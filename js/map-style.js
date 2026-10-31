/**
 * Basemap style — "paper" — generated for MapLibre from OpenFreeMap vector tiles.
 *
 * Why generate instead of pointing at OpenFreeMap's Positron/Dark styles:
 *  - the city must stay quiet under exact LDS data colours (count classes,
 *    category pins, map roles): light ground, white roads, muted water/green,
 *    no POI clutter, few labels;
 *  - both themes come from the same layer list, so light and dark differ only
 *    by the palette below;
 *  - the 3D massing tiers (massing.js) need the `openmaptiles` source and a
 *    known layer order (fills → massing → lines → labels).
 *
 * Palette values are foundation/basemap tokens from assets/theme.css (LDS 0.9.7
 * foundation pairs plus basemap-only tokens declared there). Data colours are
 * never set here. Tiles: © OpenMapTiles © OpenStreetMap contributors, served by
 * OpenFreeMap (https://openfreemap.org) — attribution flows from the TileJSON.
 */
export const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
export const GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const SOURCE_ID = 'openmaptiles';
export const FIRST_LINE_LAYER = 'waterway';
export const FIRST_LABEL_LAYER = 'water-name';

const FONT = ['Noto Sans Regular'];
const FONT_ITALIC = ['Noto Sans Italic'];

/** Fallbacks equal the values in assets/theme.css; the live values are read from CSS at build time. */
const FALLBACK = {
  light: {
    ground: '#EEF1EE', water: '#E2E9ED', waterLine: '#CBD9E1', park: '#DCE6D4', wood: '#D2DFC8', grass: '#E3EBDA', sand: '#F0EEE4', aeroway: '#E9EBE7',
    building: '#DFE2DD', buildingLine: '#CDD2CD', massingQuiet: '#ECEDE8', massingFocus: '#D9D7CD',
    road: '#FFFFFF', roadCasing: '#DCE1DD', motorwayCasing: '#C9D0CB', tunnel: '#F4F6F3', rail: '#C9D0CB', transit: '#B4BDB7', path: '#FFFFFF',
    label: '#5F635A', labelQuiet: '#7B877D', halo: '#F6F7F3', sky: '#F6F7F3', horizon: '#DCE1DD', fog: '#EEF1EE',
  },
  dark: {
    ground: '#11191D', water: '#18333E', waterLine: '#1F3F4C', park: '#16251F', wood: '#14211C', grass: '#172620', sand: '#1C2328', aeroway: '#172126',
    building: '#1C262B', buildingLine: '#2A3539', massingQuiet: '#2A343A', massingFocus: '#4A5760',
    road: '#293337', roadCasing: '#33403D', motorwayCasing: '#46524F', tunnel: '#1A2327', rail: '#46524F', transit: '#5E6B67', path: '#293337',
    label: '#A6B5B1', labelQuiet: '#8D9D99', halo: '#11191D', sky: '#0D1418', horizon: '#172126', fog: '#11191D',
  },
};

/** Read the basemap palette for a theme from CSS custom properties (assets/theme.css), with exact fallbacks. */
export function basemapPalette(theme = 'light') {
  const base = {...FALLBACK[theme === 'dark' ? 'dark' : 'light']};
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return base;
  const style = getComputedStyle(document.documentElement);
  const read = (token, fallback) => style.getPropertyValue(token).trim() || fallback;
  return {
    ...base,
    ground: read('--basemap-ground', base.ground), water: read('--basemap-water', base.water), waterLine: read('--basemap-water-line', base.waterLine),
    park: read('--basemap-park', base.park), wood: read('--basemap-wood', base.wood), grass: read('--basemap-grass', base.grass), sand: read('--basemap-sand', base.sand), aeroway: read('--basemap-aeroway', base.aeroway),
    building: read('--basemap-building', base.building), buildingLine: read('--basemap-building-line', base.buildingLine), massingQuiet: read('--basemap-massing-quiet', base.massingQuiet), massingFocus: read('--basemap-massing-focus', base.massingFocus),
    road: read('--basemap-road', base.road), roadCasing: read('--basemap-road-casing', base.roadCasing), motorwayCasing: read('--basemap-motorway-casing', base.motorwayCasing), tunnel: read('--basemap-tunnel', base.tunnel), rail: read('--basemap-rail', base.rail), transit: read('--basemap-transit', base.transit), path: read('--basemap-path', base.path),
    label: read('--basemap-label', base.label), labelQuiet: read('--basemap-label-quiet', base.labelQuiet), halo: read('--basemap-halo', base.halo), sky: read('--basemap-sky', base.sky), horizon: read('--basemap-horizon', base.horizon), fog: read('--basemap-fog', base.fog),
  };
}

