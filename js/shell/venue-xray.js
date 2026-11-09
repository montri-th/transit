/**
 * Venue x-ray — the building being looked at is drawn on top of everything else
 * in the 3D pass, so it stays visible whatever stands between it and the camera,
 * at any pan, pitch or zoom (shared with CityMETER · Luxury Brands, Shopping
 * centers, Restaurants, Fitness and the Hotel-family demos). There the solid is the focus-tier building of
 * the open building or item (js/app.js#focusTarget, js/massing.js#featuresOf),
 * owner instruction 2026-10-29: “อย่าให้ 3d building mass ตึกอื่นบังอาคารที่กำลังดูอยู่”.
 *
 * Why a custom layer: MapLibre fill-extrusion layers always depth-test against
 * each other, and translucent ones still write depth (draw_fill_extrusion.ts
 * draws translucent extrusions in two passes, depth first), so a style layer
 * drawn after a building that is 84 % transparent is still cut away where that
 * building is nearer. This is the "see-through selection" of 3D viewers —
 * three.js highlights with depthTest = false, Cesium's disableDepthTestDistance —
 * built on MapLibre's CustomLayerInterface (renderingMode '3d'):
 *   1. clear the depth buffer inside the venue's screen box only (scissored
 *      clear), so nothing drawn before can hide it;
 *   2. redraw the venue solid with its own depth test, so it still occludes
 *      itself correctly (near walls in front of far walls);
 *   3. draw its edges as lines for a crisp silhouette.
 * Vertices are stored relative to a local origin and the 64-bit matrix MapLibre
 * hands to custom layers is combined on the CPU, so building-scale geometry does
 * not jitter in 32-bit shader math (the same approach as MapLibre's three.js
 * example). Clicks on the drawn solid are answered by hitTest() below (MapLibre's
 * own fill-extrusion query does not know what was drawn over it).
 *
 * Colours: map.activeLayer (faces) and map.selectedStroke (edges) from
 * assets/theme.css — the host building is map context, never an analytical scale.
 *
 * Part of the shared CityMETER demo shell: edit it in every repository at once (js/shell/manifest.json).
 */
import earcut from '../vendor/earcut.js';

export const XRAY_LAYER = 'venue-xray';
export const XRAY_MIN_ZOOM = 13;

/* ---------- small 4×4 helpers (column-major, like gl-matrix) ---------- */
export function mat4Multiply(a, b) {
  const out = new Float64Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    out[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
  }
  return out;
}
export function mat4Translation(x, y, z) {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1; m[12] = x; m[13] = y; m[14] = z;
  return m;
}
export function transformPoint(m, [x, y, z]) {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w, w];
}

