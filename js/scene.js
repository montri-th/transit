/**
 * Transit 3D scene — a three.js scene drawn inside one MapLibre custom layer.
 *
 * Why three.js on top of the MapLibre paper basemap: the owner asked for the
 * 3D map to read like the pmndrs "raycast cycling" studio scene — translucent
 * white slabs, one soft directional shadow on the ground, a quiet fill light,
 * and overlapping objects under the cursor cycled on repeated clicks. MapLibre's
 * fill-extrusion has no shadows, no per-object materials and no object picking,
 * so the data layers of this map (line ribbons, station plates, piers and the
 * OSM buildings matched to large stations) are three.js meshes rendered with the
 * map's own projection matrix (MapLibre `defaultProjectionData.mainMatrix` → the
 * official "add a 3D model with three.js" pattern). The basemap, the quiet city
 * massing and the 2D context layers stay MapLibre.
 *
 * Coordinates: scene units are metres relative to ORIGIN (Bangkok); x = east,
 * y = up, z = south (Mercator y grows southwards; see sceneTransform()). Vertex
 * positions are stored relative to the origin, and the 64-bit map matrix is
 * combined with the origin transform on the CPU before it reaches the GPU, so
 * the geometry does not jitter in 32-bit shader math.
 *
 * Display rules (never data facts): elevated ribbons sit at ELEVATION.elevated
 * (12 m) with piers every PIER_SPACING m; surface ribbons sit on the ground;
 * underground ribbons are drawn at ground level, narrower and more transparent.
 * Plate sizes depend on the station role (hub/station), never on a metric.
 *
 * Colours come from the palette the app reads from assets/theme.css; line
 * identity colours are supplied per line by the caller (js/lines.js).
 */
import earcut from './vendor/earcut.js';

export const SCENE_LAYER = 'transit-scene';
export const ORIGIN = Object.freeze({lng: 100.5231, lat: 13.7367});
export const ELEVATION = Object.freeze({elevated: 12, surface: 0.6, underground: 0.3});
export const RIBBON = Object.freeze({width: 7, widthUnderground: 5, thickness: 1.6, quietWidth: 4});
export const PLATE = Object.freeze({hub: [150, 26], station: [110, 18], stop: [40, 10], thickness: 3, stripe: 1.2});
export const PIER_SPACING = 36;
export const PIER_SIZE = Object.freeze({w: 1.6, h: 11});
export const SHADOW_RADIUS_M = 2600;

/* ---------- pure geometry helpers (unit-tested) ---------- */

/** Metres per Mercator unit at the origin latitude and the origin Mercator coordinate. */
export function sceneTransform(maplibregl, origin = ORIGIN) {
  const mc = maplibregl.MercatorCoordinate.fromLngLat([origin.lng, origin.lat], 0);
  const scale = mc.meterInMercatorCoordinateUnits();
  return {x: mc.x, y: mc.y, z: mc.z, scale};
}

/** [lng, lat, altitude m] → scene [x, y, z] (x east, y up, z south) with a transform from sceneTransform(). */
export function toScene(maplibregl, t, lng, lat, alt = 0) {
  const mc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0);
  return [(mc.x - t.x) / t.scale, alt, (mc.y - t.y) / t.scale];
}

/** Bearing (degrees from north, clockwise) of the segment a → b in scene space (z = south). */
export function sceneBearing([ax, , az], [bx, , bz]) {
  return ((Math.atan2(bx - ax, -(bz - az)) * 180) / Math.PI + 360) % 360;
}

/**
 * A ribbon (flat slab of width w and thickness t) along polyline parts.
 * parts: [[x, y, z], …][] in scene units (y = height of the ribbon centre line).
 * Returns flat Float32 positions/normals and Uint32 indices for a BufferGeometry.
 * Faces are duplicated per side so every face has a flat normal (model look).
 */
