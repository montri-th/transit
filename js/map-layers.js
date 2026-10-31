/**
 * 2D MapLibre layers of the transit map.
 *
 *  - Rail lines (data/rail-lines.geojson): the plan-view and low-zoom form of
 *    the alignments. In 3D the three.js ribbons (js/scene.js) carry the lines
 *    from RIBBON_MIN_ZOOM; these 2D lines fade out above it, so there is always
 *    exactly one readable form of every line. Colour = the line's identity colour
 *    (the colour in its own name, with source); construction is dashed and
 *    lighter; lines outside the focus go quiet grey.
 *  - Optional context layers of the other modes (bus, boat, conventional rail
 *    stops, intercity bus terminals, motorcycle-taxi stands, airports): lazy,
 *    default off, quiet map-role tokens and a distinct shape per mode, never a
 *    categorical palette, so rail stays the subject.
 *  - Area labels (province chips) — generic HTML label host carried over from
 *    Luxury Brands, collision-managed against the map chrome.
 */
import {contrastRatio} from './scene.js';

export const RIBBON_MIN_ZOOM = 10;
const RAIL_SOURCE = 'rail-lines';
export const RAIL_LAYERS = Object.freeze({casing: 'rail-casing', line: 'rail-line', construction: 'rail-construction', selected: 'rail-selected', hit: 'rail-hit'});
const BUS_SOURCE = 'bus-routes', BUS_STOPS = 'bus-stops', BOAT_SOURCE = 'boat-routes';
export const OPTIONAL_LAYERS = Object.freeze({bus: 'bus-route-line', busStops: 'bus-stop-circle', boat: 'boat-route-line', boatStops: 'boat-stop-circle'});

function cssVar(name, fallback) {
  const value = typeof getComputedStyle === 'function' && typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '';
  return value || fallback;
}

/** First basemap line layer id, so data fills stay under roads and labels. */
export function firstLineLayerId(map) {
  const layers = map.getStyle()?.layers || [];
  return (layers.find(l => l.type === 'line') || layers.find(l => l.type === 'symbol'))?.id;
}

export function featureBounds(feature, LngLatBounds) {
  const b = new LngLatBounds();
  const walk = v => { if (typeof v[0] === 'number') b.extend(v); else v.forEach(walk); };
  walk(feature.geometry.coordinates);
  return b;
}

/**
 * Rail alignments. `geojson` features carry properties {lineId, color, status,
 * elevation}. update() sets per-feature focus/quiet/selected flags.
 */
