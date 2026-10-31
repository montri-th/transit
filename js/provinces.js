/**
 * Province frames for the country view (carried over from Luxury Brands 0.4,
 * owner instruction 2026-10-22: when the whole country is on screen the map
 * must still show where the data is — provinces that hold stations get a frame
 * to drill down into).
 *
 * Below PROVINCE_FILL_MAX_ZOOM every province is filled with the LDS `count`
 * family (stations per province in the current filter, equal-interval classes
 * of its own, legend switches with it); from there up only the frame outline
 * remains until PROVINCE_OUTLINE_MAX_ZOOM, where the lines carry the reading.
 * The selected province (the จังหวัด filter) keeps a solid selected outline;
 * the others go quiet (outline-only, no fill).
 *
 * Boundaries: data/provinces.geojson (OpenGISData-Thailand, CC BY 4.0, DOPA-
 * credited) — frames for context and navigation, never an administrative claim.
 * EVID-05: measured (nonzero), measured_zero (province in the frame set with 0
 * stations in the current filter → lowest fill + zero outline), out_of_scope
 * (provinces without rows in the dataset — nothing drawn).
 */
import {provinceByCode} from './provinces-list.js';
import {buildCountClasses, classify} from './scales.js';
import {featureBounds, firstLineLayerId} from './map-layers.js';

export const PROVINCE_FILL_MAX_ZOOM = 9;
export const PROVINCE_OUTLINE_MAX_ZOOM = 12;
export const PROVINCE_LABEL_MAX_ZOOM = 9.5;
const SOURCE = 'provinces';
export const PROVINCE_LAYERS = Object.freeze({fill: 'province-fill', zero: 'province-zero-outline', outline: 'province-outline', selected: 'province-selected'});

function cssVar(name, fallback) {
  const value = typeof getComputedStyle === 'function' && typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '';
  return value || fallback;
}

/**
 * Per-province model: stations and lines per province among `rows` (station
 * records carry provinceCode from build-time point-in-polygon). Provinces without
 * any station in the whole dataset are `out_of_scope` (nothing drawn); provinces
 * with stations in the dataset but none in the current filter are measured zero.
 */
export function buildProvinceModel(rows, geojson, {datasetCodes = null} = {}) {
  const features = geojson?.features || [];
  const byCode = new Map();
  for (const r of rows || []) {
    if (!r.provinceCode) continue;
    const e = byCode.get(r.provinceCode) || {stations: 0, lines: new Set()};
    e.stations++;
    for (const id of r.lineIds || []) e.lines.add(id);
    byCode.set(r.provinceCode, e);
  }
  const inScope = code => !datasetCodes || datasetCodes.has(code);
  const provinces = features.filter(f => inScope(f.id || f.properties?.code)).map(f => {
    const code = f.id || f.properties?.code;
    const meta = provinceByCode(code) || {code, th: f.properties?.name || code, en: f.properties?.nameEn || code};
    const e = byCode.get(code);
    return {id: code, code, name: meta.th, nameEn: meta.en, stations: e ? e.stations : 0, lines: e ? e.lines.size : 0, feature: f};
  });
  const classes = buildCountClasses(provinces.map(p => p.stations));
  for (const p of provinces) { const c = classify(p.stations, classes); p.state = c.state; p.fill = c.fill; p.ink = c.ink; p.outline = c.outline || null; }
  return {provinces, classes, zeroCount: provinces.filter(p => p.state === 'measured_zero').length};
}

