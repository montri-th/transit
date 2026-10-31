#!/usr/bin/env node
/**
 * Live byte attestation: fetch every file listed in handoff/handoff-manifest.json
 * from the public site and compare SHA-256 with the manifest. Writes a JSON
 * report (default evidence/live-attestation.json) and exits non-zero on any
 * mismatch so a release cannot be reported as verified from local bytes.
 *
 *   node scripts/verify-live.mjs [--base https://montri-th.github.io/transit/] [--out file]
 *
 * Only audience-delivered files are compared (docs, data, assets, code);
 * tests, scripts and dotfiles are not published by GitHub Pages in a
 * meaningful way and are skipped by the `published` predicate below.
 */
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const base = opt('--base', 'https://montri-th.github.io/transit/');
const out = resolve(opt('--out', join(root, 'evidence/live-attestation.json')));
const manifest = JSON.parse(readFileSync(join(root, 'handoff/handoff-manifest.json'), 'utf8'));
const published = p => !p.startsWith('tests/') && !p.startsWith('scripts/') && !p.startsWith('.') && p !== 'package.json';
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

const results = [];
for (const file of manifest.files.filter(f => published(f.path))) {
  const url = new URL(file.path, base).href + `?attest=${Date.now()}`;
  try {
    const response = await fetch(url, {cache: 'no-store'});
    const bytes = Buffer.from(await response.arrayBuffer());
    const hash = sha256(bytes);
    results.push({path: file.path, url: url.split('?')[0], status: response.status, bytes: bytes.length, sha256: hash, expectedSha256: file.sha256, ok: response.ok && hash === file.sha256});
  } catch (error) {
    results.push({path: file.path, url: url.split('?')[0], status: 0, bytes: 0, sha256: null, expectedSha256: file.sha256, ok: false, error: String(error.message || error)});
  }
}
// The root document must serve index.html bytes.
const index = manifest.files.find(f => f.path === 'index.html');
if (index) {
  const response = await fetch(base + `?attest=${Date.now()}`, {cache: 'no-store'});
  const bytes = Buffer.from(await response.arrayBuffer());
  results.push({path: '/', url: base, status: response.status, bytes: bytes.length, sha256: sha256(bytes), expectedSha256: index.sha256, ok: response.ok && sha256(bytes) === index.sha256});
}
const report = {
  checkedAt: new Date().toISOString(), baseUrl: base,
  manifestCommit: manifest.sourceCommit, manifestGeneratedAt: manifest.generatedAt,
  passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results,
};
mkdirSync(dirname(out), {recursive: true});
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(`live attestation: ${report.passed} ok, ${report.failed} failed → ${out}`);
for (const r of results.filter(r => !r.ok)) console.log(`  MISMATCH ${r.path} status=${r.status} ${r.error || ''}`);
process.exit(report.failed ? 1 : 0);
