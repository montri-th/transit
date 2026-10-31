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

/* ---------- the custom layer ---------- */

/**
 * Install the scene on a loaded style. `palette` keys: plate, plateQuiet,
 * building, pier, lineQuiet, hover, selected, shadowOpacity. Callbacks receive
 * plain hit records {kind: 'station'|'line'|'building', id, lineId?, stationId?}.
 */
export function installScene(map, THREE, maplibregl, {beforeId, palette = {}, onHover, onSelect, onCycle, reducedMotion = () => false} = {}) {
  const colors = {plate: '#FFFFFF', plateQuiet: '#ECEDE8', building: '#FFFFFF', pier: '#FFFFFF', lineQuiet: '#B4BDB7', hover: '#347DA8', selected: '#176B82', shadowOpacity: 0.2, ...palette};
  const T = sceneTransform(maplibregl);
  const state = {enabled: true, lines: [], stations: [], buildings: [], hoverId: '', selectedId: '', cycle: {ids: [], cycle: 0}, failed: false, pickables: [], meshes: {lines: [], stations: [], buildings: [], piers: []}};
  let renderer = null, scene = null, camera = null, sun = null, ground = null, raycaster = null, shadowCenter = null, disposed = false, frameMatrix = null, lastHits = [];
  const geometries = new Set(), materials = new Set();
  const track = g => { geometries.add(g); return g; };
  const material = (opts) => { const m = new THREE.MeshStandardMaterial({roughness: 1, metalness: 0, side: THREE.DoubleSide, ...opts}); materials.add(m); return m; };
  const pulse = () => !reducedMotion();

  const layer = {
    id: SCENE_LAYER, type: 'custom', renderingMode: '3d',
    onAdd(_map, gl) {
      scene = new THREE.Scene();
      camera = new THREE.Camera();
      raycaster = new THREE.Raycaster();
      // Lights: fill, main (shadow) and a low strip from the other side — the studio recipe of the reference scene.
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
      ground.renderOrder = -1;
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
    const mesh = state.meshes.stations.find(s => s.userData.id === state.hoverId);
    for (const s of state.meshes.stations) if (s !== mesh && s.scale.x !== 1) s.scale.setScalar(1);
    if (!mesh) return;
    if (!pulse()) { mesh.scale.setScalar(1.04); return; }
    t0 = (t0 || performance.now());
    const t = (performance.now() - t0) / 1000;
    mesh.scale.setScalar(1 + Math.sin(t * 10) / 50 + 0.02);
  }

  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined;
  map.addLayer(layer, before);

  /* ---------- content ---------- */
  function clear(kind) {
    for (const mesh of state.meshes[kind]) { scene?.remove(mesh); mesh.geometry?.dispose(); geometries.delete(mesh.geometry); if (mesh.material && !mesh.userData.shared) { mesh.material.dispose(); materials.delete(mesh.material); } }
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
  const scenePath = (coords, y) => coords.map(([lng, lat]) => toScene(maplibregl, T, lng, lat, y));

  function rebuildLines() {
    if (!scene) return;
    clear('lines'); clear('piers');
    const pierGeometry = track(new THREE.BoxGeometry(PIER_SIZE.w, PIER_SIZE.h, PIER_SIZE.w));
    const pierMaterial = material({color: colors.pier, transparent: true, opacity: 0.9});
    const pierTransforms = [];
    for (const line of state.lines) {
      const elevation = ELEVATION[line.elevation] ?? ELEVATION.surface;
      const parts = (line.parts || []).map(part => scenePath(part, elevation));
      if (!parts.length) continue;
      const quiet = line.quiet;
      const width = quiet ? RIBBON.quietWidth : line.elevation === 'underground' ? RIBBON.widthUnderground : RIBBON.width;
      const data = buildRibbon(parts, {width, thickness: quiet ? RIBBON.thickness * 0.6 : RIBBON.thickness});
      if (!data.indices.length) continue;
      const mat = material({color: quiet ? colors.lineQuiet : line.color || colors.lineQuiet, transparent: true, opacity: quiet ? 0.55 : line.elevation === 'underground' ? 0.5 : line.status === 'construction' ? 0.45 : 0.9});
      const mesh = new THREE.Mesh(geometryFrom(data), mat);
      mesh.castShadow = !quiet && line.elevation === 'elevated';
      mesh.receiveShadow = false;
      mesh.userData = {kind: 'line', id: line.id, lineId: line.id};
      scene.add(mesh);
      state.meshes.lines.push(mesh);
      if (line.elevation === 'elevated' && !quiet && line.status !== 'construction') for (const p of parts) pierTransforms.push(...pierPositions([p]));
    }
    if (pierTransforms.length) {
      const inst = new THREE.InstancedMesh(pierGeometry, pierMaterial, pierTransforms.length);
      const o = new THREE.Object3D();
      pierTransforms.forEach(([x, z, bearing], i) => { o.position.set(x, PIER_SIZE.h / 2, z); o.rotation.set(0, (-bearing * Math.PI) / 180, 0); o.updateMatrix(); inst.setMatrixAt(i, o.matrix); });
      inst.castShadow = true; inst.receiveShadow = false;
      inst.userData = {kind: 'pier', shared: true};
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
    for (const s of state.stations) {
      const [len, wid] = PLATE[s.role] || PLATE.station;
      const elevation = ELEVATION[s.elevation] ?? ELEVATION.surface;
      const y = s.elevation === 'elevated' ? elevation : PLATE.thickness / 2 + 0.2;
      const p = toScene(maplibregl, T, s.lng, s.lat, y);
      const group = new THREE.Group();
      group.position.set(p[0], p[1], p[2]);
      group.rotation.y = (-(s.bearing || 0) * Math.PI) / 180;
      const quiet = s.quiet;
      const mat = material({color: quiet ? colors.plateQuiet : colors.plate, transparent: true, opacity: quiet ? 0.5 : 0.62});
      const plate = new THREE.Mesh(box, mat);
      plate.scale.set(quiet ? len * 0.7 : len, PLATE.thickness, quiet ? wid * 0.7 : wid);
      plate.castShadow = !quiet; plate.receiveShadow = true;
      plate.userData = {kind: 'station', id: s.id, stationId: s.id, base: {color: mat.color.getHex(), opacity: mat.opacity}};
      group.add(plate);
      // Colour stripes along the roof edge: one per line serving the station (identity cue, not a metric).
      const stripes = (s.colors || []).slice(0, 4);
      stripes.forEach((hex, i) => {
        const sm = material({color: hex, transparent: true, opacity: quiet ? 0.7 : 1});
        const stripe = new THREE.Mesh(box, sm);
        const offset = (i - (stripes.length - 1) / 2) * (PLATE.stripe + 0.6);
        stripe.scale.set((quiet ? len * 0.7 : len) * 0.96, 0.6, PLATE.stripe);
        stripe.position.set(0, PLATE.thickness / 2 + 0.3, offset);
        stripe.userData = {kind: 'stripe', shared: false};
        group.add(stripe);
      });
      // Elevated plates stand on four piers.
      if (s.elevation === 'elevated' && !quiet) {
        const pm = material({color: colors.pier, transparent: true, opacity: 0.9});
        for (const [dx, dz] of [[-0.42, -0.3], [0.42, -0.3], [-0.42, 0.3], [0.42, 0.3]]) {
          const pier = new THREE.Mesh(box, pm);
          pier.scale.set(PIER_SIZE.w, elevation - PLATE.thickness / 2, PIER_SIZE.w);
          pier.position.set(dx * len, -(elevation - PLATE.thickness / 2) / 2 - PLATE.thickness / 2, dz * wid);
          pier.castShadow = true;
          pier.userData = {kind: 'pier', shared: true};
          group.add(pier);
        }
      }
      group.userData = {kind: 'station', id: s.id, stationId: s.id, plate};
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
      const rings = ringsOf(f).map(ring => ring.map(([lng, lat]) => { const p = toScene(maplibregl, T, lng, lat, 0); return [p[0], p[2]]; }));
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
    refreshPickables();
    if (renderer) renderer.shadowMap.needsUpdate = true;
    map.triggerRepaint();
  }

  function rebuildAll() { rebuildLines(); rebuildStations(); rebuildBuildings(); }

  function refreshPickables() {
    state.pickables = [...state.meshes.stations.map(g => g.userData.plate), ...state.meshes.buildings, ...state.meshes.lines.filter(m => !state.lines.find(l => l.id === m.userData.id)?.quiet)];
  }

  /** Hover/selected treatment: colour and opacity only, never geometry — the pulse is in animateHover(). */
  function applyStates() {
    for (const g of state.meshes.stations) {
      const plate = g.userData.plate, base = plate.userData.base;
      if (g.userData.id === state.selectedId) { plate.material.color.set(colors.selected); plate.material.opacity = 0.9; }
      else if (g.userData.id === state.hoverId) { plate.material.color.set(colors.hover); plate.material.opacity = 0.78; }
      else { plate.material.color.setHex(base.color); plate.material.opacity = base.opacity; }
    }
    for (const b of state.meshes.buildings) {
      const base = b.userData.base;
      if (b.userData.stationId && b.userData.stationId === state.selectedId) { b.material.color.set(colors.selected); b.material.opacity = 0.55; }
      else if (b.userData.id === state.hoverId) { b.material.color.set(colors.hover); b.material.opacity = 0.7; }
      else { b.material.color.setHex(base.color); b.material.opacity = base.opacity; }
    }
    map.triggerRepaint();
  }

  /* ---------- picking ---------- */
  function hitsAt(point) {
    if (!frameMatrix || !raycaster || !state.pickables.length) return [];
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
      const key = `${u.kind}:${u.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
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
    map.getCanvas().style.cursor = top ? 'pointer' : map.getCanvas().style.cursor === 'pointer' ? '' : map.getCanvas().style.cursor;
    if (id !== state.hoverId) { state.hoverId = id; t0 = 0; applyStates(); onHover?.(top); }
  };
  const onClick = e => {
    if (!state.enabled || state.failed || e.originalEvent?.__citymeterSceneHandled) return;
    const hits = hitsAt([e.point.x, e.point.y]);
    if (!hits.length) { state.cycle = {ids: [], cycle: 0}; onCycle?.({objects: [], cycle: 0}); return; }
    e.originalEvent.__citymeterSceneHandled = true;
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
    setSelected(id) { state.selectedId = id || ''; applyStates(); },
    setHover(id) { state.hoverId = id || ''; t0 = 0; applyStates(); },
    setEnabled(on) { state.enabled = Boolean(on); if (scene) scene.visible = state.enabled; map.triggerRepaint(); },
    setPalette(next) { Object.assign(colors, next); if (ground) ground.material.opacity = colors.shadowOpacity; rebuildAll(); },
    hitTest: hitsAt,
    get hits() { return lastHits.slice(); },
    get failed() { return state.failed; },
    get counts() { return {lines: state.meshes.lines.length, stations: state.meshes.stations.length, buildings: state.meshes.buildings.length, piers: state.meshes.piers.reduce((n, m) => n + m.count, 0)}; },
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
