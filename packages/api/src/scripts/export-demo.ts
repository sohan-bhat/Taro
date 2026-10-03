/**
 * Freezes one real workspace into the static snapshot behind /demo
 * (apps/web/src/demo/snapshot.ts). Anything still live is written as ended,
 * so nothing on the page moves. Only the fields listed below are read; keys,
 * tokens, and secrets never reach the snapshot.
 *
 *   pnpm --filter @taro/api export-demo --company <id> --since <ISO date> \
 *     --feature <meetingId> --time-zone America/Los_Angeles
 *
 * --company    the workspace to export; without it, the one with the most requests
 * --since      only meetings created at or after this time (the recorded session)
 * --feature    the meeting /demo opens on
 * --time-zone  the IANA zone every time on /demo is shown in (default America/Los_Angeles)
 */
import '../config/env';
import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';
import { isValidObjectId } from 'mongoose';
import { DEFAULT_GITHUB_ACTIONS } from '@taro/shared';
import { connectDB, mongoose } from '../db/mongo';
import { ActionLogModel, CompanyModel, GithubConnectionModel, MeetingModel, SlackConnectionModel } from '../db/models';
import { inferOutcome } from '../services/outcomes';

const OUT = path.resolve(__dirname, '../../../../apps/web/src/demo/snapshot.ts');
const DEFAULT_TIME_ZONE = 'America/Los_Angeles';
const MAX_MEETINGS = 50;
// A meeting's detail returns at most this many requests
const MAX_LOGS = 50;
const COMPANY_FIELDS = 'name slackTeamDomain onboardedAt createdAt updatedAt';

interface Options {
  company?: string;
  since?: Date;
  feature?: string;
  timeZone: string;
}

function readOptions(): Options {
  const { values } = parseArgs({
    // pnpm hands a bare "--" through to the script
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      company: { type: 'string' },
      since: { type: 'string' },
      feature: { type: 'string' },
      'time-zone': { type: 'string' },
    },
  });

  if (values.company && !isValidObjectId(values.company)) {
    throw new Error(`--company ${values.company} isn't a workspace ID.`);
  }
  const since = values.since ? new Date(values.since) : undefined;
  if (since && Number.isNaN(since.getTime())) {
    throw new Error(`--since ${values.since} isn't a date. Use ISO 8601, like 2026-09-30T18:00:00Z.`);
  }
  let timeZone: string;
  try {
    // Also turns "america/los_angeles" into the canonical spelling
    timeZone = new Intl.DateTimeFormat('en-US', { timeZone: values['time-zone'] ?? DEFAULT_TIME_ZONE }).resolvedOptions()
      .timeZone;
  } catch {
    throw new Error(`--time-zone ${values['time-zone']} isn't an IANA time zone, like America/Los_Angeles.`);
  }
  return { company: values.company, since, feature: values.feature, timeZone };
}

async function pickCompany(opts: Options) {
  if (opts.company) {
    const company = await CompanyModel.findById(opts.company).select(COMPANY_FIELDS).lean();
    if (!company) throw new Error(`No workspace has the ID ${opts.company}.`);
    return company;
  }

  // The workspace with the most requests in the window, then the most meetings
  const window = opts.since ? { createdAt: { $gte: opts.since } } : {};
  const companies = await CompanyModel.find().select(COMPANY_FIELDS).lean();
  const scored = await Promise.all(
    companies.map(async (company) => {
      const companyId = String(company._id);
      const [meetings, requests] = await Promise.all([
        MeetingModel.countDocuments({ companyId, ...window }),
        ActionLogModel.countDocuments({ companyId, ...window }),
      ]);
      return { company, meetings, requests };
    })
  );
  scored.sort((a, b) => b.requests - a.requests || b.meetings - a.meetings);
  for (const s of scored) console.log(`  ${s.company.name} (${s.company._id}): ${s.meetings} meetings, ${s.requests} requests`);
  if (!scored[0]) throw new Error('No workspaces found.');
  return scored[0].company;
}

