/**
 * Which buildings the map draws in each area (owner 2026-11-01, point 3: “ใช้เกณฑ์ 15% … ได้”, “กรุงเทพฯ ใช้เขต
 * เป็นหน่วย … ได้”).
 *
 * data/building-units/index.json (meta, rule, per-province summary) and data/building-units/{PROV}.json
 * (written by the demo's scripts/build-building-units.py or scripts/adapt-building-units.py): one record per อปท.
 * the build lists — in Bangkok one per เขต —
 * with its source: CityMETER Building V4 where its building count is at least 1.15 × the OpenStreetMap count of the
 * same unit, otherwise OpenStreetMap. Only a CityMETER unit carries an outline and the production tile units it is
 * read by (the อปท. itself; in Bangkok its แขวง). Everywhere else the map draws OpenStreetMap, as before.
 *
 * The focus tier (js/massing.js) reads the CityMETER tiles of the units it shows and leaves out the OSM buildings
 * whose interior point falls inside such a unit — except buildings OSM maps in parts (building:part, LOD2), which
 * stay, with the CityMETER buildings standing in their outline left out. Heights of CityMETER buildings are the
 * dataset's model estimates (`height_m`): context, never a claim.
 *
 * A file that fails to load counts as settled: the area stays on OpenStreetMap (never an empty map).
 *
 * Part of the shared CityMETER demo shell: edit it in every repository at once (js/shell/manifest.json).
 */
export const UNITS_BASE = 'data/building-units/';
/** Production building tiles (CORS allows the demo's origin; the browser caches them per the API's headers). */
export const CM_TILE_API = 'https://landometer.com/api/v2/citymeter-v3/building/detailMvt/';
export const CM_VERSION = 'V4';
export const CM_SOURCE_LAYER = 'building-detail';
export const CM_ATTRIBUTION = 'อาคาร: <a href="https://landometer.com/v3/citymeter" target="_blank" rel="noopener">CityMETER Building V4</a>';
const TILE_TYPES = new Set(['MUNICIPALITY', 'SUBDISTRICT']);

/** URL of one CityMETER Building V4 tile, clipped by the production API to one tile unit (อปท. or แขวง). */
export function cmTileUrl({z, x, y}, tileUnit, tileType) {
  if (!tileUnit?.id || !TILE_TYPES.has(tileType)) return '';
  return `${CM_TILE_API}${z}/${x}/${y}?inTileType=${tileType}&inTileId=${encodeURIComponent(tileUnit.id)}&version=${CM_VERSION}`;
}

const isBox = b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[0] <= b[2] && b[1] <= b[3];
const isRing = r => Array.isArray(r) && r.length >= 4 && r.every(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));

/** A province file is used only when every CityMETER unit in it can be drawn (outline, tile units, tile type). */
export function validUnitFile(json) {
  if (!json || typeof json.province !== 'string' || !Array.isArray(json.units)) return false;
  return json.units.every(u => u && typeof u.id === 'string' && ['cm', 'osm'].includes(u.source) && isBox(u.bbox) &&
    (u.source !== 'cm' || (TILE_TYPES.has(u.tileType) && Array.isArray(u.tileUnits) && u.tileUnits.length > 0 &&
      u.tileUnits.every(t => typeof t?.id === 'string' && isBox(t.bbox)) && Array.isArray(u.outline) && u.outline.length > 0 &&
      u.outline.every(p => Array.isArray(p) && p.length > 0 && p.every(isRing)))));
}

/** CityMETER units of a province file as zones: {id, code, name, province, bbox, polygons, tileType, tileUnits}. */
export function zonesOf(json) {
  return (json?.units || []).filter(u => u.source === 'cm' && u.outline?.length).map(u => Object.freeze({
    id: u.id, code: u.code, name: u.name, province: json.province, bbox: u.bbox, polygons: u.outline, tileType: u.tileType, tileUnits: u.tileUnits,
  }));
}

