import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { COPY } from '@taro/shared';
import { MeetingBaasClient, MeetingBaasError } from './meetingbaas';

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  key?: string;
}

function fakeMeetingBaas(t: TestContext, answer: (call: Call) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  t.mock.method(globalThis, 'fetch', (async (url: string | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      path: String(url).replace('https://api.meetingbaas.com/v2', ''),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      key: (init?.headers as Record<string, string> | undefined)?.['x-meeting-baas-api-key'],
    };
    calls.push(call);
    const { status, body } = answer(call);
    return new Response(body === undefined ? '' : JSON.stringify(body), { status });
  }) as never);
  return calls;
}

const BOT = { meetingUrl: 'https://meet.google.com/kdp-wqmx-tvr', botName: 'Taro', meetingId: '6a1f00000000000000000003', secret: 's3cret' };

test('a scheduled bot is set up exactly like one sent now, plus the time to join', async (t) => {
  const calls = fakeMeetingBaas(t, () => ({ status: 201, body: { success: true, data: { bot_id: '1b2c3d4e-0000-4000-8000-000000000001' } } }));
  const client = new MeetingBaasClient('mb-key');
  await client.joinMeeting(BOT);
  const joinAt = new Date('2026-10-07T21:00:00Z');
  const { botId } = await client.scheduleBot({ ...BOT, joinAt });
  assert.equal(botId, '1b2c3d4e-0000-4000-8000-000000000001');

  const [now, scheduled] = calls;
  assert.equal(now.path, '/bots');
  assert.equal(scheduled.method, 'POST');
  assert.equal(scheduled.path, '/bots/scheduled');
  assert.equal(scheduled.key, 'mb-key');
  // MeetingBaas takes UTC with a Z.
  assert.equal(scheduled.body!.join_at, '2026-10-07T21:00:00.000Z');
  const { join_at: _joinAt, ...rest } = scheduled.body!;
  assert.deepEqual(rest, now.body);
  assert.equal((rest.streaming_config as Record<string, string>).input_url, 'wss://api.taro.test/ws/audio-in/6a1f00000000000000000003/s3cret');
  assert.deepEqual(rest.callback_config, { url: 'https://api.taro.test/api/webhooks/meetingbaas', method: 'POST', secret: 's3cret' });
  assert.deepEqual(rest.extra, { taroMeetingId: '6a1f00000000000000000003' });
});

test('moving, checking, and canceling a scheduled bot', async (t) => {
  const calls = fakeMeetingBaas(t, (call) =>
    call.method === 'GET' ? { status: 200, body: { success: true, data: { status: 'scheduled' } } } : { status: 200, body: { success: true, data: { message: 'ok' } } }
  );
  const client = new MeetingBaasClient('mb-key');
  await client.moveScheduledBot('bot-1', { joinAt: new Date('2026-10-07T22:00:00Z'), meetingUrl: 'https://zoom.us/j/99887766554' });
  assert.equal(await client.scheduledBotStatus('bot-1'), 'scheduled');
  await client.cancelScheduledBot('bot-1');
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    ['PATCH /bots/scheduled/bot-1', 'GET /bots/scheduled/bot-1', 'DELETE /bots/scheduled/bot-1']
  );
  assert.deepEqual(calls[0].body, { join_at: '2026-10-07T22:00:00.000Z', meeting_url: 'https://zoom.us/j/99887766554' });
});

test('scheduled bot errors read like the rest, and keep their status for callers', async (t) => {
  let status = 401;
  fakeMeetingBaas(t, () => ({ status, body: { success: false, error: 'Conflict', message: 'Bot status does not allow update or join time too close' } }));
  const client = new MeetingBaasClient('mb-key');
  await assert.rejects(client.scheduleBot({ ...BOT, joinAt: new Date() }), (error: unknown) => {
    assert.ok(error instanceof MeetingBaasError);
    assert.equal(error.message, COPY.meetingBaasKeyRejected);
    return true;
  });
  status = 409;
  await assert.rejects(client.cancelScheduledBot('bot-1'), (error: unknown) => {
    assert.ok(error instanceof MeetingBaasError);
    assert.equal(error.status, 409);
    assert.match(error.message, /^MeetingBaas returned an error \(409\)\. Bot status does not allow update or join time too close\.$/);
    return true;
  });
  status = 404;
  await assert.rejects(client.moveScheduledBot('bot-1', { joinAt: new Date() }), (error: unknown) => error instanceof MeetingBaasError && error.status === 404);
});
