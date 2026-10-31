/**
 * Dataset vocabulary, shared filter and summary helpers for CityMETER Transit.
 *
 * Grain: one station record per rail station of a line or system (data/transit.json
 * `stations`), built by scripts/build-data.py from the research master's station
 * catalogue, construction-station register and interchange register. A station
 * served by several lines is ONE record with several lineIds when the research
 * master links the catalogue entries as the same place (accepted identity links);
 * otherwise each entry stays its own record and the interchange register says how
 * they connect. Nothing in this module mutates a record; filters return new arrays.
 *
 * Status vocabulary (never upgraded on screen):
 *   operating     — source shows passenger service (catalogue service_status + basis)
 *   construction  — station of a project under construction; not in service
 *   unverified    — catalogue entry whose current service could not be confirmed
 */
import {resolveProvince, provinceByCode, PROVINCE_LIST} from './provinces-list.js';

export const STATUS = Object.freeze({
  operating: {label: 'เปิดให้บริการ', tone: 'listed'},
  construction: {label: 'กำลังก่อสร้าง', tone: 'pending'},
  unverified: {label: 'ยังยืนยันบริการไม่ได้', tone: 'neutral'},
});

/** Filter presets of the สถานะ control. `current` = operating + construction (the default view). */
export const STATUS_FILTERS = Object.freeze({
  current: ['operating', 'construction'],
  operating: ['operating'],
  construction: ['construction'],
  all: ['operating', 'construction', 'unverified'],
});

export const ELEVATION_LABEL = Object.freeze({elevated: 'ยกระดับ', underground: 'ใต้ดิน', surface: 'ระดับพื้น', mixed: 'หลายระดับ'});

export {resolveProvince, provinceByCode, PROVINCE_LIST};

/** A usable coordinate inside Thailand's bounding box. */
export const hasPoint = r => Number.isFinite(r?.lat) && Number.isFinite(r?.lng) && r.lat >= 5 && r.lat <= 21 && r.lng >= 97 && r.lng <= 106;

export const isInterchange = r => (r?.lineIds?.length || 0) > 1 || (r?.interchangeIds?.length || 0) > 0;

const norm = v => String(v ?? '').normalize('NFKC').trim().toLocaleLowerCase('th-TH');

/**
 * Shared filter used by map, counters, charts, panel and table.
 * f: {search, status, system, line, province, lineIds:Set|null}
 */
export function filterStations(stations, f = {}, lines = []) {
  const q = norm(f.search);
  const statuses = new Set(STATUS_FILTERS[f.status] || STATUS_FILTERS.current);
  const lineName = new Map(lines.map(l => [l.id, `${l.name} ${l.nameEn || ''} ${l.code || ''}`]));
  return stations.filter(s => {
    if (!statuses.has(s.status)) return false;
    if (f.system && !(s.systemIds || []).includes(f.system)) return false;
    if (f.line && !(s.lineIds || []).includes(f.line)) return false;
    if (f.province && s.provinceCode !== f.province) return false;
    if (f.lineIds && !(s.lineIds || []).some(id => f.lineIds.has(id))) return false;
    if (!q) return true;
    const hay = [s.name, s.nameEn, ...(s.codes || []), provinceByCode(s.provinceCode)?.th, provinceByCode(s.provinceCode)?.en, ...(s.lineIds || []).map(id => lineName.get(id))].map(norm).join(' ');
    return hay.includes(q);
  });
}

/** Lines that pass the same filter (a line is kept when it has a station in the scope, or matches the line/system filters itself). */
export function filterLines(lines, stations, f = {}) {
  const used = new Set(stations.flatMap(s => s.lineIds || []));
  return lines.filter(l => {
    if (f.system && l.systemId !== f.system) return false;
    if (f.line && l.id !== f.line) return false;
    return used.has(l.id);
  });
}

/** Counts for the selection — every count says what it counts. */
export function summarize(stations, lines = []) {
  const lineIds = new Set(stations.flatMap(s => s.lineIds || []));
  const byStatus = s => stations.filter(r => r.status === s).length;
  return {
    stations: stations.length,
    operating: byStatus('operating'),
    construction: byStatus('construction'),
    unverified: byStatus('unverified'),
    interchanges: stations.filter(isInterchange).length,
    lines: lines.filter(l => lineIds.has(l.id)).length,
    provinces: new Set(stations.map(s => s.provinceCode).filter(Boolean)).size,
    mapped: stations.filter(hasPoint).length,
    buildings: stations.filter(s => (s.buildingIds || []).length).length,
  };
}

export const safeURL = value => {
  try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; }
  catch { return ''; }
};
