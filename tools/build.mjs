#!/usr/bin/env node
// Build the deployable PWA into ./dist and stamp the service worker with the
// commit id, so every deploy invalidates the old offline cache automatically.
//
//   node tools/build.mjs
//
// Only an explicit allowlist of files is copied: the docs, the CI config and the
// tools never reach the web server.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');

const FILES = ['index.html', 'manifest.webmanifest', 'sw.js', 'favicon.ico', '.htaccess'];
const DIRS = ['icons', 'fonts', 'screenshots'];

function commitId() {
  const fromEnv = (process.env.GITHUB_SHA || process.env.GIT_COMMIT || '').trim();
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    return 'local';
  }
}

const sha = commitId().replace(/[^0-9a-zA-Z._-]/g, '').slice(0, 12) || 'local';
const version = `riverbreaker-${sha}`;

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const f of FILES) {
  const src = path.join(root, f);
  if (!fs.existsSync(src)) throw new Error(`build: missing ${f}`);
  fs.copyFileSync(src, path.join(dist, f));
}
for (const d of DIRS) {
  const src = path.join(root, d);
  if (!fs.existsSync(src)) throw new Error(`build: missing ${d}/`);
  fs.cpSync(src, path.join(dist, d), { recursive: true });
}

// Stamp the cache version.
const swPath = path.join(dist, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
if (!/const VERSION = '[^']+';/.test(sw)) throw new Error('build: VERSION constant not found in sw.js');
sw = sw.replace(/const VERSION = '[^']+';/, `const VERSION = '${version}';`);
fs.writeFileSync(swPath, sw);

const info = {
  name: 'Riverbreaker',
  version,
  commit: process.env.GITHUB_SHA || sha,
  builtAt: new Date().toISOString()
};
fs.writeFileSync(path.join(dist, 'version.json'), JSON.stringify(info, null, 2) + '\n');

const count = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0);
console.log(`build: dist/ ready — ${count(dist)} files, version ${version}`);
