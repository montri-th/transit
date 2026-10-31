/**
 * Pure models behind the reading panel and the charts. No DOM, no map.
 *
 * The first finding (Aha) is computed per selection: how many จุดเปลี่ยนสาย
 * (interchange complexes: records joined by a current relation of
 * 31_INTERCHANGES) the operating network in the scope has, and which ones join
 * the most lines. Ties are broken by "reach" — the number of station records on
 * the lines that meet there (how far one can ride without a further change).
 * Those top hubs are the automatic 3D focus. Snapshot numbers live in tests,
 * never in the UI copy.
 */
import {isInterchange, hasPoint} from './model.js';
import {buildCountClasses, classify} from './scales.js';

const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'th');

/** Interchange hubs of the scope, ranked by lines joined, then reach, then name. */
export function computeInsight(stations, complexes = [], {top = 3} = {}) {
  const operating = stations.filter(s => s.status === 'operating');
  const byId = new Map(operating.map(s => [s.id, s]));
  const hubs = complexes.map(c => {
    const members = c.stationIds.map(id => byId.get(id)).filter(Boolean);
    const lines = new Set(members.flatMap(m => m.lineIds || []));
    if (members.length < 2 || lines.size < 2) return null;
    const anchor = members.find(hasPoint) || members[0];
    return {id: c.id, stationId: anchor.id, stationIds: members.map(m => m.id), name: c.name, lines: lines.size, lineIds: [...lines], reach: c.reach || 0, lat: anchor.lat, lng: anchor.lng};
  }).filter(Boolean).sort((a, b) => b.lines - a.lines || b.reach - a.reach || byName(a, b));
  const construction = stations.filter(s => s.status === 'construction');
  return {
    stations: operating.length,
    lines: new Set(operating.flatMap(s => s.lineIds || [])).size,
    interchanges: hubs.length,
    hubs: hubs.slice(0, top),
    allHubs: hubs,
    construction: construction.length,
    constructionLines: new Set(construction.flatMap(s => s.lineIds || [])).size,
  };
}

/** Lines ranked by stations in the scope, with count-class fills (LDS `count`, same HEX on both themes). */
export function rankLines(stations, lines, systems = []) {
  const systemName = new Map(systems.map(s => [s.id, s.name]));
  const rows = lines.map(l => {
    const members = stations.filter(s => (s.lineIds || []).includes(l.id));
    return {...l, systemName: systemName.get(l.systemId) || '', stations: members.length, operating: members.filter(s => s.status === 'operating').length, construction: members.filter(s => s.status === 'construction').length};
  }).filter(l => l.stations > 0).sort((a, b) => b.stations - a.stations || byName(a, b));
  const classes = buildCountClasses(rows.map(r => r.stations));
  for (const r of rows) r.fill = classify(r.stations, classes).fill;
  return {rows, classes};
}

/** Line profile: ordered station list when the line carries an order, else by name. */
export function buildLineProfile(line, stations, {stationById, lineById, complexById = new Map(), systems = [], provinces = new Set()} = {}) {
  if (!line) return null;
  const order = Array.isArray(line.stationIds) ? line.stationIds : [];
  const members = stations.filter(s => (s.lineIds || []).includes(line.id));
  const memberIds = new Set(members.map(s => s.id));
  const ordered = order.length > 0 && order.every(id => stationById.has(id));
  const list = ordered ? order.filter(id => memberIds.has(id)).map(id => stationById.get(id)) : [...members].sort(byName);
  // Members missing from the declared order (e.g. filtered or newly linked) are appended, never dropped.
  if (ordered) for (const s of members) if (!order.includes(s.id)) list.push(s);
  const system = systems.find(s => s.id === line.systemId);
  return {
    line,
    systemName: system?.name || '',
    ordered,
    stations: list.map(s => ({
      id: s.id, name: s.name, nameEn: s.nameEn, status: s.status,
      code: (s.codesByLine?.[line.id] || s.codes || [])[0] || '',
      otherLines: [...new Set([...(s.lineIds || []), ...(complexById.get(s.complexId)?.lineIds || [])])].filter(id => id !== line.id).map(id => lineById.get(id)?.short || lineById.get(id)?.name).filter(Boolean).join(', '),
    })),
    operating: members.filter(s => s.status === 'operating').length,
    construction: members.filter(s => s.status === 'construction').length,
    interchanges: members.filter(isInterchange).length,
    connections: members.filter(s => (s.interchangeIds || []).length > 0).length,
    provinces: new Set(members.map(s => s.provinceCode).filter(Boolean)).size,
    lengthKm: Number.isFinite(line.lengthKm) ? line.lengthKm : NaN,
    lengthSource: line.lengthSource || '',
    progressPercent: Number.isFinite(line.progressPercent) ? line.progressPercent : NaN,
    progressMetric: line.progressMetric || '',
    progressPeriod: line.progressPeriod || '',
    progressSource: line.progressSource || '',
    progressAll: Array.isArray(line.progressAll) ? line.progressAll : [],
    stage: line.stage || '',
    target: line.target || '',
    targetNote: line.targetNote || '',
    alignmentNote: line.alignmentNote || '',
    calendar: line.calendar || null,
    sources: line.sources || [],
    provinceCodes: provinces,
  };
}

/** Station detail: line chips, connections (current, in-line branch, future, non-rail), ridership and construction evidence. */
export function buildStationDetail(station, {stationById, lineById, interchanges = [], complexById = new Map(), buildingsByStation = new Map(), sourcesById = new Map()} = {}) {
  if (!station) return null;
  const lineNames = s => (s.lineIds || []).map(l => lineById.get(l)?.name).filter(Boolean).join(', ');
  const connections = interchanges.filter(x => (x.stationIds || []).includes(station.id)).flatMap(x => {
    const base = {pathway: x.pathwayLabel || '', status: x.statusLabel || '', scope: x.scope, source: x.sourceUrl || '', stepFree: Boolean(x.stepFree)};
    if (x.scope === 'branch') return [{...base, id: '', name: x.name, lineName: lineNames(station)}];
    const others = (x.stationIds || []).filter(id => id !== station.id).map(id => stationById.get(id)).filter(Boolean)
      .map(o => ({...base, id: o.id, name: o.name, lineName: lineNames(o)}));
    if (x.external) others.push({...base, id: '', name: x.external.name, lineName: x.external.systemId === 'BRT' ? 'รถโดยสารด่วนพิเศษ BRT' : (x.external.systemId || '')});
    return others;
  }).sort((a, b) => ({current: 0, branch: 1, future: 2}[a.scope] ?? 3) - ({current: 0, branch: 1, future: 2}[b.scope] ?? 3) || byName(a, b));
  const building = buildingsByStation.get(station.id) || null;
  const sources = (station.sourceRefs || []).map(r => ({url: r.url || sourcesById.get(r.sourceId)?.url || '', label: r.label || 'หลักฐาน'})).filter(x => x.url);
  return {
    station,
    complex: station.complexId ? complexById.get(station.complexId) || null : null,
    connections,
    ridership: station.ridership || [],
    construction: station.construction || null,
    building,
    coordinateNote: station.coordinateNote || '',
    sources,
  };
}

/** Points of a set of stations (for camera fits). */
export const stationPoints = stations => stations.filter(hasPoint).map(s => [s.lng, s.lat]);