function hexToRgb(hex, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  const v = parseInt((m ? m[1] : fallback), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function rings(feature) {
  const g = feature?.geometry;
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

/**
 * Build the venue solid: walls, roof (earcut, holes supported) and edge lines
 * from polygon features with display_base_m / display_height_m. `toMercator`
 * maps ([lon, lat], altitudeMetres) → {x, y, z} (MapLibre MercatorCoordinate).
 * Returns positions relative to `origin` (mercator), a per-vertex shade and the
 * origin itself. Shade keeps the 3D reading: roof 1, walls by orientation.
 */
export function buildSolid(features, toMercator, {light = [-0.55, -0.83]} = {}) {
  const tri = [], shade = [], lines = [];
  const world = [];
  let ox = 0, oy = 0, n = 0;
  const polys = [];
  for (const f of features || []) {
    const p = f.properties || {};
    const base = Math.max(0, Number(p.display_base_m) || 0);
    const top = Math.max(base + 0.5, Number(p.display_height_m) || 0);
    for (const poly of rings(f)) {
      const converted = poly.map(ring => ring.map(([lon, lat], i) => {
        const m = toMercator([lon, lat], 0);
        const closing = i === ring.length - 1 && ring.length > 1 && lon === ring[0][0] && lat === ring[0][1];
        if (!closing) { ox += m.x; oy += m.y; n++; }
        return [m.x, m.y];
      }));
      const zb = toMercator(poly[0][0], base).z, zt = toMercator(poly[0][0], top).z;
      polys.push({rings: converted, zb, zt});
    }
  }
  if (!n) return {positions: new Float32Array(0), shades: new Float32Array(0), lines: new Float32Array(0), origin: [0, 0, 0], count: 0, lineCount: 0, world: []};
  ox /= n; oy /= n;
  const push = (x, y, z, s) => { tri.push(x - ox, y - oy, z); shade.push(s); };
  const line = (a, b) => { lines.push(a[0] - ox, a[1] - oy, a[2], b[0] - ox, b[1] - oy, b[2]); };
  for (const {rings: rs, zb, zt} of polys) {
    for (const ring of rs) {
      const pts = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        const nx = dy / len, ny = -dx / len; // outward-ish normal (sign is irrelevant: both faces get the same tone)
        const facing = Math.abs(nx * light[0] + ny * light[1]);
        const s = 0.66 + 0.26 * facing;
        push(a[0], a[1], zb, s); push(b[0], b[1], zb, s); push(b[0], b[1], zt, s);
        push(a[0], a[1], zb, s); push(b[0], b[1], zt, s); push(a[0], a[1], zt, s);
        line([a[0], a[1], zt], [b[0], b[1], zt]);
        line([a[0], a[1], zb], [b[0], b[1], zb]);
        line([a[0], a[1], zb], [a[0], a[1], zt]);
        world.push([a[0], a[1], zb], [a[0], a[1], zt]);
      }
    }
    // Roof: earcut over the outer ring with holes.
    const flat = [], holeIndices = [];
    rs.forEach((ring, idx) => {
      const pts = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
      if (idx > 0) holeIndices.push(flat.length / 2);
      for (const [x, y] of pts) flat.push(x, y);
    });
    const idx = earcut(flat, holeIndices.length ? holeIndices : null, 2);
    for (const i of idx) push(flat[i * 2], flat[i * 2 + 1], zt, 1);
  }
  return {positions: new Float32Array(tri), shades: new Float32Array(shade), lines: new Float32Array(lines), origin: [ox, oy, 0], count: tri.length / 3, lineCount: lines.length / 3, world};
}

/**
 * Device-pixel box of the solid's vertices under `matrix` (mercator → clip),
 * padded; null when nothing projects in front of the camera.
 */
export function screenBoxOf(world, matrix, width, height, pad = 4) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false, behind = false;
  for (const p of world) {
    const [x, y, , w] = transformPoint(matrix, p);
    if (!(w > 0)) { behind = true; continue; }
    const px = (x + 1) / 2 * width, py = (1 - y) / 2 * height;
    minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py); any = true;
  }
  if (!any) return null;
  if (behind) { minX = 0; minY = 0; maxX = width; maxY = height; }
  const eps = 1e-6;
  const x0 = Math.max(0, Math.floor(minX - pad + eps)), y0 = Math.max(0, Math.floor(minY - pad + eps));
  const x1 = Math.min(width, Math.ceil(maxX + pad - eps)), y1 = Math.min(height, Math.ceil(maxY + pad - eps));
  if (x1 <= x0 || y1 <= y0) return null;
  return {x: x0, y: y0, width: x1 - x0, height: y1 - y0};
}

/** Point-in-triangle test of (x, y) device pixels against every triangle of the solid projected with `matrix`. */
export function solidHit(solid, matrix, width, height, x, y) {
  const P = solid.positions;
  const proj = (i) => {
    const [cx, cy, , w] = transformPoint(matrix, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    return w > 0 ? [(cx + 1) / 2 * width, (1 - cy) / 2 * height] : null;
  };
  const sign = (a, b, c) => (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
  for (let t = 0; t < solid.count; t += 3) {
    const a = proj(t), b = proj(t + 1), c = proj(t + 2);
    if (!a || !b || !c) continue;
    const d1 = sign([x, y], a, b), d2 = sign([x, y], b, c), d3 = sign([x, y], c, a);
    const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(neg && pos)) return true;
  }
  return false;
}

const VERTEX = `
attribute vec3 a_pos; attribute float a_shade;
uniform mat4 u_matrix;
varying float v_shade;
void main() { gl_Position = u_matrix * vec4(a_pos, 1.0); v_shade = a_shade; }`;
const FRAGMENT = `
precision mediump float;
uniform vec4 u_color;
varying float v_shade;
void main() { vec3 c = u_color.rgb * v_shade; gl_FragColor = vec4(c * u_color.a, u_color.a); }`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
  return s;
}

/**
 * Install the x-ray layer. `toMercator` defaults to MapLibre's MercatorCoordinate.
 * update(features, {colors}) replaces the solid; setEnabled(false) hides it.
 * The layer draws only in 3D (pitch > 0) and from zoom XRAY_MIN_ZOOM.
 */
