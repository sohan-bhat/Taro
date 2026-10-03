// Explicit public shapes for API responses. Documents are never sent raw, so a
// field added to a model later (an encrypted key, a secret hash, a legacy
// license key) can't leak to the browser by accident.

import type { ActionLog, Meeting, MeetingTally, User, Workspace } from '@taro/shared';
import type { CompanyDoc } from '../db/models/Company';
import type { UserDoc } from '../db/models/User';
import type { MeetingDoc } from '../db/models/Meeting';
import type { ActionLogDoc } from '../db/models/ActionLog';
import { env } from '../config/env';

type WithId<T> = T & { _id: unknown };

const iso = (d: Date | undefined | null) => (d ? new Date(d).toISOString() : undefined);

export function publicWorkspace(c: WithId<CompanyDoc>): Workspace {
  return {
    _id: String(c._id),
    name: c.name,
    slackTeamId: c.slackTeamId,
    slackTeamDomain: c.slackTeamDomain,
    botName: c.botName || env.defaultBotName,
    onboardedAt: iso(c.onboardedAt),
    claimed: !!c.ownerClaimedAt,
    createdAt: iso(c.createdAt)!,
  };
}

export function publicUser(u: WithId<UserDoc>): User {
  return {
    _id: String(u._id),
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    role: u.role,
    lastSeenAt: iso(u.lastSeenAt),
    ...(u.removedAt ? { removed: true } : {}),
  };
}

// The meetings list passes each meeting's request tally; single-meeting responses leave it out.
export function publicMeeting(m: WithId<MeetingDoc>, tally?: MeetingTally): Meeting {
  return {
    _id: String(m._id),
    meetUrl: m.meetUrl,
    platform: m.platform,
    status: m.status,
    source: m.source,
    startedByName: m.startedByName,
    slackChannelName: m.slackChannelName,
    title: m.title,
    errorMessage: m.errorMessage,
    errorCode: m.errorCode,
    ...(tally ? { tally } : {}),
    archivedAt: iso(m.archivedAt),
    transcript: m.transcript,
    liveTranscript: m.liveTranscript,
    lastAudioAt: iso(m.lastAudioAt),
    startedAt: iso(m.startedAt),
    endedAt: iso(m.endedAt),
    createdAt: iso(m.createdAt)!,
  };
}

export function publicActionLog(l: WithId<ActionLogDoc>): ActionLog {
  return {
    _id: String(l._id),
    meetingId: l.meetingId,
    command: l.command,
    intent: l.intent,
    status: l.status,
    outcome: l.outcome,
    summary: l.summary,
    branch: l.branch,
    mode: l.mode,
    result: l.result,
    errorMessage: l.errorMessage,
    createdAt: iso(l.createdAt)!,
  };
}
