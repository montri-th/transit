/**
 * Camera presets for reading the city.
 *
 *  plan  — 2D plan, pitch 0 (table/legend reading, choropleth).
 *  city  — 3D overview: a conventional perspective, pitched, looking a little
 *          east of north so the three Bangkok cores spread across a wide screen.
 *  model — close-up "architectural model": the vertical field of view is
 *          narrowed to 14° so the camera sits far away and perspective
 *          convergence almost disappears — building verticals stay upright,
 *          like an axonometric drawing or a white massing model. MapLibre has
 *          no orthographic camera, but a narrow FOV is the standard way to get
 *          the look (setVerticalFieldOfView, MapLibre ≥ 4.7).
 *  eye   — two-point perspective for one venue: a strongly pitched camera
 *          (pitch 75°) with a narrow field of view (24°), so verticals stay
 *          within a few degrees of upright while horizontals still converge —
 *          the classic architectural rendering camera.
 *          Constraint (verified live on MapLibre 5.6.2, 2026-10-22): once the
 *          horizon enters the viewport (pitch > 90° − fov/2) fill-extrusion
 *          layers are drawn displaced or not at all, so the eye preset keeps the
 *          horizon just outside the frame: 90 − 24/2 − 3° margin = 75°.
 *
 * Fitting a pitched camera to a bounding box: MapLibre's cameraForBounds assumes
 * a flat view, so fitPitched starts from that answer and zooms out in 0.1 steps
 * until every corner of the box projects inside the padded viewport.
 *
 * Building view (owner instruction for CityMETER · Shopping centers 2026-10-25 18:49, “tap a pin
 * or a building → the 3D building in two-point perspective, zoomed to fit the viewport, always”,
 * and for Fitness 2026-10-29 19:47, “อาคารที่เลือก หรือ on focus ให้แสดงด้วยมุมมอง 2-point
 * perspective เสมอ zoom to fit viewport เสมอ”; module shared with Shopping centers): fitBuilding
 * turns the eye camera corner-on to the building — bearing = dominant wall direction + 45°, so two
 * faces and two vanishing points show — and re-centres and zooms until the projected box of every
 * footprint and roof vertex fills the free part of the map (below the toolbar, above the bottom
 * tray, legend or sheet, clear of the zoom control). The principal point never goes below the canvas
 * centre, so the horizon stays outside the frame (75° + 24°/2 < 90°); since Hotel 0.3.2 it is moved up
 * to the free box's centre (a shift lens, `lensPadding`), so the camera looks straight at the building
 * at the eye pitch on a phone too.
 *
 * Part of the shared CityMETER demo shell: edit it in every repository at once (js/shell/manifest.json).
 */
export const DEFAULT_FOV = 36.87;

export const CAMERA = Object.freeze({
  plan: {pitch: 0, bearing: 0, fov: DEFAULT_FOV},
  city: {pitch: 56, bearing: 28, fov: DEFAULT_FOV, fitShift: 0.2},
  model: {pitch: 60, bearing: 28, fov: 14, fitShift: 0.16},
  eye: {pitch: 75, bearing: 28, fov: 24, fitShift: 0.1},
});
/**
 * Highest zoom of the building view when the building is known. Fitness branches stand in shophouses and small
 * buildings: the Shopping centers limit (19.5, sized for malls) left a 40 m building at half of the free box on a
 * desktop, so the camera may go to 21 (a ~35 m wide view on a 1,000 px box). js/map-layers.js#GEOJSON_MAXZOOM
 * stays two levels above it.
 */
export const BUILDING_MAX_ZOOM = 21;
// bearing 28°: the Siam → Chit Lom → Phrom Phong axis (azimuth ≈ 120°) runs left-to-right
// across a wide screen; the compass control keeps north legible.

export function presetFor({view3d, mode, twoPoint = false}) {
  if (!view3d) return 'plan';
  if (mode === 'overview') return 'city';
  return twoPoint ? 'eye' : 'model';
}

/** Vertical padding that moves the principal point: positive shift pushes the map centre down the screen. */
export function shiftPadding(map, shift = 0) {
  const h = map.getContainer().clientHeight;
  return shift > 0 ? {top: Math.round(h * shift), bottom: 0, left: 0, right: 0} : {top: 0, bottom: 0, left: 0, right: 0};
}

