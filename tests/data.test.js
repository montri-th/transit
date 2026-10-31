import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filterStations, summarize, hasPoint} from '../js/model.js';
import {computeInsight} from '../js/profile-model.js';
import {provinceByCode} from '../js/provinces-list.js';
import {decodePolyline, decodePoints} from '../js/polyline.js';
import {createHash} from 'node:crypto';
import {inFrame} from '../js/nearby.js';

// The published data (scripts/build-data.py over the 2026-10-31 export). These are invariants of the
// research master's rules, not snapshots of the UI copy.
const read = name => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const data = read('transit.json');
const FORBIDDEN = /docs\.google\.com|drive\.google\.com|googleusercontent|script\.google\.com|\/Users\/|chatgpt-projects|file:\/\//i;

test('published files carry no private links or local paths', () => {
  for (const name of ['transit.json', 'rail-lines.geojson', 'station-buildings.geojson', 'bus.json', 'boat.json', 'build-report.json', 'layer-moto.json', 'layer-intercity.json', 'layer-air.json', 'layer-srt.json']) {
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

test('OpenStreetMap results: verified browser extraction, colours with relations, elevation from OSM ways', () => {
  const osm = data.meta.osm;
  assert.equal(osm.sha256, '1cdb65b81d6285788e5989cc85345011c24dc59e7e4e42a752f978ae3de9fd67', 'the owner-approved Overpass download');
  assert.equal(osm.timestampOsmBase, '2026-10-31T13:12:06Z');
  assert.equal(osm.derived.file, 'sources/osm/osm-derived-2026-10-31.json');
  const derived = readFileSync(new URL('../sources/osm/osm-derived-2026-10-31.json', import.meta.url));
  assert.equal(createHash('sha256').update(derived).digest('hex'), osm.derived.sha256, 'derived file is the one the build used');
  for (const l of data.lines.filter(x => x.colorBasis === 'osm_route_colour')) {
    assert.match(l.color, /^#[0-9A-F]{6}$/);
    assert.ok(l.colorSource.osm.every(r => /^relation\/\d+$/.test(r)), l.id);
  }
  const geo = read('rail-lines.geojson');
  const operating = geo.features.filter(f => f.properties.status === 'operating');
  assert.ok(operating.every(f => ['elevated', 'surface', 'underground'].includes(f.properties.elevation)), 'every operating stretch has an OSM level');
  const buildings = read('station-buildings.geojson');
  assert.ok(buildings.features.length >= 100);
  assert.ok(buildings.features.every(f => /^(way|relation)\/\d+$/.test(f.properties.osm_ref) && f.properties.height > 0 && f.properties.height_basis));
  assert.ok(buildings.features.every(f => f.properties.stationIds.every(id => data.stations.some(s => s.id === id))));
});

/** Metres from a point to a segment (local equirectangular frame). */
function segmentM(p, a, b) {
  const kx = 111320 * Math.cos((p[1] * Math.PI) / 180), ky = 110574;
  const [px, py, ax, ay, bx, by] = [p[0] * kx, p[1] * ky, a[0] * kx, a[1] * ky, b[0] * kx, b[1] * ky];
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

test('future lines: Orange and Purple South have alignments (OSM construction ways), every station within 50 m', () => {
  const geo = read('rail-lines.geojson');
  for (const id of ['MRT_ORANGE_WEST', 'MRT_ORANGE_EAST', 'MRT_PURPLE_SOUTH']) {
    const parts = geo.features.filter(f => f.properties.lineId === id);
    assert.ok(parts.length > 0 && parts.every(f => f.properties.source === 'OSM' && /^way\/\d+$/.test(f.properties.osm_ref)), id);
    const line = data.lines.find(l => l.id === id);
    assert.match(line.alignmentNote, /OpenStreetMap/);
    assert.equal(line.lengthKm, null, 'OSM ways are per track: no route length is derived from them');
    for (const s of data.stations.filter(x => x.lineIds[0] === id)) {
      const d = Math.min(...parts.flatMap(f => f.geometry.coordinates.slice(1).map((c, i) => segmentM([s.lng, s.lat], f.geometry.coordinates[i], c))));
      assert.ok(d < 50, `${s.id} is ${Math.round(d)} m from its alignment`);
    }
  }
});

test('other modes: each layer file carries source, date and boundary; counts match the summary', () => {
  const summary = data.meta.contextLayers;
  assert.deepEqual(Object.keys(summary).sort(), ['air', 'boat', 'bus', 'intercity', 'moto', 'srt', 'stops']);
  for (const k of ['moto', 'intercity', 'air', 'srt']) {
    const d = read(`layer-${k}.json`);
    assert.equal(d.rows.length, d.meta.count, k);
    assert.equal(summary[k].count, d.meta.count, k);
    assert.ok(d.meta.sources.length && d.meta.sources.every(s => s.title && s.checkedOn && s.url.startsWith('https://')), `${k} sources`);
    assert.ok(d.meta.boundary && d.meta.frame.length === 4 && d.meta.grain && summary[k].period && summary[k].source, k);
    const [lng, lat] = [d.fields.indexOf('lng'), d.fields.indexOf('lat')];
    assert.ok(d.rows.every(r => inFrame([r[lng], r[lat]], d.meta.frame)), `${k} rows inside the frame`);
    assert.equal(d.meta.kindCounts.reduce((a, b) => a + b, 0), d.meta.count);
  }
  assert.deepEqual(summary.moto.provinces, ['BKK'], 'motorcycle-taxi stands are a Bangkok register');
  assert.equal(summary.intercity.kindCounts[1] + summary.intercity.kindCounts[2], 31, 'the 31 boarding points of บขส. (access candidates)');
  const bus = read('bus.json');
  assert.equal(summary.bus.count, bus.meta.routesUsed, 'bus routes: GTFS route records drawn');
  assert.equal(summary.stops.count, decodePoints(bus.stops).length + bus.brt.stations.length, 'bus stops + BRT stations');
  assert.deepEqual(summary.stops.kindCounts, [bus.meta.stops, bus.brt.stations.length]);
});
