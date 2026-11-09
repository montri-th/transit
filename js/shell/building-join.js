/**
 * Branch points × building footprints — a display-time spatial join (same contract as CityMETER ·
 * Restaurants 0.2 and Pharmacy 0.1, owner decision 2026-10-23).
 *
 * Buildings are the ones the map draws: the focus-tier footprints (js/massing.js keeps each original footprint,
 * before rounding/offset) — OpenStreetMap, or CityMETER Building V4 inside a CityMETER unit (owner 2026-11-01,
 * point 3; `source: 'cm'`, whole buildings, keyed `cm:`). A row joins a building when its point (the source's own point or
 * its CityMETER venue's registry reference point) lies inside the footprint; inside several (an OSM part inside an outline) → the smallest. Only rows that carry
 * a point take part (most rows have none).
 *
 * What it is: "จุดตกในอาคาร" — the point the source published falls inside the outline. What it is
 * not: a verified located-inside relationship, an address, a floor or a unit. The result only (a) answers a
 * click on a building, (b) names the building being looked at (camera, x-ray) and (c) lists the rows of one
 * building together (owner 2026-10-29: “ร้านเครือ กับ ร้านในอาคาร ให้แสดงรวมกันไม่ต้องแยก”): rows the sheet
 * links to a CityMETER venue whose registry point falls in the building, and rows whose own points fall in it,
 * in one list (joinBuildings + js/app.js#buildingRows). It never changes an area count.
 *
 * Part of the shared CityMETER demo shell: edit it in every repository at once (js/shell/manifest.json).
 */
import {pointInRing} from './geometry.js';

/** Grid cell (degrees, ≈ 165 m) of the bbox index. */
const CELL = 0.0015;

const bboxOf = ring => {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n];
};
/** Planar area in degree² (only compared between nearby footprints). */
const areaOf = ring => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
};

/**
 * Normalise a footprint: {key, outer, holes?, height?, kind?, ref?}.
 * `key` must be unique across the join ('osm:<id>').
 */
export function footprint(b) {
  const outer = b.outer, holes = b.holes || [];
  return {...b, holes, bbox: b.bbox || bboxOf(outer), area: areaOf(outer)};
}

export function containsPoint(b, [x, y]) {
  const [w, s, e, n] = b.bbox;
  if (x < w || x > e || y < s || y > n) return false;
  if (!pointInRing([x, y], b.outer)) return false;
  return !b.holes.some(h => pointInRing([x, y], h));
}

function indexOf(buildings) {
  const cells = new Map();
  for (const b of buildings) {
    const [w, s, e, n] = b.bbox;
    for (let i = Math.floor(w / CELL); i <= Math.floor(e / CELL); i++) {
      for (let j = Math.floor(s / CELL); j <= Math.floor(n / CELL); j++) {
        const k = `${i}:${j}`;
        const list = cells.get(k);
        if (list) list.push(b); else cells.set(k, [b]);
      }
    }
  }
  return cells;
}

const lonOfTile = (x, z) => (x / 2 ** z) * 360 - 180;
const latOfTile = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

/** A point strictly inside a ring: its vertex centroid when inside, else the first inside diagonal midpoint. */
export function interiorOf(ring) {
  const n = ring.length - 1;
  if (n < 3) return ring[0];
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += ring[i][0]; cy += ring[i][1]; }
  const c = [cx / n, cy / n];
  if (pointInRing(c, ring)) return c;
  for (let k = 2; k < n; k++) {
    const m = [(ring[0][0] + ring[k][0]) / 2, (ring[0][1] + ring[k][1]) / 2];
    if (pointInRing(m, ring)) return m;
  }
  return ring[0];
}

/**
 * Which footprints make one building:
 *  - pieces cut by tile edges. The focus tier clips every building to its z14 tile (js/massing.js), so a building
 *    across a tile edge arrives as two or more footprints with the same OpenStreetMap id. Two pieces are one
 *    building when they share that id, sit in neighbouring tiles and each has a vertex on their common edge within
 *    `toleranceM` of a vertex of the other (the cut points of one outline; each tile quantises it to ≈ 0.6 m at
 *    z14). An id alone is never enough: OpenFreeMap merges buildings of equal height into one feature per tile,
 *    so houses on both sides of an edge can share an id without being one building;
 *  - the building:parts inside an outline OpenMapTiles hides in 3D (`outline: true`): a part whose interior point
 *    lies inside the outline belongs to it (podium, towers and annexes of one mapped building);
 *  - `unions`: pairs the caller found standing at one point (a point inside a podium and a tower drawn
 *    separately), see joinBuildings.
 * footprints: [{id, osmId, outer: [[lon, lat]…], tile: {x, y, z}, outline?}] → Map(id → group id, the smallest).
 */
