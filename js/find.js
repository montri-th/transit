/**
 * What the search box of CityMETER · Transit knows by name: the entries js/shell/fuzzy.js matches and
 * js/shell/search.js lists (release 0.4.0; owner 2026-11-12 12:05, VERBATIM: “ศึกษาแนวคิดเรื่อง Fuzzy search แล้ว
 * implement กับ demo web ให้ได้ user benefit สูงสุดตาม user intent ในขณะนั้น และตาม product statement”).
 *
 * The page reads where rail stations are and which lines they are on. So a name typed here opens the level that
 * shows it: a province (its stations), a line (its stations in order), a system of several lines (its filter), or
 * one station (its page). A station is also found by its code (“N24”), and with its line (“สยาม สีลม”). The order
 * below is the order among equal matches.
 *
 * Pure: entries from the dataset; no DOM, no numbers shown (a row names what it is and where).
 */
import {STATUS, provinceByCode, PROVINCE_LIST} from './model.js';
import {PROVINCE_AKA} from './shell/fuzzy.js';

export const SEARCH_KINDS = Object.freeze([
  {id: 'province', level: 'province', auto: true}, {id: 'line', auto: true}, {id: 'system', auto: true}, {id: 'station', level: 'station', auto: true},
]);
/** Words a name may begin with, or carry, that people add or leave out (“สายสีชมพู” is “สีชมพู”, “BTS อโศก” is “อโศก”). */
export const SEARCH_HEADS = Object.freeze(['สถานีรถไฟฟ้า', 'รถไฟฟ้า', 'สาย', 'bts', 'mrt', 'station', 'line']);
/** What to try when nothing is found: the kinds of name this demo knows. */
export const SEARCH_HINT = 'ลองชื่อสถานี รหัสสถานี สาย หรือจังหวัด';

/** Every entry: the provinces that have a station, the lines, the systems of several lines, then the stations. */
export function* searchEntries({data}) {
  const {stations, lines, systems} = data;
  const provinces = new Set(stations.map(s => s.provinceCode));
  for (const p of PROVINCE_LIST) if (provinces.has(p.code)) yield {id: p.code, kind: 'province', name: p.th, nameEn: p.en, aka: PROVINCE_AKA[p.th], codes: [p.code], province: p.code};
  // A line by the name the page gives it, the short one, the one its source writes and its colour.
  for (const l of lines) yield {id: l.id, kind: 'line', name: l.name, nameEn: l.nameEn, aka: [l.short, l.sourceName, l.colourWord ? `สายสี${l.colourWord}` : '', l.code], line: l};
  // A system the page offers (some station is of it) is listed when it is not one line under the same name: the
  // line's row answers for that one.
  const lineNames = new Set(lines.map(l => l.name)), used = new Set(stations.flatMap(s => s.systemIds || []));
  for (const s of systems || []) if (used.has(s.id) && !lineNames.has(s.name)) yield {id: s.id, kind: 'system', name: s.name, nameEn: s.nameEn};
  const lineById = new Map(lines.map(l => [l.id, l])), places = new Map();
  for (const s of stations) {
    const key = `${(s.lineIds || []).join(',')}|${s.district || ''}|${s.provinceCode || ''}`;
    if (!places.has(key)) {
      const p = provinceByCode(s.provinceCode);
      places.set(key, [...(s.lineIds || []).flatMap(id => { const l = lineById.get(id); return l ? [l.name, l.nameEn, l.short] : []; }), s.district, p?.th, p?.en]);
    }
    yield {id: s.id, kind: 'station', name: s.name, nameEn: s.nameEn, codes: s.codes, within: places.get(key), province: s.provinceCode || '', station: s};
  }
}

/** The line under a name in the list: what it is and where. */
export function searchNote(entry, {data}) {
  const state = status => (status && status !== 'operating' ? STATUS[status]?.label || '' : '');
  if (entry.kind === 'province') return 'จังหวัด';
  if (entry.kind === 'line') return ['สาย', state(entry.line.status)].filter(Boolean).join(' · ');
  if (entry.kind === 'system') return 'ระบบ';
  // A station reads with its code and its lines; one not in service yet says so, as its page does.
  const s = entry.station, lines = (s.lineIds || []).map(id => data.lines.find(l => l.id === id)?.name).filter(Boolean);
  return [['สถานี', (s.codes || [])[0]].filter(Boolean).join(' '), ...lines, state(s.status)].filter(Boolean).join(' · ');
}
