#!/usr/bin/env node
/**
 * Build data/provinces.geojson (all 77 province frames) from the OpenGISData-
 * Thailand provinces layer.
 *
 * Source: https://github.com/chingchai/OpenGISData-Thailand (provinces.geojson,
 * boundaries credited by the publisher to the Department of Provincial
 * Administration — DOPA; CC BY 4.0). The frames are context for the country
 * view and the จังหวัด drill-down, not an administrative authority.
 *
 * Unlike the Luxury Brands demo (9 provinces, unsimplified), transit stops
 * exist nationwide, so every province is kept and the outlines are simplified
 * for display with a declared tolerance (Douglas–Peucker, degrees). The
 * tolerance, source commit, sha256 and retrieval date are written to metadata.
 *
 *   node scripts/extract-provinces.mjs <path/to/provinces.geojson> --commit <sha> --sha256 <hex> --retrieved YYYY-MM-DD [--tolerance 0.0012]
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROVINCE_LIST, PRODUCTION_VERIFIED_CODES} from '../js/provinces-list.js';

const args = process.argv.slice(2);
const opt = (k, d = '') => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const input = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
if (!input) { console.error('usage: node scripts/extract-provinces.mjs <provinces.geojson> [--commit sha] [--sha256 hex] [--retrieved date] [--tolerance deg]'); process.exit(1); }
const tolerance = Number(opt('--tolerance', '0.0012'));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(readFileSync(resolve(input), 'utf8'));
const byDopa = new Map(PROVINCE_LIST.map(p => [p.dopaCode, p]));
const round = v => Math.round(v * 1e5) / 1e5;

/** Douglas–Peucker on a ring (closed), keeping the first/last point. */
function simplify(points, tol) {
  if (points.length <= 4 || tol <= 0) return points;
  const sq = tol * tol;
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let d;
      if (len2 === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
      else { const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)); d = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2; }
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > sq && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
const cleanRing = ring => {
  const out = [];
  for (const [x, y] of ring) { const p = [round(x), round(y)]; if (!out.length || out.at(-1)[0] !== p[0] || out.at(-1)[1] !== p[1]) out.push(p); }
  if (out.length && (out[0][0] !== out.at(-1)[0] || out[0][1] !== out.at(-1)[1])) out.push([...out[0]]);
  return out;
};
const ringArea = r => Math.abs(r.reduce((s, p, i) => (i ? s + (r[i - 1][0] * p[1] - p[0] * r[i - 1][1]) : s), 0) / 2);

const features = [];
let sourceVertices = 0;
for (const f of source.features) {
  const p = byDopa.get(String(f.properties?.pro_code).padStart(2, '0'));
  if (!p) { console.warn('unknown province', f.properties?.pro_code, f.properties?.pro_th); continue; }
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  sourceVertices += polys.reduce((n, poly) => n + poly.reduce((m, r) => m + r.length, 0), 0);
  const coordinates = polys
    .map(poly => poly.map(r => cleanRing(simplify(cleanRing(r), tolerance))))
    .filter(poly => poly[0].length >= 4 && ringArea(poly[0]) > 1e-5); // drop islets below ~1 km² after simplification
  features.push({
    type: 'Feature', id: p.code,
    properties: {code: p.code, dopaCode: p.dopaCode, name: p.th, nameEn: p.en, sourceNameTh: f.properties.pro_th, sourceNameEn: f.properties.pro_en, region: f.properties.reg_nesdb || '', areaSqkm: Math.round(Number(f.properties.area_sqkm) || 0), productionVerified: PRODUCTION_VERIFIED_CODES.includes(p.code)},
    geometry: {type: 'MultiPolygon', coordinates},
  });
}
features.sort((a, b) => a.properties.dopaCode.localeCompare(b.properties.dopaCode));
const vertices = features.reduce((n, f) => n + f.geometry.coordinates.reduce((m, poly) => m + poly.reduce((k, r) => k + r.length, 0), 0), 0);
const retrieved = opt('--retrieved', new Date().toISOString().slice(0, 10));
const out = {
  type: 'FeatureCollection',
  metadata: {
    version: `${retrieved}-r1`,
    role: 'province frames for the country view and the จังหวัด drill-down — context, not an administrative authority',
    source: 'OpenGISData-Thailand provinces.geojson (chingchai/OpenGISData-Thailand), boundaries credited by the publisher to the Department of Provincial Administration (DOPA)',
    sourceUrl: 'https://github.com/chingchai/OpenGISData-Thailand/blob/master/provinces.geojson',
    sourceCommit: opt('--commit', ''), sourceSha256: opt('--sha256', ''), retrievedOn: retrieved,
    license: 'CC BY 4.0', attribution: 'ขอบเขตจังหวัด: OpenGISData-Thailand (CC BY 4.0), อ้างอิงกรมการปกครอง',
    processing: `all 77 provinces; coordinates rounded to 5 decimals; outlines simplified for display (Douglas–Peucker, tolerance ${tolerance}° ≈ ${Math.round(tolerance * 111000)} m); islets below ~1 km² dropped after simplification; id = three-letter province code (9 verified on CityMETER production, see js/provinces-list.js), dopaCode = DOPA two-digit code`,
    provinces: features.length, vertices, sourceVertices,
  },
  features,
};
const target = join(root, 'data', 'provinces.geojson');
writeFileSync(target, JSON.stringify(out) + '\n');
console.log(`wrote ${target}: ${features.length} provinces, ${vertices} vertices (source ${sourceVertices}), ${JSON.stringify(out).length} bytes`);
