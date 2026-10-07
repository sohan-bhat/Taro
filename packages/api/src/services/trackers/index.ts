/**
 * Linear and Jira behind one interface. A workspace can connect either or both; a ticket goes to the
 * tracker someone named, else the one whose team or project prefix the ticket key has, else the
 * workspace's choice for new tickets, else the only one connected.
 */

import type { IntentParams, TrackerId } from '@taro/shared';
import { CompanyModel, JiraConnectionModel, LinearConnectionModel } from '../../db/models';
import { log, errorMessage } from '../../lib/logger';
import { JiraService } from './jira';
import { LinearService } from './linear';
import { trackerForKey } from './refs';
import type { Tracker } from './types';

export type { Tracker, TicketResult } from './types';
export { normalizeTicketKey } from './refs';

export interface Trackers {
  linear?: Tracker;
  jira?: Tracker;
  // The workspace's choice for new tickets, when both are connected
  preferred?: TrackerId;
}

export async function loadTrackers(companyId: string): Promise<Trackers> {
  const [linear, jira, company] = await Promise.all([
    LinearConnectionModel.findOne({ companyId }),
    JiraConnectionModel.findOne({ companyId }),
    CompanyModel.findById(companyId, 'ticketTracker'),
  ]);
  const out: Trackers = { preferred: company?.ticketTracker };
  if (linear) out.linear = new LinearService(linear);
  if (jira) {
    try {
      out.jira = new JiraService(jira);
    } catch (error) {
      // A key that no longer decrypts (ENCRYPTION_KEY changed) reads as not connected
      log.error(`[Jira] Workspace ${companyId}'s connection can't be read:`, errorMessage(error));
    }
  }
  return out;
}

export const anyTracker = (t: Trackers) => !!(t.linear || t.jira);

/**
 * Which tracker a request goes to. `named` is set when they asked for one by name and it isn't
 * connected, so Taro can say so instead of quietly using the other.
 */
export function chooseTracker(p: Pick<IntentParams, 'tracker' | 'ticket'>, t: Trackers): { tracker?: Tracker; named?: TrackerId } {
  if (p.tracker) return t[p.tracker] ? { tracker: t[p.tracker] } : { named: p.tracker };
  const connected = [t.linear, t.jira].filter((x): x is Tracker => !!x);
  const byKey = trackerForKey(
    p.ticket,
    connected.map((x) => ({ id: x.id, spaces: x.spaces }))
  );
  if (byKey) return { tracker: t[byKey] };
  if (t.preferred && t[t.preferred]) return { tracker: t[t.preferred] };
  return { tracker: connected[0] };
}

/** One line for the model: what's connected, so "file a ticket" lands in the right place. */
export function describeTools(tools: { slack: boolean; github?: string; trackers: Trackers }): string {
  const parts: string[] = [];
  if (tools.slack) parts.push('Slack');
  if (tools.github) parts.push(`GitHub (${tools.github})`);
  for (const tracker of [tools.trackers.linear, tools.trackers.jira]) {
    if (!tracker) continue;
    const keys = tracker.spaces.map((s) => s.key).slice(0, 12).join(', ');
    parts.push(`${tracker.name}${keys ? ` (ticket prefixes: ${keys}${tracker.defaultSpaceKey ? `; new tickets go to ${tracker.defaultSpaceKey}` : ''})` : ''}`);
  }
  if (tools.trackers.linear && tools.trackers.jira && tools.trackers.preferred) {
    parts.push(`unnamed tickets go to ${tools.trackers.preferred === 'linear' ? 'Linear' : 'Jira'}`);
  }
  return parts.length ? parts.join('; ') : 'nothing yet';
}