export function buildRibbon(parts, {width = RIBBON.width, thickness = RIBBON.thickness} = {}) {
  const positions = [], normals = [], indices = [];
  const half = width / 2, ht = thickness / 2;
  const push = (p, n) => { positions.push(p[0], p[1], p[2]); normals.push(n[0], n[1], n[2]); return positions.length / 3 - 1; };
  for (const raw of parts) {
    const pts = dedupe(raw);
    const n = pts.length;
    if (n < 2) continue;
    // Per-vertex offset direction (XZ plane), mitred between adjacent segments and clamped.
    const dirs = [];
    for (let i = 0; i < n - 1; i++) {
      const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][2] - pts[i][2], len = Math.hypot(dx, dz) || 1;
      dirs.push([dx / len, dz / len]);
    }
    const left = [], right = [];
    for (let i = 0; i < n; i++) {
      const d0 = dirs[Math.max(0, i - 1)], d1 = dirs[Math.min(n - 2, i)];
      // normal of a direction (dx, dz) pointing left when walking the segment: (dz, -dx)
      let nx = d0[1] + d1[1], nz = -(d0[0] + d1[0]);
      const l = Math.hypot(nx, nz);
      if (l < 1e-6) { nx = d1[1]; nz = -d1[0]; } else { nx /= l; nz /= l; }
      const cos = Math.max(0.5, nx * d1[1] + nz * -d1[0]); // mitre length clamp (≤ 2× half width)
      const m = half / cos;
      left.push([pts[i][0] + nx * m, pts[i][1], pts[i][2] + nz * m]);
      right.push([pts[i][0] - nx * m, pts[i][1], pts[i][2] - nz * m]);
    }
    const lift = (p, dy) => [p[0], p[1] + dy, p[2]];
    const faces = [
      {n: [0, 1, 0], a: i => lift(left[i], ht), b: i => lift(right[i], ht), flip: false},
      {n: [0, -1, 0], a: i => lift(left[i], -ht), b: i => lift(right[i], -ht), flip: true},
    ];
    for (const f of faces) {
      const start = positions.length / 3;
      for (let i = 0; i < n; i++) { push(f.a(i), f.n); push(f.b(i), f.n); }
      for (let i = 0; i < n - 1; i++) {
        const a = start + i * 2, b = a + 1, c = a + 2, d = a + 3;
        if (f.flip) indices.push(a, c, b, b, c, d); else indices.push(a, b, c, b, d, c);
      }
    }
    // Side walls: left (outward normal = left offset direction) and right.
    for (const side of ['left', 'right']) {
      const ring = side === 'left' ? left : right;
      const start = positions.length / 3;
      for (let i = 0; i < n; i++) {
        const d = dirs[Math.min(n - 2, i)];
        const nrm = side === 'left' ? [d[1], 0, -d[0]] : [-d[1], 0, d[0]];
        push(lift(ring[i], ht), nrm); push(lift(ring[i], -ht), nrm);
      }
      for (let i = 0; i < n - 1; i++) {
        const a = start + i * 2, b = a + 1, c = a + 2, d = a + 3;
        if (side === 'left') indices.push(a, c, b, b, c, d); else indices.push(a, b, c, b, d, c);
      }
    }
    // End caps.
    for (const [i, sign] of [[0, -1], [n - 1, 1]]) {
      const d = dirs[Math.min(n - 2, Math.max(0, i - (sign > 0 ? 1 : 0)))];
      const nrm = [d[0] * sign, 0, d[1] * sign];
      const s = positions.length / 3;
      push(lift(left[i], ht), nrm); push(lift(right[i], ht), nrm); push(lift(left[i], -ht), nrm); push(lift(right[i], -ht), nrm);
      if (sign > 0) indices.push(s, s + 1, s + 2, s + 1, s + 3, s + 2); else indices.push(s, s + 2, s + 1, s + 1, s + 2, s + 3);
    }
  }
  return {positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices)};
}

function dedupe(points) {
  const out = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[2] - q[2]) > 0.25) out.push(p);
  }
  return out;
}

/** Positions of piers every `spacing` m along the parts (the first pier at half spacing). */
export function pierPositions(parts, spacing = PIER_SPACING) {
  const out = [];
  for (const raw of parts) {
    const pts = dedupe(raw);
    let next = spacing / 2;
    let travelled = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (len < 1e-6) continue;
      while (next <= travelled + len) {
        const f = (next - travelled) / len;
        out.push([a[0] + (b[0] - a[0]) * f, a[2] + (b[2] - a[2]) * f, sceneBearing(a, b)]);
        next += spacing;
      }
      travelled += len;
    }
  }
  return out;
}

/**
 * Extrude a polygon (outer ring + holes, scene XZ coordinates) from `base` to `height`.
 * Returns positions/normals/indices. Roof via earcut; walls per edge with flat normals.
 */
export function buildExtrusion(rings, {height = 10, base = 0} = {}) {
  const positions = [], normals = [], indices = [];
  const push = (x, y, z, n) => { positions.push(x, y, z); normals.push(n[0], n[1], n[2]); return positions.length / 3 - 1; };
  const flat = [], holes = [];
  rings.forEach((ring, r) => {
    const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
    if (r > 0) holes.push(flat.length / 2);
    for (const [x, z] of pts) flat.push(x, z);
  });
  if (flat.length < 6) return {positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0)};
  // Roof (y up). earcut gives CCW/CW triangles in the XZ plane; orient so normals face up.
  const tris = earcut(flat, holes.length ? holes : null, 2);
  const roofStart = positions.length / 3;
  for (let i = 0; i < flat.length; i += 2) push(flat[i], height, flat[i + 1], [0, 1, 0]);
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
    const ax = flat[a * 2], az = flat[a * 2 + 1], bx = flat[b * 2], bz = flat[b * 2 + 1], cx = flat[c * 2], cz = flat[c * 2 + 1];
    // In the x/z plane with y up, counter-clockwise seen from above means (b−a)×(c−a) has negative y in right-handed xz.
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (cross < 0) indices.push(roofStart + a, roofStart + b, roofStart + c); else indices.push(roofStart + a, roofStart + c, roofStart + b);
  }
  // Walls.
  rings.forEach(ring => {
    const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % n];
      const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const nrm = [dz / len, 0, -dx / len];
      const s = positions.length / 3;
      push(x1, base, z1, nrm); push(x2, base, z2, nrm); push(x2, height, z2, nrm); push(x1, height, z1, nrm);
      indices.push(s, s + 1, s + 2, s, s + 2, s + 3); // materials are double-sided; the explicit normal drives the shading
    }
  });
  return {positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices)};
}

