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
 */
export const DEFAULT_FOV = 36.87;

export const CAMERA = Object.freeze({
  plan: {pitch: 0, bearing: 0, fov: DEFAULT_FOV},
  city: {pitch: 56, bearing: 28, fov: DEFAULT_FOV, fitShift: 0.2},
  model: {pitch: 60, bearing: 28, fov: 14, fitShift: 0.16},
  eye: {pitch: 75, bearing: 28, fov: 24, fitShift: 0.1},
});
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
 * Screen position of [lng, lat, altitudeMetres]. MapLibre's map.project() is
 * ground-only, so elevated points (roof vertices) go through the transform's
 * view-projection matrix (world pixels, z in metres → clip space), exactly as
 * fill-extrusion vertices do. Falls back to map.project for ground points.
 */
export function projectPoint(map, point) {
  const [lng, lat, alt = 0] = point;
  const t = map.transform;
  const M = t?.modelViewProjectionMatrix;
  if (!alt || !M || !Number.isFinite(t.worldSize) || !globalThis.maplibregl?.MercatorCoordinate) return map.project([lng, lat]);
  const mc = globalThis.maplibregl.MercatorCoordinate.fromLngLat([lng, lat]);
  const x = mc.x * t.worldSize, y = mc.y * t.worldSize, z = alt;
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

/** Fly to a point under a preset keeping at least `zoom`; `offset` lifts the target (mobile sheet). */
export function framePoint(map, lngLat, {preset = 'model', zoom = 16, offset = [0, 0], animate = true, duration = 650} = {}) {
  const p = CAMERA[preset] || CAMERA.plan;
  setFov(map, p.fov);
  const options = {center: lngLat, zoom: Math.max(map.getZoom(), zoom), pitch: p.pitch, bearing: p.bearing, padding: shiftPadding(map, p.shift || 0), offset};
  if (animate) map.flyTo({...options, duration}); else map.jumpTo(options);
  return options;
}
