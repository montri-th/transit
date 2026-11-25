import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {decodeOperatorLogos, lineLogos, lineMark, logoPlate} from '../js/operator-logos.js';
import {renderLine, renderStation, renderOverview} from '../js/panel.js';

// Rail agencies' logos (0.4.0): data/operator-logos.json and assets/operator-logos/ are written only by
// scripts/add-operator-logos.py from the research team's transit logo library (DATA_METHOD.md §12).
const root = new URL('../', import.meta.url);
const json = JSON.parse(readFileSync(new URL('data/operator-logos.json', root), 'utf8'));
const data = JSON.parse(readFileSync(new URL('data/transit.json', root), 'utf8'));
const reg = decodeOperatorLogos(json);
const systemById = new Map(data.systems.map(s => [s.id, s]));
const line = id => data.lines.find(l => l.id === id);
const sha256 = buf => createHash('sha256').update(buf).digest('hex');

test('every logo file is in the registry with its bytes, and nothing else is in the folder', () => {
  const files = readdirSync(new URL('assets/operator-logos/', root)).sort();
  assert.deepEqual(files, Object.values(json.logos).map(x => x.file.split('/').pop()).sort());
  for (const [key, x] of Object.entries(json.logos)) {
    const bytes = readFileSync(new URL(x.file, root));
    assert.equal(sha256(bytes), x.sha256, key);
    assert.equal(bytes.length, x.bytes, key);
    assert.ok(key === `OL-${x.sha256.slice(0, 16)}` && x.file.includes(x.sha256.slice(0, 20)), key);
    assert.ok(/^https:\/\//.test(x.sourcePage) && !/google|drive|localhost/i.test(x.sourcePage), key);
    assert.ok(x.transformation === 'none' ? x.original === null : x.original?.sha256?.length === 64, `${key}: a derived file keeps the original's SHA-256`);
  }
  assert.equal(reg.logos.size, Object.keys(json.logos).length, 'every record passes the loader');
  assert.equal(json.meta.manifestSha256.length, 64);
});

test('agencies come from the demo systems only, and each slot holds a known logo', () => {
  const inDemo = new Set(data.systems.map(s => s.operatorId).filter(Boolean));
  assert.deepEqual(json.meta.agenciesInDemo, [...inDemo].sort());
  for (const [agency, slots] of Object.entries(json.agencies)) {
    assert.ok(inDemo.has(agency), agency);
    for (const key of Object.values(slots)) assert.ok(json.logos[key], `${agency}: ${key}`);
  }
  assert.deepEqual(Object.keys(json.agencies).sort(), ['BEM', 'BTSC', 'MRTA', 'SRTET']);
});

test('a line takes the logos of its GTFS agency; a line under construction takes none', () => {
  assert.equal(lineLogos(line('BTS_SUKHUMVIT'), systemById, reg).system?.label, 'BTS Skytrain');
  assert.equal(lineLogos(line('BTS_SUKHUMVIT'), systemById, reg).operator, null, 'BTSC has no logo of its own in the library');
  assert.equal(lineLogos(line('MRT_BLUE'), systemById, reg).system?.label, 'MRT');
  assert.equal(lineLogos(line('MRT_BLUE'), systemById, reg).operator?.label, 'BEM');
  assert.equal(lineLogos(line('MRT_PINK'), systemById, reg).system, null);
  assert.equal(lineMark(line('MRT_PINK'), systemById, reg)?.label, 'MRTA');
  assert.equal(lineMark(line('ARL_CITY'), systemById, reg)?.role, 'brand_primary');
  const south = line('MRT_PURPLE_SOUTH');
  assert.equal(south.status, 'construction');
  assert.deepEqual(lineLogos(south, systemById, reg), {system: null, operator: null}, 'its system has an agency, but it does not run yet');
  assert.deepEqual(lineLogos(line('BTS_SUKHUMVIT'), systemById, null), {system: null, operator: null}, 'no file: no logo');
});

test('the loader refuses a record outside the folder, a key that is not its hash or an unknown plate', () => {
  const bad = structuredClone(json);
  const [k] = Object.keys(bad.logos);
  bad.logos[k].file = 'https://example.com/x.png';
  assert.equal(decodeOperatorLogos(bad).logos.has(k), false);
  const plate = structuredClone(json);
  plate.logos[k].plate = '#FF0000';
  assert.equal(decodeOperatorLogos(plate).logos.has(k), false);
  assert.equal(decodeOperatorLogos(null), null);
  assert.equal(decodeOperatorLogos({}), null);
});

test('views: the line heading, the operator fact, the chips and the ranking carry the plate; none without the file', () => {
  const blue = line('MRT_BLUE');
  const profile = {line: blue, stations: [], progressAll: [], sources: [], operating: 1, interchanges: 0, provinces: 1, systemName: 'MRT'};
  const withLogos = renderLine(profile, {logos: lineLogos(blue, systemById, reg)});
  assert.match(withLogos, /class="line-title"><span class="logo-plate"/);
  assert.match(withLogos, /class="operator-name"><span class="logo-plate"/);
  assert.match(withLogos, /alt=""/, 'decorative: the name beside it is the identity');
  assert.doesNotMatch(renderLine(profile), /logo-plate/);
  const plate = logoPlate(lineMark(blue, systemById, reg), {height: 18});
  assert.match(plate, /style="background:#FFFFFF"/);
  assert.match(plate, /width="18" height="18"/, 'a square mark keeps its proportions');
  const station = {station: {id: 'S1', name: 'สถานี', lineIds: ['MRT_BLUE'], codes: ['BL01']}, ridership: [], connections: []};
  const lineById = new Map(data.lines.map(l => [l.id, l]));
  assert.match(renderStation(station, {lineById, logoFor: id => lineMark(lineById.get(id), systemById, reg)}), /class="line-chip"[^>]*>.*logo-plate/s);
  assert.doesNotMatch(renderStation(station, {lineById}), /logo-plate/);
  const overview = renderOverview({insight: {}, summary: {}, lineRanking: [{...blue, stations: 3, systemName: 'MRT'}], logoFor: id => lineMark(lineById.get(id), systemById, reg)});
  assert.match(overview, /logo-plate is-inline/);
});
