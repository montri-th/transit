import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filterStations, summarize, isInterchange, hasPoint, STATUS_FILTERS} from '../js/model.js';
import {computeInsight, rankLines, buildLineProfile} from '../js/profile-model.js';
import {buildBreadcrumb, renderBreadcrumb, breadcrumbText} from '../js/breadcrumb.js';
import {resolveProvince, provinceByCode, PROVINCE_LIST, PRODUCTION_VERIFIED_CODES} from '../js/provinces-list.js';
import {rampPath, ribbonWidth, metresPerPixel, RAMP_M} from '../js/scene.js';
import {FAMILIES, classColors, buildCountClasses, classify} from '../js/scales.js';

// SYNTHETIC fixture (tests/fixtures/harness): invented stations and lines, used only to exercise code paths.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/harness/transit.json', import.meta.url), 'utf8'));

test('status filter presets: current = operating + construction (default), all adds unverified', () => {
  assert.deepEqual(STATUS_FILTERS.current, ['operating', 'construction']);
  const rows = [{id: 'a', status: 'operating', lineIds: []}, {id: 'b', status: 'construction', lineIds: []}, {id: 'c', status: 'unverified', lineIds: []}];
  assert.deepEqual(filterStations(rows, {}).map(r => r.id), ['a', 'b']);
  assert.deepEqual(filterStations(rows, {status: 'all'}).map(r => r.id), ['a', 'b', 'c']);
  assert.deepEqual(filterStations(rows, {status: 'construction'}).map(r => r.id), ['b']);
});

test('search matches Thai and English names, codes, province and line names', () => {
  const rows = fixture.stations;
  assert.equal(filterStations(rows, {search: 'ก3'}, fixture.lines).length, 1);
  assert.ok(filterStations(rows, {search: 'test line b'}, fixture.lines).length >= 7);
  assert.equal(filterStations(rows, {search: 'กรุงเทพ'}, fixture.lines).length, filterStations(rows, {}, fixture.lines).length);
});

test('summary counts say what they count; an interchange is one record with two lines', () => {
  const s = summarize(filterStations(fixture.stations, {}, fixture.lines), fixture.lines);
  assert.equal(s.stations, s.operating + s.construction);
  assert.equal(s.interchanges, fixture.stations.filter(isInterchange).length);
  assert.ok(fixture.stations.every(hasPoint));
});

test('Aha: hubs ranked by lines served; construction counted separately', () => {
  const insight = computeInsight(filterStations(fixture.stations, {}, fixture.lines));
  assert.equal(insight.hubs[0].id, 'st-a3');
  assert.equal(insight.hubs[0].lines, 2);
  assert.equal(insight.construction, fixture.stations.filter(s => s.status === 'construction').length);
});

test('line ranking uses the exact LDS count classes', () => {
  const {rows, classes} = rankLines(fixture.stations, fixture.lines, fixture.systems);
  assert.ok(rows.length >= 2);
  for (const r of rows) assert.ok(FAMILIES.count.lut.includes(r.fill));
  assert.equal(classes.scaleId, 'count');
});

test('line profile keeps the declared station order and appends unknown members', () => {
  const line = fixture.lines.find(l => l.id === 'test-blue');
  const p = buildLineProfile(line, fixture.stations, {stationById: new Map(fixture.stations.map(s => [s.id, s])), lineById: new Map(fixture.lines.map(l => [l.id, l])), systems: fixture.systems});
  assert.equal(p.ordered, true);
  assert.deepEqual(p.stations.map(s => s.id), line.stationIds);
});

test('breadcrumb: country › province › line › station; line only when navigated through it', () => {
  const c = buildBreadcrumb({provinceCode: 'BKK', line: {id: 'l', name: 'สาย'}, station: {id: 's', name: 'สถานี'}});
  assert.equal(breadcrumbText(c), 'ประเทศไทย › กรุงเทพมหานคร › สาย › สถานี');
  assert.ok(renderBreadcrumb(c).includes('crumb-more'));
  assert.equal(breadcrumbText(buildBreadcrumb({provinceCode: 'XXX'})), 'ประเทศไทย');
});

test('province registry: 77 provinces, unique codes, production-verified codes present, names resolve', () => {
  assert.equal(PROVINCE_LIST.length, 77);
  assert.equal(new Set(PROVINCE_LIST.map(p => p.code)).size, 77);
  assert.equal(new Set(PROVINCE_LIST.map(p => p.dopaCode)).size, 77);
  for (const c of PRODUCTION_VERIFIED_CODES) assert.ok(provinceByCode(c));
  assert.equal(resolveProvince('กรุงเทพมหานคร').code, 'BKK');
  assert.equal(resolveProvince('จังหวัดเชียงใหม่').code, 'CMI');
  assert.equal(resolveProvince('Chonburi').code, 'CBI');
  assert.equal(resolveProvince('83').code, 'PKT');
  assert.equal(resolveProvince(''), null);
});

test('provinces.geojson: 77 frames keyed by the registry codes with label points and provenance', () => {
  const g = JSON.parse(readFileSync(new URL('../data/provinces.geojson', import.meta.url), 'utf8'));
  assert.equal(g.features.length, 77);
  assert.equal(g.metadata.sourceSha256, '310c3adf5c3f5ce574e0ecbc4fadc5761f520d02050fcc3a6373fd9f22d011c0');
  for (const f of g.features) {
    assert.ok(provinceByCode(f.id), f.id);
    assert.equal(provinceByCode(f.id).dopaCode, f.properties.dopaCode);
    assert.equal(f.properties.labelPoint.length, 2);
  }
});

test('ramp: an elevated part meeting a surface part slopes down over RAMP_M with an inserted break', () => {
  const path = [[0, 0], [1000, 0]];
  const p = rampPath(path, 12, {startLow: 0.6});
  assert.equal(p[0][1], 0.6);
  assert.ok(p.some(q => Math.abs(q[0] - RAMP_M) < 1e-6 && Math.abs(q[1] - 12) < 1e-6));
  assert.equal(p.at(-1)[1], 12);
  const flat = rampPath(path, 12);
  assert.ok(flat.every(q => q[1] === 12));
});

test('ribbon width never drops below the minimum pixel width', () => {
  const mpp = metresPerPixel(12, 13.75);
  assert.ok(mpp > 18 && mpp < 19.2, `≈ 18.6 m/px at z12 with MapLibre's 512 px world tiles: ${mpp}`);
  assert.ok(ribbonWidth({elevation: 'elevated'}, mpp) >= 4.5 * mpp - 1e-9);
  assert.equal(ribbonWidth({elevation: 'elevated'}, 0.5), 7);
});

test('LDS scales: exact 41-sample LUTs, class indices round(i×40/(n−1)), measured zero is not a class', () => {
  for (const fam of Object.values(FAMILIES)) {
    assert.equal(fam.lut.length, 41);
    assert.deepEqual([fam.lut[0], fam.lut[20], fam.lut[40]], fam.anchors);
  }
  assert.deepEqual(classColors(5), ['#F4F0E7', '#BAD5D4', '#7DBAC0', '#4C7A98', '#213E70']);
  assert.deepEqual(classColors(5, FAMILIES.activity), ['#F1F5E5', '#AEDFC9', '#60C9AD', '#4097A6', '#25659A']);
  const m = buildCountClasses([0, 3, 9, 27]);
  assert.equal(classify(0, m).state, 'measured_zero');
  assert.equal(classify(null, m).state, 'no_data');
  assert.equal(classify(27, m).fill, '#213E70');
});
