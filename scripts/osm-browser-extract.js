/**
 * OpenStreetMap → compact derived results, run in a browser page that holds the
 * owner-approved Overpass response (osm-rail-stations-2026-10-31.json, ODbL).
 *
 * Why in the browser: the raw file (3.8 MB) could not be copied into the build
 * environment, so the same rules as scripts/osm_enrich.py are applied where the
 * file is, and only the small results travel (data/osm-derived.json, verified by
 * sha256 on both sides). scripts/build-data.py --osm-derived applies them.
 *
 * Usage (browser console, page with the raw text in `raw`):
 *   const out = await extractOsmDerived(raw, await (await fetch(BASE + 'data/rail-lines.geojson')).text(),
 *                                       await (await fetch(BASE + 'data/transit.json')).json());
 *
 * Rules (mirroring scripts/osm_enrich.py — keep the two in step):
 *  - level of an OSM railway way: tunnel=yes|culvert, location=underground or layer<0 (no bridge) → underground;
 *    bridge=yes|viaduct|aqueduct, location=overground or layer>0 → elevated; else surface
 *  - each operating alignment is densified every 10 m; each point takes the level of the nearest
 *    OSM way of the same line (route-relation members + ways whose name/ref/network names the
 *    line, within 40 m) or, for a line with neither, of any railway way within 30 m; gaps take the
 *    nearest known neighbour; stretches shorter than 100 m join the longer neighbour; no match at
 *    all leaves the stretch unknown. Output: runs as [fromMetre, toMetre, level] along the feature.
 *  - station level = level of its own line within 150 m of the station point
 *  - colours: `colour` of route relations, weighted by member ways
 *  - construction ways named สีส้ม/orange or สีม่วง/purple → the project whose stations are nearest (≤ 2.5 km)
 *  - buildings: OSM station feature by ref (station code) or name within 400 m, then the building
 *    polygon containing it (station-tagged, or any building when a station feature matched) or a
 *    station-tagged building within 80 m; a named building must carry the station's name; an
 *    underground station never takes a generic building; one hall may serve several records.
 */