export function installVenueXray(map, {beforeId, toMercator = null, colors = {}} = {}) {
  const merc = toMercator || ((lngLat, alt) => globalThis.maplibregl.MercatorCoordinate.fromLngLat(lngLat, alt));
  let solid = buildSolid([], merc), enabled = true, program = null, buffers = null, dirty = true;
  // Last frame's matrix and drawing-buffer size → screen-space hit test (MapLibre's own
  // fill-extrusion query only finds a tall building near its footprint or along the camera ray).
  let lastMatrix = null, lastSize = [0, 0], lastDrawn = false;
  const palette = {fill: '#347DA8', stroke: '#176B82', ...colors};
  let features = [];

  const layer = {
    id: XRAY_LAYER, type: 'custom', renderingMode: '3d',
    onAdd(_map, gl) {
      program = gl.createProgram();
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'program');
      buffers = {pos: gl.createBuffer(), shade: gl.createBuffer(), lines: gl.createBuffer(), lineShade: gl.createBuffer()};
      dirty = true;
    },
    onRemove(_map, gl) {
      if (program) gl.deleteProgram(program);
      for (const b of Object.values(buffers || {})) gl.deleteBuffer(b);
      program = null; buffers = null;
    },
    render(gl, options) {
      if (!enabled || !program || !solid.count || map.getZoom() < XRAY_MIN_ZOOM || map.getPitch() <= 0) return;
      const main = options?.defaultProjectionData?.mainMatrix;
      if (!main) return;
      // Fail safe: a GL error here must never stop MapLibre's frame loop — the style host layer still draws.
      try { draw(gl, main); }
      catch (e) { enabled = false; failed = true; console.warn('Venue x-ray disabled', e); }
    },
  };
  let failed = false;
  function draw(gl, main) {
      if (dirty) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.pos); gl.bufferData(gl.ARRAY_BUFFER, solid.positions, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.shade); gl.bufferData(gl.ARRAY_BUFFER, solid.shades, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.lines); gl.bufferData(gl.ARRAY_BUFFER, solid.lines, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.lineShade); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(solid.lineCount).fill(1), gl.STATIC_DRAW);
        dirty = false;
      }
      // 64-bit on the CPU: main × translate(origin); the shader only sees small offsets.
      const matrix = mat4Multiply(main, mat4Translation(solid.origin[0], solid.origin[1], solid.origin[2]));
      const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
      lastMatrix = matrix; lastSize = [width, height]; lastDrawn = false;
      const box = screenBoxOf(solid.world.map(p => [p[0] - solid.origin[0], p[1] - solid.origin[1], p[2]]), matrix, width, height);
      if (!box) return;
      lastDrawn = true;
      gl.useProgram(program);
      const aPos = gl.getAttribLocation(program, 'a_pos'), aShade = gl.getAttribLocation(program, 'a_shade');
      gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_matrix'), false, Float32Array.from(matrix));
      // 1. Nothing drawn before may hide the venue: clear depth inside its box only.
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(box.x, height - box.y - box.height, box.width, box.height);
      gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.SCISSOR_TEST);
      // 2. The solid, depth-tested against itself only.
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      const fill = hexToRgb(palette.fill, '347DA8'), stroke = hexToRgb(palette.stroke, '176B82');
      gl.uniform4f(gl.getUniformLocation(program, 'u_color'), fill[0], fill[1], fill[2], 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.pos); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.shade); gl.enableVertexAttribArray(aShade); gl.vertexAttribPointer(aShade, 1, gl.FLOAT, false, 0, 0);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 2);
      gl.drawArrays(gl.TRIANGLES, 0, solid.count);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      // 3. Edges.
      gl.uniform4f(gl.getUniformLocation(program, 'u_color'), stroke[0], stroke[1], stroke[2], 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.lines); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.lineShade); gl.vertexAttribPointer(aShade, 1, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, solid.lineCount);
      gl.disableVertexAttribArray(aShade);
  }
  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined;
  map.addLayer(layer, before);

  function update(nextFeatures = [], {colors: next} = {}) {
    if (next) Object.assign(palette, next);
    features = Array.isArray(nextFeatures) ? nextFeatures : [];
    solid = buildSolid(features, merc);
    dirty = true;
    if (typeof map.triggerRepaint === 'function') map.triggerRepaint();
    return {vertices: solid.count, lines: solid.lineCount, features: features.length};
  }
  function setEnabled(on) { enabled = Boolean(on); if (typeof map.triggerRepaint === 'function') map.triggerRepaint(); }
  /**
   * True when a CSS-pixel point of the map container lies on the drawn solid
   * (any wall or roof triangle, projected with the last frame's matrix).
   */
  function hitTest(point) {
    if (!enabled || !lastDrawn || !lastMatrix || !solid.count || !point) return false;
    const container = typeof map.getContainer === 'function' ? map.getContainer() : null;
    const cssW = container?.clientWidth || lastSize[0], cssH = container?.clientHeight || lastSize[1];
    const x = point[0] * lastSize[0] / cssW, y = point[1] * lastSize[1] / cssH;
    return solidHit(solid, lastMatrix, lastSize[0], lastSize[1], x, y);
  }
  function dispose() { if (map.getLayer(XRAY_LAYER)) map.removeLayer(XRAY_LAYER); }
  return {update, setEnabled, hitTest, dispose, layerId: XRAY_LAYER, get count() { return solid.count; }, get enabled() { return enabled; }, get failed() { return failed; }};
}
