/**
 * Guard for a MapLibre GL JS 5.6.2 tile-cover bug (Fitness 0.2.1, found on the live site 2026-10-29).
 *
 * SourceCache._updateRetainedTiles checks whether a missing ideal tile is covered by its four children
 * (`children[0..3].key`) whenever the cover zoom + 1 ≤ the source maxzoom. Under a pitched camera the near
 * tiles of the cover sit above the camera zoom, so with the camera between maxzoom − 1 and maxzoom an ideal
 * tile can already be at the source maxzoom, where OverscaledTileID.children() returns ONE overscaled child.
 * When that child is retained (it was loaded at a higher zoom just before), children[1] is undefined and the
 * frame throws “Cannot read properties of undefined (reading 'key')”. Seen live on the OpenFreeMap vector
 * source (maxzoom 14) when the building camera (pitch 75°) flies from one building to another and zooms out
 * through 13–14; CityMETER · Shopping centers met the same throw on GeoJSON sources at their default maxzoom 18
 * (js/map-layers.js#GEOJSON_MAXZOOM). A user zooming out of a building view meets it too.
 *
 * The guard pads the child list of exactly those ideal tiles to four copies of the one overscaled child, so the
 * check reads as MapLibre's own overzoom branch does (covered when that child is retained, otherwise ascend to
 * the parents). Nothing else changes. It applies to the pinned 5.6.2 only: re-check before upgrading MapLibre.
 *
 * Part of the shared CityMETER demo shell: edit it in every repository at once (js/shell/manifest.json).
 */
export const GUARDED_VERSION = '5.6.2';

/** Wrap `children` of the ideal tiles the 5.6.2 check reads wrongly; returns how many it wrapped. */
export function padOverscaledChildren(idealTileIDs, zoom, maxzoom) {
  if (!Number.isFinite(maxzoom) || !(zoom + 1 <= maxzoom)) return 0;
  let n = 0;
  for (const id of idealTileIDs) {
    if (!(id?.overscaledZ >= maxzoom) || Object.prototype.hasOwnProperty.call(id, 'children')) continue;
    const base = Object.getPrototypeOf(id).children;
    if (typeof base !== 'function') continue;
    Object.defineProperty(id, 'children', {
      configurable: true, writable: true,
      value(sourceMaxZoom) { const c = base.call(this, sourceMaxZoom); return c.length === 1 ? [c[0], c[0], c[0], c[0]] : c; },
    });
    n++;
  }
  return n;
}

/**
 * Install the guard on the SourceCache prototype of `map` (shared by every source, including sources added
 * later). Returns true when it is installed (or already was), false when the version or the internals differ.
 */
export function guardRetainedTiles(map, version) {
  if (version !== GUARDED_VERSION) return false;
  const caches = map?.style?.sourceCaches;
  const first = caches && Object.values(caches)[0];
  const proto = first && Object.getPrototypeOf(first);
  if (!proto || typeof proto._updateRetainedTiles !== 'function') return false;
  if (proto.__citymeterRetainGuard) return true;
  const original = proto._updateRetainedTiles;
  proto._updateRetainedTiles = function guardedUpdateRetainedTiles(idealTileIDs, zoom) {
    padOverscaledChildren(idealTileIDs || [], zoom, this._source?.maxzoom);
    return original.call(this, idealTileIDs, zoom);
  };
  Object.defineProperty(proto, '__citymeterRetainGuard', {value: true});
  return true;
}

/**
 * Guard 2 (Hotel 0.3.2, found 2026-11-02 on a hillside resort): an easeTo/flyTo on terrain without `freezeElevation`
 * leaves `map._elevationFreeze` set — only `_finalizeElevation` (eases with `freezeElevation`) and the gesture handler
 * clear it — so later frames no longer clamp the centre to the ground: the camera keeps the elevation sampled on the
 * ease's last frame from the DEM tiles loaded then (coarse while finer tiles stream in). Seen 18 m off at Sri Panwa,
 * which put the framed building under the legend. When a programmatic ease ends (not a gesture's own move), the
 * guard clears the freeze and lands the centre on the ground under it before `moveend`, as the render loop of a still
 * map does; centre and zoom stay. Pinned 5.6.2 only.
 */
export function landAfterEase(map) {
  if (!map?.terrain || !map._elevationFreeze || map.handlers?._terrainMovement) return false;
  map._elevationFreeze = false;
  if (typeof map.getCenterClampedToGround === 'function' && !map.getCenterClampedToGround()) return true;
  const tr = map.transform, e = map.terrain.getElevationForLngLatZoom?.(tr.center, tr.tileZoom);
  if (Number.isFinite(e) && typeof tr.setElevation === 'function') tr.setElevation(e);
  map.triggerRepaint?.();
  return true;
}

/** Install guard 2 on this map (its `_afterEase`); true when installed (or already), false for another version. */
export function guardElevationFreeze(map, version) {
  if (version !== GUARDED_VERSION || typeof map?._afterEase !== 'function') return false;
  if (map.__citymeterLandGuard) return true;
  const original = map._afterEase;
  map._afterEase = function guardedAfterEase(eventData, easeId) {
    // An ease stopped to start another with the same id fires nothing (MapLibre returns early): leave it to that one.
    if (!(this._easeId && easeId && this._easeId === easeId)) landAfterEase(this);
    return original.call(this, eventData, easeId);
  };
  Object.defineProperty(map, '__citymeterLandGuard', {value: true});
  return true;
}

