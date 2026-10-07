import type { TrackerId, TrackerSpace } from '@taro/shared';

export type TicketResult =
  | { success: true; key: string; url: string; names?: string[] }
  | {
      success: false;
      error: string;
      // The tracker answered with this HTTP status; unset when it couldn't be reached
      status?: number;
      notFound?: boolean;
      // Its access was refused; an owner or admin has to connect again
      reconnect?: boolean;
      // Assigning: the people nobody there matched
      missingPeople?: string[];
    };

/** What Taro does in Linear or Jira, the same way for both. Keys are normalized (ENG-123) before they get here. */
export interface Tracker {
  id: TrackerId;
  name: string;
  spaces: readonly TrackerSpace[];
  // The team or project new tickets go to, by key
  defaultSpaceKey?: string;
  enabledActions: readonly string[];
  needsReconnect?: boolean;
  createTicket(title: string, body?: string): Promise<TicketResult>;
  comment(key: string, body: string): Promise<TicketResult>;
  close(key: string): Promise<TicketResult>;
  reopen(key: string): Promise<TicketResult>;
  assign(key: string, people: readonly string[]): Promise<TicketResult>;
  addLabels(key: string, labels: readonly string[]): Promise<TicketResult>;
}

/** Picks the people someone named out of a tracker's members: exact names first, then first names, then a unique partial match. */
export function matchPeople<T>(
  wanted: readonly string[],
  people: readonly T[],
  namesOf: (p: T) => ReadonlyArray<string | undefined>
): { found: T[]; missing: string[] } {
  const found: T[] = [];
  const missing: string[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]+/g, ' ').trim();
  for (const name of wanted) {
    const target = norm(name);
    if (!target) continue;
    const names = (p: T) => namesOf(p).filter((n): n is string => !!n).map(norm);
    const tiers = [
      people.filter((p) => names(p).includes(target)),
      people.filter((p) => names(p).some((n) => n.split(' ')[0] === target)),
      people.filter((p) => names(p).some((n) => n.includes(target))),
    ];
    const hit = tiers.find((t) => t.length === 1)?.[0] ?? tiers[0][0];
    if (hit && !found.includes(hit)) found.push(hit);
    else if (!hit) missing.push(name);
  }
  return { found, missing };
}
