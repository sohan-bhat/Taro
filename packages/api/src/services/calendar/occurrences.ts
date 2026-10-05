/**
 * Writing occurrences, for both ways Taro hears about a meeting: an invitation to its address (a
 * series) and members' connected Google Calendars (holders). One place decides what an upsert
 * changes and when MeetingBaas needs a fresh look, so both sources schedule, move, and cancel bots
 * the same way.
 */

import { CalendarOccurrenceModel } from '../../db/models';
import type { CalendarOccurrenceDoc, OccurrenceStatus } from '../../db/models/CalendarOccurrence';
import { KEEP_AFTER_END_MS, launchAtFor, type DesiredOccurrence } from './series';

const sameTime = (a?: Date, b?: Date) => (a ? a.getTime() : undefined) === (b ? b.getTime() : undefined);
const same = (a: unknown, b: unknown) =>
  a instanceof Date || b instanceof Date ? sameTime(a as Date | undefined, b as Date | undefined) : a === b;

/** A stored occurrence, as far as writing one goes. */
export type OccurrenceRow = Partial<CalendarOccurrenceDoc> & { _id: unknown; start: Date; meetUrl: string; status: OccurrenceStatus };

export interface OccurrenceWrite {
  companyId: string;
  uid: string;
  // The stored row for this occurrence, when there is one
  row?: OccurrenceRow;
  desired: DesiredOccurrence;
  status: OccurrenceStatus;
  relaunch: boolean;
  // The source's own fields: an invitation's series and people, or Google's organizer. Undefined clears one.
  values: Record<string, unknown>;
  // Google Calendar: the member whose calendar has it
  holder?: string;
}

/** Upserts one occurrence the way a plan says. Returns its ID when its MeetingBaas bot needs a look. */
export async function writeOccurrence(w: OccurrenceWrite): Promise<string | null> {
  const { companyId, uid, row, desired: d, status, relaunch } = w;
  const botMatters = !row || !sameTime(row.start, d.start) || row.meetUrl !== d.meetUrl || row.status !== status || relaunch;
  const values: Record<string, unknown> = {
    recurring: d.recurring,
    title: d.title,
    start: d.start,
    end: d.end,
    meetUrl: d.meetUrl,
    platform: d.platform,
    status,
    ...w.values,
  };
  const holderMissing = !!w.holder && !(row?.holders ?? []).includes(w.holder);
  const stored = row as Record<string, unknown> | undefined;
  if (stored && !botMatters && !holderMissing && Object.entries(values).every(([field, value]) => same(stored[field], value))) return null;

  values.launchAt = launchAtFor(d.start, d.meetUrl, relaunch ? undefined : row?.bot);
  values.expiresAt = new Date(d.end.getTime() + KEEP_AFTER_END_MS);
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};
  for (const [field, value] of Object.entries(values)) {
    if (value === undefined) $unset[field] = 1;
    else $set[field] = value;
  }
  if (status !== 'skipped') Object.assign($unset, { skipReason: 1, skippedByUserId: 1 });
  // Moved to a later time after Taro went: a new occurrence, with its own bot and meeting.
  if (relaunch) Object.assign($unset, { meetingId: 1, launchedAt: 1, bot: 1 });
  if (botMatters) $set.botDirty = true;
  const update = {
    $set,
    ...(Object.keys($unset).length ? { $unset } : {}),
    ...(botMatters ? { $inc: { botRev: 1 } } : {}),
    ...(w.holder ? { $addToSet: { holders: w.holder } } : {}),
    $setOnInsert: { companyId, uid, recurrenceKey: d.recurrenceKey },
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const saved = await CalendarOccurrenceModel.findOneAndUpdate({ companyId, uid, recurrenceKey: d.recurrenceKey }, update, {
        upsert: true,
        new: true,
      }).select('_id');
      return saved && botMatters ? String(saved._id) : null;
    } catch (error) {
      // Two writers inserted the same occurrence at once; the second goes again and lands on the first's.
      if ((error as { code?: unknown }).code !== 11000) throw error;
    }
  }
  return null;
}
