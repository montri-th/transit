import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildRibbon, pierPositions, buildExtrusion, cycleHits, sceneTransform, toScene, sceneBearing, ELEVATION, PLATE} from '../js/scene.js';

/** Minimal MercatorCoordinate stand-in with MapLibre's formulas. */
const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6378137;
const fakeMaplibre = {
  MercatorCoordinate: {
    fromLngLat([lng, lat], alt = 0) {
      const x = (180 + lng) / 360;
      const y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
      const circumference = EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180);
      return {x, y, z: alt / circumference, meterInMercatorCoordinateUnits: () => 1 / circumference};
    },
  },
};

test('scene coordinates: east is +x, north is -z, metres scale', () => {
  const t = sceneTransform(fakeMaplibre);
  const origin = toScene(fakeMaplibre, t, 100.5231, 13.7367, 0);
  assert.ok(Math.abs(origin[0]) < 1e-6 && Math.abs(origin[2]) < 1e-6);
  const east = toScene(fakeMaplibre, t, 100.5331, 13.7367, 5);
  assert.ok(east[0] > 1000 && east[0] < 1200, `1 km east ≈ ${east[0]}`);
  assert.equal(east[1], 5);
  const north = toScene(fakeMaplibre, t, 100.5231, 13.7467, 0);
  assert.ok(north[2] < -1000 && north[2] > -1200, `north is negative z: ${north[2]}`);
  assert.ok(Math.abs(sceneBearing(origin, north)) < 0.5);
  assert.ok(Math.abs(sceneBearing(origin, east) - 90) < 0.5);
});

test('ribbon: a straight two-point part gives a closed slab with 6 faces', () => {
  const r = buildRibbon([[[0, 12, 0], [100, 12, 0]]], {width: 8, thickness: 2});
  // 2 verts × 2 points for top and bottom + 2 × 2 for each wall + 4 + 4 for caps = 24 vertices
  assert.equal(r.positions.length / 3, 24);
  assert.equal(r.indices.length / 3, 2 + 2 + 2 + 2 + 2 + 2);
  const ys = new Set(Array.from(r.positions).filter((_, i) => i % 3 === 1).map(v => Math.round(v * 100) / 100));
  assert.deepEqual([...ys].sort((a, b) => a - b), [11, 13]);
  const zs = Array.from(r.positions).filter((_, i) => i % 3 === 2);
  assert.ok(Math.max(...zs) - Math.min(...zs) === 8, 'width is honoured');
  // normals are unit length
  for (let i = 0; i < r.normals.length; i += 3) assert.ok(Math.abs(Math.hypot(r.normals[i], r.normals[i + 1], r.normals[i + 2]) - 1) < 1e-6);
});

test('ribbon: a right-angle turn is mitred without exploding', () => {
  const r = buildRibbon([[[0, 0, 0], [100, 0, 0], [100, 0, 100]]], {width: 6, thickness: 1});
  const xs = Array.from(r.positions).filter((_, i) => i % 3 === 0);
  assert.ok(Math.max(...xs) <= 100 + 6, 'mitre is clamped to twice the half width');
  assert.ok(r.indices.every(i => i < r.positions.length / 3));
});

test('ribbon: degenerate and duplicate points are skipped', () => {
  assert.equal(buildRibbon([[[0, 0, 0]]]).indices.length, 0);
  const r = buildRibbon([[[0, 0, 0], [0, 0, 0], [50, 0, 0]]]);
  assert.equal(r.positions.length / 3, 24);
});

test('piers every spacing metres, first at half spacing, with the segment bearing', () => {
  const piers = pierPositions([[[0, 12, 0], [0, 12, -100]]], 36);
  assert.deepEqual(piers.map(p => [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])]), [[0, -18, 0], [0, -54, 0], [0, -90, 0]]);
  assert.equal(pierPositions([[[0, 0, 0], [10, 0, 0]]], 36).length, 0);
});

test('extrusion: a square footprint gives a roof and four walls', () => {
  const e = buildExtrusion([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]], {height: 20, base: 0});
  assert.equal(e.positions.length / 3, 4 + 16);
  assert.equal(e.indices.length / 3, 2 + 8);
  const ys = Array.from(e.positions).filter((_, i) => i % 3 === 1);
  assert.equal(Math.max(...ys), 20);
  assert.equal(Math.min(...ys), 0);
});

test('extrusion: holes are honoured and empty input is safe', () => {
  const e = buildExtrusion([[[0, 0], [30, 0], [30, 30], [0, 30], [0, 0]], [[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]]], {height: 5});
  assert.equal(e.indices.length / 3, 8 + 8 * 2);
  assert.equal(buildExtrusion([]).indices.length, 0);
});

test('raycast cycling: same set cycles, new set resets, empty clears', () => {
  let c = cycleHits({ids: [], cycle: 0}, ['station:a', 'building:b']);
  assert.deepEqual(c, {ids: ['station:a', 'building:b'], cycle: 0});
  c = cycleHits(c, ['station:a', 'building:b']);
  assert.equal(c.cycle, 1);
  c = cycleHits(c, ['station:a', 'building:b']);
  assert.equal(c.cycle, 0);
  c = cycleHits(c, ['line:x']);
  assert.deepEqual(c, {ids: ['line:x'], cycle: 0});
  assert.deepEqual(cycleHits(c, []), {ids: [], cycle: 0});
});

test('display constants are declared, not metrics', () => {
  assert.equal(ELEVATION.elevated, 12);
  assert.ok(PLATE.hub[0] > PLATE.station[0] && PLATE.station[0] > PLATE.stop[0]);
});