export function installProvinceLayers(map, geojson, {onSelect} = {}) {
  const beforeId = firstLineLayerId(map);
  map.addSource(SOURCE, {type: 'geojson', data: {type: 'FeatureCollection', features: []}, promoteId: 'code',
    attribution: 'ขอบเขตจังหวัด: <a href="https://github.com/chingchai/OpenGISData-Thailand" target="_blank" rel="noopener">OpenGISData-Thailand</a> (CC BY 4.0)'});
  const outlineColor = () => ['case', ['==', ['get', 'quiet'], 1], cssVar('--border-default', '#C9D0CB'), cssVar('--border-emphasis', '#7D877F')];
  map.addLayer({
    id: PROVINCE_LAYERS.fill, type: 'fill', source: SOURCE, maxzoom: PROVINCE_FILL_MAX_ZOOM,
    filter: ['==', ['get', 'filled'], 1],
    paint: {'fill-color': ['get', 'fill'], 'fill-opacity': 1, 'fill-antialias': true},
  }, beforeId);
  map.addLayer({
    id: PROVINCE_LAYERS.zero, type: 'line', source: SOURCE, maxzoom: PROVINCE_FILL_MAX_ZOOM,
    filter: ['all', ['==', ['get', 'state'], 'measured_zero'], ['==', ['get', 'filled'], 1]],
    paint: {'line-color': cssVar('--data-zero-outline', '#7D877F'), 'line-width': 2},
  }, beforeId);
  map.addLayer({
    id: PROVINCE_LAYERS.outline, type: 'line', source: SOURCE, maxzoom: PROVINCE_OUTLINE_MAX_ZOOM,
    paint: {'line-color': outlineColor(), 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 9, 1.2, 12, 1.6], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 1, 12, 0.35]},
  });
  map.addLayer({
    id: PROVINCE_LAYERS.selected, type: 'line', source: SOURCE, maxzoom: 13,
    filter: ['==', ['get', 'selected'], 1],
    paint: {'line-color': cssVar('--map-selected-stroke', '#176B82'), 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.6, 9, 2.4], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 1, 13, 0.3]},
  });
  if (onSelect) {
    map.on('click', PROVINCE_LAYERS.fill, e => { const f = e.features?.[0]; if (f) onSelect(f.properties.code); });
    map.on('mouseenter', PROVINCE_LAYERS.fill, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', PROVINCE_LAYERS.fill, () => { map.getCanvas().style.cursor = ''; });
  }
  let current = {provinces: [], classes: null, zeroCount: 0};

  /** rows: the filtered scope WITHOUT the province filter, so every frame keeps its own count; selectedCode: the จังหวัด filter. */
  function update({rows = [], selectedCode = '', visible = true, datasetCodes = null} = {}) {
    current = buildProvinceModel(rows, geojson, {datasetCodes});
    for (const p of current.provinces) { p.selected = p.code === selectedCode; p.quiet = Boolean(selectedCode) && !p.selected; }
    const features = current.provinces.map(p => ({
      type: 'Feature', id: p.code, geometry: p.feature.geometry,
      properties: {code: p.code, name: p.name, stations: p.stations, lines: p.lines, state: p.state, fill: p.fill, filled: p.quiet ? 0 : 1, quiet: p.quiet ? 1 : 0, selected: p.selected ? 1 : 0},
    }));
    map.getSource(SOURCE)?.setData({type: 'FeatureCollection', features});
    for (const id of Object.values(PROVINCE_LAYERS)) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    return current;
  }
  function retheme() {
    if (map.getLayer(PROVINCE_LAYERS.outline)) map.setPaintProperty(PROVINCE_LAYERS.outline, 'line-color', outlineColor());
    if (map.getLayer(PROVINCE_LAYERS.selected)) map.setPaintProperty(PROVINCE_LAYERS.selected, 'line-color', cssVar('--map-selected-stroke', '#176B82'));
    if (map.getLayer(PROVINCE_LAYERS.zero)) map.setPaintProperty(PROVINCE_LAYERS.zero, 'line-color', cssVar('--data-zero-outline', '#7D877F'));
  }
  function dispose() {
    for (const id of Object.values(PROVINCE_LAYERS)) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  }
  return {update, retheme, dispose, model: () => current, layerIds: PROVINCE_LAYERS};
}

/** Bounds of one province frame (for the drill-down fit). */
export function provinceBounds(geojson, code, LngLatBounds) {
  const f = (geojson?.features || []).find(x => (x.id || x.properties?.code) === code);
  return f ? featureBounds(f, LngLatBounds) : null;
}
