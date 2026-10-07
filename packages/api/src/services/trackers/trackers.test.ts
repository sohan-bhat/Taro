import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToAdf } from './adf';
import { normalizeTicketKey, trackerForKey } from './refs';
import { matchPeople, type Tracker } from './types';
import { chooseTracker, describeTools } from './index';
import { parseConnectionKey, pickIssueType, signJiraRequest } from './jira';

test('reads ticket keys the way people say them', () => {
  assert.equal(normalizeTicketKey('ENG-123'), 'ENG-123');
  assert.equal(normalizeTicketKey('eng 123'), 'ENG-123');
  assert.equal(normalizeTicketKey('ENG123'), 'ENG-123');
  assert.equal(normalizeTicketKey('ticket 42', 'OPS'), 'OPS-42');
  assert.equal(normalizeTicketKey('#7', 'OPS'), 'OPS-7');
  assert.equal(normalizeTicketKey('007', 'OPS'), 'OPS-7');
  assert.equal(normalizeTicketKey('42'), null);
  assert.equal(normalizeTicketKey('the login bug', 'ENG'), null);
  assert.equal(normalizeTicketKey('ENG-12/../../admin'), null);
});

test('a ticket prefix picks the tracker that owns it', () => {
  const trackers = [
    { id: 'linear' as const, spaces: [{ id: '1', key: 'ENG', name: 'Engineering' }] },
    { id: 'jira' as const, spaces: [{ id: 'OPS', key: 'OPS', name: 'Operations' }] },
  ];
  assert.equal(trackerForKey('ops 12', trackers), 'jira');
  assert.equal(trackerForKey('ENG-4', trackers), 'linear');
  assert.equal(trackerForKey('12', trackers), undefined);
  assert.equal(trackerForKey('DES-1', trackers), undefined);
});

function fake(id: 'linear' | 'jira', keys: string[]): Tracker {
  const none = async () => ({ success: false as const, error: 'unused' });
  return {
    id,
    name: id === 'linear' ? 'Linear' : 'Jira',
    spaces: keys.map((key) => ({ id: key, key, name: key })),
    defaultSpaceKey: keys[0],
    enabledActions: [],
    createTicket: none,
    comment: none,
    close: none,
    reopen: none,
    assign: none,
    addLabels: none,
  };
}

test('chooses the named tracker, then the key prefix, then the preferred one', () => {
  const linear = fake('linear', ['ENG']);
  const jira = fake('jira', ['OPS']);
  assert.equal(chooseTracker({ tracker: 'jira' }, { linear, jira }).tracker, jira);
  assert.deepEqual(chooseTracker({ tracker: 'jira' }, { linear }), { named: 'jira' });
  assert.equal(chooseTracker({ ticket: 'OPS-3' }, { linear, jira, preferred: 'linear' }).tracker, jira);
  assert.equal(chooseTracker({}, { linear, jira, preferred: 'jira' }).tracker, jira);
  assert.equal(chooseTracker({}, { jira }).tracker, jira);
  assert.equal(chooseTracker({}, {}).tracker, undefined);
});

test('tells the model what is connected', () => {
  const line = describeTools({ slack: true, github: 'acme/web', trackers: { linear: fake('linear', ['ENG', 'DES']) } });
  assert.equal(line, 'Slack; GitHub (acme/web); Linear (ticket prefixes: ENG, DES; new tickets go to ENG)');
  assert.equal(describeTools({ slack: false, trackers: {} }), 'nothing yet');
});

test('matches people by full name, first name, then a unique partial', () => {
  const people = [
    { id: 'a', name: 'Priya Raman' },
    { id: 'b', name: 'Sam Ortiz' },
    { id: 'c', name: 'Samira Khan' },
  ];
  const names = (p: (typeof people)[number]) => [p.name];
  assert.deepEqual(matchPeople(['priya'], people, names).found.map((p) => p.id), ['a']);
  assert.deepEqual(matchPeople(['Sam'], people, names).found.map((p) => p.id), ['b']);
  assert.deepEqual(matchPeople(['khan'], people, names).found.map((p) => p.id), ['c']);
  assert.deepEqual(matchPeople(['jordan'], people, names), { found: [], missing: ['jordan'] });
});

