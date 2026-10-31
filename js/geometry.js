/**
 * Small planar geometry kit for display-only massing shapes.
 *
 * Everything here works on rings of [x, y] in one planar unit (tile units or
 * metres). Nothing is reprojected or claimed as a measurement: the outputs are
 * used to draw a rounded, slightly enlarged "model" of a building that fully
 * encloses the original footprint, so the original rendered by the basemap
 * can sit inside it without seams or z-fighting.
 *
 * Exports: signedArea, isClockwise, clipRingToBox, offsetRing, roundRing,
 * pointInRing, ringsIntersect, ringBBox.
 */

export function signedArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
}
/** MVT uses a y-down axis, so "clockwise on screen" has positive signed area there. */
export const isClockwise = ring => signedArea(ring) > 0;

export function ringBBox(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return {minX, minY, maxX, maxY};
}

/** Remove consecutive duplicate points and ensure the ring is closed. */
export function cleanRing(ring, epsilon = 1e-9) {
  const out = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > epsilon || Math.abs(q[1] - p[1]) > epsilon) out.push([p[0], p[1]]);
  }
  if (out.length > 1) {
    const f = out[0], l = out[out.length - 1];
    if (Math.abs(f[0] - l[0]) <= epsilon && Math.abs(f[1] - l[1]) <= epsilon) out.pop();
  }
  if (out.length < 3) return null;
  out.push([out[0][0], out[0][1]]);
  return out;
}

/**
 * Sutherland–Hodgman clip of a closed ring against an axis-aligned box.
 * Used to cut tile buffers away so neighbouring tiles meet exactly.
 */
export function clipRingToBox(ring, {minX, minY, maxX, maxY}) {
  const edges = [
    [p => p[0] >= minX, (a, b) => [minX, a[1] + ((b[1] - a[1]) * (minX - a[0])) / (b[0] - a[0])]],
    [p => p[0] <= maxX, (a, b) => [maxX, a[1] + ((b[1] - a[1]) * (maxX - a[0])) / (b[0] - a[0])]],
    [p => p[1] >= minY, (a, b) => [a[0] + ((b[0] - a[0]) * (minY - a[1])) / (b[1] - a[1]), minY]],
    [p => p[1] <= maxY, (a, b) => [a[0] + ((b[0] - a[0]) * (maxY - a[1])) / (b[1] - a[1]), maxY]],
  ];
  let input = ring.slice(0, -1);
  for (const [inside, intersect] of edges) {
    if (!input.length) return null;
    const output = [];
    for (let i = 0; i < input.length; i++) {
      const current = input[i], previous = input[(i + input.length - 1) % input.length];
      const cin = inside(current), pin = inside(previous);
      if (cin) { if (!pin) output.push(intersect(previous, current)); output.push(current); }
      else if (pin) output.push(intersect(previous, current));
    }
    input = output;
  }
  return cleanRing([...input, input[0] || [0, 0]]);
}

function segmentIntersection(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
}

/**
 * Offset a closed ring outward by `d` (mitered; long miters are bevelled).
 * `outwardSign` = +1 when the ring's outward normal is (dy, -dx) for the
 * walking direction, −1 otherwise; pass isClockwise(ring) ? 1 : -1 in a y-down
 * frame for outer rings, and the opposite for holes (which must shrink).
 */
