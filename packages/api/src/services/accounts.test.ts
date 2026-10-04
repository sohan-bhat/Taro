import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { CompanyModel, SlackConnectionModel, UserModel } from '../db/models';
import { MICROSOFT_PERSONAL_TENANT, type GoogleAccount, type MicrosoftAccount } from '../lib/oidc';
import {
  googleIdentity,
  linkSlackTeam,
  microsoftIdentity,
  SignInRefused,
  signInWithDirectory,
  signInWithSlack,
  unlinkSlackTeam,
} from './accounts';

// ---------------------------------------------------------------------------------------------
// A stand-in for the three collections, so sign-in runs without a database. It keeps each model's
// unique indexes (and their partial filters) and answers the queries accounts.ts makes.

type Doc = Record<string, unknown> & { _id: Types.ObjectId };
type Filter = Record<string, unknown>;

const same = (a: unknown, b: unknown) => a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b);

function matches(doc: Doc, filter: Filter): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return (condition as Filter[]).some((f) => matches(doc, f));
    const value = doc[key];
    // As in MongoDB, null matches a field that's missing or null
    if (condition === null) return value === undefined || value === null;
    if (condition && typeof condition === 'object' && !(condition instanceof Types.ObjectId) && !(condition instanceof Date)) {
      const c = condition as { $exists?: boolean; $in?: unknown[] };
      if ('$exists' in c) return (value !== undefined) === c.$exists;
      if ('$in' in c) return c.$in!.some((option) => (option === null ? value === undefined || value === null : same(value, option)));
      throw new Error(`The fake database can't match ${key}: ${JSON.stringify(condition)}`);
    }
    return same(value, condition);
  });
}

// [fields, the one that must be a string for the document to be indexed]
type Unique = [string[], string];

function collection(unique: Unique[]) {
  const docs: Doc[] = [];
  const copy = (doc: Doc) => ({ ...doc, save: async () => Object.assign(docs.find((d) => d._id.equals(doc._id))!, strip(doc)) });
  const strip = (doc: Record<string, unknown>) => Object.fromEntries(Object.entries(doc).filter(([k]) => k !== 'save'));

  function checkUnique(candidate: Doc) {
    for (const [fields, partial] of unique) {
      if (typeof candidate[partial] !== 'string') continue;
      const clash = docs.some((d) => !d._id.equals(candidate._id) && fields.every((f) => same(d[f], candidate[f])));
      if (clash) throw Object.assign(new Error(`E11000 duplicate key: ${fields.join(', ')}`), { code: 11000 });
    }
  }

  function apply(doc: Doc, update: Record<string, unknown>): Doc {
    const ops = Object.keys(update).some((k) => k.startsWith('$')) ? update : { $set: update };
    const next: Doc = { ...doc, ...((ops.$set as object) ?? {}) };
    for (const field of Object.keys((ops.$unset as object) ?? {})) delete next[field];
    return next;
  }

  const api = {
    docs,
    findOne: async (filter: Filter) => {
      const found = docs.find((d) => matches(d, filter));
      return found ? copy(found) : null;
    },
    create: async (fields: Record<string, unknown>) => {
      const doc: Doc = { _id: new Types.ObjectId(), createdAt: new Date(), ...fields };
      for (const key of Object.keys(doc)) if (doc[key] === undefined) delete doc[key];
      checkUnique(doc);
      docs.push(doc);
      return copy(doc);
    },
    findOneAndUpdate: async (filter: Filter, update: Record<string, unknown>, options: { new?: boolean } = {}) => {
      const at = docs.findIndex((d) => matches(d, filter));
      if (at < 0) return null;
      const before = docs[at];
      const after = apply(before, update);
      checkUnique(after);
      docs[at] = after;
      return copy(options.new ? after : before);
    },
    updateOne: async (filter: Filter, update: Record<string, unknown>) => {
      const at = docs.findIndex((d) => matches(d, filter));
      if (at < 0) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      const after = apply(docs[at], update);
      checkUnique(after);
      docs[at] = after;
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    },
    exists: async (filter: Filter) => (docs.some((d) => matches(d, filter)) ? { _id: docs.find((d) => matches(d, filter))!._id } : null),
  };
  return api;
}

