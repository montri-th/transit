#!/usr/bin/env node
/**
 * Stamp one cache version on every first-party asset the page loads, so a
 * release never mixes old and new modules from the browser cache.
 *
 *   node scripts/stamp-version.mjs 20261031-r2
 *
 * Rewrites index.html: ?v= on stylesheets and scripts, and the import map with
 * one entry per ES module in js/ (relative keys resolve to the same absolute
 * URLs as the modules' own relative imports, so every import gets the stamp).
 */
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const version = process.argv[2];
if (!/^\d{8}-r\d+$/.test(version || '')) { console.error('usage: node scripts/stamp-version.mjs YYYYMMDD-rN'); process.exit(1); }
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(root, 'index.html');
let html = readFileSync(file, 'utf8');
html = html.replace(/(href|src)="((?:assets\/|js\/|styles\.css|navigation\.css)[^"?]*)(\?v=[^"]*)?"/g, (m, attr, path) => `${attr}="${path}?v=${version}"`);
const modules = readdirSync(resolve(root, 'js')).filter(f => f.endsWith('.js') && f !== 'launch.js').sort();
const entries = modules.map(f => `      "./js/${f}": "./js/${f}?v=${version}"`).join(',\n');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, `<script type="importmap">\n    {"imports": {\n${entries}\n    }}\n  </script>`);
writeFileSync(file, html);
console.log(`stamped ${version}: ${modules.length} modules`);