test('turns the model’s markdown into Jira rich text', () => {
  const doc = markdownToAdf('## Summary\nThe export **times out** for `large` accounts.\n\n## Changes\n- [ ] Profile it\n- [x] Find the slow query\n1. First\n2. Second');
  assert.equal(doc.type, 'doc');
  assert.deepEqual(
    doc.content.map((n) => n.type),
    ['heading', 'paragraph', 'heading', 'bulletList', 'orderedList']
  );
  assert.deepEqual(doc.content[1].content, [
    { type: 'text', text: 'The export ' },
    { type: 'text', text: 'times out', marks: [{ type: 'strong' }] },
    { type: 'text', text: ' for ' },
    { type: 'text', text: 'large', marks: [{ type: 'code' }] },
    { type: 'text', text: ' accounts.' },
  ]);
  const items = doc.content[3].content!.map((li) => ((li as { content: Array<{ content: Array<{ text: string }> }> }).content[0].content[0].text));
  assert.deepEqual(items, ['☐ Profile it', '☑ Find the slow query']);
  assert.deepEqual(markdownToAdf('').content, [{ type: 'paragraph' }]);
});

const keyFor = (u: string, s = 'x'.repeat(43)) => `taro-jira-1.${Buffer.from(JSON.stringify({ u, s })).toString('base64url')}`;

test('accepts only connection keys that point at Atlassian', () => {
  const url = 'https://abc123.hello.atlassian-dev.net/x1/token';
  assert.deepEqual(parseConnectionKey(`  ${keyFor(url)}\n`), { triggerUrl: url, secret: 'x'.repeat(43) });
  assert.equal(parseConnectionKey(keyFor('https://evil.example/x1')), null);
  assert.equal(parseConnectionKey(keyFor('https://atlassian-dev.net.evil.example/x')), null);
  assert.equal(parseConnectionKey(keyFor('http://abc.hello.atlassian-dev.net/x')), null);
  assert.equal(parseConnectionKey(keyFor('https://abc.hello.atlassian-dev.net:8443/x')), null);
  assert.equal(parseConnectionKey(keyFor(url, 'short')), null);
  assert.equal(parseConnectionKey('taro-jira-1.not-json'), null);
  assert.equal(parseConnectionKey(42), null);
});

test('signs requests the way the Jira app checks them', () => {
  // HMAC-SHA256("secret", "1700000000.{}"), checked against openssl
  assert.equal(signJiraRequest('secret', 1700000000, '{}'), 'b8569b78799ff9e3cbff0fc2d63a33a2b57f3282abd07c37ae5e8e7d79a5f163');
  assert.notEqual(signJiraRequest('secret', 1700000000, '{}'), signJiraRequest('secret', 1700000001, '{}'));
  assert.match(signJiraRequest('secret', 1, 'body'), /^[0-9a-f]{64}$/);
});

test('files tickets as a Task when the project has one', () => {
  const types = [
    { id: '1', name: 'Epic', hierarchyLevel: 1 },
    { id: '2', name: 'Bug' },
    { id: '3', name: 'Task' },
    { id: '4', name: 'Subtask', subtask: true, hierarchyLevel: -1 },
  ];
  assert.equal(pickIssueType(types)?.id, '3');
  assert.equal(pickIssueType(types.filter((t) => t.name !== 'Task'))?.id, '2');
  assert.equal(pickIssueType([{ id: '9', name: 'Request' }])?.id, '9');
  assert.equal(pickIssueType([{ id: '1', name: 'Epic', hierarchyLevel: 1 }]), undefined);
});