function setFov(map, fov) {
  if (typeof map.setVerticalFieldOfView === 'function' && Math.abs(map.getVerticalFieldOfView?.() - fov) > 0.01) map.setVerticalFieldOfView(fov);
}

/** Apply a preset's pitch/bearing/FOV (centre and zoom unchanged unless given). */
export function applyPreset(map, name, {animate = true, duration = 650, ...rest} = {}) {
  const p = CAMERA[name] || CAMERA.plan;
  setFov(map, p.fov);
  const options = {pitch: p.pitch, bearing: p.bearing, padding: shiftPadding(map, p.shift || 0), ...rest};
  if (animate) map.easeTo({...options, duration}); else map.jumpTo(options);
  return p;
}

/** Corners of a LngLatBounds as [lng, lat] pairs. */
export function boundsCorners(b) {
  return [[b.getWest(), b.getSouth()], [b.getEast(), b.getSouth()], [b.getEast(), b.getNorth()], [b.getWest(), b.getNorth()]];
}

/**
 * Ground under [lng, lat] as the map draws it: the terrain elevation in metres, exaggerated (MapLibre
 * queryTerrainElevation); 0 without terrain or before its DEM tile has loaded. Fill-extrusions stand on the
 * elevation at their centroid (MapLibre's TERRAIN3D shader), so a building and its roof are lifted by it.
 */
export function groundAt(map, [lng, lat]) {
  if (!map?.terrain || typeof map.queryTerrainElevation !== 'function') return 0;
  const e = map.queryTerrainElevation([lng, lat]);
  return Number.isFinite(e) ? e : 0;
}

/** Deepest drop under one building's outline, and deepest drop of a building below the item's pin, read as ground. */
export const PIECE_DROP_M = 60, SITE_DROP_M = 400;

/**
 * The ground one building stands on as the x-ray and the building camera draw it: its roof on the ground at its
 * centroid (`g`, as MapLibre lifts fill-extrusions) and its walls down to the lowest ground under its outline (`low`),
 * from DEM samples (0 = not loaded yet, skipped). A sample far below the centroid's ground is a DEM artefact, not a slope
 * (0.3.9: one outline vertex of a Rayavadee building read −2,110 m on the Krabi coast and the camera zoomed out to
 * hold it): the walls go down at most PIECE_DROP_M, and a centroid more than SITE_DROP_M below the pin's ground stands
 * on the pin's ground.
 */
export function pieceGround(centroid, samples, pin = 0) {
  let g = centroid || pin;
  if (Number.isFinite(pin) && g < pin - SITE_DROP_M) g = pin;
  let low = g;
  for (const e of samples) if (e && Number.isFinite(e) && e < low && e >= g - PIECE_DROP_M) low = e;
  return {g, low};
}

/**
 * Where the ground under a framed target is watched (the anchor first, then the outermost fit points west, east, south
 * and north): a frame is computed again when the ground moves at any of them (0.3.9: Patong Bay Hill Resort, a site
 * 450 m up a hillside, was framed before the DEM under its upper half arrived, while its pin's ground was already in).
 */
export function groundProbes(anchor, points = []) {
  const probes = [anchor];
  if (points.length) {
    const pick = f => points.reduce((a, q) => (f(q) < f(a) ? q : a));
    for (const f of [q => q[0], q => -q[0], q => q[1], q => -q[1]]) {
      const q = pick(f);
      probes.push([q[0], q[1]]);
    }
  }
  return probes;
}

/**
 * Screen position of [lng, lat, altitudeMetres] — the altitude above the ground under the point (with terrain the
 * drawn ground is added, as for fill-extrusions). MapLibre's map.project() is ground-only (terrain-aware), so
 * elevated points (roof vertices) go through the transform's view-projection matrix (world pixels, z in metres →
 * clip space), exactly as fill-extrusion vertices do. Falls back to map.project for ground points.
 */
export function projectPoint(map, point) {
  const [lng, lat, alt = 0] = point;
  const t = map.transform;
  if (!alt || !t?.modelViewProjectionMatrix || !Number.isFinite(t.worldSize) || !globalThis.maplibregl?.MercatorCoordinate) return map.project([lng, lat]);
  return projectAltitude(map, [lng, lat, alt + groundAt(map, [lng, lat])]);
}