function fakeDatabase(t: TestContext) {
  const companies = collection([
    [['slackTeamId'], 'slackTeamId'],
    [['signInWith', 'directoryId'], 'directoryId'],
  ]);
  const users = collection([
    [['slackTeamId', 'slackUserId'], 'slackUserId'],
    [['signInWith', 'accountId'], 'accountId'],
  ]);
  const slackConnections = collection([[['teamId'], 'teamId']]);
  for (const [model, fake] of [
    [CompanyModel, companies],
    [UserModel, users],
    [SlackConnectionModel, slackConnections],
  ] as const) {
    for (const method of ['findOne', 'create', 'findOneAndUpdate', 'updateOne', 'exists'] as const) {
      t.mock.method(model, method, fake[method] as never);
    }
  }
  return { companies: companies.docs, users: users.docs, slackConnections: slackConnections.docs };
}

// ---------------------------------------------------------------------------------------------
// People

const googleAccount = (sub: string, email: string, hd?: string, name = 'Priya Raman'): GoogleAccount => ({
  sub,
  email,
  hd,
  name,
  givenName: name.split(' ')[0],
  picture: `https://lh3.googleusercontent.com/a/${sub}`,
});

const ACME_PRIYA = googleAccount('1001', 'priya@acme.com', 'acme.com');
const ACME_SAM = googleAccount('1002', 'sam@acme.com', 'acme.com', 'Sam Okafor');
const GLOBEX_ANA = googleAccount('2001', 'ana@globex.com', 'globex.com', 'Ana Silva');
const GMAIL_DEV = googleAccount('3001', 'dev.patel@gmail.com', undefined, 'Dev Patel');
const GMAIL_LEE = googleAccount('3002', 'lee@gmail.com', undefined, 'Lee Chen');

const CONTOSO = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const microsoftAccount = (tid: string, oid: string, email: string, name: string): MicrosoftAccount => ({ tid, oid, email, name });
const CONTOSO_MEI = microsoftAccount(CONTOSO, '11111111-0000-0000-0000-000000000001', 'mei@contoso.com', 'Mei Tanaka');
const CONTOSO_JO = microsoftAccount(CONTOSO, '11111111-0000-0000-0000-000000000002', 'jo@contoso.com', 'Jo Byrne');
const OUTLOOK_KAI = microsoftAccount(MICROSOFT_PERSONAL_TENANT, '00000000-0000-0000-1234-56789abcdef0', 'kai@outlook.com', 'Kai Moana');

const signInGoogle = (account: GoogleAccount) => signInWithDirectory(googleIdentity(account));
const signInMicrosoft = (account: MicrosoftAccount) => signInWithDirectory(microsoftIdentity(account));

const roleOf = (users: ReturnType<typeof fakeDatabase>['users'], userId: unknown) =>
  users.find((u) => String(u._id) === String(userId))?.role;

// ---------------------------------------------------------------------------------------------
// Which workspace an account belongs to

test('a Google Workspace account belongs to the workspace for its domain, named after it', () => {
  const identity = googleIdentity(ACME_PRIYA);
  assert.equal(identity.provider, 'google');
  assert.equal(identity.accountId, '1001');
  assert.equal(identity.directoryId, 'acme.com');
  assert.equal(identity.personal, false);
  assert.equal(identity.workspaceName, 'acme.com');
  assert.equal(googleIdentity(ACME_SAM).directoryId, identity.directoryId);
  assert.notEqual(googleIdentity(GLOBEX_ANA).directoryId, identity.directoryId);
});

test('a Gmail account gets a workspace of its own, named after the person', () => {
  const identity = googleIdentity(GMAIL_DEV);
  assert.equal(identity.directoryId, 'user:3001');
  assert.equal(identity.personal, true);
  assert.equal(identity.workspaceName, "Dev's workspace");
  assert.notEqual(googleIdentity(GMAIL_LEE).directoryId, identity.directoryId);
});

test('a Microsoft work account belongs to the workspace for its tenant, named after its email domain', () => {
  const identity = microsoftIdentity(CONTOSO_MEI);
  assert.equal(identity.accountId, `${CONTOSO}:11111111-0000-0000-0000-000000000001`);
  assert.equal(identity.directoryId, CONTOSO);
  assert.equal(identity.personal, false);
  assert.equal(identity.workspaceName, 'contoso.com');
  assert.equal(microsoftIdentity(CONTOSO_JO).directoryId, CONTOSO);
  assert.equal(microsoftIdentity({ ...CONTOSO_MEI, email: undefined }).workspaceName, 'My workspace');
});

