#!/usr/bin/env node
/**
 * Build the developer handoff: hash every tracked source file into
 * handoff/handoff-manifest.json and, with --zip <path>, package the bundle
 * (START_HERE.md, RELEASE_RECEIPT.json, evidence/, source/).
 *
 *   node scripts/build-handoff.mjs                 # manifest only
 *   node scripts/build-handoff.mjs --zip out.zip   # manifest + bundle
 *   node scripts/build-handoff.mjs --zip out.zip --receipt path/RELEASE_RECEIPT.json --evidence dir/
 *
 * Hashes are computed from the bytes on disk — never hand-edited. The manifest
 * excludes itself to avoid a circular hash. `git ls-files` defines the source
 * set, so untracked scratch files never leak into a bundle.
 */
import {createHash} from 'node:crypto';
import {readFileSync, statSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const MANIFEST = 'handoff/handoff-manifest.json';

const git = (...a) => execFileSync('git', a, {cwd: root, encoding: 'utf8'}).trim();
const files = git('ls-files').split('\n').filter(f => f && f !== MANIFEST);
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const data = JSON.parse(readFileSync(join(root, 'data/transit.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const entries = files.map(path => {
  const buffer = readFileSync(join(root, path));
  return {path, bytes: buffer.length, sha256: sha256(buffer)};
});
const manifest = {
  schemaVersion: '1.2.0',
  documentType: 'handoff-manifest',
  productId: 'citymeter-transit',
  productVersion: pkg.version,
  generatedOn: new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Bangkok'}).format(new Date()),
  generatedAt: new Date().toISOString(),
  timeZone: 'Asia/Bangkok',
  datasetCheckedOn: data.meta?.asOf || null,
  repository: 'https://github.com/montri-th/transit',
  liveUrl: 'https://montri-th.github.io/transit/',
  sourceCommit: git('rev-parse', 'HEAD'),
  sourceBranch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  workingTreeClean: git('status', '--porcelain') === '',
  hashAlgorithm: 'SHA-256',
  excludedSelf: MANIFEST,
  runtime: {node: process.version, python: (() => { try { return execFileSync('python3', ['--version'], {encoding: 'utf8'}).trim(); } catch { return null; } })()},
  commands: pkg.scripts,
  fileCount: entries.length,
  totalBytes: entries.reduce((n, e) => n + e.bytes, 0),
  files: entries,
};
mkdirSync(join(root, 'handoff'), {recursive: true});
writeFileSync(join(root, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest: ${entries.length} files, ${manifest.totalBytes} bytes, commit ${manifest.sourceCommit.slice(0, 7)}${manifest.workingTreeClean ? '' : ' (working tree not clean)'}`);

const zipPath = opt('--zip');
if (zipPath) {
  const stage = join(root, '.handoff-stage');
  rmSync(stage, {recursive: true, force: true});
  mkdirSync(join(stage, 'source'), {recursive: true});
  for (const path of [...files, MANIFEST]) {
    mkdirSync(dirname(join(stage, 'source', path)), {recursive: true});
    cpSync(join(root, path), join(stage, 'source', path));
  }
  const receipt = opt('--receipt');
  if (receipt && existsSync(receipt)) cpSync(resolve(receipt), join(stage, 'RELEASE_RECEIPT.json'));
  const evidence = opt('--evidence');
  if (evidence && existsSync(evidence)) cpSync(resolve(evidence), join(stage, 'evidence'), {recursive: true});
  const startHere = opt('--start-here') || join(root, 'handoff/START_HERE.md');
  if (existsSync(startHere)) cpSync(resolve(startHere), join(stage, 'START_HERE.md'));
  const out = resolve(zipPath);
  rmSync(out, {force: true});
  execFileSync('zip', ['-qr', '-X', out, '.'], {cwd: stage});
  rmSync(stage, {recursive: true, force: true});
  const bytes = statSync(out).size;
  console.log(`bundle: ${out} (${bytes} bytes, sha256 ${sha256(readFileSync(out))})`);
}