const boxesMeet = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
function ringBox(ring) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n];
}

/** Zones whose box meets any of the lon/lat rings (the focus regions). */
export function zonesFor(zones, regions = []) {
  const boxes = regions.filter(r => Array.isArray(r) && r.length).map(ringBox);
  return boxes.length ? zones.filter(z => boxes.some(b => boxesMeet(z.bbox, b))) : [];
}

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** The zone a lon/lat point falls in (outer ring in, holes out), or null. */
export function zoneAt(zones, point) {
  const [x, y] = point;
  for (const z of zones) {
    const [w, s, e, n] = z.bbox;
    if (x < w || x > e || y < s || y > n) continue;
    if (z.polygons.some(p => inRing(point, p[0]) && !p.slice(1).some(h => inRing(point, h)))) return z;
  }
  return null;
}

/**
 * Lazy per-province store, the pattern of js/frames.js. The national index (index.json) is read first: it names the
 * provinces that have a unit file, so no other file is requested. `settled(code)` is true once nothing more will
 * change for that province (file loaded or failed, or none in the index); without the index every province stays on
 * OpenStreetMap. A failure is reported once.
 */
export function createBuildingUnitStore({base = UNITS_BASE, fetchJSON, version = '', onLoad = () => {}, onError = () => {}, concurrency = 2} = {}) {
  const loaded = new Map(), failed = new Set(), pending = new Map(), queue = [];
  let active = 0, zones = [], index = null, indexFailed = false, indexTask = null;
  const q = version ? `?v=${version}` : '';

  function pump() {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      active++;
      fetchJSON(`${base}${job.code}.json${q}`, {timeout: 45000})
        .then(json => {
          if (!validUnitFile(json) || json.province !== job.code) { const e = new Error('Invalid building-unit file'); e.resource = job.code; throw e; }
          loaded.set(job.code, json);
          zones = [...zones, ...zonesOf(json)];
          job.resolve(json);
          onLoad(job.code, json);
        })
        .catch(error => { failed.add(job.code); job.resolve(null); onError(job.code, error); })
        .finally(() => { active--; pump(); });
    }
  }

  /** The national index (meta + one summary row per province with units); null when unavailable. */
  function loadIndex() {
    indexTask ||= fetchJSON(`${base}index.json${q}`, {timeout: 45000})
      .then(json => {
        if (!json || !Array.isArray(json.provinces)) throw new Error('Invalid building-unit index');
        index = json;
        return index;
      })
      .catch(error => { indexFailed = true; onError('index', error); return null; });
    return indexTask;
  }
  const hasFile = code => Boolean(index?.provinces.some(p => p.province === code && p.cm > 0));

  /** Load one province's units (idempotent). Resolves with the file, or null (no CityMETER unit there, failed). */
  function ensure(code) {
    if (!code) return Promise.resolve(null);
    if (loaded.has(code)) return Promise.resolve(loaded.get(code));
    if (pending.has(code)) return pending.get(code);
    const promise = loadIndex().then(() => {
      if (loaded.has(code)) return loaded.get(code);
      if (!hasFile(code) || failed.has(code)) return null;
      return new Promise(resolve => { queue.push({code, resolve}); pump(); });
    });
    pending.set(code, promise);
    promise.finally(() => pending.delete(code));
    return promise;
  }

  return {
    loadIndex,
    ensure,
    ensureMany: codes => Promise.all([...new Set(codes)].filter(Boolean).map(ensure)),
    /** Nothing more will change what is drawn for this province (loaded, failed, no CityMETER unit, no index). */
    settled: code => !code || indexFailed || loaded.has(code) || failed.has(code) || Boolean(index && !hasFile(code)),
    zones: () => zones,
    zonesFor: regions => zonesFor(zones, regions),
    zoneAt: point => zoneAt(zones, point),
    unitsOf: code => loaded.get(code)?.units || [],
    index: () => index,
    loadedCodes: () => [...loaded.keys()],
  };
}
