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