/** Screen position of [lng, lat, z] with z in metres above sea level as drawn (no ground lookup): the view-projection matrix. */
export function projectAltitude(map, [lng, lat, z = 0]) {
  const t = map.transform;
  const M = t?.modelViewProjectionMatrix;
  if (!M || !Number.isFinite(t.worldSize) || !globalThis.maplibregl?.MercatorCoordinate) return map.project([lng, lat]);
  const mc = globalThis.maplibregl.MercatorCoordinate.fromLngLat([lng, lat]);
  const x = mc.x * t.worldSize, y = mc.y * t.worldSize;
  const w = M[3] * x + M[7] * y + M[11] * z + M[15];
  if (!(w > 0)) return {x: NaN, y: NaN};
  const cx = (M[0] * x + M[4] * y + M[8] * z + M[12]) / w, cy = (M[1] * x + M[5] * y + M[9] * z + M[13]) / w;
  return {x: (cx + 1) / 2 * t.width, y: (1 - cy) / 2 * t.height};
}

function cornersInside(map, corners, padding) {
  const w = map.getContainer().clientWidth, h = map.getContainer().clientHeight;
  return corners.every(c => {
    const p = c.length > 2 && c[2] ? projectPoint(map, c) : map.project([c[0], c[1]]);
    return p.x >= padding.left && p.x <= w - padding.right && p.y >= padding.top && p.y <= h - padding.bottom;
  });
}

/**
 * Frame `bounds` under a preset. Computes the final camera with instantaneous
 * jumps (no frame is rendered in between), restores the start camera and then
 * animates to the result. Returns the camera used. `points` may carry a third
 * value (altitude in metres) so a building's roof is framed, not only its
 * footprint. `apply: false` only computes the target and restores the start.
 */
export function fitPitched(map, bounds, {preset = 'city', padding = {top: 24, bottom: 24, left: 24, right: 24}, maxZoom = 16, animate = true, duration = 650, minZoom = 10, points = null, shift = null, apply = true} = {}) {
  const p = CAMERA[preset] || CAMERA.plan;
  const start = {center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), padding: map.getPadding()};
  setFov(map, p.fov);
  // A pitched camera sees much more ground above the centre than below it, so the
  // box is centred lower on the screen (view padding at the top) before fitting.
  const view = shiftPadding(map, shift ?? (p.shift || p.fitShift || 0));
  map.jumpTo({pitch: p.pitch, bearing: p.bearing, padding: view});
  const flat = map.cameraForBounds(bounds, {padding, bearing: p.bearing, maxZoom});
  if (!flat) { map.jumpTo(start); return null; }
  let zoom = Math.min(maxZoom, flat.zoom);
  // Containment is tested on the actual outline vertices when given (a diagonal band
  // of areas leaves its bounding-box corners empty), otherwise on the box corners.
  const corners = points && points.length ? points : boundsCorners(bounds);
  map.jumpTo({center: flat.center, zoom, pitch: p.pitch, bearing: p.bearing, padding: view});
  let guard = 0;
  if (p.pitch > 0) {
    // Zoom out until every vertex is inside the padded viewport…
    while (!cornersInside(map, corners, padding) && zoom > minZoom && guard++ < 60) { zoom -= 0.1; map.jumpTo({zoom}); }
    // …then zoom in while they all still fit (foreshortening leaves room the flat fit did not use).
    while (zoom + 0.1 <= maxZoom && guard++ < 120) {
      map.jumpTo({zoom: zoom + 0.1});
      if (!cornersInside(map, corners, padding)) { map.jumpTo({zoom}); break; }
      zoom += 0.1;
    }
    zoom = Math.round(zoom * 100) / 100;
  }
  const target = {center: map.getCenter(), zoom, pitch: p.pitch, bearing: p.bearing, padding: view};
  if (!apply) { map.jumpTo(start); return target; }
  if (animate) { map.jumpTo(start); map.easeTo({...target, duration}); } else map.jumpTo(target);
  return target;
}

/* ---------- two-point view of one building ---------- */

const RAD = Math.PI / 180;
const norm180 = deg => { const d = ((deg % 360) + 540) % 360 - 180; return d === -180 ? 180 : d; };