test('a personal Microsoft account gets a workspace of its own', () => {
  const identity = microsoftIdentity(OUTLOOK_KAI);
  assert.equal(identity.directoryId, 'user:00000000-0000-0000-1234-56789abcdef0');
  assert.equal(identity.personal, true);
  assert.equal(identity.workspaceName, "Kai's workspace");
});

// ---------------------------------------------------------------------------------------------
// Signing in

test('the first person from a domain creates its workspace and owns it; colleagues join as members', async (t) => {
  const db = fakeDatabase(t);
  const first = await signInGoogle(ACME_PRIYA);
  assert.equal(first.user.role, 'owner');
  assert.equal(db.companies.length, 1);
  assert.equal(db.companies[0].name, 'acme.com');
  assert.equal(db.companies[0].signInWith, 'google');
  assert.ok(db.companies[0].ownerClaimedAt, 'the workspace records its owner');
  assert.equal(roleOf(db.users, first.user._id), 'owner');

  const colleague = await signInGoogle(ACME_SAM);
  assert.equal(String(colleague.company._id), String(first.company._id));
  assert.equal(colleague.user.role, 'member');
  assert.equal(roleOf(db.users, colleague.user._id), 'member');
  assert.equal(db.companies.length, 1);

  // Another company is another workspace, with its own first owner
  const other = await signInGoogle(GLOBEX_ANA);
  assert.notEqual(String(other.company._id), String(first.company._id));
  assert.equal(other.user.role, 'owner');
});

test('signing in again finds the same person and keeps the role an owner gave them', async (t) => {
  const db = fakeDatabase(t);
  await signInGoogle(ACME_PRIYA);
  const sam = await signInGoogle(ACME_SAM);
  const record = db.users.find((u) => String(u._id) === String(sam.user._id))!;
  record.role = 'admin';

  const again = await signInGoogle({ ...ACME_SAM, name: 'Sam O.' });
  assert.equal(String(again.user._id), String(sam.user._id));
  assert.equal(again.user.role, 'admin');
  assert.equal(record.role, 'admin');
  assert.equal(db.users.find((u) => String(u._id) === String(sam.user._id))?.name, 'Sam O.');
  assert.equal(db.users.length, 2);
});

test('two colleagues signing in at the same moment share one workspace with one owner', async (t) => {
  const db = fakeDatabase(t);
  const [a, b] = await Promise.all([signInGoogle(ACME_PRIYA), signInGoogle(ACME_SAM)]);
  assert.equal(String(a.company._id), String(b.company._id));
  assert.equal(db.companies.length, 1);
  assert.deepEqual(db.users.map((u) => u.role).sort(), ['member', 'owner']);
});

test('personal accounts each get their own workspace, owned by that person', async (t) => {
  const db = fakeDatabase(t);
  const dev = await signInGoogle(GMAIL_DEV);
  const lee = await signInGoogle(GMAIL_LEE);
  const kai = await signInMicrosoft(OUTLOOK_KAI);
  assert.equal(new Set([dev, lee, kai].map((s) => String(s.company._id))).size, 3);
  assert.deepEqual([dev, lee, kai].map((s) => s.user.role), ['owner', 'owner', 'owner']);
  assert.ok(db.companies.every((c) => c.personal === true));
  assert.deepEqual(db.companies.map((c) => c.name), ["Dev's workspace", "Lee's workspace", "Kai's workspace"]);
});

test('Microsoft colleagues in one tenant land together, apart from the same people on Google', async (t) => {
  const db = fakeDatabase(t);
  const mei = await signInMicrosoft(CONTOSO_MEI);
  const jo = await signInMicrosoft(CONTOSO_JO);
  assert.equal(String(mei.company._id), String(jo.company._id));
  assert.deepEqual([mei.user.role, jo.user.role], ['owner', 'member']);
  assert.equal(db.companies[0].directoryId, CONTOSO);
  assert.equal(db.companies[0].name, 'contoso.com');

  // A Google domain that happens to match is a different directory, so a different workspace
  const google = await signInGoogle(googleAccount('5001', 'mei@contoso.com', 'contoso.com', 'Mei Tanaka'));
  assert.notEqual(String(google.company._id), String(mei.company._id));
});

test('someone an owner removed is turned away', async (t) => {
  const db = fakeDatabase(t);
  await signInGoogle(ACME_PRIYA);
  const sam = await signInGoogle(ACME_SAM);
  db.users.find((u) => String(u._id) === String(sam.user._id))!.removedAt = new Date();
  await assert.rejects(signInGoogle(ACME_SAM), (error) => error instanceof SignInRefused && error.code === 'removed');
});