/**
 * Raycast cycling (pmndrs CycleRaycast semantics): the objects under the
 * cursor are kept in distance order; a repeated click on the same set brings the
 * next one to the front. Pure: returns the new {ids, cycle}.
 */
export function cycleHits(previous, ids) {
  const same = previous.ids.length === ids.length && previous.ids.every((id, i) => id === ids[i]);
  if (!ids.length) return {ids: [], cycle: 0};
  return {ids, cycle: same ? (previous.cycle + 1) % ids.length : 0};
}

/* ---------- display scale (pure) ---------- */

/** Ground metres per CSS pixel at a zoom and latitude (Web Mercator, 512 px tiles). */
export const metresPerPixel = (zoom, latitude = ORIGIN.lat) => (40075016.686 * Math.cos((latitude * Math.PI) / 180)) / (512 * 2 ** zoom);

/** Minimum on-screen sizes so the model stays readable when zoomed out (display only). */
export const MIN_PX = Object.freeze({ribbon: 4.5, ribbonQuiet: 2.5, plateLength: 12, plateWidth: 4});
export const PIER_MIN_ZOOM = 14.5;
export const RAMP_M = 200;

/** Ribbon width (m) for a line at a display scale: the real width or the minimum pixel width, whichever is larger. */
export function ribbonWidth(line, mpp) {
  const real = line.quiet ? RIBBON.quietWidth : line.elevation === 'underground' ? RIBBON.widthUnderground : RIBBON.width;
  return Math.max(real, (line.quiet ? MIN_PX.ribbonQuiet : MIN_PX.ribbon) * mpp);
}

/**
 * Per-vertex heights along one part with ramps: an elevated part that meets a
 * lower part of the same line (shared end point) slopes down to the lower level
 * over RAMP_M metres at that end; extra vertices are inserted so the slope is
 * smooth. `path` = [[x, z], …] in scene metres. Returns [[x, y, z], …].
 */