/**
 * Compass azimuth (degrees in [0, 90)) of the dominant wall direction of footprint rings
 * ([[lng, lat]…]), weighting each edge by its length; walls 90° apart count as one direction
 * (angles ×4 on the circle). null when the rings have no edge.
 */
export function wallAzimuth(rings) {
  let c = 0, s = 0;
  for (const ring of rings || []) {
    if (!Array.isArray(ring) || ring.length < 2) continue;
    const kx = 111320 * Math.cos((ring[0][1] || 0) * RAD), ky = 110574; // metres per degree
    for (let i = 0; i < ring.length - 1; i++) {
      const dx = (ring[i + 1][0] - ring[i][0]) * kx, dy = (ring[i + 1][1] - ring[i][1]) * ky;
      const len = Math.hypot(dx, dy);
      if (!len) continue;
      const a = Math.atan2(dx, dy); // clockwise from north
      c += len * Math.cos(4 * a); s += len * Math.sin(4 * a);
    }
  }
  if (Math.hypot(c, s) < 1e-9) return null;
  const deg = Math.atan2(s, c) / 4 / RAD;
  return ((deg % 90) + 90) % 90;
}

/**
 * How much of the target the drawn buildings in `obstacles` ([{ring, height}]) would hide when the
 * camera looks along `bearing` under the eye pitch: an obstacle counts when it stands between the
 * camera and the target, overlaps it sideways and rises above the sight line to the target's foot
 * (tan(90° − pitch) per metre of gap). Ground metres round the target's first vertex.
 */
export function occlusionScore(rings, obstacles, bearing, pitch = CAMERA.eye.pitch) {
  const all = (rings || []).flat();
  if (!all.length || !obstacles?.length) return 0;
  const [lon0, lat0] = all[0];
  const kx = 111320 * Math.cos(lat0 * RAD), ky = 110574;
  const b = bearing * RAD, fwd = [Math.sin(b), Math.cos(b)], right = [Math.cos(b), -Math.sin(b)];
  const along = ([lng, lat]) => {
    const e = (lng - lon0) * kx, n = (lat - lat0) * ky;
    return [e * right[0] + n * right[1], e * fwd[0] + n * fwd[1]];
  };
  const extent = pts => pts.map(along).reduce((m, [x, y]) => [Math.min(m[0], x), Math.max(m[1], x), Math.min(m[2], y), Math.max(m[3], y)], [Infinity, -Infinity, Infinity, -Infinity]);
  const [x0, x1, y0] = extent(all);
  const slope = Math.tan((90 - pitch) * RAD);
  let score = 0;
  for (const o of obstacles) {
    if (!Array.isArray(o?.ring) || o.ring.length < 3) continue;
    const [ox0, ox1, , oy1] = extent(o.ring);
    if (oy1 > y0 + 1) continue; // not in front of the target
    const overlap = Math.min(x1, ox1) - Math.max(x0, ox0);
    if (overlap <= 0) continue;
    const rise = (Number(o.height) || 3) - slope * (y0 - oy1);
    if (rise > 0) score += overlap * rise;
  }
  return score;
}

/**
 * Bearing for a two-point (corner-on) view of rings: the dominant wall direction + 45°. Of the four
 * diagonals, the one where the other drawn buildings (`obstacles`) hide least of the target wins;
 * ties go to the one nearest `current`, so the camera turns as little as possible.
 */
export function twoPointBearing(rings, current = 0, obstacles = []) {
  const wall = wallAzimuth(rings);
  if (wall == null) return norm180(current);
  const candidates = [0, 1, 2, 3].map(k => {
    const b = norm180(wall + 45 + k * 90);
    return {b, turn: Math.abs(norm180(b - current)), hidden: occlusionScore(rings, obstacles, b)};
  });
  const least = Math.min(...candidates.map(c => c.hidden));
  const best = candidates.filter(c => c.hidden <= least * 1.05 + 1).sort((a, c) => a.turn - c.turn)[0];
  return Math.round(best.b * 10) / 10;
}

/** Screen box of [lng, lat, altitude] points under the current camera; null when one is behind the camera. */
export function screenBounds(map, points, project = projectPoint) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const q of points) {
    const p = q[2] ? project(map, q) : map.project([q[0], q[1]]);
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) return null;
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return Number.isFinite(minX) ? {minX, minY, maxX, maxY} : null;
}