/**
 * What the map may hold on this device (shell 0.6.0; owner 2026-11-11 20:38 on a phone: “เวบโหลดไม่สำเร็จดับบ่อยมาก …
 * อาคาร 3d ไม่แสดงเลย”). Measured on the live Hotel page the same day in a 393 px wide frame: opening อำเภอกะทู้ shaped
 * 18,209 focus buildings (the page's memory 87 → 266 MB) and the terrain kept up to 30 textures of 1024 × 1024 with a
 * depth buffer each, all drawn at the screen's own pixel ratio (3 on a phone). A phone ends a page that asks for
 * that much, so three levels:
 *   full      — a desktop: as before.
 *   phone     — a touch-first device, or one that reports ≤ 4 GB: the canvas at ≤ 2 × , the focus buildings within
 *               `radiusM` of the camera from zoom `focusZoom` (≤ `tiles` tiles), a terrain pool of `terrainPool`.
 *   recovered — after the page was ended or the map lost its context (js/shell/launch.js, html[data-lean]): the
 *               canvas at ≤ 1.5 × , a smaller radius, and no 3D ground.
 * `phone` and `recovered` can be asked for with ?lean=phone and ?lean=1.
 */
export const MAP_BUDGETS = Object.freeze({
  full: Object.freeze({level: 'full', pixelRatio: null, tiles: 16, cmRequests: 40, radiusM: 0, focusZoom: 0, terrain: true, terrainPool: 30, cacheZoomLevels: 5}),
  phone: Object.freeze({level: 'phone', pixelRatio: 2, tiles: 4, cmRequests: 12, radiusM: 900, focusZoom: 14, terrain: true, terrainPool: 12, cacheZoomLevels: 2}),
  recovered: Object.freeze({level: 'recovered', pixelRatio: 1.5, tiles: 4, cmRequests: 8, radiusM: 500, focusZoom: 15, terrain: false, terrainPool: 8, cacheZoomLevels: 1}),
});
export function mapBudget(win = typeof window === 'undefined' ? null : window) {
  if (!win) return MAP_BUDGETS.full;
  const asked = win.document?.documentElement?.dataset?.lean || '';
  if (asked === 'recovered') return MAP_BUDGETS.recovered;
  if (asked === 'phone') return MAP_BUDGETS.phone;
  let coarse = false;
  try { coarse = win.matchMedia('(pointer: coarse)').matches && !win.matchMedia('(any-pointer: fine)').matches; } catch { /* no media queries */ }
  const memory = Number(win.navigator?.deviceMemory);
  return coarse || (memory > 0 && memory <= 4) ? MAP_BUDGETS.phone : MAP_BUDGETS.full;
}
/** The pixel ratio to give `new maplibregl.Map` under a budget: the screen's own, capped (undefined = MapLibre's default). */
export function budgetPixelRatio(budget, win = typeof window === 'undefined' ? null : window) {
  const own = Number(win?.devicePixelRatio) || 1;
  return budget?.pixelRatio ? Math.min(own, budget.pixelRatio) : undefined;
}

/**
 * Cap the terrain's render-to-texture pool (MapLibre 5.6.2: `painter.renderToTexture.pool`, 30 framebuffers of
 * tileSize × qualityFactor = 1024 px with a depth buffer, about 8 MB each). MapLibre draws and frees the pool whenever
 * it is full (RenderToTexture#renderLayer), so a smaller pool costs redraws, never a wrong frame. Call right after
 * map.setTerrain(…), before a frame: only a pool that holds nothing yet is changed. True when capped.
 */
export function capTerrainPool(map, size, version = GUARDED_VERSION) {
  if (version !== GUARDED_VERSION || !(size > 0)) return false;
  const pool = map?.painter?.renderToTexture?.pool;
  if (!pool || !Number.isInteger(pool._size) || !Array.isArray(pool._objects) || pool._objects.length || typeof pool.isFull !== 'function') return false;
  if (size >= pool._size) return false;
  pool._size = Math.max(4, Math.floor(size));
  return true;
}

/**
 * A lost WebGL context (a phone under memory pressure, a tab back from the background): MapLibre stops drawing and,
 * when the browser restores the context, builds a new painter — but the tiles, images and custom layers of the old
 * context are gone, so the map stays empty or wrong. `onLost()` is called once, shortly after the loss (so the browser
 * has let go of the old context), and the app starts a new map in the same place. Returns a function that stops
 * watching.
 */
export function watchContext(map, onLost, {delay = 400} = {}) {
  if (typeof map?.on !== 'function' || typeof onLost !== 'function') return () => {};
  let timer = 0, done = false;
  const lost = () => { if (done) return; done = true; timer = setTimeout(onLost, delay); };
  map.on('webglcontextlost', lost);
  return () => { done = true; clearTimeout(timer); try { map.off('webglcontextlost', lost); } catch { /* map already removed */ } };
}

/**
 * For a demo without a restart of its own: after a lost context the page says so to the launch script (which turns
 * the tab lean) and reloads once — the address keeps the place and the filters, and the page comes back with the
 * lighter budget. A loss in a tab that is already lean reloads nothing (no loop); the launch script keeps the event.
 */
export function reloadOnContextLoss(map, win = typeof window === 'undefined' ? null : window) {
  if (!win) return () => {};
  return watchContext(map, () => {
    const again = win.document?.documentElement?.dataset?.lean === 'recovered';
    try { win.dispatchEvent(new win.CustomEvent('citymeter:map-trouble', {detail: {kind: 'context-lost', note: again ? 'again' : 'reload'}})); } catch { /* no events */ }
    if (!again) win.location.reload();
  });
}
