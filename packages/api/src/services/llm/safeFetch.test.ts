import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertEndpointAllowed, isPrivateAddress } from './safeFetch';

test('flags private, loopback, link-local and metadata addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
    assert.ok(isPrivateAddress(ip), `${ip} should be private`);
  }
});

test('catches other spellings of private addresses', () => {
  // Hex IPv4-mapped forms are what URL parsing turns [::ffff:127.0.0.1] into
  for (const ip of ['::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:a00:1', '[::ffff:7f00:1]', '::7f00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::1', '::']) {
    assert.ok(isPrivateAddress(ip), `${ip} should be private`);
  }
});

test('allows public addresses', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '104.18.0.1', '2606:4700::1111']) {
    assert.ok(!isPrivateAddress(ip), `${ip} should be public`);
  }
});

test('custom endpoints must be public https', () => {
  assert.doesNotThrow(() => assertEndpointAllowed('https://api.together.xyz/v1'));
  assert.throws(() => assertEndpointAllowed('http://api.example.com/v1'));
  assert.throws(() => assertEndpointAllowed('https://localhost:11434/v1'));
  assert.throws(() => assertEndpointAllowed('https://169.254.169.254/latest'));
  assert.throws(() => assertEndpointAllowed('https://10.0.0.5/v1'));
  assert.throws(() => assertEndpointAllowed('https://[::1]/v1'));
  assert.throws(() => assertEndpointAllowed('https://metadata.google.internal/v1'));
  assert.throws(() => assertEndpointAllowed('not a url'));
});

test('custom endpoints can not be IP literals in any spelling', () => {
  for (const url of [
    'https://[::ffff:127.0.0.1]/v1',
    'https://[::ffff:7f00:1]/v1',
    'https://[::ffff:a9fe:a9fe]/v1',
    'https://[::ffff:10.0.0.1]/v1',
    'https://2130706433/v1',
    'https://0x7f.1/v1',
    'https://127.1/v1',
    'https://8.8.8.8/v1',
    'https://localhost./v1',
  ]) {
    assert.throws(() => assertEndpointAllowed(url), Error, `${url} should be refused`);
  }
});
