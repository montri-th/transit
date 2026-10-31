/**
 * Pure models behind the reading panel and the charts. No DOM, no map.
 *
 * The first finding (Aha) is computed per selection: how many operating
 * stations are interchanges (served by two or more lines, or listed in the
 * interchange register) and which ones connect the most lines. Those top hubs
 * are the automatic 3D focus. Numerator, denominator and the hubs are always
 * shown together; snapshot numbers live in tests, never in the UI.
 */
import {isInterchange, hasPoint} from './model.js';
import {buildCountClasses, classify} from './scales.js';

const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'th');

/** Interchange hubs of the scope, ranked by lines served, then ridership (when reported), then name. */
export function computeInsight(stations, {top = 3} = {}) {
  const operating = stations.filter(s => s.status === 'operating');
  const hubs = operating.filter(isInterchange)
    .map(s => ({id: s.id, name: s.name, lines: (s.lineIds || []).length, ridership: s.ridershipRank ?? Infinity, lat: s.lat, lng: s.lng}))
    .sort((a, b) => b.lines - a.lines || a.ridership - b.ridership || byName(a, b));
  const construction = stations.filter(s => s.status === 'construction');
  return {
    stations: operating.length,
    interchanges: hubs.length,
    hubs: hubs.slice(0, top),
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
export function buildLineProfile(line, stations, {stationById, lineById, systems = [], provinces = new Set()} = {}) {
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
      otherLines: (s.lineIds || []).filter(id => id !== line.id).map(id => lineById.get(id)?.short || lineById.get(id)?.name).filter(Boolean).join(', '),
    })),
    operating: members.filter(s => s.status === 'operating').length,
    construction: members.filter(s => s.status === 'construction').length,
    interchanges: members.filter(isInterchange).length,
    provinces: new Set(members.map(s => s.provinceCode).filter(Boolean)).size,
    lengthKm: Number.isFinite(line.lengthKm) ? line.lengthKm : NaN,
    lengthSource: line.lengthSource || '',
    progressPercent: Number.isFinite(line.progressPercent) ? line.progressPercent : NaN,
    progressMetric: line.progressMetric || '',
    progressPeriod: line.progressPeriod || '',
    progressSource: line.progressSource || '',
    sources: line.sources || [],
    provinceCodes: provinces,
  };
}

/** Station detail: line chips, interchange connections, ridership and construction evidence. */
export function buildStationDetail(station, {stationById, lineById, interchanges = [], buildingsByStation = new Map(), sourcesById = new Map()} = {}) {
  if (!station) return null;
  const connections = interchanges.filter(x => (x.stationIds || []).includes(station.id)).flatMap(x => (x.stationIds || []).filter(id => id !== station.id).map(id => {
    const other = stationById.get(id);
    return other ? {id, name: other.name, lineName: (other.lineIds || []).map(l => lineById.get(l)?.name).filter(Boolean).join(', '), pathway: x.pathwayLabel || '', status: x.statusLabel || ''} : null;
  })).filter(Boolean);
  const building = buildingsByStation.get(station.id) || null;
  const sources = (station.sourceRefs || []).map(r => ({url: r.url || sourcesById.get(r.sourceId)?.url || '', label: r.label || 'หลักฐาน'})).filter(x => x.url);
  return {
    station,
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