/**
 * Shift lens of the building view (Hotel 0.3.2): padding that puts the principal point at the centre of the free `box`,
 * never below the canvas centre (the horizon would enter the frame: pitch + fov/2 < 90 holds only above it). With zero
 * padding a phone's free strip above the sheet sat ~200 px above the principal point, so the building stood on a ray
 * 7.5° under the horizon where the fit did not converge; with the lens the camera looks straight at it at the eye pitch.
 */
export function lensPadding(map, box) {
  const c = map.getContainer?.();
  const W = c ? c.clientWidth : map.width, H = c ? c.clientHeight : map.height;
  const tx = (box.left + box.right) / 2, ty = (box.top + box.bottom) / 2;
  if (!Number.isFinite(W) || !Number.isFinite(H)) return {top: 0, bottom: 0, left: 0, right: 0};
  return {top: 0, bottom: Math.max(0, Math.round(H - 2 * ty)), left: Math.max(0, Math.round(2 * tx - W)), right: Math.max(0, Math.round(W - 2 * tx))};
}

/**
 * Run `fn` with MapLibre's lift of a camera inside the terrain switched off (Map#_elevateCameraIfInsideTerrain, run by
 * every jump in 5.6.2), so instant jumps keep the camera asked for; `fn` gets MapLibre's check (transform →
 * {pitch, zoom} of the lifted camera, or {}) to ask about the camera it found, or null without one. Restored after.
 */
function withoutLift(map, fn) {
  const check = map._elevateCameraIfInsideTerrain;
  if (typeof check !== 'function') return fn(null);
  const own = Object.prototype.hasOwnProperty.call(map, '_elevateCameraIfInsideTerrain');
  map._elevateCameraIfInsideTerrain = () => ({});
  try {
    return fn(tr => check.call(map, tr));
  } finally {
    if (own) map._elevateCameraIfInsideTerrain = check;
    else delete map._elevateCameraIfInsideTerrain;
  }
}

/** Ground metres per pixel at zoom z (512-px tiles). */
const metresPerPixel = (lat, z) => (40075016.686 * Math.cos(lat * RAD)) / (512 * 2 ** z);

/**
 * Fit 3D points (a building's footprint and roof vertices, [lng, lat, altitude m]) into `box`
 * ({left, top, right, bottom}, map-container pixels) under the eye preset at `bearing`. The
 * camera is panned (the ground point under the box's offset becomes the anchor's place — exact
 * for ground points) and zoomed (log2 of the size ratio) until the projected box of every point
 * fills `fill` of the box. Computes with instant jumps, restores the start camera, then animates
 * (flyTo when the target is far). `project` is injectable for tests. Returns the target camera.
 *
 * On terrain (owner 2026-11-01: “อยากให้เห็นอาคารบนภูมิประเทศ”) the building stands on the drawn ground — MapLibre
 * lifts a fill-extrusion by the elevation at its centroid — so the fit works on a local plane at the anchor's ground G:
 * every point at its altitude + its ground (`projectAbs`): the ground a point carries as its 4th value (the caller's
 * one sample per piece, at the piece's centroid, where MapLibre lifts it — 0.3.2: a small building on a slope sat off
 * the frame when every piece was put at G), else G (no per-vertex terrain lookup: neighbouring DEM samples on a slope
 * or a tile not loaded yet would tear the frame); the camera centre held at one elevation per round and the pan
 * solved on that plane (the projection's Jacobian; map.unproject's terrain ray reads the last rendered frame and is
 * stale between instant jumps). A second round holds the centre at the ground under the found centre — what
 * MapLibre clamps it to when the camera lands — so the computed frame is the landed one.
 *
 * MapLibre lifts a camera that would sit inside the terrain (Map#_applyUpdatedTransform →
 * _elevateCameraIfInsideTerrain: a lower pitch and another zoom over the same ground). The fit computes with the lift
 * off (`withoutLift`), so every computed camera is the one asked for (0.3.2: on a phone a far camera behind a hillside
 * was lifted to 48° early in the fit, the fit went on at 48° and the 75° target put the building under the sheet), then
 * asks MapLibre's own check whether the found camera would be lifted: if so, the `alternates` (other corners of the
 * building) are tried and the first one clear of the ground is taken, so the view stays two-point; if every corner is
 * lifted, the asked corner is fitted again at the pitch MapLibre allows there. The target carries the pitch and the
 * centre's elevation it was computed with.
 */
