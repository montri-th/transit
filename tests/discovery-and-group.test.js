// Owner decision 2026-11-08: the demo stays out of search engines, and its
// group label follows the dataset registry (R01_DATASETS.dataset_group).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('the page asks search engines not to index it, with no signal that contradicts it', () => {
  assert.equal((html.match(/<meta name="robots" content="noindex, nofollow">/g) || []).length, 1);
  assert.doesNotMatch(html, /<link rel="canonical"[^>]*landometer\.com/);
  assert.ok(!existsSync(new URL('../sitemap.xml', import.meta.url)), 'a noindex demo has no sitemap');
});

test('the group label follows the dataset registry: LIVING', () => {
  assert.deepEqual(html.match(/CITYMETER · (LAND|LOCATION|LIVING)</g), ['CITYMETER · LIVING<']);
});
