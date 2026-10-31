#!/usr/bin/env node
// Static checks for the Riverbreaker PWA. No dependencies, runs on plain Node.
//
//   node tools/check.mjs
//
// Verifies that the single-file game, the manifest and the service worker agree
// with each other and with the files that actually exist on disk, and that the
// app stays offline-first and free of insecure URLs.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const errors = [];
const warnings = [];

const err = m => errors.push(m);
const warn = m => warnings.push(m);
const exists = rel => fs.existsSync(path.join(root, rel));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

// --- required files ---------------------------------------------------------
const REQUIRED = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'favicon.ico',
  '.htaccess',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'fonts/fonts.css'
];
for (const f of REQUIRED) if (!exists(f)) err(`missing required file: ${f}`);

// --- index.html -------------------------------------------------------------
const html = exists('index.html') ? read('index.html') : '';
if (!html.includes('<canvas id="game"')) err('index.html: game canvas not found');
if (!/<link rel="manifest" href="manifest\.webmanifest">/.test(html)) err('index.html: manifest link missing');
if (!/'serviceWorker' in navigator/.test(html)) err('index.html: service worker registration missing');
if (/\beval\s*\(/.test(html)) err('index.html: eval() is not allowed');

// Every inline script must compile. The game is one big IIFE, a typo breaks it.
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (scripts.length < 2) err('index.html: expected at least two inline scripts');
scripts.forEach((src, i) => {
  try { new vm.Script(src, { filename: `index.html#script${i}` }); }
  catch (e) { err(`index.html: script #${i} has a syntax error: ${e.message}`); }
});

// Insecure transport.
if (/http:\/\//i.test(html)) err('index.html: insecure http:// URL found');

// Local references must exist.
const refs = new Set();
for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
  const v = m[1];
  if (/^(?:[a-z]+:|\/\/|#)/i.test(v)) continue;
  refs.add(v.split('?')[0]);
}
for (const r of refs) if (!exists(r)) err(`index.html: referenced file does not exist: ${r}`);

// --- manifest ---------------------------------------------------------------
let manifest = null;
try {
  manifest = JSON.parse(read('manifest.webmanifest'));
} catch (e) {
  err(`manifest.webmanifest: invalid JSON (${e.message})`);
}
if (manifest) {
  for (const key of ['id', 'name', 'short_name', 'start_url', 'scope', 'display', 'icons']) {
    if (!manifest[key]) err(`manifest.webmanifest: missing "${key}"`);
  }
  if (manifest.start_url && /^https?:/i.test(manifest.start_url)) err('manifest.webmanifest: start_url must be relative');
  if (manifest.scope && /^https?:/i.test(manifest.scope)) err('manifest.webmanifest: scope must be relative');
  const icons = [...(manifest.icons || []), ...(manifest.screenshots || [])];
  for (const icon of icons) if (!exists(icon.src)) err(`manifest.webmanifest: missing asset ${icon.src}`);
  if (!(manifest.icons || []).some(i => (i.purpose || '').includes('maskable'))) warn('manifest.webmanifest: no maskable icon');
  if (!(manifest.screenshots || []).length) warn('manifest.webmanifest: no screenshots (install dialog stays plain)');
}

// --- service worker ---------------------------------------------------------
const sw = exists('sw.js') ? read('sw.js') : '';
if (!/const VERSION = '[^']+';/.test(sw)) err("sw.js: VERSION constant not found");
const coreMatch = sw.match(/const CORE = \[([\s\S]*?)\];/);
if (!coreMatch) {
  err('sw.js: CORE list not found');
} else {
  const core = [...coreMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  for (const rel of core) {
    const clean = rel.replace(/^\.\//, '').replace(/\/$/, '');
    if (!clean) continue;                       // './' is the folder itself
    if (!exists(clean)) err(`sw.js: precached file does not exist: ${rel}`);
  }
  for (const need of ['index.html', 'manifest.webmanifest']) {
    if (!core.includes(need)) err(`sw.js: ${need} is not in CORE`);
  }
  for (const icon of (manifest && manifest.icons) || []) {
    if (!core.includes(icon.src)) warn(`sw.js: manifest icon not precached: ${icon.src}`);
  }
  if (!/caches\.delete/.test(sw)) warn('sw.js: old caches are never deleted');
}

// --- fonts ------------------------------------------------------------------
if (exists('fonts/fonts.css')) {
  const css = read('fonts/fonts.css');
  for (const m of css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
    const rel = path.posix.normalize(path.posix.join('fonts', m[1]));
    if (!exists(rel)) err(`fonts/fonts.css: missing font file ${m[1]}`);
  }
}

// --- project hygiene --------------------------------------------------------
const treeSize = (dir, skip) => {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? treeSize(full, skip) : fs.statSync(full).size;
  }
  return total;
};
const skip = new Set(['.git', 'node_modules', 'dist', '.github']);
const total = treeSize(root, skip);
if (total > 40 * 1024 * 1024) err(`repository is ${(total / 1048576).toFixed(1)} MB, above the 40 MB budget`);
const htmlSize = Buffer.byteLength(html);
if (htmlSize > 512 * 1024) err(`index.html is ${Math.round(htmlSize / 1024)} KB, above the 512 KB budget`);

// --- report -----------------------------------------------------------------
for (const w of warnings) console.log(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);
console.log(`\nindex.html ${(htmlSize / 1024).toFixed(1)} KB · project ${(total / 1048576).toFixed(1)} MB · ` +
  `${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