export function installRailLines(map, geojson, {beforeId, onSelect, onHover} = {}) {
  map.addSource(RAIL_SOURCE, {type: 'geojson', data: {type: 'FeatureCollection', features: []}, promoteId: 'fid'});
  const quiet = () => cssVar('--scene-line-quiet', '#B4BDB7');
  const halo = () => cssVar('--map-marker-halo', '#FFFFFF');
  // Casing: the halo, or a neutral backing for an identity colour too close to the ground (navy on the dark
  // theme, yellow on the light one) — legibility by outline, never by changing the colour (LDS).
  const casing = () => ['case', ['==', ['get', 'backed'], 1], cssVar('--border-emphasis', '#7D877F'), halo()];
  // In 3D the ribbons take over from RIBBON_MIN_ZOOM; `mode3d` is a layout-level switch applied by setMode().
  const fade = mode3d => mode3d ? ['interpolate', ['linear'], ['zoom'], RIBBON_MIN_ZOOM - 0.6, 1, RIBBON_MIN_ZOOM + 0.4, 0] : 1;
  // Zoom must be the top-level input of a paint expression, so every derived width is its own interpolate.
  const widthAt = (k = 1, add = 0) => ['interpolate', ['exponential', 1.4], ['zoom'], 5, 1.2 * k + add, 9, 2.2 * k + add, 12, 3.6 * k + add, 16, 7 * k + add];
  const width = widthAt();
  const colour = () => ['case', ['==', ['get', 'quiet'], 1], quiet(), ['coalesce', ['get', 'color'], quiet()]];
  map.addLayer({id: RAIL_LAYERS.casing, type: 'line', source: RAIL_SOURCE, filter: ['==', ['get', 'status'], 'operating'],
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': casing(), 'line-width': widthAt(1, 2.4), 'line-opacity': fade(true)}}, beforeId);
  map.addLayer({id: RAIL_LAYERS.line, type: 'line', source: RAIL_SOURCE, filter: ['==', ['get', 'status'], 'operating'],
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': colour(), 'line-width': width, 'line-opacity': fade(true)}}, beforeId);
  map.addLayer({id: RAIL_LAYERS.construction, type: 'line', source: RAIL_SOURCE, filter: ['!=', ['get', 'status'], 'operating'],
    layout: {'line-cap': 'butt', 'line-join': 'round'},
    paint: {'line-color': colour(), 'line-width': widthAt(0.8), 'line-dasharray': [2, 1.6], 'line-opacity': fade(true)}}, beforeId);
  map.addLayer({id: RAIL_LAYERS.selected, type: 'line', source: RAIL_SOURCE, filter: ['==', ['get', 'selected'], 1],
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': cssVar('--map-selected-stroke', '#176B82'), 'line-width': 2.5, 'line-gap-width': widthAt(1, 1), 'line-opacity': fade(true)}}, beforeId);
  // Wide invisible hit target so thin lines are easy to pick in plan view.
  map.addLayer({id: RAIL_LAYERS.hit, type: 'line', source: RAIL_SOURCE,
    paint: {'line-color': '#000000', 'line-opacity': 0, 'line-width': widthAt(1, 10)}}, beforeId);
  let mode3d = true;
  if (onSelect) map.on('click', RAIL_LAYERS.hit, e => { if (e.originalEvent?.__citymeterSceneHandled) return; const f = e.features?.[0]; if (f) onSelect(f.properties.lineId); });
  map.on('mouseenter', RAIL_LAYERS.hit, e => { map.getCanvas().style.cursor = 'pointer'; onHover?.(e.features?.[0]?.properties?.lineId || ''); });
  map.on('mouseleave', RAIL_LAYERS.hit, () => { map.getCanvas().style.cursor = ''; onHover?.(''); });

  function update({focusLineIds = null, selectedLineId = '', visibleLineIds = null} = {}) {
    const ground = cssVar('--basemap-ground', '#EEF1EE');
    const features = (geojson?.features || []).filter(f => !visibleLineIds || visibleLineIds.has(f.properties.lineId)).map((f, i) => ({
      type: 'Feature', geometry: f.geometry,
      properties: {...f.properties, fid: i + 1, quiet: focusLineIds && !focusLineIds.has(f.properties.lineId) ? 1 : 0, selected: f.properties.lineId === selectedLineId ? 1 : 0,
        backed: contrastRatio(f.properties.color, ground) < 3 ? 1 : 0},
    }));
    map.getSource(RAIL_SOURCE)?.setData({type: 'FeatureCollection', features});
  }
  function setMode(is3d) {
    mode3d = Boolean(is3d);
    for (const id of [RAIL_LAYERS.casing, RAIL_LAYERS.line, RAIL_LAYERS.construction, RAIL_LAYERS.selected]) if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', fade(mode3d));
  }
  function retheme() {
    if (map.getLayer(RAIL_LAYERS.casing)) map.setPaintProperty(RAIL_LAYERS.casing, 'line-color', casing());
    for (const id of [RAIL_LAYERS.line, RAIL_LAYERS.construction]) if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', colour());
    if (map.getLayer(RAIL_LAYERS.selected)) map.setPaintProperty(RAIL_LAYERS.selected, 'line-color', cssVar('--map-selected-stroke', '#176B82'));
  }
  function dispose() {
    for (const id of Object.values(RAIL_LAYERS)) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(RAIL_SOURCE)) map.removeSource(RAIL_SOURCE);
  }
  return {update, setMode, retheme, dispose, layerIds: RAIL_LAYERS, get mode3d() { return mode3d; }};
}

/**
 * Optional context layers (owner 2026-10-31: every mode of the research master
 * with coordinates, off by default, lazy-loaded; rail stays the subject; once
 * switched on, visible at every zoom and on every screen — no minimum zoom):
 *   bus   — GTFS route corridors (width = route-count class) + BRT routes
 *   stops — GTFS bus stops + BRT stations
 *   boat  — GTFS boat routes (dashed) + piers (rings)
 *   srt   — conventional rail stops with scheduled trips (filled square)
 *   intercity — bus terminals and บขส. boarding points (diamond; hollow = บขส. stop)
 *   moto  — motorcycle-taxi stands of Bangkok (small triangle)
 *   air   — airport reference points (plane)
 * Shape, not colour, tells the modes apart; colours are the quiet map-role
 * tokens (ink, halo, bus, water) so no mode competes with the line colours.
 * Route lines sit above the road casing and below the rail lines — they were
 * drawn under the roads in 0.1 and never showed.
 */
const CONTEXT_POINT_LAYERS = ['srt', 'intercity', 'moto', 'air'];
export const CONTEXT_LAYER_IDS = Object.freeze(Object.fromEntries(CONTEXT_POINT_LAYERS.map(k => [k, `ctx-${k}`])));

/** Context data rows → GeoJSON points (fields from the layer file). */
export function contextFeatures(data) {
  const fields = data?.fields || [];
  return {type: 'FeatureCollection', features: (data?.rows || []).map((r, i) => {
    const props = {};
    fields.forEach((f, k) => { if (f !== 'lng' && f !== 'lat') props[f] = r[k]; });
    const kinds = data.meta?.kinds || [];
    props.kindLabel = kinds[props.kind] || '';
    return {type: 'Feature', id: i, properties: props, geometry: {type: 'Point', coordinates: [r[fields.indexOf('lng')], r[fields.indexOf('lat')]]}};
  })};
}

/** Small symbol images drawn per theme (pixel ratio 2), so each mode keeps its shape in any colour scheme. */
function drawSymbol(shape, {ink, halo, tint}) {
  const size = shape === 'air' ? 36 : shape === 'moto' ? 22 : 28, c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!c) return null;
  c.width = c.height = size;
  const g = c.getContext('2d'), m = size / 2;
  g.lineJoin = 'round';
  const path = () => {
    g.beginPath();
    if (shape === 'square') { g.rect(m - 7, m - 7, 14, 14); }
    else if (shape === 'diamond' || shape === 'diamond-open') { g.moveTo(m, m - 10); g.lineTo(m + 10, m); g.lineTo(m, m + 10); g.lineTo(m - 10, m); g.closePath(); }
    else if (shape === 'moto') { g.moveTo(m, m - 7); g.lineTo(m + 7, m + 6); g.lineTo(m - 7, m + 6); g.closePath(); }
    else if (shape === 'air') { // plane seen from above, nose up
      g.moveTo(m, m - 14); g.lineTo(m + 2.6, m - 9); g.lineTo(m + 2.6, m - 3); g.lineTo(m + 13, m + 3); g.lineTo(m + 13, m + 6); g.lineTo(m + 2.6, m + 3);
      g.lineTo(m + 2.4, m + 9); g.lineTo(m + 6, m + 12); g.lineTo(m + 6, m + 14); g.lineTo(m, m + 12.5); g.lineTo(m - 6, m + 14); g.lineTo(m - 6, m + 12);
      g.lineTo(m - 2.4, m + 9); g.lineTo(m - 2.6, m + 3); g.lineTo(m - 13, m + 6); g.lineTo(m - 13, m + 3); g.lineTo(m - 2.6, m - 3); g.lineTo(m - 2.6, m - 9); g.closePath();
    }
  };
  path();
  g.lineWidth = 5; g.strokeStyle = halo; g.stroke();          // halo
  g.fillStyle = shape === 'diamond-open' ? halo : (shape === 'moto' ? tint : ink); g.fill();
  g.lineWidth = shape === 'diamond-open' ? 2.6 : 1.2; g.strokeStyle = shape === 'moto' ? tint : ink; g.stroke();
  return g.getImageData(0, 0, size, size);
}

export function installOptionalLayers(map, {beforeId, lineBeforeId = 'rail-casing', onPick = null} = {}) {
  const bus = () => cssVar('--scene-bus', '#7B877D');
  const boat = () => cssVar('--map-active-layer', '#347DA8');
  const halo = () => cssVar('--map-marker-halo', '#FFFFFF');
  const ink = () => cssVar('--map-marker-stroke', '#182327');
  const state = {bus: false, stops: false, boat: false, srt: false, intercity: false, moto: false, air: false, loaded: new Set()};
  // Route lines above the roads (0.1 put them under the road casing, where nothing showed) and under the rail lines.
  const linesBefore = () => (map.getLayer(lineBeforeId) ? lineBeforeId : beforeId);
  function images() {
    const colours = {ink: ink(), halo: halo(), tint: bus()};
    for (const shape of ['square', 'diamond', 'diamond-open', 'moto', 'air']) {
      const id = `ctx-sym-${shape}`;
      if (map.hasImage?.(id)) continue;
      const img = drawSymbol(shape, colours);
      if (img) map.addImage(id, img, {pixelRatio: 2});
    }
  }
  const pickable = [];
  function ensure(kind, data) {
    if (state.loaded.has(kind) || !data) return;
    if (kind === 'bus') {
      map.addSource(BUS_SOURCE, {type: 'geojson', data: data.routes, tolerance: 0.6});
      // Width (not colour) carries the count class: how many GTFS route records pass a stretch (data/bus.json meta.classes).
      const classWidth = k => ['case', ['==', ['get', 'brt'], 1], 2.2 * k, ['match', ['get', 'class'], 0, 0.45 * k, 1, 0.75 * k, 2, 1.1 * k, 3, 1.6 * k, 2.2 * k]];
      map.addLayer({id: OPTIONAL_LAYERS.bus, type: 'line', source: BUS_SOURCE,
        layout: {'line-cap': 'round', 'line-join': 'round', visibility: 'none'},
        paint: {'line-color': bus(), 'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 9, 0.5, 13, 0.6, 16, 0.7], 'line-width': ['interpolate', ['linear'], ['zoom'], 6, classWidth(0.35), 9, classWidth(0.7), 13, classWidth(1.3), 16, classWidth(2.1)]}}, linesBefore());
    } else if (kind === 'stops') {
      map.addSource(BUS_STOPS, {type: 'geojson', data: data.stops});
      // Every zoom: a fine texture when far out (where the stops are), dots with a halo when close.
      map.addLayer({id: OPTIONAL_LAYERS.busStops, type: 'circle', source: BUS_STOPS,
        layout: {visibility: 'none'},
        paint: {'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, ['case', ['==', ['get', 'brt'], 1], 1.4, 0.5], 10, ['case', ['==', ['get', 'brt'], 1], 2.2, 0.9], 13, ['case', ['==', ['get', 'brt'], 1], 2.8, 1.4], 17, ['case', ['==', ['get', 'brt'], 1], 5, 3.4]],
          'circle-color': bus(), 'circle-stroke-color': halo(), 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 0, 13.5, 1], 'circle-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.65, 12, 0.85, 14, 1]}});
      pickable.push(OPTIONAL_LAYERS.busStops);
    } else if (kind === 'boat') {
      map.addSource(BOAT_SOURCE, {type: 'geojson', data: data.routes});
      map.addSource(`${BOAT_SOURCE}-stops`, {type: 'geojson', data: data.stops});
      map.addLayer({id: OPTIONAL_LAYERS.boat, type: 'line', source: BOAT_SOURCE,
        layout: {'line-cap': 'round', 'line-join': 'round', visibility: 'none'},
        paint: {'line-color': boat(), 'line-opacity': 0.8, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.2, 14, 2.4, 17, 3.6], 'line-dasharray': [3, 2]}}, linesBefore());
      map.addLayer({id: OPTIONAL_LAYERS.boatStops, type: 'circle', source: `${BOAT_SOURCE}-stops`,
        layout: {visibility: 'none'},
        paint: {'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 11, 2, 17, 4.5], 'circle-color': halo(), 'circle-stroke-color': boat(), 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 11, 1.6]}});
      pickable.push(OPTIONAL_LAYERS.boatStops);
    } else if (CONTEXT_POINT_LAYERS.includes(kind)) {
      images();
      const id = CONTEXT_LAYER_IDS[kind];
      const fc = contextFeatures(data);
      map.addSource(id, {type: 'geojson', data: fc});
      // Names get their own source: a tile whose label font fails to load drops every layer of that source,
      // and the symbols must not depend on the font server.
      map.addSource(`${id}-label`, {type: 'geojson', data: fc});
      const icon = kind === 'srt' ? 'ctx-sym-square' : kind === 'moto' ? 'ctx-sym-moto' : kind === 'air' ? 'ctx-sym-air'
        : ['case', ['==', ['get', 'kind'], 2], 'ctx-sym-diamond-open', 'ctx-sym-diamond'];
      // No minimum zoom (owner 2026-10-31): a switched-on layer shows at every zoom; symbols shrink when far out.
      // Icons and names are two layers, so a symbol never waits for (or fails with) the label font.
      const labelZoom = kind === 'air' ? 7 : kind === 'srt' ? 10 : kind === 'intercity' ? 10 : 16;
      map.addLayer({id, type: 'symbol', source: id,
        layout: {
          visibility: 'none', 'icon-image': icon, 'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'icon-size': kind === 'moto' ? ['interpolate', ['linear'], ['zoom'], 8, 0.35, 11, 0.5, 13, 0.75, 16, 1.1] : ['interpolate', ['linear'], ['zoom'], 5, 0.6, 9, 0.8, 12, 1, 16, 1.2],
        },
        paint: {'icon-opacity': kind === 'moto' ? ['interpolate', ['linear'], ['zoom'], 9, 0.6, 13, 1] : 1}});
      map.addLayer({id: `${id}-label`, type: 'symbol', source: `${id}-label`, minzoom: labelZoom,
        layout: {visibility: 'none', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-max-width': 9},
        paint: {'text-color': ink(), 'text-halo-color': halo(), 'text-halo-width': 1.4}});
      pickable.push(id);
    }
    state.loaded.add(kind);
  }
  function idsOf(kind) {
    if (kind === 'bus') return [OPTIONAL_LAYERS.bus];
    if (kind === 'stops') return [OPTIONAL_LAYERS.busStops];
    if (kind === 'boat') return [OPTIONAL_LAYERS.boat, OPTIONAL_LAYERS.boatStops];
    return [CONTEXT_LAYER_IDS[kind], `${CONTEXT_LAYER_IDS[kind]}-label`];
  }
  function setVisible(kind, on, data) {
    ensure(kind, data);
    state[kind] = Boolean(on);
    for (const id of idsOf(kind)) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    return state;
  }
  // A click on a context point reports it (name, kind, area); the caller shows it.
  const onClick = e => {
    const ids = pickable.filter(id => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') === 'visible');
    if (!ids.length || typeof onPick !== 'function') return;
    const hit = map.queryRenderedFeatures(e.point, {layers: ids})[0];
    if (hit) onPick({layer: hit.layer.id, properties: hit.properties, lngLat: hit.geometry?.coordinates || e.lngLat.toArray()});
  };
  const onMove = e => {
    const ids = pickable.filter(id => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') === 'visible');
    map.getCanvas().style.cursor = ids.length && map.queryRenderedFeatures(e.point, {layers: ids}).length ? 'pointer' : '';
  };
  map.on('click', onClick);
  map.on('mousemove', onMove);
  function dispose() {
    map.off('click', onClick);
    map.off('mousemove', onMove);
    for (const id of [...Object.values(OPTIONAL_LAYERS), ...Object.values(CONTEXT_LAYER_IDS).flatMap(id => [`${id}-label`, id])]) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of [BUS_SOURCE, BUS_STOPS, BOAT_SOURCE, `${BOAT_SOURCE}-stops`, ...Object.values(CONTEXT_LAYER_IDS).flatMap(id => [id, `${id}-label`])]) if (map.getSource(id)) map.removeSource(id);
  }
  return {setVisible, dispose, get state() { return {...state, loaded: [...state.loaded]}; }};
}

/**
 * HTML labels for areas (province chips): name + count badge. Collision-managed
 * against each other and the map chrome; shown only inside [minZoom, maxZoom).
 * `areas`: [{id, name, count, state, quiet, feature|latitude/longitude, countLabel}].
 */
export function installAreaLabels(map, container, {onSelect, reservedBottom = () => 0, className = 'area-label', hostId = 'area-labels', hostLabel = 'พื้นที่บนแผนที่', minZoom = 0, maxZoom = Infinity, verb = 'กดเพื่อสำรวจ', unit = 'สถานี'} = {}) {
  const host = document.createElement('div');
  host.id = hostId;
  host.className = 'area-labels';
  host.setAttribute('aria-label', hostLabel);
  container.append(host);
  let labels = [], frame = 0;
  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  function layout() {
    const width = container.clientWidth, height = container.clientHeight - reservedBottom();
    const panel = container.closest('.map-panel'), rect = container.getBoundingClientRect();
    const chrome = panel ? [...panel.querySelectorAll('.map-toolbar, .mode-chips, .mode-menu, .map-legend, .map-status, .map-aha, .ray-status, .maplibregl-ctrl-top-right')]
      .filter(e => e.offsetWidth && e.offsetHeight)
      .map(e => { const b = e.getBoundingClientRect(); return {left: b.left - rect.left - 4, right: b.right - rect.left + 4, top: b.top - rect.top - 4, bottom: b.bottom - rect.top + 4}; }) : [];
    const placed = [];
    const zoom = map.getZoom();
    const inWindow = zoom >= minZoom && zoom < maxZoom;
    for (const e of labels) {
      const p = map.project(e.center);
      e.button.hidden = !(e.visible && inWindow && p.x > 0 && p.x < width && p.y > 48 && p.y < height);
      if (e.button.hidden) continue;
      const w = e.button.offsetWidth, h = e.button.offsetHeight;
      let position = null;
      for (const [dx, dy] of [[0, 0], [0, -30], [0, 30], [-40, 0], [40, 0], [0, -60], [0, 60]]) {
        const x = p.x + dx, y = p.y + dy;
        const box = {left: x - w / 2 - 4, right: x + w / 2 + 4, top: y - h / 2 - 3, bottom: y + h / 2 + 3};
        if (box.left < 4 || box.right > width - 4 || box.top < 48 || box.bottom > height || placed.some(b => overlaps(box, b)) || chrome.some(b => overlaps(box, b))) continue;
        position = {x, y, box};
        break;
      }
      e.button.hidden = !position;
      if (position) { e.button.style.left = `${position.x}px`; e.button.style.top = `${position.y}px`; placed.push(position.box); }
    }
  }
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(layout); };

  function update(areas, {selectedId = '', visible = true, LngLatBounds} = {}) {
    host.replaceChildren();
    labels = [];
    for (const a of areas) {
      if (a.state === 'out_of_scope') continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `${className} is-${a.state}${a.id === selectedId ? ' is-selected' : ''}${a.quiet ? ' is-quiet' : ''}${a.state === 'measured_zero' ? ' is-zero' : ''}`;
      button.innerHTML = `<span class="label-name"></span><span class="label-count data-number" aria-hidden="true"></span>`;
      button.querySelector('.label-name').textContent = a.name;
      button.querySelector('.label-count').textContent = String(a.count);
      button.setAttribute('aria-label', `${a.name}: ${a.count} ${unit} ${verb}`);
      button.title = `${a.name} · ${a.count} ${unit}`;
      button.setAttribute('aria-pressed', String(a.id === selectedId));
      button.onclick = () => onSelect?.(a.id);
      const center = a.labelPoint || (a.feature ? featureBounds(a.feature, LngLatBounds).getCenter().toArray() : [a.longitude, a.latitude]);
      host.append(button);
      labels.push({button, center, visible});
    }
    schedule();
  }
  map.on('move', schedule);
  map.on('resize', schedule);
  return {update, layout: schedule, dispose() { cancelAnimationFrame(frame); map.off('move', schedule); map.off('resize', schedule); host.remove(); }};
}