export function groupPieces(footprints, {toleranceM = 2, unions = []} = {}) {
  const parent = new Map(footprints.map(f => [f.id, f.id]));
  const find = id => { let r = id; while (parent.get(r) !== r) r = parent.get(r); parent.set(id, r); return r; };
  const unite = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb)); };
  const byTile = new Map(); // `${osmId}|${x}|${y}` → pieces touching an edge of their tile
  for (const f of footprints) {
    if (f.osmId == null || !f.tile || !Array.isArray(f.outer)) continue;
    const {x, y, z = 14} = f.tile;
    const W = lonOfTile(x, z), E = lonOfTile(x + 1, z), N = latOfTile(y, z), S = latOfTile(y + 1, z), eps = 1e-7;
    const edges = {w: [], e: [], n: [], s: []};
    for (const [lon, lat] of f.outer) {
      if (Math.abs(lon - W) < eps) edges.w.push(lat);
      if (Math.abs(lon - E) < eps) edges.e.push(lat);
      if (Math.abs(lat - N) < eps) edges.n.push(lon);
      if (Math.abs(lat - S) < eps) edges.s.push(lon);
    }
    if (!edges.w.length && !edges.e.length && !edges.n.length && !edges.s.length) continue;
    const k = `${f.osmId}|${x}|${y}`;
    const list = byTile.get(k);
    const entry = {f, edges, lat: (N + S) / 2};
    if (list) list.push(entry); else byTile.set(k, [entry]);
  }
  const near = (as, bs, metres) => as.some(a => bs.some(b => Math.abs(a - b) * metres < toleranceM));
  for (const [k, list] of byTile) {
    const [osmId, xs, ys] = k.split('|'), x = Number(xs), y = Number(ys);
    for (const a of list) {
      // East neighbour (shared meridian) and south neighbour (shared parallel); west/north are found from the other side.
      for (const b of byTile.get(`${osmId}|${x + 1}|${y}`) || []) if (a.edges.e.length && b.edges.w.length && near(a.edges.e, b.edges.w, 110574)) unite(a.f.id, b.f.id);
      const kx = 111320 * Math.cos((a.lat * Math.PI) / 180);
      for (const b of byTile.get(`${osmId}|${x}|${y + 1}`) || []) if (a.edges.s.length && b.edges.n.length && near(a.edges.s, b.edges.n, kx)) unite(a.f.id, b.f.id);
    }
  }
  // building:parts inside an outline hidden in 3D (same tile: the outline is clipped to it like the parts).
  const outlines = footprints.filter(f => f.outline && Array.isArray(f.outer));
  if (outlines.length) {
    const parts = footprints.filter(f => !f.outline && Array.isArray(f.outer)).map(f => ({f, at: interiorOf(f.outer)}));
    for (const o of outlines) {
      const [w, s, e, n] = o.bbox || bboxOf(o.outer);
      for (const {f, at} of parts) {
        if (f.tile && o.tile && (f.tile.x !== o.tile.x || f.tile.y !== o.tile.y)) continue;
        if (at[0] < w || at[0] > e || at[1] < s || at[1] > n) continue;
        if (pointInRing(at, o.outer)) unite(o.id, f.id);
      }
    }
  }
  for (const [a, b] of unions) if (parent.has(a) && parent.has(b)) unite(a, b);
  return new Map(footprints.map(f => [f.id, find(f.id)]));
}

/**
 * Join rows (with longitude/latitude) to footprints.
 * Returns {buildings: Map(key → footprint), byBuilding: Map(key → rows[]), byRow: Map(rowId → key)}.
 */
export function joinRows(footprints, rows) {
  const list = footprints.map(footprint);
  const buildings = new Map(list.map(b => [b.key, b]));
  const cells = indexOf(list);
  const byBuilding = new Map(), byRow = new Map();
  for (const r of rows) {
    const x = r.longitude, y = r.latitude;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const candidates = cells.get(`${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`);
    if (!candidates) continue;
    let best = null;
    for (const b of candidates) if ((!best || b.area < best.area) && containsPoint(b, [x, y])) best = b;
    if (!best) continue;
    byRow.set(r.id, best.key);
    const at = byBuilding.get(best.key);
    if (at) at.push(r); else byBuilding.set(best.key, [r]);
  }
  return {buildings, byBuilding, byRow};
}