/** WCAG contrast ratio of two #RRGGBB colours (NaN when either is not a hex colour). */
export function contrastRatio(a, b) {
  const lum = hex => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return NaN;
    const [r, g, bl] = [0, 2, 4].map(k => parseInt(m[1].slice(k, k + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Split a 3D path into dashes of `on` scene metres separated by `off` (construction
 * lines are dashed in 3D as in the 2D legend: the cue does not rest on colour or opacity).
 */
export function dashPath(path, on = 36, off = 24) {
  const out = [];
  if (!path || path.length < 2) return out;
  let cur = [path[0]], drawing = true, left = on;
  for (let i = 1; i < path.length; i++) {
    let a = path[i - 1];
    const b = path[i];
    let seg = Math.hypot(b[0] - a[0], b[2] - a[2]);
    while (seg > left) {
      const t = left / seg;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      if (drawing) { cur.push(p); if (cur.length >= 2) out.push(cur); cur = []; }
      else cur = [p];
      drawing = !drawing;
      seg -= left;
      left = drawing ? on : off;
      a = p;
    }
    left -= seg;
    if (drawing) cur.push(b);
  }
  if (drawing && cur.length >= 2) out.push(cur);
  return out;
}

export function rampPath(path, height, {startLow = null, endLow = null, ramp = RAMP_M} = {}) {
  if (path.length < 2) return path.map(([x, z]) => [x, height, z]);
  const dist = [0];
  for (let i = 1; i < path.length; i++) dist.push(dist[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const total = dist[dist.length - 1];
  const r = Math.min(ramp, total / 2);
  // Insert vertices at r from each end so the slope breaks exactly there.
  const cuts = [];
  if (startLow != null) cuts.push(r);
  if (endLow != null) cuts.push(total - r);
  const pts = [];
  for (let i = 0; i < path.length; i++) {
    if (i > 0) for (const c of cuts) if (c > dist[i - 1] + 0.5 && c < dist[i] - 0.5) {
      const f = (c - dist[i - 1]) / (dist[i] - dist[i - 1]);
      pts.push({x: path[i - 1][0] + (path[i][0] - path[i - 1][0]) * f, z: path[i - 1][1] + (path[i][1] - path[i - 1][1]) * f, d: c});
    }
    pts.push({x: path[i][0], z: path[i][1], d: dist[i]});
  }
  return pts.map(p => {
    let y = height;
    if (startLow != null && p.d < r) y = startLow + (height - startLow) * (p.d / r);
    if (endLow != null && total - p.d < r) y = Math.min(y, endLow + (height - endLow) * ((total - p.d) / r));
    return [p.x, y, p.z];
  });
}

/* ---------- the custom layer ---------- */

/**
 * Install the scene on a loaded style. `palette` keys: plate, plateQuiet,
 * building, context, pier, lineQuiet, hover, selected, shadowOpacity.
 * Callbacks receive plain hit records {kind: 'station'|'line'|'building', id, lineId?, stationId?}.
 *
 * Content setters:
 *  setLines([{id, color, status, quiet, elevation, parts: [{coords: [[lng, lat]…], elevation}]}])
 *  setStations([{id, lng, lat, role, elevation, bearing, colors: [hex], quiet, status}])
 *  setBuildings(GeoJSON features with properties {height, base, stationId, osm_id})
 *  setContext(GeoJSON features with properties {height, base}) — focus massing, merged, not pickable
 *  setScale({zoom, latitude}) — rebuilds widths in half-zoom buckets
 */
export function installScene(map, THREE, maplibregl, {beforeId, palette = {}, onHover, onSelect, onCycle, reducedMotion = () => false} = {}) {
  const colors = {plate: '#FFFFFF', plateQuiet: '#ECEDE8', building: '#FFFFFF', context: '#FFFFFF', pier: '#FFFFFF', lineQuiet: '#B4BDB7', hover: '#347DA8', selected: '#176B82', shadowOpacity: 0.2, ground: '', backing: '', ...palette};
  const T = sceneTransform(maplibregl);
  const state = {enabled: true, lines: [], stations: [], buildings: [], context: [], hoverId: '', selectedId: '', cycle: {ids: [], cycle: 0}, failed: false, pickables: [], zoom: 12, latitude: ORIGIN.lat, bucket: -1,
    meshes: {lines: [], stations: [], buildings: [], piers: [], context: []}};
  let renderer = null, scene = null, camera = null, sun = null, ground = null, raycaster = null, shadowCenter = null, disposed = false, frameMatrix = null, lastHits = [];
  const geometries = new Set(), materials = new Set();
  const track = g => { geometries.add(g); return g; };
  const material = opts => { const m = new THREE.MeshStandardMaterial({roughness: 1, metalness: 0, side: THREE.DoubleSide, ...opts}); materials.add(m); return m; };
  const pulse = () => !reducedMotion();
  const mpp = () => metresPerPixel(state.zoom, state.latitude);

  const layer = {
    id: SCENE_LAYER, type: 'custom', renderingMode: '3d',
    onAdd(_map, gl) {
      scene = new THREE.Scene();
      camera = new THREE.Camera();
      raycaster = new THREE.Raycaster();
      // Lights — the studio recipe of the reference scene: a fill, one main light that casts the
      // soft shadow, and a strong low strip light from the opposite side that rims the slabs.
      scene.add(new THREE.AmbientLight(0xffffff, 0.5 * Math.PI));
      sun = new THREE.DirectionalLight(0xffffff, Math.PI);
      sun.position.set(300, 2000, -600);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.6;
      const sc = sun.shadow.camera;
      sc.left = -SHADOW_RADIUS_M; sc.right = SHADOW_RADIUS_M; sc.top = SHADOW_RADIUS_M; sc.bottom = -SHADOW_RADIUS_M; sc.near = 10; sc.far = 6000;
      scene.add(sun); scene.add(sun.target);
      const strip = new THREE.DirectionalLight(0xffffff, 3 * Math.PI);
      strip.position.set(-2000, -2000, 400);
      scene.add(strip);
      ground = new THREE.Mesh(track(new THREE.PlaneGeometry(80000, 80000)), new THREE.ShadowMaterial({opacity: colors.shadowOpacity, transparent: true, depthWrite: false}));
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = 0.05;
      ground.receiveShadow = true;
      ground.renderOrder = -2;
      scene.add(ground);
      renderer = new THREE.WebGLRenderer({canvas: map.getCanvas(), context: gl, antialias: true});
      renderer.autoClear = false;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
      rebuildAll();
    },
    onRemove() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      geometries.clear(); materials.clear();
      renderer?.dispose?.();
      scene = null; camera = null; renderer = null;
    },
    render(gl, args) {
      if (!renderer || !state.enabled || state.failed) return;
      try {
        const main = args?.defaultProjectionData?.mainMatrix;
        if (!main) return;
        const rotX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
        const m = new THREE.Matrix4().fromArray(main);
        const l = new THREE.Matrix4().makeTranslation(T.x, T.y, T.z).scale(new THREE.Vector3(T.scale, -T.scale, T.scale)).multiply(rotX);
        camera.projectionMatrix = m.multiply(l);
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        frameMatrix = camera.projectionMatrix;
        followShadow();
        animateHover();
        renderer.resetState();
        // Data is never hidden by the quiet MapLibre city massing drawn before this layer
        // (translucent extrusions still write depth): start the scene on a clear depth buffer.
        renderer.clearDepth();
        renderer.render(scene, camera);
        if (state.hoverId && pulse()) map.triggerRepaint();
      } catch (e) {
        state.failed = true;
        console.warn('Transit scene disabled after a render error', e);
      }
    },
  };

  /** The shadow volume follows the map centre in 500 m steps; the shadow map is re-baked only then or when content changes. */
  function followShadow() {
    const c = map.getCenter();
    const p = toScene(maplibregl, T, c.lng, c.lat, 0);
    if (!shadowCenter || Math.hypot(p[0] - shadowCenter[0], p[2] - shadowCenter[2]) > 500) {
      shadowCenter = p;
      sun.target.position.set(p[0], 0, p[2]);
      sun.position.set(p[0] + 300, 2000, p[2] - 600);
      sun.target.updateMatrixWorld();
      ground.position.set(p[0], 0.05, p[2]);
      renderer.shadowMap.needsUpdate = true;
    }
  }

  let t0 = 0;
  function animateHover() {
    const group = state.meshes.stations.find(s => s.userData.id === state.hoverId);
    for (const s of state.meshes.stations) if (s !== group && s.userData.plate.scale.y !== s.userData.baseScale.y) s.userData.plate.scale.copy(s.userData.baseScale);
    if (!group) return;
    const k = pulse() ? 1 + Math.sin((performance.now() - (t0 ||= performance.now())) / 100) / 50 + 0.02 : 1.04;
    group.userData.plate.scale.copy(group.userData.baseScale).multiplyScalar(k);
  }

  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined;
  map.addLayer(layer, before);

  /* ---------- content ---------- */
  function clear(kind) {
    for (const mesh of state.meshes[kind]) {
      scene?.remove(mesh);
      mesh.traverse?.(o => { if (o.geometry && !o.userData?.sharedGeometry) { o.geometry.dispose(); geometries.delete(o.geometry); } if (o.material && !o.userData?.sharedMaterial) { o.material.dispose(); materials.delete(o.material); } });
    }
    state.meshes[kind] = [];
  }
  const geometryFrom = data => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    g.setIndex(new THREE.BufferAttribute(data.indices, 1));
    g.computeBoundingSphere();
    return track(g);
  };
  const xz = ([lng, lat]) => { const p = toScene(maplibregl, T, lng, lat, 0); return [p[0], p[2]]; };
  const key = ([x, z]) => `${Math.round(x / 8)},${Math.round(z / 8)}`;

  function rebuildLines() {
    if (!scene) return;
    clear('lines'); clear('piers');
    const pierTransforms = [];
    const showPiers = state.zoom >= PIER_MIN_ZOOM;
    for (const line of state.lines) {
      const parts = (line.parts || []).map(p => ({path: (p.coords || []).map(xz), elevation: p.elevation || line.elevation || 'surface'})).filter(p => p.path.length >= 2);
      if (!parts.length) continue;
      // Junctions between parts of the same line at different levels (shared end points).
      const ends = new Map();
      for (const p of parts) for (const pt of [p.path[0], p.path[p.path.length - 1]]) { const k = key(pt); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(p); }
      const lowAt = (p, pt) => { const others = (ends.get(key(pt)) || []).filter(o => o !== p && o.elevation !== 'elevated'); return others.length ? (ELEVATION[others[0].elevation] ?? ELEVATION.surface) : null; };
      const width = ribbonWidth(line, mpp());
      const thickness = Math.max(line.quiet ? RIBBON.thickness * 0.6 : RIBBON.thickness, width * 0.18);
      const byLevel = new Map();
      for (const p of parts) {
        const h = ELEVATION[p.elevation] ?? ELEVATION.surface;
        const path3 = p.elevation === 'elevated' ? rampPath(p.path, h, {startLow: lowAt(p, p.path[0]), endLow: lowAt(p, p.path[p.path.length - 1])}) : p.path.map(([x, z]) => [x, h + thickness / 2, z]);
        if (!byLevel.has(p.elevation)) byLevel.set(p.elevation, []);
        if (line.status === 'construction') byLevel.get(p.elevation).push(...dashPath(path3, 14 * mpp(), 9 * mpp()));
        else byLevel.get(p.elevation).push(path3);
        if (p.elevation === 'elevated' && showPiers && !line.quiet && line.status !== 'construction') pierTransforms.push(...pierPositions([path3]).filter(([x, z]) => {
          // no pier on the ramps (the deck is low there)
          const i = path3.findIndex(q => Math.hypot(q[0] - x, q[2] - z) < PIER_SPACING); return i < 0 || path3[i][1] > ELEVATION.elevated - 1;
        }));
      }
      // An identity colour too close to the ground (navy or dark red on the dark theme) keeps its colour and
      // gets a neutral backing ribbon underneath (LDS: legibility by outline or backing, never by changing the colour).
      const backed = !line.quiet && colors.backing && contrastRatio(line.color, colors.ground) < 3;
      for (const [level, paths] of byLevel) {
        const data = buildRibbon(paths, {width: level === 'underground' ? width * 0.75 : width, thickness});
        if (!data.indices.length) continue;
        if (backed) {
          const back = buildRibbon(paths.map(path => path.map(([x, y, z]) => [x, y - thickness * 0.3, z])), {width: (level === 'underground' ? width * 0.75 : width) + 4 * mpp(), thickness: thickness * 0.6});
          const backMesh = new THREE.Mesh(geometryFrom(back), material({color: colors.backing, transparent: true, opacity: line.status === 'construction' ? 0.5 : 0.85, depthWrite: false}));
          backMesh.renderOrder = level === 'underground' ? -2 : 0;
          backMesh.userData = {kind: 'line-backing', lineId: line.id, level};
          scene.add(backMesh);
          state.meshes.lines.push(backMesh);
        }
        const opacity = line.quiet ? 0.5 : line.status === 'construction' ? (level === 'underground' ? 0.6 : 0.75) : level === 'underground' ? 0.42 : 0.92;
        const mat = material({color: line.quiet ? colors.lineQuiet : line.color || colors.lineQuiet, transparent: true, opacity, depthWrite: !line.quiet && level !== 'underground'});
        const mesh = new THREE.Mesh(geometryFrom(data), mat);
        mesh.castShadow = !line.quiet && level === 'elevated';
        mesh.receiveShadow = false;
        mesh.renderOrder = level === 'underground' ? -1 : 1;
        mesh.userData = {kind: 'line', id: line.id, lineId: line.id, level};
        scene.add(mesh);
        state.meshes.lines.push(mesh);
      }
    }
    if (pierTransforms.length) {
      const pierGeometry = track(new THREE.BoxGeometry(PIER_SIZE.w, PIER_SIZE.h, PIER_SIZE.w));
      const pierMaterial = material({color: colors.pier, transparent: true, opacity: 0.9});
      const inst = new THREE.InstancedMesh(pierGeometry, pierMaterial, pierTransforms.length);
      const o = new THREE.Object3D();
      pierTransforms.forEach(([x, z, bearing], i) => { o.position.set(x, PIER_SIZE.h / 2, z); o.rotation.set(0, (-bearing * Math.PI) / 180, 0); o.updateMatrix(); inst.setMatrixAt(i, o.matrix); });
      inst.castShadow = true; inst.receiveShadow = false;
      inst.userData = {kind: 'pier'};
      inst.frustumCulled = false;
      scene.add(inst);
      state.meshes.piers.push(inst);
    }
    refreshPickables();
    if (renderer) renderer.shadowMap.needsUpdate = true;
    map.triggerRepaint();
  }

  function rebuildStations() {
    if (!scene) return;
    clear('stations');
    const box = track(new THREE.BoxGeometry(1, 1, 1));
    const m = mpp();
    const pierMat = material({color: colors.pier, transparent: true, opacity: 0.9});
    for (const s of state.stations) {
      if (!Number.isFinite(s.lng) || !Number.isFinite(s.lat)) continue;
      const [realLen, realWid] = PLATE[s.role] || PLATE.station;
      const quiet = Boolean(s.quiet);
      const len = Math.max(realLen * (quiet ? 0.7 : 1), MIN_PX.plateLength * m * (quiet ? 0.6 : 1));
      const wid = Math.max(realWid * (quiet ? 0.7 : 1), MIN_PX.plateWidth * m * (quiet ? 0.6 : 1));
      const thick = Math.max(PLATE.thickness, Math.min(wid * 0.25, 1.2 * m));
      const elevated = s.elevation === 'elevated';
      const y = elevated ? ELEVATION.elevated + thick / 2 + 0.6 : thick / 2 + 0.2;
      const p = toScene(maplibregl, T, s.lng, s.lat, y);
      const group = new THREE.Group();
      group.position.set(p[0], p[1], p[2]);
      group.rotation.y = (-(s.bearing || 0) * Math.PI) / 180 + Math.PI / 2;
      const construction = s.status === 'construction';
      const mat = material({color: quiet ? colors.plateQuiet : colors.plate, transparent: true, opacity: quiet ? 0.45 : construction ? 0.4 : 0.62});
      const plate = new THREE.Mesh(box, mat);
      plate.userData = {kind: 'station', id: s.id, stationId: s.id, base: {color: mat.color.getHex(), opacity: mat.opacity}, sharedGeometry: true};
      plate.scale.set(len, thick, wid);
      plate.castShadow = !quiet; plate.receiveShadow = true;
      group.add(plate);
      // Colour stripes along the roof: one per line serving the station (identity cue, not a metric).
      const stripes = (s.colors || []).slice(0, 4);
      const stripeW = Math.min(wid / Math.max(2, stripes.length + 1), Math.max(PLATE.stripe, 1.2 * m));
      stripes.forEach((hex, i) => {
        const stripe = new THREE.Mesh(box, material({color: hex, transparent: true, opacity: quiet ? 0.6 : construction ? 0.5 : 1}));
        stripe.userData = {kind: 'stripe', sharedGeometry: true};
        stripe.scale.set(len * 0.96, Math.max(0.6, thick * 0.25), stripeW);
        stripe.position.set(0, thick / 2 + Math.max(0.3, thick * 0.12), (i - (stripes.length - 1) / 2) * stripeW * 1.35);
        group.add(stripe);
      });
      // Elevated plates stand on four piers (near zoom only).
      if (elevated && !quiet && state.zoom >= PIER_MIN_ZOOM) {
        const h = y - thick / 2;
        for (const [dx, dz] of [[-0.42, -0.3], [0.42, -0.3], [-0.42, 0.3], [0.42, 0.3]]) {
          const pier = new THREE.Mesh(box, pierMat);
          pier.userData = {kind: 'pier', sharedGeometry: true, sharedMaterial: true};
          pier.scale.set(PIER_SIZE.w, h, PIER_SIZE.w);
          pier.position.set(dx * len, -thick / 2 - h / 2, dz * wid);
          pier.castShadow = true;
          group.add(pier);
        }
      }
      group.userData = {kind: 'station', id: s.id, stationId: s.id, plate, baseScale: plate.scale.clone()};
      scene.add(group);
      state.meshes.stations.push(group);
    }
    applyStates();
    refreshPickables();
    if (renderer) renderer.shadowMap.needsUpdate = true;
    map.triggerRepaint();
  }

  function rebuildBuildings() {
    if (!scene) return;
    clear('buildings');
    for (const f of state.buildings) {
      const rings = ringsOf(f).map(ring => ring.map(xz));
      if (!rings.length) continue;
      const height = Number(f.properties?.height) || 3, base = Number(f.properties?.base) || 0;
      const data = buildExtrusion(rings, {height, base});
      if (!data.indices.length) continue;
      const mat = material({color: colors.building, transparent: true, opacity: 0.6});
      const mesh = new THREE.Mesh(geometryFrom(data), mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData = {kind: 'building', id: String(f.id ?? f.properties?.id ?? ''), stationId: f.properties?.stationId || '', osmId: f.properties?.osm_id ?? null, height, base: {color: mat.color.getHex(), opacity: mat.opacity}};
      scene.add(mesh);
      state.meshes.buildings.push(mesh);
    }
    applyStates();
    refreshPickables();
    if (renderer) renderer.shadowMap.needsUpdate = true;
    map.triggerRepaint();
  }

  /** Focus massing (context): one merged translucent solid that casts and receives the soft shadow, never pickable, never hiding data. */
  function rebuildContext() {
    if (!scene) return;
    clear('context');
    const positions = [], normals = [], indices = [];
    for (const f of state.context) {
      const rings = ringsOf(f).map(ring => ring.map(xz));
      if (!rings.length) continue;
      const data = buildExtrusion(rings, {height: Number(f.properties?.height) || 3, base: Number(f.properties?.base) || 0});
      const offset = positions.length / 3;
      for (const v of data.positions) positions.push(v);
      for (const v of data.normals) normals.push(v);
      for (const i of data.indices) indices.push(i + offset);
    }
    if (indices.length) {
      const mat = material({color: colors.context, transparent: true, opacity: 0.38, depthWrite: false});
      const mesh = new THREE.Mesh(geometryFrom({positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices)}), mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.renderOrder = -1;
      mesh.userData = {kind: 'context'};
      scene.add(mesh);
      state.meshes.context.push(mesh);
    }
    if (renderer) renderer.shadowMap.needsUpdate = true;
    map.triggerRepaint();
  }

  function rebuildAll() { rebuildContext(); rebuildLines(); rebuildStations(); rebuildBuildings(); }

  function refreshPickables() {
    state.pickables = [...state.meshes.stations.map(g => g.userData.plate), ...state.meshes.buildings, ...state.meshes.lines.filter(m => !state.lines.find(l => l.id === m.userData.id)?.quiet)];
  }

  /** Hover/selected treatment: colour and opacity only — the hover pulse is in animateHover(). */
  function applyStates() {
    for (const g of state.meshes.stations) {
      const plate = g.userData.plate, base = plate.userData.base;
      if (g.userData.id === state.selectedId) { plate.material.color.set(colors.selected); plate.material.opacity = 0.9; }
      else if (g.userData.id === state.hoverId) { plate.material.color.set(colors.hover); plate.material.opacity = 0.8; }
      else { plate.material.color.setHex(base.color); plate.material.opacity = base.opacity; }
    }
    for (const b of state.meshes.buildings) {
      const base = b.userData.base;
      if (b.userData.stationId && b.userData.stationId === state.selectedId) { b.material.color.set(colors.selected); b.material.opacity = 0.5; }
      else if (b.userData.id === state.hoverId) { b.material.color.set(colors.hover); b.material.opacity = 0.7; }
      else { b.material.color.setHex(base.color); b.material.opacity = base.opacity; }
    }
    map.triggerRepaint();
  }

  /* ---------- picking ---------- */
  function hitsAt(point) {
    if (!frameMatrix || !raycaster || !state.pickables.length || !state.enabled) return [];
    const w = map.getCanvas().clientWidth, h = map.getCanvas().clientHeight;
    const nx = (point[0] / w) * 2 - 1, ny = -((point[1] / h) * 2 - 1);
    const inv = camera.projectionMatrixInverse;
    const near = new THREE.Vector3(nx, ny, -1).applyMatrix4(inv), far = new THREE.Vector3(nx, ny, 1).applyMatrix4(inv);
    raycaster.ray.origin.copy(near);
    raycaster.ray.direction.copy(far.sub(near).normalize());
    const hits = raycaster.intersectObjects(state.pickables, false);
    const seen = new Set(), out = [];
    for (const hit of hits) {
      const u = hit.object.userData;
      const id = `${u.kind}:${u.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({kind: u.kind, id: u.id, stationId: u.stationId || '', lineId: u.lineId || '', osmId: u.osmId ?? null, distance: hit.distance});
    }
    return out;
  }

  const onMouseMove = e => {
    if (!state.enabled || state.failed) return;
    const hits = hitsAt([e.point.x, e.point.y]);
    lastHits = hits;
    const top = hits[0] || null;
    const id = top ? top.id : '';
    if (top) map.getCanvas().style.cursor = 'pointer';
    else if (state.hoverId) map.getCanvas().style.cursor = '';
    if (id !== state.hoverId) { state.hoverId = id; t0 = 0; applyStates(); }
    onHover?.(top, hits, state.cycle);
  };
  const onClick = e => {
    if (!state.enabled || state.failed || e.originalEvent?.__citymeterSceneHandled) return;
    const hits = hitsAt([e.point.x, e.point.y]);
    if (!hits.length) { state.cycle = {ids: [], cycle: 0}; onCycle?.({objects: [], cycle: 0}); return; }
    if (e.originalEvent) e.originalEvent.__citymeterSceneHandled = true;
    state.cycle = cycleHits(state.cycle, hits.map(h => `${h.kind}:${h.id}`));
    onCycle?.({objects: hits, cycle: state.cycle.cycle});
    onSelect?.(hits[state.cycle.cycle], hits);
  };
  map.on('mousemove', onMouseMove);
  map.on('click', onClick);

  return {
    setLines(lines) { state.lines = Array.isArray(lines) ? lines : []; rebuildLines(); },
    setStations(stations) { state.stations = Array.isArray(stations) ? stations : []; rebuildStations(); },
    setBuildings(features) { state.buildings = Array.isArray(features) ? features : []; rebuildBuildings(); },
    setContext(features) { state.context = Array.isArray(features) ? features : []; rebuildContext(); },
    /** Widths and plate sizes follow the zoom in half-zoom buckets (and piers appear from PIER_MIN_ZOOM). */
    setScale({zoom = state.zoom, latitude = state.latitude} = {}) {
      const bucket = Math.round(zoom * 2) / 2;
      state.latitude = latitude;
      if (bucket === state.bucket) return false;
      state.bucket = bucket; state.zoom = bucket;
      rebuildLines(); rebuildStations();
      return true;
    },
    setSelected(id) { state.selectedId = id || ''; applyStates(); },
    setHover(id) { state.hoverId = id || ''; t0 = 0; applyStates(); },
    setEnabled(on) { state.enabled = Boolean(on); if (scene) scene.visible = state.enabled; map.triggerRepaint(); },
    setPalette(next) { Object.assign(colors, next); if (ground) ground.material.opacity = colors.shadowOpacity; rebuildAll(); },
    hitTest: hitsAt,
    get hits() { return lastHits.slice(); },
    get failed() { return state.failed; },
    get counts() { return {lines: state.meshes.lines.length, stations: state.meshes.stations.length, buildings: state.meshes.buildings.length, context: state.context.length, piers: state.meshes.piers.reduce((n, m) => n + m.count, 0), zoomBucket: state.bucket}; },
    dispose() {
      if (disposed) return;
      disposed = true;
      map.off('mousemove', onMouseMove);
      map.off('click', onClick);
      if (map.getLayer(SCENE_LAYER)) map.removeLayer(SCENE_LAYER);
    },
  };
}

function ringsOf(feature) {
  const g = feature?.geometry;
  if (!g) return [];
  if (g.type === 'Polygon') return g.coordinates;
  if (g.type === 'MultiPolygon') return g.coordinates[0] || [];
  return [];
}
