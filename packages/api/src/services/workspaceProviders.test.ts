import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { COPY } from '@taro/shared';
import { env } from '../config/env';
import { CompanyModel, MeetingModel } from '../db/models';
import { encryptSecret } from '../lib/crypto';
import { LaunchError, launchMeeting } from './meetingLauncher';
import { MeetingBaasClient, MeetingBaasError } from './meetingbaas';
import { keyContext, providerReadiness, providerSettings, resolveProviders } from './workspaceProviders';

const ID = '64b000000000000000000001';

function company(providers: Record<string, unknown> = {}) {
  return { _id: ID, providers } as never;
}

const ownLlm = {
  llm: { provider: 'anthropic', model: 'claude-sonnet-5-5', keyEnc: encryptSecret('sk-ant-own', keyContext(ID, 'llm')), keyHint: 'own' },
};

function shareKey(t: TestContext, key: string | undefined) {
  const shared = env as { sharedGroqKey?: string };
  const before = shared.sharedGroqKey;
  shared.sharedGroqKey = key;
  t.after(() => {
    shared.sharedGroqKey = before;
  });
}

test('without a shared key, nothing is filled in for the workspace', (t) => {
  shareKey(t, undefined);
  const p = resolveProviders(company());
  assert.equal(p.llm, null);
  assert.equal(p.shared, false);
  assert.equal(providerReadiness(company()).llm, false);
});

test('the shared Groq key covers whatever the workspace has not set up, and only that', (t) => {
  shareKey(t, 'gsk_shared');
  const empty = resolveProviders(company());
  assert.deepEqual(empty.llm, { provider: 'groq', apiKey: 'gsk_shared', model: 'openai/gpt-oss-120b' });
  assert.equal(empty.shared, true);
  assert.equal(providerSettings(company()).llm.shared, true);
  assert.equal(providerReadiness(company()).llm, true);

  const own = resolveProviders(company(ownLlm));
  assert.equal(own.llm?.apiKey, 'sk-ant-own');
  assert.equal(providerSettings(company(ownLlm)).llm.shared, undefined);
});

function fakeLaunch(t: TestContext, usedThisMonth: number) {
  t.mock.method(CompanyModel, 'findById', (async () => ({
    _id: ID,
    providers: { meetingBaas: { keyEnc: encryptSecret('mb_key', keyContext(ID, 'meetingBaas')) } },
  })) as never);
  t.mock.method(MeetingModel, 'findOne', (async () => null) as never);
  t.mock.method(MeetingModel, 'countDocuments', (async (q: { sharedKey?: boolean }) => (q.sharedKey ? usedThisMonth : 0)) as never);
  const created: Array<Record<string, unknown>> = [];
  t.mock.method(MeetingModel, 'create', (async (doc: Record<string, unknown>) => {
    created.push(doc);
    return { ...doc, _id: 'm1', save: async () => {} };
  }) as never);
  // The bot never goes anywhere in a test
  t.mock.method(MeetingBaasClient.prototype, 'joinMeeting', async () => {
    throw new MeetingBaasError('offline', 0);
  });
  return created;
}

const LINK = { url: 'https://meet.google.com/abc-defg-hij', platform: 'google_meet' } as const;

test('a meeting on the shared key is marked so it counts toward the month', async (t) => {
  shareKey(t, 'gsk_shared');
  const created = fakeLaunch(t, 3);
  await assert.rejects(launchMeeting({ companyId: ID, link: LINK, source: 'dashboard' }), LaunchError);
  assert.equal(created[0].sharedKey, true);
});

test('once the free meetings are used, Taro says how to keep going and sends no bot', async (t) => {
  shareKey(t, 'gsk_shared');
  const created = fakeLaunch(t, env.sharedMeetingsPerMonth);
  await assert.rejects(launchMeeting({ companyId: ID, link: LINK, source: 'dashboard' }), (error: LaunchError) => {
    assert.equal(error.message, COPY.freeMeetingsUsed(env.sharedMeetingsPerMonth));
    assert.equal(error.code, 'limit');
    return true;
  });
  assert.equal(created.length, 0);
});
