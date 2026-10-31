/**
 * Other modes around a station (owner 2026-10-31: "mode อื่นๆหายไป").
 *
 * For each optional layer, the points within NEARBY_RADIUS_M of the station's
 * reference point and the nearest one. Distances are straight lines from the
 * station's reference point (not walking distance, not from an entrance).
 *
 * A layer that does not cover the station — its frame or its province list
 * leaves the station out — says "outside the data boundary": no data is never
 * shown as zero. Inside the boundary, zero points within the radius is a
 * measured zero of that source and is said so.
 */
export const NEARBY_RADIUS_M = 500;
/** Order of the rows in the station panel; air last (its point is the aerodrome reference point, not a terminal). */
export const NEARBY_ORDER = ['moto', 'bus', 'boat', 'srt', 'intercity', 'air'];

/** Metres between two [lng, lat] points (equirectangular; exact enough within tens of kilometres). */
export function distanceM([lng1, lat1], [lng2, lat2]) {
  const kx = 111320 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180), ky = 110574;
  return Math.hypot((lng2 - lng1) * kx, (lat2 - lat1) * ky);
}

export function inFrame([lng, lat], frame) {
  return Array.isArray(frame) && frame.length === 4 && lng >= frame[0] && lng <= frame[2] && lat >= frame[1] && lat <= frame[3];
}

/**
 * Whether a layer covers a station: inside its frame, and — when the layer names
 * provinces (motorcycle-taxi stands are a Bangkok register) — in one of them.
 */
export function covers(summary, station) {
  if (!summary || !Number.isFinite(station?.lng) || !Number.isFinite(station?.lat)) return false;
  if (Array.isArray(summary.provinces) && summary.provinces.length && !summary.provinces.includes(station.provinceCode)) return false;
  return !summary.frame || inFrame([station.lng, station.lat], summary.frame);
}

/** Points [{lng, lat, name}] within `radius` of `p`, and the nearest point overall. */
export function near(points, p, radius = NEARBY_RADIUS_M) {
  let count = 0, nearest = null;
  for (const q of points || []) {
    const d = distanceM(p, [q.lng, q.lat]);
    if (d <= radius) count += 1;
    if (!nearest || d < nearest.distance) nearest = {name: q.name || '', distance: d};
  }
  return {count, nearest};
}

/**
 * Rows for the station panel. `points` maps layer → [{lng, lat, name}] (only loaded
 * layers), `summary` is data/transit.json meta.contextLayers.
 * Row: {layer, label, unit, state: 'loading'|'outside'|'measured', count, nearest, source, period, boundary}.
 */
export function nearbyModes(station, points, summary, {radius = NEARBY_RADIUS_M, order = NEARBY_ORDER} = {}) {
  const p = [station.lng, station.lat];
  return order.filter(k => summary?.[k]).map(layer => {
    const s = summary[layer];
    const base = {layer, label: s.label, unit: s.unit, source: s.source, period: s.period, boundary: s.boundary, count: null, nearest: null};
    if (!covers(s, station)) return {...base, state: 'outside'};
    if (!points?.[layer]) return {...base, state: 'loading'};
    const r = near(points[layer], p, radius);
    return {...base, state: 'measured', count: r.count, nearest: r.nearest};
  });
}

/** "120 ม." / "1.4 กม." */
export function distanceLabel(m) {
  if (!Number.isFinite(m)) return '';
  return m < 1000 ? `${Math.round(m / 10) * 10} ม.` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} กม.`;
}
