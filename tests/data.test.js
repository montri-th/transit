import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filterStations, summarize, hasPoint} from '../js/model.js';
import {computeInsight} from '../js/profile-model.js';
import {provinceByCode} from '../js/provinces-list.js';
import {decodePolyline, decodePoints} from '../js/polyline.js';

// The published data (scripts/build-data.py over the 2026-10-31 export). These are invariants of the
// research master's rules, not snapshots of the UI copy.
const read = name => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const data = read('transit.json');
const FORBIDDEN = /docs\.google\.com|drive\.google\.com|googleusercontent|script\.google\.com|\/Users\/|chatgpt-projects|file:\/\//i;

test('published files carry no private links or local paths', () => {
  for (const name of ['transit.json', 'rail-lines.geojson', 'station-buildings.geojson', 'bus.json', 'boat.json', 'build-report.json']) {
    assert.ok(!FORBIDDEN.test(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8')), name);
  }
});

test('grain: one record per station–line (17) or station–project (23); counts match the research master', () => {
  const by = s => data.stations.filter(r => r.status === s).length;
  assert.equal(by('operating'), 195, '17_RAIL_CATALOG station–line entries');
  assert.equal(by('construction'), 106, 'new stations or halts in construction projects');
  assert.equal(by('unverified'), 4, 'existing stations and junction references inside projects');
  assert.equal(new Set(data.stations.map(s => s.id)).size, data.stations.length);
  assert.ok(data.stations.every(s => s.lineIds.length === 1 && data.lines.some(l => l.id === s.lineIds[0])));
  assert.ok(data.stations.every(s => s.status !== 'operating' || s.statusCode === 'operator_roster_listed' || s.statusCode === 'government_8station_extent_and_gtfs_scheduled'));
});

test('every station is mapped inside Thailand with a resolved province; held coordinates are labelled', () => {
  assert.ok(data.stations.every(hasPoint));
  assert.ok(data.stations.every(s => provinceByCode(s.provinceCode)), 'province code');
  const held = data.stations.filter(s => s.coordStatus === 'conflict_held');
  assert.equal(held.length, 1, 'ARL A1 coordinate conflict stays held');
  assert.match(held[0].coordinateNote, /โดยประมาณ/);
});

test('interchanges: 22 current + 2 in-line + 12 future relations; complexes join two or more lines', () => {
  const scope = s => data.interchanges.filter(i => i.scope === s).length;
  assert.deepEqual([scope('current'), scope('branch'), scope('future')], [22, 2, 12]);
  assert.ok(data.complexes.every(c => c.lineIds.length >= 2 && c.stationIds.every(id => data.stations.find(s => s.id === id)?.complexId === c.id)));
  const insight = computeInsight(filterStations(data.stations, {}, data.lines), data.complexes);
  assert.equal(insight.interchanges, data.complexes.length);
  assert.equal(insight.hubs[0].lines, 3, 'the Bang Sue / Krung Thep Aphiwat complex joins three lines');
  assert.equal(summarize(data.stations, data.lines, data.complexes).interchanges, data.complexes.length);
});

test('ridership: one comparable series per metric, never mixed; Siam shared value flagged', () => {
  const metrics = new Set(data.stations.flatMap(s => s.ridership.map(r => [r.metric, r.unit, r.period, r.aggregation].join('|'))));
  assert.ok(metrics.size >= 3);
  for (const s of data.stations) for (const r of s.ridership) {
    assert.ok(Number.isFinite(r.value) && r.value >= 0 && r.source.startsWith('https://') && r.period && r.unit && r.seriesKey, `${s.id} ${r.metric}`);
  }
  const siam = data.stations.filter(s => s.ridership.some(r => r.seriesKey === 'BTS2564:SIAM'));
  assert.equal(siam.length, 2);
  assert.ok(siam.every(s => s.ridership.find(r => r.seriesKey === 'BTS2564:SIAM').shared));
});

test('lines: operating alignments come from GTFS shapes; construction lines say whether an alignment exists', () => {
  const geo = read('rail-lines.geojson');
  const drawn = new Set(geo.features.map(f => f.properties.lineId));
  for (const l of data.lines) {
    if (l.status === 'operating') { assert.ok(drawn.has(l.id), l.id); assert.ok(l.lengthKm > 0); }
    else assert.ok(l.alignmentNote, l.id);
    assert.ok(l.color || l.colorToken, `${l.id} colour`);
    assert.ok(l.stationIds.length >= 1);
  }
  assert.ok(geo.features.every(f => f.geometry.coordinates.length >= 2));
});

test('optional layers decode: bus corridors and stops stay inside the Bangkok frame', () => {
  const bus = read('bus.json');
  const first = decodePolyline(bus.routes[0].p);
  assert.ok(first.length >= 2);
  const stops = decodePoints(bus.stops);
  assert.equal(stops.length, bus.meta.stops);
  assert.ok(stops.every(([lng, lat]) => lng >= 99.9 && lng <= 101.2 && lat >= 13.2 && lat <= 14.4));
  const boat = read('boat.json');
  assert.ok(boat.routes.features.length > 0 && boat.stops.features.length > 0);
});
