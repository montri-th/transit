/**
 * The search box of CityMETER · Transit (0.4.0; owner 2026-11-12 12:05, VERBATIM: “ศึกษาแนวคิดเรื่อง Fuzzy search แล้ว
 * implement กับ demo web ให้ได้ user benefit สูงสุดตาม user intent ในขณะนั้น และตาม product statement”): the names
 * js/find.js gives js/shell/fuzzy.js, read from the shipped data, and what a name typed opens.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createIndex, key1, STEP} from '../js/shell/fuzzy.js';
import {SEARCH_KINDS, SEARCH_HEADS, SEARCH_HINT, searchEntries, searchNote} from '../js/find.js';
import {filterStations} from '../js/model.js';

let built = null;
function index() {
  if (!built) {
    const loaded = {data: JSON.parse(readFileSync(new URL('../data/transit.json', import.meta.url), 'utf8'))};
    const idx = createIndex({kinds: SEARCH_KINDS, heads: SEARCH_HEADS});
    idx.addAll(searchEntries(loaded));
    built = {idx, ...loaded};
  }
  return built;
}
const top = (result, n = 5) => result.items.slice(0, n).map(i => `${i.entry.kind}:${i.entry.id}`);

test('every province with a station, every line and every station of the data can be found by name', () => {
  const {idx, data} = index();
  const entries = [...searchEntries({data})];
  const nameless = entries.filter(e => !key1(e.name || '') && !key1(e.nameEn || '')).length;
  assert.ok(idx.size > 300 && entries.length - idx.size <= nameless, `${idx.size} of ${entries.length} entries: only one whose name has no letter (${nameless}) is left out`);
  assert.deepEqual([...new Set(entries.map(e => e.kind))].sort(), SEARCH_KINDS.map(k => k.id).sort(), 'every kind the list names has entries');
  assert.equal(entries.filter(e => e.kind === 'station').length, data.stations.length, 'every station, of every status');
  assert.equal(entries.filter(e => e.kind === 'line').length, data.lines.length, 'every line');
  let missed = 0;
  for (const s of data.stations) {
    const r = idx.search(s.name);
    if (!r.items.slice(0, 20).some(i => i.entry.kind === 'station' && i.entry.id === s.id)) missed++;
  }
  assert.equal(missed, 0, 'every station typed as written');
});

test('a name typed opens what it names; one exact place, line or station is chosen ahead', () => {
  const {idx} = index();
  let r = idx.search('จ.นนทบุรี');
  assert.deepEqual([top(r, 1)[0], r.preselect?.kind, r.total], ['province:NBI', 'province', 1]);
  // A station by its name in either language, with the word สถานี, with BTS in front, or by its code.
  for (const typed of ['อโศก', 'asok', 'สถานีอโศก', 'E4']) {
    r = idx.search(typed);
    assert.deepEqual([r.items[0].entry.kind, r.items[0].entry.name, r.preselect?.name], ['station', 'อโศก', 'อโศก'], typed);
  }
  assert.equal(idx.search('E4').items[0].step, STEP.code);
  assert.equal(idx.search('bts อโศก').items[0].entry.name, 'อโศก', 'the word people put in front is left aside');
  // Two stations of one name: the reader says which — or types the line with it.
  r = idx.search('สยาม');
  assert.deepEqual([r.items.slice(0, 2).map(i => i.entry.name), r.preselect], [['สยาม', 'สยาม'], null]);
  r = idx.search('สยาม สีลม');
  assert.deepEqual([r.total, r.items[0].step, r.preselect?.station.lineIds], [1, STEP.within, ['BTS_SILOM']]);
  // A line by its name, its colour, its short name or its English name.
  for (const typed of ['สายสีชมพู', 'pink line']) {
    r = idx.search(typed);
    assert.deepEqual([r.items[0].entry.kind, r.items[0].entry.id, r.preselect?.id], ['line', r.items[0].entry.id, r.items[0].entry.id], typed);
    assert.equal(r.items[0].entry.name, 'สายสีชมพู');
  }
  r = idx.search('สายสีน้ำเงิน');
  assert.deepEqual([r.items[0].entry.name, r.preselect?.kind], ['MRT สายสีน้ำเงิน', 'line']);
  r = idx.search('arl');
  assert.deepEqual([r.items[0].entry.name, r.items[0].matched], ['แอร์พอร์ต เรล ลิงก์', 'ARL']);
  r = idx.search('สุขุมวิท');
  assert.deepEqual([r.items.slice(0, 2).map(i => i.entry.kind), r.preselect], [['line', 'station'], null], 'a line and a station of another line go by the name: the reader says which');
  r = idx.search('สายสีส้ม');
  assert.deepEqual([r.items.slice(0, 2).map(i => i.entry.kind), r.preselect], [['line', 'line'], null], 'two lines of that colour');
});

test('a name typed another way is still found, and a guess is said to be one', () => {
  const {idx} = index();
  let r = idx.search('หมอชิด');
  assert.deepEqual([r.items[0].entry.name, r.items[0].show, r.preselect], ['หมอชิต', 'near', null]);
  r = idx.search('mo chit');
  assert.deepEqual([r.items[0].entry.name, r.items[0].matched], ['หมอชิต', 'Mo Chit']);
  r = idx.search('vFLd');
  assert.deepEqual([r.layout, r.items[0]?.entry.name, r.items[0]?.show], ['อโศก', 'อโศก', 'near'], 'อโศก typed with the keyboard left on English');
  assert.equal(idx.search('zzzzqqqq').total, 0);
});

test('the list says what an entry is and where, and the page opens every kind it lists', () => {
  const {idx, data} = index();
  const note = entry => searchNote(entry, {data});
  const of = (typed, kind) => idx.search(typed).items.find(i => i.entry.kind === kind).entry;
  assert.equal(note(of('นนทบุรี', 'province')), 'จังหวัด');
  assert.equal(note(of('สายสีชมพู', 'line')), 'สาย');
  assert.equal(note(of('สายสีส้ม', 'line')), 'สาย · กำลังก่อสร้าง');
  assert.equal(note(of('mrt', 'system')), 'ระบบ');
  assert.equal(note(of('อโศก', 'station')), 'สถานี E4 · BTS สายสุขุมวิท');
  for (const e of searchEntries({data})) {
    const line = note(e);
    assert.ok(line && !/ไม่ใช่|อาจ/.test(line.split(' · ')[0]) && !/ ·  ·|^ · | · $/.test(line), `${e.kind} ${e.name}: ${line}`);
  }
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  for (const k of SEARCH_KINDS) assert.ok(app.includes(`entry.kind === '${k.id}'`), `js/app.js opens a ${k.id}`);
  assert.ok(SEARCH_HINT.startsWith('ลอง'));
  assert.ok(app.includes("f === 'search' && !state.finder ? 180 : 0"), 'without the list the box filters as it is typed in');
  // The words still keep stations the way the box always did (a line's name keeps its stations).
  assert.ok(filterStations(data.stations, {search: 'สีชมพู'}, data.lines).length > 0);
});
