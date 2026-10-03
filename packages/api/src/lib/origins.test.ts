import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedCorsOrigin, isAllowedOrigin, resolveReturnTo } from './origins';

test('trusts the app URL and configured extra origins', () => {
  assert.ok(isAllowedOrigin('https://app.taro.test'));
  assert.ok(isAllowedOrigin('https://preview.taro.test/dashboard?x=1'));
  assert.equal(resolveReturnTo('https://preview.taro.test/anything'), 'https://preview.taro.test');
});

test('never redirects a login to an untrusted origin', () => {
  assert.ok(!isAllowedOrigin('https://evil.example'));
  assert.ok(!isAllowedOrigin('https://app.taro.test.evil.example'));
  assert.equal(resolveReturnTo('https://evil.example'), 'https://app.taro.test');
  assert.equal(resolveReturnTo('javascript:alert(1)'), 'https://app.taro.test');
  assert.equal(resolveReturnTo(undefined), 'https://app.taro.test');
  assert.equal(resolveReturnTo({ toString: () => 'https://evil.example' }), 'https://app.taro.test');
});

test('the browser extension may call the API but is never a sign-in return target', () => {
  const ext = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
  assert.ok(isAllowedCorsOrigin(ext));
  assert.ok(!isAllowedOrigin(ext));
  assert.equal(resolveReturnTo(ext), 'https://app.taro.test');
  assert.ok(!isAllowedCorsOrigin('chrome-extension://pppppppppppppppppppppppppppppppp'));
  assert.ok(isAllowedCorsOrigin('https://app.taro.test'));
});

test('any local port is a dashboard origin outside production', () => {
  assert.ok(isAllowedOrigin('http://localhost:3100'));
  assert.ok(isAllowedOrigin('http://127.0.0.1:5173'));
  assert.ok(!isAllowedOrigin('http://localhost.evil.example:3100'));
  assert.ok(!isAllowedOrigin('https://localhost:3100.evil.example'));
});
