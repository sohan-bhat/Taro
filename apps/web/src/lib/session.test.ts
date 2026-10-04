import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameSitePath } from './session';

const ORIGIN = 'https://taro.example';

test('keeps paths on this site', () => {
  assert.equal(sameSitePath('/dashboard', ORIGIN), '/dashboard');
  assert.equal(sameSitePath('/dashboard?m=6a8e568d83915237bbf1cb83', ORIGIN), '/dashboard?m=6a8e568d83915237bbf1cb83');
  assert.equal(
    sameSitePath('/extension/connect?id=lkdndnkaapmpibnjmaiadheckoflifde&n=4f1c', ORIGIN),
    '/extension/connect?id=lkdndnkaapmpibnjmaiadheckoflifde&n=4f1c'
  );
  assert.equal(sameSitePath('/%2F%2Fevil.example', ORIGIN), '/%2F%2Fevil.example');
});

test('refuses anything that could leave the site', () => {
  for (const next of [
    null,
    undefined,
    '',
    'dashboard',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/.//evil.example',
    '/..//evil.example',
    '/a/..//evil.example',
    '/%2e//evil.example',
    '/a\\..\\..\\\\evil.example',
    '/\tdashboard',
    'javascript:alert(1)',
  ]) {
    assert.equal(sameSitePath(next, ORIGIN), null, String(next));
  }
});