const poly = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
const line = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const cls = (...values) => ['match', ['get', 'class'], values, true, false];
const name = ['coalesce', ['get', 'name:th'], ['get', 'name']];
const zoomWidth = (base, pairs) => ['interpolate', ['exponential', base], ['zoom'], ...pairs.flat()];

function roadLayers(p) {
  const notTunnel = ['!=', ['get', 'brunnel'], 'tunnel'];
  const majorClasses = cls('primary', 'secondary', 'tertiary', 'trunk');
  const motorway = cls('motorway');
  const minor = cls('minor', 'service', 'track');
  return [
    {id: 'tunnel', type: 'line', source: SOURCE_ID, 'source-layer': 'transportation', minzoom: 13, filter: ['all', line, ['==', ['get', 'brunnel'], 'tunnel'], ['!', cls('rail', 'transit', 'path')]],
      layout: {'line-cap': 'butt', 'line-join': 'round'}, paint: {'line-color': p.tunnel, 'line-width': zoomWidth(1.4, [[13, 1.5], [18, 10]]), 'line-dasharray': [4, 2]}},
    {id: 'road-path', type: 'line', source: SOURCE_ID, 'source-layer': 'transportation', minzoom: 14.5, filter: ['all', line, notTunnel, cls('path')],
      layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': p.path, 'line-width': zoomWidth(1.2, [[14.5, 0.8], [20, 5]]), 'line-dasharray': [2, 1.5], 'line-opacity': 0.9}},
    {id: 'road-minor-casing', type: 'line', source: SOURCE_ID, 'source-layer': 'transportation', minzoom: 14.5, filter: ['all', line, notTunnel, minor],
      layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': p.roadCasing, 'line-width': zoomWidth(1.5, [[14.5, 2.2], [20, 24]])}},
    {id: 'road-minor', type: 'line', source: SOURCE_ID, 'source-layer': 'transportation', minzoom: 12.5, filter: ['all', line, notTunnel, minor],
      layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': p.road, 'line-width': zoomWidth(1.5, [[12.5, 0.6], [14.5, 1.4], [20, 22]])}},
    {id: 'road-major-casing', type: 'line', source: SOURCE_ID, 'source-layer': 'transportation', minzoom: 11, filter: ['all', line, notTunnel, majorClasses],
      layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': p.roadCasing, 'line-width': zoomWidth(1.3, [[11, 2.2], [20, 28]])}},
    {id: 'road-major', type: 'line', source: SOURCE_ID, 'source-layer': 'transportation', minzoom: 11, filter: ['all', line, notTunnel, majorClasses],
      layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': p.road, 'line-width': zoomWidth(1.3, [[11, 1.2], [20, 26]])}},
    {id: 'road-motorway-casing', type: 'line', source: SOURCE_ID, 'source-layer': 'transportation', minzoom: 8, filter: ['all', line, notTunnel, motorway],
      layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': p.motorwayCasing, 'line-width': zoomWidth(1.3, [[8, 2], [20, 32]])}},
    {id: 'road-motorway', type: 'line', source: SOURCE_ID, 'source-layer': 'transportation', minzoom: 8, filter: ['all', line, notTunnel, motorway],
      layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': p.road, 'line-width': zoomWidth(1.3, [[8, 1], [20, 30]])}},
    {id: 'rail', type: 'line', source: SOURCE_ID, 'source-layer': 'transportation', minzoom: 12, filter: ['all', line, notTunnel, cls('rail')],
      paint: {'line-color': p.rail, 'line-width': zoomWidth(1.3, [[12, 0.8], [20, 4]]), 'line-dasharray': [6, 3]}},
    {id: 'transit', type: 'line', source: SOURCE_ID, 'source-layer': 'transportation', minzoom: 11, filter: ['all', line, notTunnel, cls('transit')],
      paint: {'line-color': p.transit, 'line-width': zoomWidth(1.3, [[11, 1], [20, 5]])}},
  ];
}

function labelLayers(p) {
  const halo = {'text-halo-color': p.halo, 'text-halo-width': 1.2, 'text-halo-blur': 0.6};
  return [
    {id: 'water-name', type: 'symbol', source: SOURCE_ID, 'source-layer': 'water_name', minzoom: 11,
      layout: {'text-field': name, 'text-font': FONT_ITALIC, 'text-size': 11, 'symbol-placement': 'line', 'text-letter-spacing': 0.05},
      paint: {'text-color': p.labelQuiet, ...halo}},
    {id: 'road-name-major', type: 'symbol', source: SOURCE_ID, 'source-layer': 'transportation_name', minzoom: 13.5, filter: cls('primary', 'secondary', 'tertiary', 'trunk', 'motorway'),
      layout: {'text-field': name, 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 13.5, 10.5, 17, 13], 'symbol-placement': 'line', 'text-rotation-alignment': 'map', 'symbol-spacing': 420, 'text-max-angle': 30},
      paint: {'text-color': p.label, ...halo}},
    {id: 'road-name-minor', type: 'symbol', source: SOURCE_ID, 'source-layer': 'transportation_name', minzoom: 15.5, filter: cls('minor', 'service', 'path'),
      layout: {'text-field': name, 'text-font': FONT, 'text-size': 10.5, 'symbol-placement': 'line', 'text-rotation-alignment': 'map', 'symbol-spacing': 360},
      paint: {'text-color': p.labelQuiet, ...halo}},
    {id: 'place-quarter', type: 'symbol', source: SOURCE_ID, 'source-layer': 'place', minzoom: 12, maxzoom: 15.5, filter: cls('suburb', 'quarter', 'neighbourhood'),
      layout: {'text-field': name, 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 15, 12], 'text-transform': 'uppercase', 'text-letter-spacing': 0.12, 'text-max-width': 8, 'text-padding': 12},
      paint: {'text-color': p.labelQuiet, ...halo}},
    {id: 'place-town', type: 'symbol', source: SOURCE_ID, 'source-layer': 'place', maxzoom: 12, filter: cls('city', 'town'),
      layout: {'text-field': name, 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 11, 13], 'text-max-width': 8},
      paint: {'text-color': p.label, ...halo}},
  ];
}

/**
 * Build the complete style object for a theme. `tileJSON` may override the
 * source URL (tests, offline harness). Layer order: ground fills → water →
 * buildings (2D) → [massing tiers are inserted before FIRST_LINE_LAYER by the
 * app] → roads → rail/transit → labels.
 */
export function buildMapStyle(theme = 'light', {palette = basemapPalette(theme), tileJSON = TILEJSON_URL, glyphs = GLYPHS_URL} = {}) {
  const p = palette;
  return {
    version: 8,
    name: `CityMETER paper (${theme})`,
    metadata: {'citymeter:theme': theme, 'citymeter:palette': 'assets/theme.css --basemap-*'},
    sources: {[SOURCE_ID]: {type: 'vector', url: tileJSON}},
    glyphs,
    light: {anchor: 'viewport', color: '#FFFFFF', intensity: 0.32, position: [1.15, 205, 38]},
    sky: {
      'sky-color': p.sky, 'horizon-color': p.horizon, 'fog-color': p.fog,
      'fog-ground-blend': 0.82, 'horizon-fog-blend': 0.85, 'sky-horizon-blend': 0.7,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 1, 11, 0],
    },
    layers: [
      {id: 'background', type: 'background', paint: {'background-color': p.ground}},
      {id: 'landcover-wood', type: 'fill', source: SOURCE_ID, 'source-layer': 'landcover', filter: ['all', poly, cls('wood')], paint: {'fill-color': p.wood, 'fill-antialias': false}},
      {id: 'landcover-grass', type: 'fill', source: SOURCE_ID, 'source-layer': 'landcover', filter: ['all', poly, cls('grass', 'farmland', 'wetland')], paint: {'fill-color': p.grass, 'fill-antialias': false}},
      {id: 'landcover-sand', type: 'fill', source: SOURCE_ID, 'source-layer': 'landcover', filter: ['all', poly, cls('sand')], paint: {'fill-color': p.sand, 'fill-antialias': false}},
      {id: 'landuse-green', type: 'fill', source: SOURCE_ID, 'source-layer': 'landuse', minzoom: 12, filter: ['all', poly, cls('pitch', 'playground', 'zoo', 'stadium', 'garden', 'cemetery')], paint: {'fill-color': p.grass}},
      {id: 'park', type: 'fill', source: SOURCE_ID, 'source-layer': 'park', filter: poly, paint: {'fill-color': p.park}},
      {id: 'aeroway-area', type: 'fill', source: SOURCE_ID, 'source-layer': 'aeroway', minzoom: 10, filter: poly, paint: {'fill-color': p.aeroway}},
      {id: 'water', type: 'fill', source: SOURCE_ID, 'source-layer': 'water', filter: ['all', poly, ['!=', ['get', 'brunnel'], 'tunnel']], paint: {'fill-color': p.water}},
      // Data fills (neighborhood choropleth) are inserted before this first line layer, so
      // they sit above the ground but beneath water lines, building footprints and roads.
      {id: FIRST_LINE_LAYER, type: 'line', source: SOURCE_ID, 'source-layer': 'waterway', filter: ['all', line, ['!=', ['get', 'brunnel'], 'tunnel']],
        layout: {'line-cap': 'round'}, paint: {'line-color': p.waterLine, 'line-width': ['interpolate', ['exponential', 1.3], ['zoom'], 10, ['match', ['get', 'class'], 'river', 1.2, 0.6], 18, ['match', ['get', 'class'], 'river', 7, 3]]}},
      {id: 'building', type: 'fill', source: SOURCE_ID, 'source-layer': 'building', minzoom: 13, paint: {'fill-color': p.building, 'fill-outline-color': p.buildingLine, 'fill-antialias': true}},
      {id: 'aeroway-runway', type: 'line', source: SOURCE_ID, 'source-layer': 'aeroway', minzoom: 11, filter: ['all', line, cls('runway', 'taxiway')], paint: {'line-color': p.road, 'line-width': zoomWidth(1.4, [[11, 1], [18, 20]])}},
      {id: 'pier', type: 'fill', source: SOURCE_ID, 'source-layer': 'transportation', filter: ['all', poly, cls('pier')], paint: {'fill-color': p.road}},
      ...roadLayers(p),
      ...labelLayers(p),
    ],
  };
}

/** Data fills go before this layer: above the ground, beneath water lines, footprints, roads and labels. */
export const DATA_FILL_BEFORE = FIRST_LINE_LAYER;
/**
 * 3D layers (city/focus massing, host buildings) go before the first label layer:
 * after every line layer, so pitched buildings occlude roads correctly, and before
 * symbols, so labels still draw over the buildings. Data outlines are appended last.
 */
export const MASSING_BEFORE = FIRST_LABEL_LAYER;