export function fitBuilding(map, points, {box, bearing = 0, alternates = [], preset = 'eye', minZoom = 14, maxZoom = 19.5, fill = 0.94, animate = true, duration = 900, apply = true, project = projectPoint, projectAbs = projectAltitude} = {}) {
  if (!points?.length || !box) return null;
  const p = CAMERA[preset] || CAMERA.eye;
  const onTerrain = Boolean(map.terrain) && typeof map.queryTerrainElevation === 'function';
  const start = {center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), padding: map.getPadding(),
    ...(onTerrain && Number.isFinite(map.transform?.elevation) ? {elevation: map.transform.elevation} : {})};
  setFov(map, p.fov);
  const lens = lensPadding(map, box);
  const ground = points.filter(q => !q[2]);
  const base = ground.length ? ground : points;
  const anchor = [base.reduce((s, q) => s + q[0], 0) / base.length, base.reduce((s, q) => s + q[1], 0) / base.length];
  const tw = Math.max(40, (box.right - box.left) * fill), th = Math.max(40, (box.bottom - box.top) * fill);
  const tx = (box.left + box.right) / 2, ty = (box.top + box.bottom) / 2;
  // Start from the footprint's size: metres per pixel that would fit its larger side.
  const kx = Math.cos(anchor[1] * RAD), mx = 111320 * kx, ky = 110574;
  const span = Math.max(20, ...base.map(q => Math.hypot((q[0] - anchor[0]) * mx, (q[1] - anchor[1]) * ky) * 2));
  const clampZ = z => Math.min(maxZoom, Math.max(minZoom, z));
  const firstZoom = clampZ(Math.log2((40075016.686 * kx * Math.min(tw, th)) / (512 * span)) - 0.4);
  let zoom = firstZoom;
  const G = onTerrain ? groundAt(map, anchor) : 0;
  // Screen box of the points: on terrain at altitude + G on the anchor's plane, else as before.
  const bounds = () => {
    if (!onTerrain) return screenBounds(map, points, project);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const q of points) {
      const s = projectAbs(map, [q[0], q[1], (q[2] || 0) + (Number.isFinite(q[3]) ? q[3] : G)]);
      if (!Number.isFinite(s?.x) || !Number.isFinite(s?.y)) return null;
      if (s.x < minX) minX = s.x; if (s.x > maxX) maxX = s.x; if (s.y < minY) minY = s.y; if (s.y > maxY) maxY = s.y;
    }
    return {minX, minY, maxX, maxY};
  };
  // One instant jump at the asked pitch (the preset's, or the one MapLibre allows there).
  let asked = p.pitch;
  const jump = options => { map.jumpTo({...options, pitch: asked}); zoom = map.getZoom(); };
  const pan = b => {
    const dx = tx - (b.minX + b.maxX) / 2, dy = ty - (b.minY + b.maxY) / 2;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return 0;
    const c = map.getCenter();
    if (onTerrain) {
      // Moving the centre by Δ metres on the plane moves the anchor on screen by −J·Δ (J: screen px per metre there).
      const step = 5;
      const p0 = projectAbs(map, [anchor[0], anchor[1], G]), pe = projectAbs(map, [anchor[0] + step / mx, anchor[1], G]), pn = projectAbs(map, [anchor[0], anchor[1] + step / ky, G]);
      const a = (pe.x - p0.x) / step, cc = (pe.y - p0.y) / step, bb = (pn.x - p0.x) / step, d = (pn.y - p0.y) / step, det = a * d - bb * cc;
      if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return 0;
      const de = -(d * dx - bb * dy) / det, dn = -(-cc * dx + a * dy) / det;
      jump({center: [c.lng + de / mx, c.lat + dn / ky]});
      return Math.hypot(dx, dy);
    }
    const pa = map.project(anchor), g = map.unproject([pa.x + dx, pa.y + dy]);
    jump({center: [c.lng + anchor[0] - g.lng, c.lat + anchor[1] - g.lat]});
    return Math.hypot(dx, dy);
  };
  const converge = () => {
    for (let i = 0; i < 30; i++) {
      let b = bounds();
      if (!b) { jump({zoom: clampZ(zoom - 0.5)}); continue; }
      const moved = pan(b);
      b = bounds();
      if (!b) { jump({zoom: clampZ(zoom - 0.5)}); continue; }
      const scale = Math.min(tw / Math.max(1, b.maxX - b.minX), th / Math.max(1, b.maxY - b.minY));
      const before = zoom;
      jump({zoom: clampZ(zoom + Math.log2(scale))});
      if (Math.abs(zoom - before) < 0.004 && moved < 1) break;
    }
    const last = bounds();
    if (last) pan(last);
  };
  const solve = (b, pitch) => {
    asked = pitch;
    jump({center: anchor, zoom: firstZoom, bearing: b, padding: lens, ...(onTerrain ? {elevation: G} : {})});
    converge();
    if (onTerrain) {
      // The landed camera orbits the ground under its centre: hold the centre there and converge again — until the
      // held ground is the ground under the found centre. A close camera on a steep slope swings between two centres
      // (0.3.2: ±0.5 m each round on a 30 % slope), so after the first round the held ground moves halfway (≤ 10 rounds).
      let held = G;
      for (let round = 0; round < 10; round++) {
        const c = map.getCenter(), e = groundAt(map, [c.lng, c.lat]);
        if (Math.abs(e - held) < 0.1) break;
        held = round ? (held + e) / 2 : e;
        jump({elevation: held});
        converge();
      }
    }
    // On terrain the target carries the centre's elevation it was computed with: an instant jump (reduced motion) then
    // checks the camera against the terrain from the right height (an ease interpolates to the same ground).
    const elevation = onTerrain ? map.transform?.elevation : undefined;
    return {center: map.getCenter(), zoom: Math.round(map.getZoom() * 1000) / 1000, pitch: Math.round(asked * 100) / 100, bearing: b, padding: lens, ...(Number.isFinite(elevation) ? {elevation} : {})};
  };
  const target = withoutLift(map, lifted => {
    // The pitch MapLibre would lift the found camera to (null: clear of the ground, or no terrain check).
    const liftTo = () => { const l = onTerrain && lifted ? lifted(map.transform) : null; return Number.isFinite(l?.pitch) && l.pitch < asked - 0.5 ? l.pitch : null; };
    const first = solve(norm180(bearing), p.pitch);
    let lift = liftTo();
    if (lift == null) return first;
    for (const b of alternates) {
      const other = solve(norm180(b), p.pitch);
      if (liftTo() == null) return other;
    }
    // Every corner is lifted: the asked one, at the pitch MapLibre allows there (≤ 3 passes, the frame moves with it).
    let best = first;
    for (let pass = 0; pass < 3 && lift != null; pass++) {
      best = solve(norm180(bearing), lift);
      lift = liftTo();
    }
    return best;
  });
  map.jumpTo(start);
  if (!apply) return target;
  if (!animate) { map.jumpTo(target); return target; }
  // Far (another part of the city or a big zoom change): flyTo arcs out and back in; near: a plain ease.
  const distance = Math.hypot((start.center.lng - target.center.lng) * mx, (start.center.lat - target.center.lat) * ky);
  const far = Math.abs(start.zoom - target.zoom) > 2.5 || distance > metresPerPixel(anchor[1], start.zoom) * 1500;
  if (far) map.flyTo({...target, duration: Math.max(duration, 1400), essential: false});
  else map.easeTo({...target, duration});
  return target;
}

/** Fly to a point under a preset keeping at least `zoom`; `offset` lifts the target (mobile sheet). */
export function framePoint(map, lngLat, {preset = 'model', zoom = 16, offset = [0, 0], animate = true, duration = 650} = {}) {
  const p = CAMERA[preset] || CAMERA.plan;
  setFov(map, p.fov);
  const options = {center: lngLat, zoom: Math.max(map.getZoom(), zoom), pitch: p.pitch, bearing: p.bearing, padding: shiftPadding(map, p.shift || 0), offset};
  if (animate) map.flyTo({...options, duration}); else map.jumpTo(options);
  return options;
}
