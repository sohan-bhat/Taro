import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromiumManifest, firefoxManifest, FIREFOX_ID } from '../scripts/manifests.mjs';

const source = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

test('the Chromium build keeps the key that pins the development ID', () => {
  const m = chromiumManifest(source);
  assert.equal(m.manifest_version, 3);
  assert.equal(m.key, source.key);
  assert.equal(m.background.service_worker, 'src/background.js');
  assert.deepEqual(m.externally_connectable, source.externally_connectable);
});

test('the Firefox build uses background scripts, a gecko ID, and no Chrome only keys', () => {
  const m = firefoxManifest(source);
  assert.equal(m.manifest_version, 3);
  assert.equal(m.version, source.version);
  assert.deepEqual(m.background, { scripts: ['src/background.js'], type: 'module' });
  assert.equal(m.browser_specific_settings.gecko.id, FIREFOX_ID);
  for (const key of ['key', 'minimum_chrome_version', 'externally_connectable', 'storage']) assert.ok(!(key in m), key);
  const bridge = m.content_scripts.find((c) => c.js.includes('src/firefox-bridge.js'));
  assert.deepEqual(bridge.matches, ['https://trytaro.vercel.app/extension/connect*', 'http://localhost/extension/connect*']);
  assert.equal(bridge.run_at, 'document_start');
  // The source manifest is left alone.
  assert.ok(source.key && source.background.service_worker);
});