async function main() {
  const opts = readOptions();
  await connectDB();

  const company = await pickCompany(opts);
  const companyId = String(company._id);
  console.log(`\nExporting ${company.name} (${companyId})`);

  const [slack, github] = await Promise.all([
    SlackConnectionModel.findOne({ companyId }).select('teamName createdAt').lean(),
    GithubConnectionModel.findOne({ companyId }).select('installationId accountLogin repo enabledActions disconnectedAt createdAt').lean(),
  ]);

  // Archived meetings are included: the demo shows everything in the window as history.
  const meetingDocs = await MeetingModel.find({ companyId, ...(opts.since ? { createdAt: { $gte: opts.since } } : {}) })
    .sort({ createdAt: -1 })
    .limit(MAX_MEETINGS)
    .lean();
  if (opts.feature && !meetingDocs.some((m) => String(m._id) === opts.feature)) {
    throw new Error(`--feature ${opts.feature} isn't one of the exported meetings.`);
  }

  const meetings = meetingDocs.map((m) => ({
    _id: String(m._id),
    companyId: m.companyId,
    meetUrl: m.meetUrl,
    platform: m.platform,
    // Nothing on /demo is live, so a meeting caught mid-call is shown as over
    status: m.status === 'error' ? 'error' : 'ended',
    source: m.source,
    startedByName: m.startedByName,
    slackChannelName: m.slackChannelName,
    errorCode: m.errorCode,
    errorMessage: m.errorMessage,
    transcript: m.transcript || undefined,
    // What was heard live stands in only when no final transcript was saved
    liveTranscript: m.transcript ? undefined : m.liveTranscript || undefined,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    startedAt: m.startedAt,
    endedAt: m.endedAt,
  }));

  const logDocs = await ActionLogModel.find({ meetingId: { $in: meetings.map((m) => m._id) } })
    .sort({ createdAt: -1 })
    .lean();
  const details = Object.fromEntries(
    meetings.map((meeting) => [
      meeting._id,
      {
        ...meeting,
        // Newest first, as GET /api/meetings/:id returns them
        actionLogs: logDocs
          .filter((l) => l.meetingId === meeting._id)
          .slice(0, MAX_LOGS)
          .map((l) => ({
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
            createdAt: l.createdAt,
          })),
      },
    ])
  );

  const snapshot = {
    capturedAt: new Date().toISOString(),
    timeZone: opts.timeZone,
    ...(opts.feature ? { featuredMeetingId: opts.feature } : {}),
    company: {
      _id: companyId,
      name: company.name,
      domain: company.slackTeamDomain ?? '',
      onboardedAt: company.onboardedAt,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
    },
    slack: {
      connected: !!slack,
      teamName: slack?.teamName,
      connectedAt: slack?.createdAt,
    },
    github: {
      connected: !!(github?.installationId && !github.disconnectedAt),
      configured: true,
      accountLogin: github?.accountLogin,
      repo: github?.repo,
      needsRepo: !github?.repo,
      // Unset means the defaults; an empty list means everything is off
      enabledActions: github?.enabledActions ?? DEFAULT_GITHUB_ACTIONS,
      connectedAt: github?.createdAt,
    },
    meetings,
    details,
  };

  const banner =
    '// AUTO-GENERATED by packages/api/src/scripts/export-demo.ts. A frozen snapshot of\n' +
    '// real workspace data for the no-backend demo. Regenerate, do not hand-edit.\n';
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${banner}export const snapshot = ${JSON.stringify(snapshot, null, 2)} as const;\n`);

  const outcomes = new Map<string, number>();
  for (const l of Object.values(details).flatMap((d) => d.actionLogs)) {
    const outcome = l.outcome ?? inferOutcome(l.status, l.intent.action, snapshot.github.enabledActions);
    outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
  }
  console.log(`\nWrote ${OUT}`);
  console.log(`${meetings.length} meetings; requests by outcome: ${JSON.stringify(Object.fromEntries(outcomes))}`);
  console.log(`Times are ${opts.timeZone}. Opens on ${opts.feature ?? 'the most recent meeting with a done request'}.`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error('Export failed:', error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