// ---------------------------------------------------------------------------------------------
// Adding Slack to a Google or Microsoft workspace

test('a Google workspace can connect a Slack team nobody else has, and let it go again', async (t) => {
  const db = fakeDatabase(t);
  const { company } = await signInGoogle(ACME_PRIYA);
  const id = String(company._id);
  assert.equal(await linkSlackTeam(id, 'T0ACME'), 'linked');
  assert.equal(db.companies[0].slackTeamId, 'T0ACME');
  // The install then saves the bot's connection
  db.slackConnections.push({ _id: new Types.ObjectId(), companyId: id, teamId: 'T0ACME' });
  // Adding Taro to the same team again is fine
  assert.equal(await linkSlackTeam(id, 'T0ACME'), 'linked');
  // A second team waits until the first is removed
  assert.equal(await linkSlackTeam(id, 'T0OTHER'), 'other_team');
  assert.equal(db.companies[0].slackTeamId, 'T0ACME');

  // Removing Slack deletes the connection and lets the team go
  db.slackConnections.splice(0);
  await unlinkSlackTeam(id);
  assert.equal(db.companies[0].slackTeamId, undefined);
  assert.equal(await linkSlackTeam(id, 'T0OTHER'), 'linked');
});

test("a Slack install that never finished doesn't keep a workspace from adding another team", async (t) => {
  const db = fakeDatabase(t);
  const { company } = await signInMicrosoft(CONTOSO_MEI);
  const id = String(company._id);
  // Linked, but the bot's connection was never saved
  assert.equal(await linkSlackTeam(id, 'T0STALE'), 'linked');
  assert.equal(await linkSlackTeam(id, 'T0CONTOSO'), 'linked');
  assert.equal(db.companies[0].slackTeamId, 'T0CONTOSO');
});

test('a Slack team that already belongs to another Taro workspace is refused', async (t) => {
  const db = fakeDatabase(t);
  // A Slack workspace, made when someone signed in with Slack
  db.companies.push({ _id: new Types.ObjectId(), name: 'Acme', slackTeamId: 'T0SLACK', ownerClaimedAt: new Date() });
  const { company } = await signInGoogle(ACME_PRIYA);
  assert.equal(await linkSlackTeam(String(company._id), 'T0SLACK'), 'taken');
  assert.equal(db.companies.find((c) => String(c._id) === String(company._id))?.slackTeamId, undefined);

  // A team another Google or Microsoft workspace connected
  const mei = await signInMicrosoft(CONTOSO_MEI);
  assert.equal(await linkSlackTeam(String(mei.company._id), 'T0CONTOSO'), 'linked');
  db.slackConnections.push({ _id: new Types.ObjectId(), companyId: String(mei.company._id), teamId: 'T0CONTOSO' });
  assert.equal(await linkSlackTeam(String(company._id), 'T0CONTOSO'), 'taken');
});

test('a Slack workspace keeps its team when Slack is removed', async (t) => {
  const db = fakeDatabase(t);
  const id = new Types.ObjectId();
  db.companies.push({ _id: id, name: 'Acme', slackTeamId: 'T0SLACK' });
  await unlinkSlackTeam(String(id));
  assert.equal(db.companies[0].slackTeamId, 'T0SLACK');
});

test('signing in with Slack from a team a Google or Microsoft workspace connected points to that sign-in', async (t) => {
  const db = fakeDatabase(t);
  const acme = await signInGoogle(ACME_PRIYA);
  await linkSlackTeam(String(acme.company._id), 'T0ACME');
  const contoso = await signInMicrosoft(CONTOSO_MEI);
  await linkSlackTeam(String(contoso.company._id), 'T0CONTOSO');

  const slackPerson = { teamName: 'Acme', userId: 'U0SAM', name: 'Sam Okafor' };
  await assert.rejects(
    signInWithSlack({ ...slackPerson, teamId: 'T0ACME' }),
    (error) => error instanceof SignInRefused && error.code === 'use_google'
  );
  await assert.rejects(
    signInWithSlack({ ...slackPerson, teamId: 'T0CONTOSO' }),
    (error) => error instanceof SignInRefused && error.code === 'use_microsoft'
  );
  // Nobody was added under a second sign-in
  assert.equal(db.users.length, 2);
  assert.ok(db.users.every((u) => !u.slackUserId));
});