export function offsetRing(ring, d, outwardSign = 1, miterLimit = 2.5) {
  const pts = ring.slice(0, -1), n = pts.length;
  if (n < 3 || d === 0) return ring.map(p => [p[0], p[1]]);
  const normals = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    normals.push([(outwardSign * dy) / len, (-outwardSign * dx) / len]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const nPrev = normals[(i + n - 1) % n], nNext = normals[i];
    const p = pts[i];
    const a1 = [pts[(i + n - 1) % n][0] + nPrev[0] * d, pts[(i + n - 1) % n][1] + nPrev[1] * d];
    const a2 = [p[0] + nPrev[0] * d, p[1] + nPrev[1] * d];
    const b1 = [p[0] + nNext[0] * d, p[1] + nNext[1] * d];
    const b2 = [pts[(i + 1) % n][0] + nNext[0] * d, pts[(i + 1) % n][1] + nNext[1] * d];
    const x = segmentIntersection(a1, a2, b1, b2);
    if (x && Math.hypot(x[0] - p[0], x[1] - p[1]) <= miterLimit * d) out.push(x);
    else { out.push(a2); out.push(b1); } // bevel for sharp spikes or parallel edges
  }
  return cleanRing([...out, out[0]]) || ring.map(p => [p[0], p[1]]);
}

/**
 * Round every corner of a closed ring with a circular fillet of radius ≤ r.
 * The fillet at a vertex is limited to a third of its shorter adjacent edge, so
 * small or narrow shapes keep their silhouette. `segments` arc points per 90°.
 */
export function roundRing(ring, r, segments = 3, {encloseOffset = 0} = {}) {
  const pts = ring.slice(0, -1), n = pts.length;
  if (n < 3 || r <= 0) return ring.map(p => [p[0], p[1]]);
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i + n - 1) % n], v = pts[i], next = pts[(i + 1) % n];
    const ux = prev[0] - v[0], uy = prev[1] - v[1], wx = next[0] - v[0], wy = next[1] - v[1];
    const lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy);
    if (lu < 1e-9 || lw < 1e-9) { out.push([v[0], v[1]]); continue; }
    const cos = Math.max(-1, Math.min(1, (ux * wx + uy * wy) / (lu * lw)));
    const theta = Math.acos(cos); // angle between the two edges at v (0…π)
    if (theta < 0.05 || Math.PI - theta < 0.02) { out.push([v[0], v[1]]); continue; } // spike or straight
    let radius = Math.min(r, (Math.min(lu, lw) / 3) * Math.tan(theta / 2));
    // A fillet cuts r·(1/sin(θ/2) − 1) off a corner; keep that inside the outward
    // offset so a ring offset by `encloseOffset` still contains the original.
    if (encloseOffset > 0) radius = Math.min(radius, (0.95 * encloseOffset) / (1 - Math.sin(theta / 2)));
    const t = radius / Math.tan(theta / 2);
    if (!(t > 0) || !(radius > 0)) { out.push([v[0], v[1]]); continue; }
    const p1 = [v[0] + (ux / lu) * t, v[1] + (uy / lu) * t];
    const p2 = [v[0] + (wx / lw) * t, v[1] + (wy / lw) * t];
    const bx = ux / lu + wx / lw, by = uy / lu + wy / lw, bl = Math.hypot(bx, by) || 1;
    const c = [v[0] + (bx / bl) * (radius / Math.sin(theta / 2)), v[1] + (by / bl) * (radius / Math.sin(theta / 2))];
    const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]), a2 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
    let sweep = a2 - a1;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    const steps = Math.max(1, Math.round((Math.abs(sweep) / (Math.PI / 2)) * segments));
    for (let k = 0; k <= steps; k++) {
      const a = a1 + (sweep * k) / steps;
      out.push([c[0] + Math.cos(a) * radius, c[1] + Math.sin(a) * radius]);
    }
  }
  return cleanRing([...out, out[0]]) || ring.map(p => [p[0], p[1]]);
}

export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** True when two closed rings overlap: containment either way or any crossing edges. */
export function ringsIntersect(a, b) {
  const ba = ringBBox(a), bb = ringBBox(b);
  if (ba.maxX < bb.minX || bb.maxX < ba.minX || ba.maxY < bb.minY || bb.maxY < ba.minY) return false;
  if (pointInRing(a[0], b) || pointInRing(b[0], a)) return true;
  for (let i = 0; i < a.length - 1; i++) for (let j = 0; j < b.length - 1; j++) if (segmentsCross(a[i], a[i + 1], b[j], b[j + 1])) return true;
  return false;
}
