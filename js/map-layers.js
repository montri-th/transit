/**
 * 2D MapLibre layers of the transit map.
 *
 *  - Rail lines (data/rail-lines.geojson): the plan-view and low-zoom form of
 *    the alignments. In 3D the three.js ribbons (js/scene.js) carry the lines
 *    from RIBBON_MIN_ZOOM; these 2D lines fade out above it, so there is always
 *    exactly one readable form of every line. Colour = the line's identity colour
 *    (the colour in its own name, with source); construction is dashed and
 *    lighter; lines outside the focus go quiet grey.
 *  - Bus routes and stops (optional, lazy-loaded, default off) and boat routes
 *    (optional, default off): quiet context lines in scene/map-role tokens, never
 *    a categorical palette, so rail stays the subject.
 *  - Area labels (province chips) — generic HTML label host carried over from
 *    Luxury Brands, collision-managed against the map chrome.
 */
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
  // In 3D the ribbons take over from RIBBON_MIN_ZOOM; `mode3d` is a layout-level switch applied by setMode().
  const fade = mode3d => mode3d ? ['interpolate', ['linear'], ['zoom'], RIBBON_MIN_ZOOM - 0.6, 1, RIBBON_MIN_ZOOM + 0.4, 0] : 1;
  // Zoom must be the top-level input of a paint expression, so every derived width is its own interpolate.
  const widthAt = (k = 1, add = 0) => ['interpolate', ['exponential', 1.4], ['zoom'], 5, 1.2 * k + add, 9, 2.2 * k + add, 12, 3.6 * k + add, 16, 7 * k + add];
  const width = widthAt();
  const colour = () => ['case', ['==', ['get', 'quiet'], 1], quiet(), ['coalesce', ['get', 'color'], quiet()]];
  map.addLayer({id: RAIL_LAYERS.casing, type: 'line', source: RAIL_SOURCE, filter: ['==', ['get', 'status'], 'operating'],
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': halo(), 'line-width': widthAt(1, 2.4), 'line-opacity': fade(true)}}, beforeId);
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
    const features = (geojson?.features || []).filter(f => !visibleLineIds || visibleLineIds.has(f.properties.lineId)).map((f, i) => ({
      type: 'Feature', geometry: f.geometry,
      properties: {...f.properties, fid: i + 1, quiet: focusLineIds && !focusLineIds.has(f.properties.lineId) ? 1 : 0, selected: f.properties.lineId === selectedLineId ? 1 : 0},
    }));
    map.getSource(RAIL_SOURCE)?.setData({type: 'FeatureCollection', features});
  }
  function setMode(is3d) {
    mode3d = Boolean(is3d);
    for (const id of [RAIL_LAYERS.casing, RAIL_LAYERS.line, RAIL_LAYERS.construction, RAIL_LAYERS.selected]) if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', fade(mode3d));
  }
  function retheme() {
    if (map.getLayer(RAIL_LAYERS.casing)) map.setPaintProperty(RAIL_LAYERS.casing, 'line-color', halo());
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
 * Optional context layers: bus routes + stops and boat routes + piers. Data is
 * loaded only when the reader switches a layer on (the caller passes it in).
 */
export function installOptionalLayers(map, {beforeId} = {}) {
  const bus = () => cssVar('--scene-bus', '#7B877D');
  const boat = () => cssVar('--map-active-layer', '#347DA8');
  const halo = () => cssVar('--map-marker-halo', '#FFFFFF');
  const state = {bus: false, boat: false, busLoaded: false, boatLoaded: false};
  function ensure(kind, data) {
    if (kind === 'bus' && !state.busLoaded && data) {
      map.addSource(BUS_SOURCE, {type: 'geojson', data: data.routes, tolerance: 0.6});
      map.addSource(BUS_STOPS, {type: 'geojson', data: data.stops});
      map.addLayer({id: OPTIONAL_LAYERS.bus, type: 'line', source: BUS_SOURCE, minzoom: 9,
        layout: {'line-cap': 'round', 'line-join': 'round', visibility: 'none'},
        paint: {'line-color': bus(), 'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.25, 13, 0.45, 16, 0.6], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 13, 1, 16, 2]}}, beforeId);
      map.addLayer({id: OPTIONAL_LAYERS.busStops, type: 'circle', source: BUS_STOPS, minzoom: 14,
        layout: {visibility: 'none'},
        paint: {'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 1.6, 17, 3.2], 'circle-color': bus(), 'circle-stroke-color': halo(), 'circle-stroke-width': 1}});
      state.busLoaded = true;
    }
    if (kind === 'boat' && !state.boatLoaded && data) {
      map.addSource(BOAT_SOURCE, {type: 'geojson', data: data.routes});
      map.addSource(`${BOAT_SOURCE}-stops`, {type: 'geojson', data: data.stops});
      map.addLayer({id: OPTIONAL_LAYERS.boat, type: 'line', source: BOAT_SOURCE,
        layout: {'line-cap': 'round', 'line-join': 'round', visibility: 'none'},
        paint: {'line-color': boat(), 'line-opacity': 0.7, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 2.2, 17, 3.4], 'line-dasharray': [3, 2]}}, beforeId);
      map.addLayer({id: OPTIONAL_LAYERS.boatStops, type: 'circle', source: `${BOAT_SOURCE}-stops`, minzoom: 12,
        layout: {visibility: 'none'},
        paint: {'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2, 17, 4.5], 'circle-color': halo(), 'circle-stroke-color': boat(), 'circle-stroke-width': 1.6}});
      state.boatLoaded = true;
    }
  }
  function setVisible(kind, on, data) {
    ensure(kind, data);
    state[kind] = Boolean(on);
    const ids = kind === 'bus' ? [OPTIONAL_LAYERS.bus, OPTIONAL_LAYERS.busStops] : [OPTIONAL_LAYERS.boat, OPTIONAL_LAYERS.boatStops];
    for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    return state;
  }
  function dispose() {
    for (const id of Object.values(OPTIONAL_LAYERS)) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of [BUS_SOURCE, BUS_STOPS, BOAT_SOURCE, `${BOAT_SOURCE}-stops`]) if (map.getSource(id)) map.removeSource(id);
  }
  return {setVisible, dispose, get state() { return {...state}; }};
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
    const chrome = panel ? [...panel.querySelectorAll('.map-toolbar, .map-legend, .map-status, .map-aha, .ray-status, .maplibregl-ctrl-top-right')]
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