async function extractOsmDerived(rawText, railLinesText, transit) {
  const KX = 111320 * Math.cos((13.75 * Math.PI) / 180), KY = 110574;
  const xy = (lng, lat) => [(lng - 100.5) * KX, (lat - 13.75) * KY];
  const ll = (x, y) => [100.5 + x / KX, 13.75 + y / KY];
  const hex = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const BBOX = [13.5, 100.3, 14.1, 100.85];
  const ROUTE_KEYS = {
    BTS_SUKHUMVIT: [/sukhumvit/, /สุขุมวิท/], BTS_SILOM: [/silom/, /สีลม/], BTS_GOLD: [/gold line/, /สีทอง/],
    MRT_BLUE: [/blue line/, /สีน้ำเงิน/, /เฉลิมรัชมงคล/], MRT_PURPLE: [/purple line/, /สีม่วง/, /ฉลองรัชธรรม/],
    MRT_PINK: [/pink line/, /สีชมพู/], MRT_YELLOW: [/yellow line/, /สีเหลือง/],
    ARL_CITY: [/airport rail link/, /แอร์พอร์ต/, /city line/, /\barl\b/, /aera1/, /เอราวัน/],
    SRT_RED_NORTH: [/dark red/, /แดงเข้ม/], SRT_RED_WEST: [/light red/, /แดงอ่อน/],
    MRT_ORANGE_WEST: [/orange line/, /สีส้ม/], MRT_ORANGE_EAST: [/orange line/, /สีส้ม/],
  };
  const LABEL_TAGS = ['name', 'name:en', 'name:th', 'alt_name', 'alt_name:en', 'official_name', 'ref', 'network'];
  const num = v => { const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(String(v ?? '')); return m ? Number(m[1]) : null; };
  const wayLevel = t => {
    const layer = num(t.layer);
    if (['yes', 'culvert'].includes(t.tunnel) || t.location === 'underground' || (layer !== null && layer < 0 && [undefined, 'no'].includes(t.bridge))) return 'underground';
    if (['yes', 'viaduct', 'aqueduct'].includes(t.bridge) || t.location === 'overground' || (layer !== null && layer > 0)) return 'elevated';
    return 'surface';
  };
  const densify = (pts, step) => {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], d = Math.hypot(bx - ax, by - ay);
      for (let k = 1; k * step < d; k++) out.push([ax + ((bx - ax) * k * step) / d, ay + ((by - ay) * k * step) / d]);
      out.push([bx, by]);
    }
    return out;
  };
  class Grid {
    constructor(cell) { this.cell = cell; this.cells = new Map(); }
    add(p, payload) { const k = `${Math.floor(p[0] / this.cell)},${Math.floor(p[1] / this.cell)}`; if (!this.cells.has(k)) this.cells.set(k, []); this.cells.get(k).push([p, payload]); }
    nearest(p, radius) {
      const cx = Math.floor(p[0] / this.cell), cy = Math.floor(p[1] / this.cell), r = Math.ceil(radius / this.cell);
      let best = radius, found = null;
      for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) for (const [q, payload] of this.cells.get(`${i},${j}`) || []) {
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d <= best) { best = d; found = payload; }
      }
      return [found, best];
    }
  }
  const simplify = (points, tol) => {
    if (points.length <= 2) return points;
    const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [i, j] = stack.pop(), [ax, ay] = points[i], [bx, by] = points[j], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      let best = -1, at = -1;
      for (let k = i + 1; k < j; k++) {
        const [px, py] = points[k], t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
        const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        if (d > best) { best = d; at = k; }
      }
      if (best > tol) { keep[at] = 1; stack.push([i, at], [at, j]); }
    }
    return points.filter((_, k) => keep[k]);
  };
  const encode = (coords, precision = 6) => {   // Google polyline of (lat, lng)
    const f = 10 ** precision; let out = '', plat = 0, plng = 0;
    for (const [lng, lat] of coords) {
      const ilat = Math.round(lat * f), ilng = Math.round(lng * f);
      for (let d of [ilat - plat, ilng - plng]) {
        let v = d < 0 ? ~(d << 1) : d << 1;
        while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
        out += String.fromCharCode(v + 63);
      }
      plat = ilat; plng = ilng;
    }
    return out;
  };
  const ringContains = (ring, p) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / ((yj - yi) || 1e-12) + xi) inside = !inside;
    }
    return inside;
  };
  const normName = v => String(v || '').toLowerCase().replace(/\(.*?\)|สถานี|station|bts|mrt|arl|srt|รถไฟฟ้า/g, '').replace(/[\s\-–·.]+/g, '');
  const labelOf = (t, keys) => keys.map(k => t[k] || '').join(' ').toLowerCase();
  const linesFor = label => Object.entries(ROUTE_KEYS).filter(([, keys]) => keys.some(k => k.test(label))).map(([id]) => id);

  const data = JSON.parse(rawText);
  const elements = data.elements || [];
  const rail = JSON.parse(railLinesText);
  const out = {
    meta: {
      generator: 'scripts/osm-browser-extract.js v1', rawSha256: await hex(rawText), rawBytes: new TextEncoder().encode(rawText).length,
      timestampOsmBase: data.osm3s?.timestamp_osm_base || '', elements: elements.length, railLinesSha256: await hex(railLinesText),
      licence: 'ODbL 1.0 — © OpenStreetMap contributors',
    },
    colours: {}, elevation: {}, featureCheck: {}, stationLevel: {}, construction: [], buildings: [], routeMembership: {}, namedWays: {},
  };

  // route relations → member ways per line; colours weighted by member ways
  const members = {}, colourWeight = {}, colourRelations = {};
  for (const e of elements) {
    const t = e.tags || {};
    if (e.type !== 'relation' || !['subway', 'light_rail', 'monorail', 'train'].includes(t.route)) continue;
    const ways = (e.members || []).filter(m => m.type === 'way' && ['', 'forward', 'backward', 'main'].includes(m.role || ''));
    for (const lid of linesFor(labelOf(t, ['name', 'name:en', 'name:th', 'ref']))) {
      members[lid] = members[lid] || new Set();
      for (const m of ways) members[lid].add(m.ref);
      if (/^#[0-9A-Fa-f]{6}$/.test(t.colour || '')) {   // weight = all way members (a branch weighs less than the main line)
        colourWeight[lid] = colourWeight[lid] || {};
        const c = t.colour.toUpperCase();
        colourWeight[lid][c] = colourWeight[lid][c] || {w: 0, relations: []};
        colourWeight[lid][c].w += Math.max(1, (e.members || []).filter(m => m.type === 'way').length);
        colourWeight[lid][c].relations.push(e.id);
        (colourRelations[lid] = colourRelations[lid] || []).push(e.id);
      }
    }
  }
  for (const [lid, byColour] of Object.entries(colourWeight)) {
    const [colour, v] = Object.entries(byColour).sort((a, b) => b[1].w - a[1].w)[0];
    out.colours[lid] = {colour, relations: colourRelations[lid], memberWays: v.w, variants: Object.fromEntries(Object.entries(byColour).map(([c, x]) => [c, x.w]))};
  }
  // railway ways → grids
  const railGrid = new Grid(30), lineGrids = {};
  const lineGrid = id => (lineGrids[id] = lineGrids[id] || new Grid(40));
  const construction = [];
  for (const e of elements) {
    const t = e.tags || {};
    if (e.type !== 'way' || !e.geometry) continue;
    const pts = e.geometry.filter(Boolean).map(g => xy(g.lon, g.lat));
    if (pts.length < 2) continue;
    if (['subway', 'light_rail', 'monorail', 'rail'].includes(t.railway)) {
      const level = wayLevel(t), dense = densify(pts, 10);
      for (const p of dense) railGrid.add(p, level);
      for (const [lid, ids] of Object.entries(members)) if (ids.has(e.id)) { for (const p of dense) lineGrid(lid).add(p, level); out.routeMembership[lid] = (out.routeMembership[lid] || 0) + 1; }
      const label = labelOf(t, LABEL_TAGS);
      if (label.trim()) for (const lid of linesFor(label)) if (!members[lid]?.has(e.id)) { for (const p of dense) lineGrid(lid).add(p, level); out.namedWays[lid] = (out.namedWays[lid] || 0) + 1; }
    } else if (t.railway === 'construction') construction.push([e, pts, wayLevel(t)]);
  }
  const gridFor = id => (lineGrids[id] ? [lineGrids[id], 40] : [railGrid, 30]);

  // 1. operating alignments → runs [fromMetre, toMetre, level]
  const classified = {};   // lineId → [{pts, levels}] for station levels
  for (const f of rail.features) {
    if (f.properties.status !== 'operating') continue;
    const id = f.properties.lineId, key = `${id}:${f.properties.part}`;
    const base = f.geometry.coordinates.map(c => xy(c[0], c[1]));
    const pts = densify(base, 10);
    let baseLength = 0;
    for (let i = 1; i < base.length; i++) baseLength += Math.hypot(base[i][0] - base[i - 1][0], base[i][1] - base[i - 1][1]);
    out.featureCheck[key] = [base.length, Math.round(baseLength * 10) / 10];   // the build checks it applies runs to the same geometry
    const [grid, radius] = gridFor(id);
    const levels = pts.map(p => grid.nearest(p, radius)[0]);
    const known = levels.map((l, i) => (l ? i : -1)).filter(i => i >= 0);
    if (!known.length) { out.elevation[key] = null; continue; }
    for (let i = 0; i < levels.length; i++) if (!levels[i]) { let k = known[0]; for (const j of known) if (Math.abs(j - i) < Math.abs(k - i)) k = j; levels[i] = levels[k]; }
    let runs = [];
    levels.forEach((l, i) => { if (runs.length && runs.at(-1)[0] === l) runs.at(-1)[2] = i; else runs.push([l, i, i]); });
    let changed = true;
    while (changed && runs.length > 1) {
      changed = false;
      for (let k = 0; k < runs.length; k++) {
        const r = runs[k];
        if ((r[2] - r[1] + 1) * 10 < 100) {
          const left = k > 0 ? runs[k - 1] : null, right = k + 1 < runs.length ? runs[k + 1] : null;
          const target = left && (!right || left[2] - left[1] >= right[2] - right[1]) ? left : right;
          if (target === left) left[2] = r[2]; else right[1] = r[1];
          runs.splice(k, 1); changed = true; break;
        }
      }
      const merged = [];
      for (const r of runs) { if (merged.length && merged.at(-1)[0] === r[0]) merged.at(-1)[2] = r[2]; else merged.push(r); }
      runs = merged;
    }
    // index → metres along the densified path
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    out.elevation[key] = runs.map(([l, a, b]) => [Math.round(cum[a] * 10) / 10, Math.round(cum[Math.min(b + 1, pts.length - 1)] * 10) / 10, l]);
    (classified[id] = classified[id] || []).push({pts, levels});
  }
  // 5. construction ways for urban projects without an alignment
  const byLine = {};
  for (const s of transit.stations) if (s.status !== 'operating' && s.lat != null) (byLine[s.lineIds[0]] = byLine[s.lineIds[0]] || []).push(xy(s.lng, s.lat));
  const have = new Set(rail.features.filter(f => f.properties.status !== 'operating').map(f => f.properties.lineId));
  for (const [e, pts, level] of construction) {
    const label = labelOf(e.tags || {}, ['name', 'name:th', 'name:en', 'ref']);
    const family = /สีส้ม|orange/.test(label) ? 'MRT_ORANGE' : /สีม่วง|purple/.test(label) ? 'MRT_PURPLE' : '';
    if (!family) continue;
    const candidates = Object.keys(byLine).filter(id => id.startsWith(family) && !have.has(id));
    if (!candidates.length) continue;
    const mid = pts[Math.floor(pts.length / 2)];
    const dist = id => Math.min(...byLine[id].map(q => Math.hypot(mid[0] - q[0], mid[1] - q[1])));
    const best = candidates.sort((a, b) => dist(a) - dist(b))[0];
    if (dist(best) > 2500) continue;
    out.construction.push({lineId: best, osmRef: `way/${e.id}`, level, p: encode(simplify(pts, 2).map(q => ll(...q)))});
    (classified[best] = classified[best] || []).push({pts: densify(simplify(pts, 2), 10), levels: null, level});
  }
  // 2. station level: its own line within 150 m (operating stretches and the construction ways above)
  const levelAt = (id, p) => {
    let best = 150, found = null;
    for (const c of classified[id] || []) c.pts.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d <= best) { best = d; found = c.levels ? c.levels[i] : c.level; } });
    return found;
  };
  for (const s of transit.stations) {
    if (s.lat == null) continue;
    const l = levelAt(s.lineIds[0], xy(s.lng, s.lat));
    if (l) out.stationLevel[s.id] = l;
  }

  // 4. buildings
  const osmStations = [], buildings = [];
  const pointOf = e => {
    if (e.type === 'node') return [e.lon, e.lat];
    const r = ringsOf(e)[0];
    if (r) return [r.reduce((a, q) => a + q[0], 0) / r.length, r.reduce((a, q) => a + q[1], 0) / r.length];
    return e.bounds ? [(e.bounds.minlon + e.bounds.maxlon) / 2, (e.bounds.minlat + e.bounds.maxlat) / 2] : null;
  };
  function ringsOf(e) {
    const closed = r => r.length >= 4 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1];
    if (e.type === 'way' && e.geometry) { const r = e.geometry.filter(Boolean).map(g => [g.lon, g.lat]); return closed(r) ? [r] : []; }
    if (e.type === 'relation') return (e.members || []).filter(m => ['outer', ''].includes(m.role || '') && m.geometry).map(m => m.geometry.filter(Boolean).map(g => [g.lon, g.lat])).filter(closed);
    return [];
  }
  for (const e of elements) {
    const t = e.tags || {};
    if (['station', 'halt'].includes(t.railway) || t.public_transport === 'station' || t['construction:railway'] === 'station') { const p = pointOf(e); if (p) osmStations.push([e, xy(...p)]); }
    if (t.building) { const rings = ringsOf(e); if (rings.length) buildings.push([e, rings.map(r => r.map(q => xy(...q)))]); }
  }
  const byRef = {};
  for (const s of transit.stations) {
    if (s.lat == null || s.lat < BBOX[0] || s.lat > BBOX[2] || s.lng < BBOX[1] || s.lng > BBOX[3]) continue;
    const p = xy(s.lng, s.lat), codes = new Set((s.codes || []).map(c => c.toUpperCase()));
    const names = new Set([normName(s.name), normName(s.nameEn)].filter(Boolean));
    const level = out.stationLevel[s.id] || null;
    let best = null;
    for (const [e, q] of osmStations) {
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d > 400) continue;
      const t = e.tags || {};
      const refHit = String(t.ref || '').split(/[;,]/).map(x => x.trim().toUpperCase()).filter(Boolean).some(x => codes.has(x));
      const nameHit = ['name', 'name:th', 'name:en'].map(k => normName(t[k])).filter(Boolean).some(n => names.has(n));
      if (!refHit && !nameHit) continue;
      const score = [refHit ? 0 : 1, d];
      if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) best = {score, e, q, match: refHit ? 'osm_ref' : 'osm_name'};
    }
    const anchor = best ? best.q : p;
    let chosen = null;
    for (const [e, rings] of buildings) {
      const t = e.tags || {};
      const stationTagged = ['train_station', 'transportation'].includes(t.building) || t.railway === 'station' || t.public_transport === 'station';
      const bnames = ['name', 'name:th', 'name:en'].map(k => normName(t[k])).filter(Boolean);
      if (bnames.length && ![...names].some(a => bnames.some(b => a.includes(b) || b.includes(a)))) continue;
      if (!stationTagged && level === 'underground') continue;
      const inside = rings.some(r => ringContains(r, anchor));
      let near = Infinity; for (const r of rings) for (const v of r) near = Math.min(near, Math.hypot(anchor[0] - v[0], anchor[1] - v[1]));
      let rank;
      if (inside && (stationTagged || best)) rank = [0, near];
      else if (stationTagged && near <= 80) rank = [1, near];
      else continue;
      if (!chosen || rank[0] < chosen.rank[0] || (rank[0] === chosen.rank[0] && rank[1] < chosen.rank[1])) chosen = {rank, e, rings};
    }
    if (!chosen) continue;
    const ref = `${chosen.e.type}/${chosen.e.id}`;
    if (byRef[ref]) { byRef[ref].stationIds.push(s.id); continue; }
    const t = chosen.e.tags || {};
    const height = num(t.height), levels = num(t['building:levels']), minH = num(t.min_height), minLevel = num(t['building:min_level']);
    const rec = {
      ref, stationIds: [s.id], name: t['name:th'] || t.name || '', heightTag: height, levelsTag: levels, minHeightTag: minH, minLevelTag: minLevel,
      match: best ? best.match : 'station_tagged_building_near_point', dist: Math.round(chosen.rank[1] * 10) / 10,
      osmStation: best ? `${best.e.type}/${best.e.id}` : '', p: encode(simplify(chosen.rings[0], 1).map(q => ll(...q))),
    };
    byRef[ref] = rec;
    out.buildings.push(rec);
  }
  // compact form: one letter per station in transit.json order (E elevated, S surface, U underground, - none)
  const levelCode = transit.stations.map(s => ({elevated: 'E', surface: 'S', underground: 'U'}[out.stationLevel[s.id]] || '-')).join('');
  out.stationLevel = {order: await hex(transit.stations.map(s => s.id).join('\n')), code: levelCode};
  return out;
}
if (typeof module !== 'undefined') module.exports = {extractOsmDerived};
