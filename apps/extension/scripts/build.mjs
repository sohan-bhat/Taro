// Builds dist/taro-extension-chromium.zip and dist/taro-extension-firefox.zip from
// this folder. No dependencies; it needs the zip command (macOS and Linux have it).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumManifest, firefoxManifest } from './manifests.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const source = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

const builds = [
  { name: 'chromium', manifest: chromiumManifest(source), skip: ['src/firefox-bridge.js'] },
  { name: 'firefox', manifest: firefoxManifest(source), skip: [] },
];

mkdirSync(dist, { recursive: true });
for (const { name, manifest, skip } of builds) {
  const dir = join(dist, name);
  const zip = join(dist, `taro-extension-${name}.zip`);
  rmSync(dir, { recursive: true, force: true });
  rmSync(zip, { force: true });
  for (const part of ['src', 'icons', 'fonts', 'managed_schema.json']) {
    if (part === 'managed_schema.json' && !manifest.storage) continue;
    cpSync(join(root, part), join(dir, part), { recursive: true, filter: (p) => !skip.some((s) => p === join(root, s)) });
  }
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  execFileSync('zip', ['-qrX', zip, '.', '-x', '.*', '*/.*'], { cwd: dir });
  console.log(`${name}: dist/taro-extension-${name}.zip (unpacked in dist/${name})`);
}