/**
 * The drawn building the camera turns to when an item's pin lies in no outline (Hotel 0.3.2, owner 2026-11-02: “เวลาคลิกที่ poi hotel
 * แล้วต้องแสดง 2-point perspective ของ 3d building mass ทุกกรณี”). Pins are often published on the road, a drive or a
 * garden: the building nearest the pin, measured to its outline (and courtyard edges) on a local plane, within
 * `maxM`; among the pieces within `slackM` of the nearest, the largest footprint — a main block before a kiosk or a
 * gatehouse beside the pin. It names the camera's building only (“อาคารใกล้หมุด”): never a join, never a row of
 * the panel's “…ในอาคารนี้” list (Hotel: “ที่พักในอาคารนี้”).
 * pieces: massing footprints [{id, outer, holes?, bbox?}]; keyOfPiece: Map(piece id → building key) of joinBuildings.
 * → {key, pieceId, distanceM} | null (nothing drawn within maxM).
 */
export function nearestBuilding(pieces, [lon, lat], {keyOfPiece = null, maxM = 300, slackM = 10} = {}) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110574;
  const dLon = maxM / kx, dLat = maxM / ky;
  const px = lon * kx, py = lat * ky;
  const toSegment = (a, b) => {
    const ax = a[0] * kx, ay = a[1] * ky, dx = b[0] * kx - ax, dy = b[1] * ky - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  const areaM2 = ring => { let s = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] + ring[i][0]) * kx * (ring[j][1] - ring[i][1]) * ky; return Math.abs(s / 2); };
  const found = [];
  for (const p of pieces || []) {
    if (!Array.isArray(p?.outer) || p.outer.length < 4) continue;
    const [w, s, e, n] = p.bbox || bboxOf(p.outer);
    if (lon < w - dLon || lon > e + dLon || lat < s - dLat || lat > n + dLat) continue;
    const holes = p.holes || [];
    let d = 0;
    const inHole = holes.find(h => pointInRing([lon, lat], h));
    if (!pointInRing([lon, lat], p.outer) || inHole) {
      d = Infinity;
      for (const ring of inHole ? [inHole] : [p.outer, ...holes]) for (let i = 0; i < ring.length - 1; i++) d = Math.min(d, toSegment(ring[i], ring[i + 1]));
    }
    if (d <= maxM) found.push({p, d});
  }
  if (!found.length) return null;
  const nearest = Math.min(...found.map(f => f.d));
  const pick = found.filter(f => f.d <= nearest + slackM).map(f => ({...f, area: areaM2(f.p.outer)})).sort((a, b) => b.area - a.area || a.d - b.d)[0];
  return {key: keyOfPiece?.get(pick.p.id) ?? null, pieceId: pick.p.id, distanceM: Math.round(pick.d * 10) / 10};
}

/**
 * A site of several buildings (Hotel 0.3.6, owner 2026-11-03 “… สร้างขอบเขตอาคาร ร่วมกับ site layout ของโรงแรม/รีสอท”):
 * the drawn buildings whose
 * outline holds one of the site's points (49_SITE_BOUNDARY_CHECK.buildings_in_boundary — one interior point per building
 * inside the research site boundary), every piece of each. The points come from the same building data the map draws,
 * so a point stands in its building; a point no drawn outline holds (tiles still loading, a building gone from the data)
 * is left out, never snapped to a neighbour.
 * pieces: massing footprints [{id, outer, holes?, bbox?}]; points: [[lon, lat]…]; keyOfPiece: Map(piece id → building key).
 * → {keys: building keys in point order (unique), refs: piece ids of those buildings, held: points that found a building}.
 */
export function buildingsAtPoints(pieces, points, keyOfPiece) {
  const keys = [], seen = new Set();
  let held = 0;
  if (!pieces?.length || !points?.length) return {keys, refs: [], held};
  const list = pieces.map(p => footprint({...p, key: p.id}));
  const cells = indexOf(list);
  for (const [lon, lat] of points) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const here = (cells.get(`${Math.floor(lon / CELL)}:${Math.floor(lat / CELL)}`) || []).filter(b => containsPoint(b, [lon, lat]));
    if (here.length) held++;
    for (const b of here) {
      const k = keyOfPiece?.get(b.id) ?? `piece:${b.id}`;
      if (!seen.has(k)) { seen.add(k); keys.push(k); }
    }
  }
  const refs = pieces.filter(p => seen.has(keyOfPiece?.get(p.id) ?? `piece:${p.id}`)).map(p => p.id);
  return {keys, refs, held};
}

/**
 * The page's display-time join: rows and CityMETER venue reference points × the drawn focus-tier footprints, with
 * the pieces of one building grouped (groupPieces). A building is keyed `osm:<group id>` (or `cm:<group id>` when
 * the group's first piece is a CityMETER building; `kind` says which) and lists its pieces (`refs` = focus-tier
 * feature ids, for the highlight, the x-ray and the camera).
 * pieces: massing footprints [{id, osmId, source?, outer, holes, bbox?, height, tile}]; rows: [{id, longitude, latitude}];
 * venues: [{id, longitude, latitude}].
 * Returns {buildings: Map(key → {key, kind, ref, refs, pieces, bbox, height}), byBuilding: Map(key → rows[]),
 *          byRow: Map(rowId → key), byVenue: Map(venueId → key), venuesByBuilding: Map(key → venue[]),
 *          keyOfPiece: Map(piece id → key)}.
 */
export function joinBuildings(pieces, rows, venues = []) {
  // Every drawn piece that holds a point stands for one building with the others there (a podium and its tower).
  const unions = [];
  const located = [...rows, ...venues].filter(r => Number.isFinite(r.longitude) && Number.isFinite(r.latitude));
  if (located.length) {
    const list = pieces.map(p => footprint({...p, key: p.id}));
    const cells = indexOf(list);
    for (const r of located) {
      const here = (cells.get(`${Math.floor(r.longitude / CELL)}:${Math.floor(r.latitude / CELL)}`) || []).filter(b => containsPoint(b, [r.longitude, r.latitude]));
      for (let i = 1; i < here.length; i++) unions.push([here[0].id, here[i].id]);
    }
  }
  const groups = groupPieces(pieces, {unions});
  const sourceOf = new Map(pieces.map(p => [p.id, p.source === 'cm' ? 'cm' : 'osm']));
  const keyOfPiece = new Map(pieces.map(p => { const g = groups.get(p.id); return [p.id, `${sourceOf.get(g) || 'osm'}:${g}`]; }));
  const fps = pieces.map(p => ({key: `piece:${p.id}`, ref: p.id, outer: p.outer, holes: p.holes || [], bbox: p.bbox, height: p.height}));
  const groupOf = new Map(fps.map(f => [f.key, keyOfPiece.get(f.ref)]));
  const rowJoin = joinRows(fps, rows);
  const buildings = new Map();
  for (const p of rowJoin.buildings.values()) {
    const key = groupOf.get(p.key);
    const b = buildings.get(key);
    if (b) {
      b.refs.push(p.ref); b.pieces.push(p);
      b.height = Math.max(b.height ?? 0, p.height ?? 0);
      b.bbox = [Math.min(b.bbox[0], p.bbox[0]), Math.min(b.bbox[1], p.bbox[1]), Math.max(b.bbox[2], p.bbox[2]), Math.max(b.bbox[3], p.bbox[3])];
    } else buildings.set(key, {key, kind: key.startsWith('cm:') ? 'cm' : 'osm', ref: groups.get(p.ref), refs: [p.ref], pieces: [p], bbox: [...p.bbox], height: p.height});
  }
  const byRow = new Map(), byBuilding = new Map();
  for (const [rowId, pieceKey] of rowJoin.byRow) byRow.set(rowId, groupOf.get(pieceKey));
  for (const [pieceKey, list] of rowJoin.byBuilding) {
    const key = groupOf.get(pieceKey), at = byBuilding.get(key);
    if (at) at.push(...list); else byBuilding.set(key, [...list]);
  }
  const byVenue = new Map(), venuesByBuilding = new Map();
  if (venues.length) {
    const venueJoin = joinRows(fps, venues.map(v => ({id: v.id, longitude: v.longitude, latitude: v.latitude})));
    const venueById = new Map(venues.map(v => [v.id, v]));
    for (const [venueId, pieceKey] of venueJoin.byRow) {
      const key = groupOf.get(pieceKey);
      byVenue.set(venueId, key);
      const at = venuesByBuilding.get(key);
      if (at) at.push(venueById.get(venueId)); else venuesByBuilding.set(key, [venueById.get(venueId)]);
    }
  }
  return {buildings, byBuilding, byRow, byVenue, venuesByBuilding, keyOfPiece};
}
