/**
 * CityMETER · Transit — application orchestration.
 *
 * One committed selection drives everything. Row scopes (same contract as the
 * Luxury Brands demo, renamed for stations):
 *   scopeStations — stations after search/status/system/province filters, BEFORE
 *                   any line selection: the comparison base for the Aha, the
 *                   charts and the line ranking.
 *   baseStations  — scopeStations narrowed by the selected line (if any).
 *   pins          — focused stations get full detail (line colour, label, keyboard);
 *                   the rest of the scope is quiet grey context.
 *
 * Focus (state.focusMode):
 *   auto     — default overview: the top interchange hubs of the scope are the
 *              camera focus of the first 3D view; every line keeps its colour.
 *   none     — ?focus=all: the camera frames the whole scope.
 *   line     — a selected line: its alignment, stations and buildings carry the
 *              detail; other lines go quiet grey.
 *   station  — a selected station: its lines carry the detail; the camera is the
 *              station-level two-point view (มุมสถาปนิก) framed on its building.
 *
 * Map: MapLibre (paper basemap, province frames, 2D lines, quiet city massing)
 * plus one three.js custom layer (js/scene.js) for the rail model: ribbons,
 * piers, station plates, OSM station buildings and the focus massing, with a
 * soft ground shadow and raycast cycling of stacked objects.
 * URL state (own names, inside): filters, line, station, focus, view, view3d, cam, layers (and the 0.1 bus, boat) —
 * written in the shared grammar d · at · e · n · f.* · focus · view · v3d · cam by citymeter-shell (js/shell/url.js):
 * a line is `n=line:<id>`, a station `e=station:<id>`, one browser history entry per level (the back button goes up
 * a level).
 */
import {STATUS, hasPoint, isInterchange, filterStations, summarize, provinceByCode, PROVINCE_LIST} from './model.js';
import {decodePolyline, decodePoints} from './polyline.js';
import {computeInsight, rankLines, buildLineProfile, buildStationDetail} from './profile-model.js';
import {renderOverview, renderLine, renderStation, renderFilterChips, statusPill, link, esc, num, lineBadges} from './panel.js';
import {renderInsightChart} from './charts.js';
import {loadMapLibrary, loadThree} from './vendors.js';
import {installStationPins} from './pins.js';
import {installRailLines, installOptionalLayers, installAreaLabels} from './map-layers.js';
import {installProvinceLayers, buildProvinceModel, PROVINCE_FILL_MAX_ZOOM, PROVINCE_LABEL_MAX_ZOOM} from './provinces.js';
import {buildMapStyle, basemapPalette, TILEJSON_URL, MASSING_BEFORE, DATA_FILL_BEFORE} from './map-style.js';
import {installMassing, outerRings} from './massing.js';
import {nearbyModes, distanceLabel, NEARBY_RADIUS_M} from './nearby.js';
import {installScene, ELEVATION} from './scene.js';
import {presetFor, applyPreset, fitPitched} from './camera.js';
import {buildBreadcrumb, renderBreadcrumb, breadcrumbText} from './breadcrumb.js';
import {createCodec, createNavigator} from './shell/url.js';
import {pageTitle} from './shell/title.js';

const $ = id => document.getElementById(id);
const FIELDS = ['search', 'status', 'system', 'line', 'province'];
const BANGKOK = {center: [100.535, 13.755], zoom: 11.6};
const FOCUS_RADIUS_M = 700;
/** Station level: the area drawn as focus massing around the station, and the area the camera fits. */
const STATION_RADIUS_M = 450;
/** Roof allowance (m) used to frame a station area before its massing has loaded — a framing margin, not data. */
const DEFAULT_ROOF_M = 60;
/** Optional layers of the other modes (menu order) and their lazy files. */
const MODE_LAYERS = ['bus', 'stops', 'moto', 'boat', 'intercity', 'srt', 'air'];
const LAYER_FILE = {bus: 'data/bus.json', stops: 'data/bus.json', boat: 'data/boat.json', srt: 'data/layer-srt.json', intercity: 'data/layer-intercity.json', moto: 'data/layer-moto.json', air: 'data/layer-air.json'};
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobilePortrait = () => matchMedia('(max-width: 760px) and (orientation: portrait)').matches;
const animate = () => !reduced();

const state = {
  data: null, railGeo: null, buildingGeo: null, provinces: null, optionalData: {bus: null, stops: null, boat: null, srt: null, intercity: null, moto: null, air: null},
  lineById: new Map(), stationById: new Map(), systemById: new Map(), complexById: new Map(), buildingsByStation: new Map(), sourcesById: new Map(),
  scopeStations: [], baseStations: [], focusStations: [],
  view: 'lines', page: 0,
  focusMode: 'auto', selectedStationId: '', panel: {mode: 'overview', id: ''}, history: [], via: '',
  map: null, loaded: false, mapTheme: '', initialCameraDone: false, tileTemplate: '', lastPreset: '',
  view3d: true, twoPoint: true, layers: {bus: false, stops: false, boat: false, srt: false, intercity: false, moto: false, air: false},
  pins: null, rail: null, optional: null, provinceLayers: null, provinceLabels: null, provinceModel: null, massing: null, scene: null, THREE: null,
  ray: {objects: [], cycle: 0}, pinAlias: new Map(), ready: false, ridershipGroup: '',
};

/* ---------- helpers ---------- */
const values = () => Object.fromEntries(FIELDS.map(k => [k, $(k).value]));
const theme = () => document.documentElement.dataset.theme;
const announce = text => { $('announcement').textContent = text; };
const activeFilterCount = f => FIELDS.filter(k => f[k] && !(k === 'status' && f[k] === 'current')).length;
const sheetOpen = () => mobilePortrait() && $('panel').classList.contains('is-open');
const stationLevel = () => state.panel.mode === 'station';
const cameraPreset = () => presetFor({view3d: state.view3d, mode: state.panel.mode === 'overview' ? 'overview' : 'detail', twoPoint: state.twoPoint && stationLevel() && !sheetOpen()});
const selectedLine = () => state.lineById.get($('line').value) || null;
const currentStation = () => (state.panel.mode === 'station' ? state.stationById.get(state.panel.id) || null : null);
const linesOf = s => (s?.lineIds || []).map(id => state.lineById.get(id)).filter(Boolean);
const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/* ---------- address (citymeter-shell, js/shell/url.js) ---------- */
// The page keeps its own parameter names inside (saveURL / restoreFromURL); the shell writes them in the shared
// grammar d · at · e · n · f.* · focus · view · v3d · cam, and opening a line or a station adds one browser history
// entry, so the back button goes up a level. A line is a network (`n=line:<id>`), a station the thing open
// (`e=station:<id>`, the id this dataset owns and the other demos link with, e.g. RAILCAT:BTS_SUKHUMVIT:E4); a
// province is `at=BKK`. The filters are `f.q`, `f.status`, `f.system`, `f.layers`. Old links (?province=, ?line=,
// ?station= — the Hotel family links here with it — ?q=, ?status=, ?system=, ?layers=, ?focus=all, ?view3d=, the 0.1
// ?bus=1 / ?boat=1) still open and are rewritten. `transit` is the code in the dataset registry; production has not
// been checked for it, so the crumbs' production links carry no `d`.
const nav = createNavigator(createCodec({
  dataset: 'transit', levels: ['P'], place: {province: 'province'},
  items: {station: 'station'}, networks: {line: 'line'}, filters: ['q', 'status', 'system', 'layers'],
  rename: {focus: 'focus', view: 'view', view3d: 'v3d', cam: 'cam'},
}), {onPop: restoreFromHistory});

function saveURL() {
  const f = values(), p = new URLSearchParams();
  if (f.search) p.set('q', f.search);
  if (f.status && f.status !== 'current') p.set('status', f.status);
  if (f.system) p.set('system', f.system);
  if (f.line) p.set('line', f.line);
  if (f.province) p.set('province', f.province);
  if (state.panel.mode === 'station' && state.panel.id) p.set('station', state.panel.id);
  if (state.focusMode === 'none') p.set('focus', 'all');
  if (state.view !== 'lines') p.set('view', state.view);
  if (!state.view3d) p.set('view3d', '0');
  if (!state.twoPoint) p.set('cam', 'model');
  const on = MODE_LAYERS.filter(k => state.layers[k]);
  if (on.length) p.set('layers', on.join(','));
  nav.commit(p);
}

/* ---------- theme ---------- */
function scenePalette() {
  return {
    plate: cssVar('--scene-solid', '#FFFFFF'), plateQuiet: cssVar('--basemap-massing-quiet', '#ECEDE8'), building: cssVar('--scene-solid', '#FFFFFF'),
    context: cssVar('--scene-context', '#FFFFFF'), pier: cssVar('--scene-pier', '#FFFFFF'), lineQuiet: cssVar('--scene-line-quiet', '#B4BDB7'),
    hover: cssVar('--map-hover-stroke', '#347DA8'), selected: cssVar('--map-selected-stroke', '#176B82'), shadowOpacity: Number(cssVar('--scene-shadow-opacity', '0.2')) || 0.2,
    ground: cssVar('--basemap-ground', '#F1F1EC'), backing: cssVar('--border-emphasis', '#7D877F'),
  };
}
function applyTheme() {
  const value = $('theme').value;
  const next = value === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : value;
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('citymeter-transit-theme', value); } catch {}
  resolveLineColors();
  if (state.ready) { renderPanel(); renderLegend(); updatePins(); }
  if (state.map && next !== state.mapTheme) {
    state.loaded = false;
    disposeSpatial();
    state.mapTheme = next;
    state.map.setStyle(buildMapStyle(next), {diff: false});
  }
  if (state.data) drawChart();
}

/* ---------- selection ---------- */
function update({fit = false} = {}) {
  const f = values();
  state.scopeStations = filterStations(state.data.stations, {...f, line: ''}, state.data.lines);
  const line = selectedLine();
  state.baseStations = line ? state.scopeStations.filter(s => (s.lineIds || []).includes(line.id)) : state.scopeStations;
  state.page = 0;

  // Keep the panel honest: drop a station that left the filtered scope.
  if (state.panel.mode === 'station' && !state.baseStations.some(s => s.id === state.panel.id) && !state.scopeStations.some(s => s.id === state.panel.id)) { state.panel = line ? {mode: 'line', id: line.id} : {mode: 'overview', id: ''}; state.history = []; }
  if (state.panel.mode === 'line' && !line) state.panel = {mode: 'overview', id: ''};
  if (line && state.panel.mode === 'overview') state.panel = {mode: 'line', id: line.id};
  state.selectedStationId = state.panel.mode === 'station' ? state.panel.id : '';

  const s = summarize(state.baseStations, state.data.lines, state.data.complexes);
  $('result-count').textContent = num(state.baseStations.length);
  $('filter-count').textContent = activeFilterCount(f) ? String(activeFilterCount(f)) : '';
  $('filter-chips').innerHTML = renderFilterChips(f, {
    status: {operating: 'เปิดให้บริการ', construction: 'กำลังก่อสร้าง', all: 'ทั้งหมด รวมรายการที่ยังไม่ยืนยัน'},
    system: Object.fromEntries(state.data.systems.map(x => [x.id, x.name])),
    line: Object.fromEntries(state.data.lines.map(x => [x.id, x.name])),
    province: Object.fromEntries(PROVINCE_LIST.map(p => [p.code, p.th])),
  });
  renderPanel(s);
  renderLegend();
  updatePins();
  if (state.loaded) {
    updateSpatialLayers();
    if (fit) fitMap();
    else if (state.lastPreset && cameraPreset() !== state.lastPreset) applyPreset(state.map, cameraPreset(), {animate: animate()});
    state.lastPreset = cameraPreset();
  }
  drawChart();
  renderTable();
  saveURL();
  announce(`พบ ${num(state.baseStations.length)} สถานี ${num(s.lines)} สาย`);
}

/** Line ids that carry the detail: the selected line, the selected station's lines, or null (= all lines). */
function focusLineIds() {
  if (state.panel.mode === 'station') { const st = currentStation(); return st ? new Set([...(st.lineIds || []), ...(state.complexById.get(st.complexId)?.lineIds || [])]) : null; }
  const line = selectedLine();
  return line ? new Set([line.id]) : null;
}

/**
 * One pin per interchange complex: records of a complex within 150 m of the first
 * shown member share that pin (a presentation choice — every record stays in the
 * counts, the table and the panel). The selected station leads its complex.
 */
const metresBetween = (a, b) => Math.hypot((a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110574);
function groupComplexPins(rows, alias = null) {
  const lead = state.selectedStationId;
  const ordered = lead ? [...rows].sort((a, b) => (b.id === lead) - (a.id === lead)) : rows;
  const anchors = new Map(), out = [];
  for (const r of ordered) {
    const a = r.complexId && hasPoint(r) ? anchors.get(r.complexId) : null;
    if (a && metresBetween(a, r) <= 150) { a.pinMembers.push(r); alias?.set(r.id, a.id); continue; }
    const row = r.complexId ? {...r, pinMembers: [r]} : r;
    if (r.complexId && hasPoint(r) && !a) anchors.set(r.complexId, row);
    out.push(row);
  }
  return out;
}

function updatePins() {
  if (!state.pins) return;
  const focus = focusLineIds();
  state.pinAlias = new Map();
  const rows = groupComplexPins((focus ? state.scopeStations.filter(s => (s.lineIds || []).some(id => focus.has(id))) : state.baseStations).map(asDrawn), state.pinAlias);
  const ids = new Set(rows.flatMap(r => (r.pinMembers || [r]).map(m => m.id)));
  state.pins.update(rows, {contextRows: groupComplexPins(state.scopeStations.filter(r => !ids.has(r.id)).map(asDrawn), state.pinAlias)});
  if (state.selectedStationId) state.pins.select(state.pinAlias.get(state.selectedStationId) || state.selectedStationId);
}

/* ---------- breadcrumb ---------- */
function renderCrumbs() {
  const station = currentStation();
  const line = state.panel.mode === 'line' ? selectedLine() : (station && state.via && (station.lineIds || []).includes(state.via) ? state.lineById.get(state.via) : null);
  const provinceCode = station?.provinceCode || $('province').value || '';
  const crumbs = buildBreadcrumb({provinceCode, line: line ? {id: line.id, name: line.name} : null, station: station ? {id: station.id, name: station.name} : null});
  $('crumbs').innerHTML = renderBreadcrumb(crumbs);
  // Tab title: what the view shows, then the product, ≤ 60 characters (LDS FAVICON-01, js/shell/title.js).
  document.title = pageTitle(station ? `สถานี${station.name}` : state.panel.mode === 'line' && line ? line.name
    : `ระบบราง ${crumbs[crumbs.length - 1].label}`);
  return crumbs;
}

/* ---------- panel ---------- */
function renderPanel() {
  const view = $('panel-view');
  const mode = state.panel.mode;
  renderCrumbs();
  syncEyeToggle();
  let html = '';
  if (mode === 'line') html = renderLine(buildLineProfile(selectedLine(), state.scopeStations, {stationById: state.stationById, lineById: state.lineById, complexById: state.complexById, systems: state.data.systems}));
  else if (mode === 'station') {
    const st = currentStation(), detail = buildStationDetail(st, {stationById: state.stationById, lineById: state.lineById, interchanges: state.data.interchanges || [], complexById: state.complexById, buildingsByStation: state.buildingsByStation, sourcesById: state.sourcesById});
    const drawn = displayPoint(st), off = drawn && hasPoint(st) ? metresBetween({lng: drawn[0], lat: drawn[1]}, st) : 0;
    if (detail && off >= 20) detail.displayNote = `บนแผนที่วางสถานีที่อาคารสถานีจาก OpenStreetMap ห่างจุดอ้างอิงนี้ ${num(Math.round(off / 10) * 10)} ม.`;
    html = renderStation(detail, {lineById: state.lineById});
  }
  if (!html) {
    const insight = computeInsight(state.scopeStations, state.data.complexes || []);
    const ranking = rankLines(state.scopeStations, state.data.lines, state.data.systems).rows;
    const provinces = $('province').value ? [] : (state.provinceModel?.provinces || buildProvinceModelSafe()).filter(p => p.stations > 0).sort((a, b) => b.stations - a.stations || b.lines - a.lines);
    html = renderOverview({insight, summary: summarize(state.scopeStations, state.data.lines, state.data.complexes), lineRanking: ranking, provinces, focusMode: state.focusMode, asOf: state.data.meta?.asOf || '', provinceName: provinceByCode($('province').value)?.th || ''});
    renderMapAha(insight);
  } else {
    $('map-aha').hidden = true;
  }
  view.innerHTML = html;
  view.dataset.mode = mode;
  if (mode === 'station') renderStationModes();
  const key = `${mode}:${state.panel.id}:${$('line').value}:${$('province').value}`;
  if (key !== renderPanel.lastKey) $('panel').scrollTop = 0;
  renderPanel.lastKey = key;
}

function renderMapAha(insight) {
  const el = $('map-aha');
  if (!insight.stations) { el.hidden = true; return; }
  el.hidden = $('panel').classList.contains('is-open');
  const crumb = `<p class="map-aha-crumb">${esc(breadcrumbText(buildBreadcrumb({provinceCode: $('province').value})))}</p>`;
  el.innerHTML = `<div>${crumb}<h2>${num(insight.interchanges)} จุดเปลี่ยนสาย · ${num(insight.lines)} สาย</h2><p>${insight.hubs.map(h => `${esc(h.name)} ${num(h.lines)} สาย`).join(' · ')}</p></div>${state.focusMode === 'auto'
    ? '<button type="button" class="btn" data-action="clear-focus">ดูทั้งหมด</button>'
    : '<button type="button" class="btn primary" data-action="explore-top">โฟกัส</button>'}`;
}

function pushHistory() { state.history.push({...state.panel, line: $('line').value}); if (state.history.length > 20) state.history.shift(); }

function goBack() {
  // Every level is a browser history entry (citymeter-shell): go up the way the browser's button does.
  if (nav.canGoBack()) { nav.back(); return; }
  const previous = state.history.pop();
  if (!previous || previous.mode === 'overview') { $('line').value = previous?.line || ''; state.panel = {mode: 'overview', id: ''}; state.via = ''; update({fit: true}); return; }
  $('line').value = previous.line || '';
  state.panel = {mode: previous.mode, id: previous.id};
  update({fit: true});
}

function selectLine(id, {fromMap = false} = {}) {
  const line = state.lineById.get(id);
  if (!line) return;
  if (state.panel.mode !== 'line' || $('line').value !== id) pushHistory();
  if (![...$('line').options].some(o => o.value === id)) return;
  $('line').value = id;
  state.via = id;
  state.panel = {mode: 'line', id};
  update({fit: true});
  if (!fromMap) openMobilePanel();
  announce(`เลือก${line.name}`);
}

function selectStation(id, {fly = true, fromMap = false} = {}) {
  const st = state.stationById.get(id);
  if (!st) return;
  if (!state.scopeStations.some(s => s.id === id)) { // outside the filter: widen the status filter rather than hiding the click
    $('status').value = 'all'; $('system').value = ''; $('province').value = ''; $('search').value = '';
  }
  if (state.panel.mode !== 'station' || state.panel.id !== id) pushHistory();
  if (!state.via || !(st.lineIds || []).includes(state.via)) state.via = $('line').value && (st.lineIds || []).includes($('line').value) ? $('line').value : '';
  state.panel = {mode: 'station', id};
  state.selectedStationId = id;
  update();
  if (!fromMap || mobilePortrait()) openMobilePanel();
  if (state.loaded && fly) frameStation(st);
  state.lastPreset = cameraPreset();
  announce(`เลือกสถานี${st.name}`);
}

function selectProvince(code) {
  if (![...$('province').options].some(o => o.value === code)) return;
  $('province').value = code;
  $('line').value = '';
  state.panel = {mode: 'overview', id: ''};
  state.history = [];
  update({fit: true});
  announce(`จังหวัด${provinceByCode(code)?.th || code}`);
}

function exploreTop() { state.focusMode = 'auto'; update({fit: true}); closeMobilePanel(); }
function clearFocus() { state.focusMode = 'none'; update({fit: true}); }

function resetToOverview({fit = true} = {}) {
  state.panel = {mode: 'overview', id: ''};
  state.history = [];
  state.via = '';
  update({fit});
}

function clearFilter(key) {
  if (key === 'all') { $('filters').reset(); $('status').value = 'current'; $('line').value = ''; resetToOverview(); return; }
  $(key).value = key === 'status' ? 'current' : '';
  if (key === 'line') { resetToOverview(); return; }
  update({fit: key !== 'search'});
}

function onPanelAction(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const {action, id} = target.dataset;
  switch (action) {
    case 'select-line': selectLine(id); break;
    case 'select-station': selectStation(id); break;
    case 'select-province': selectProvince(id); break;
    case 'back': goBack(); break;
    case 'explore-top': exploreTop(); break;
    case 'clear-focus': clearFocus(); break;
    case 'open-charts': openInsights(true); closeMobilePanel(); break;
    case 'open-table': $('results').hidden = false; closeMobilePanel(); $('toggle-table').focus({preventScroll: true}); break;
    case 'clear-filter': clearFilter(id); break;
    case 'toggle-layer': toggleLayer(id).then(() => renderStationModes()); break;
    case 'crumb-country': $('province').value = ''; $('line').value = ''; resetToOverview(); break;
    case 'crumb-province': $('province').value = id; $('line').value = ''; resetToOverview(); break;
    case 'crumb-network': selectLine(id); break;
    case 'crumb-site': selectStation(id); break;
    case 'crumb-expand': { const ol = target.closest('.crumbs'); ol.classList.add('is-expanded'); target.setAttribute('aria-expanded', 'true'); ol.querySelector('.crumb:not(.crumb-more)')?.focus({preventScroll: true}); break; }
    default: break;
  }
}

/* ---------- legend ---------- */
const provinceZoom = () => Boolean(state.provinceModel) && (state.map?.getZoom?.() ?? 12) < PROVINCE_FILL_MAX_ZOOM;
function renderLegend() {
  const atProvince = provinceZoom();
  const model = state.provinceModel;
  const steps = $('legend-steps');
  $('legend-areas').hidden = !atProvince;
  if (atProvince) {
    if (!model || !model.classes.classes.length) steps.innerHTML = '<span class="hint">ไม่มีจังหวัดที่มีสถานีในตัวกรองนี้</span>';
    else {
      steps.innerHTML = model.classes.classes.map(c => `<span class="legend-step"><i style="background:${c.fill}" aria-hidden="true"></i>${esc(c.label)}</span>`).join('') +
        (model.zeroCount ? '<span class="legend-step" title="จังหวัดที่มีสถานีในข้อมูล แต่ไม่พบในตัวกรองนี้"><i class="legend-zero" aria-hidden="true"></i>0</span>' : '');
      $('legend-areas').title = `สถานีต่อจังหวัด · ${model.classes.classCount} ระดับเท่าช่วง จากค่าสูงสุด ${model.classes.max} · จังหวัดที่ไม่มีสถานีในข้อมูลไม่ระบายสี · สีเดียวกันทั้งสองธีม`;
    }
  }
  const lines = state.data.lines.filter(l => state.scopeStations.some(s => (s.lineIds || []).includes(l.id)));
  $('line-items').innerHTML = lines.map(l => `<span><i class="line-swatch${l.status === 'construction' ? ' is-construction' : ''}" style="--line-color:${esc(l.color || '')}" aria-hidden="true"></i>${esc(l.name)}</span>`).join('');
  document.querySelector('.legend-bus-item').hidden = !state.layers.bus;

  document.querySelector('.map-panel').classList.toggle('is-3d', state.view3d);
  document.querySelector('.map-panel').classList.toggle('is-province-zoom', atProvince);
}

/* ---------- charts ---------- */
let chartDispose = null;
function ridershipMetrics() {
  // Group values by metric + unit + period + aggregation so a bar chart never mixes incomparable values;
  // a value the source reports for a whole complex (seriesKey shared by two records) is drawn once.
  const groups = new Map();
  for (const s of state.baseStations) for (const r of s.ridership || []) {
    const key = [r.metric, r.unit, r.period, r.aggregation].join('|');
    if (!groups.has(key)) groups.set(key, {key, label: r.label.split(' · ')[0], fullLabel: r.label, unit: r.unit, period: r.period, aggregation: r.aggregation, dataset: r.dataset || '', source: r.source || '', note: r.note || '', values: [], seen: new Set()});
    const g = groups.get(key);
    const series = r.seriesKey || `${s.id}|${key}`;
    if (g.seen.has(series)) continue;
    g.seen.add(series);
    const complex = r.shared ? state.complexById.get(s.complexId) : null;
    g.values.push({stationId: s.id, name: complex ? `${complex.name} (รวม ${num(complex.lineIds.length)} สาย)` : s.name, value: r.value, lineIds: complex ? complex.lineIds : s.lineIds});
  }
  return [...groups.values()].filter(g => g.aggregation !== 'sum_of_available_months').sort((a, b) => b.values.length - a.values.length);
}
function drawChart() {
  if (!state.data) return;
  chartDispose?.(); chartDispose = null;
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-selected', String(b.dataset.view === state.view));
  $('chart').setAttribute('aria-labelledby', 'tab-' + state.view);
  $('chart-scope').textContent = `${num(state.scopeStations.length)} สถานีในตัวกรอง`;
  if ($('insight-content').hidden) return;
  const rows = rankLines(state.scopeStations, state.data.lines, state.data.systems).rows;
  chartDispose = renderInsightChart({elementId: 'chart', view: state.view, lineRows: rows, ridershipMetrics: ridershipMetrics(), ridershipGroup: state.ridershipGroup, selectedLineId: $('line').value, selectedStationId: state.selectedStationId, lineById: state.lineById, theme: theme()}, selection => {
    if (selection.type === 'line') selectLine(selection.id, {fromMap: true});
    if (selection.type === 'station') selectStation(selection.id, {fromMap: true});
    if (selection.type === 'metric') { state.ridershipGroup = selection.id; drawChart(); }
  });
}
function openInsights(open) {
  $('insight-content').hidden = !open;
  $('insights').classList.toggle('is-collapsed', !open);
  $('toggle-insights').setAttribute('aria-expanded', String(open));
  $('toggle-insights').textContent = open ? 'ย่อกราฟ' : 'เปิดกราฟ';
  requestAnimationFrame(() => { syncBottomPanel(); drawChart(); });
}
function syncBottomPanel() {
  document.documentElement.style.setProperty('--bottom-panel-height', `${$('insights').getBoundingClientRect().height}px`);
  state.pins?.layout();
  state.provinceLabels?.layout();
}

/* ---------- table ---------- */
function renderTable() {
  const pageSize = 25, start = state.page * pageSize, rs = state.baseStations.slice(start, start + pageSize);
  $('result-rows').innerHTML = rs.map(s => `<tr><td><button type="button" class="row-name" data-id="${esc(s.id)}">${esc(s.name)}</button><small>${esc([s.nameEn, (s.codes || []).join(' / ')].filter(Boolean).join(' · '))}</small></td>
      <td>${lineBadges(s.lineIds, state.lineById)}</td>
      <td>${esc(provinceByCode(s.provinceCode)?.th || '—')}</td>
      <td>${statusPill(s.status, s.statusBasis || '')}</td>
      <td><small class="data-number">${hasPoint(s) ? s.lat.toFixed(5) + ', ' + s.lng.toFixed(5) : 'ไม่มีพิกัด'}</small></td>
      <td class="links">${(s.sourceRefs || []).slice(0, 3).map(r => link(r.url, r.label || 'หลักฐาน')).join('')}</td></tr>`).join('') || '<tr><td colspan="6">ไม่พบสถานีตามตัวกรอง</td></tr>';
  $('page-label').textContent = state.baseStations.length ? `${num(start + 1)}–${num(Math.min(start + pageSize, state.baseStations.length))} / ${num(state.baseStations.length)}` : '0 สถานี';
  $('prev-page').disabled = state.page === 0;
  $('next-page').disabled = start + pageSize >= state.baseStations.length;
  for (const b of $('result-rows').querySelectorAll('[data-id]')) b.onclick = () => { selectStation(b.dataset.id); $('panel').scrollTop = 0; };
}

/* ---------- map ---------- */
/** Bottom edge of the top map chrome: the toolbar and the mode row under it. */
function topChrome() {
  const toolbar = document.querySelector('.map-toolbar').getBoundingClientRect();
  const bar = $('mode-bar');
  return {bottom: bar && bar.offsetHeight ? Math.max(toolbar.bottom, bar.getBoundingClientRect().bottom) : toolbar.bottom};
}
function cameraPadding() {
  const height = $('map').clientHeight, panel = $('insights').getBoundingClientRect().height;
  const edge = Math.min(48, Math.max(12, (height - panel) / 6));
  const mapTop = $('map').getBoundingClientRect().top, toolbar = topChrome();
  const aha = $('map-aha'), legend = $('map-legend');
  const chromeTop = !aha.hidden && aha.offsetHeight ? aha.getBoundingClientRect().top : legend.offsetHeight ? legend.getBoundingClientRect().top : null;
  let bottom = chromeTop != null ? height - (chromeTop - mapTop) + 12 : panel + edge;
  if (mobilePortrait() && $('panel').classList.contains('is-open')) bottom = Math.max(bottom, Math.round(window.innerHeight * 0.64) - (window.innerHeight - height - mapTop) + 8);
  return {top: Math.max(edge, toolbar.bottom - mapTop + 12), left: edge, right: edge, bottom: Math.min(height * 0.7, bottom)};
}
function pitchedPadding() {
  const mapTop = $('map').getBoundingClientRect().top, toolbar = topChrome();
  return {top: Math.round(toolbar.bottom - mapTop + 12), bottom: Math.round($('insights').getBoundingClientRect().height + 40), left: 24, right: 24};
}

/** A ring of `radius` metres around a point (lon/lat), closed — the focus region of one station. */
function circleRing([lng, lat], radius = FOCUS_RADIUS_M, steps = 24) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110574;
  const ring = Array.from({length: steps}, (_, i) => { const a = (i / steps) * 2 * Math.PI; return [lng + (Math.cos(a) * radius) / kx, lat + (Math.sin(a) * radius) / ky]; });
  ring.push([...ring[0]]);
  return ring;
}

/** Points that define the camera focus of the current state. */
function focusPoints() {
  const st = currentStation();
  if (st && hasPoint(st)) return [displayPoint(st)];
  const line = selectedLine();
  if (line) return state.scopeStations.filter(s => (s.lineIds || []).includes(line.id) && hasPoint(s)).map(s => [s.lng, s.lat]);
  if (state.focusMode === 'auto') {
    const hubs = computeInsight(state.scopeStations, state.data.complexes || []).hubs.filter(h => Number.isFinite(h.lat));
    if (hubs.length) return hubs.map(h => [h.lng, h.lat]);
  }
  return state.baseStations.filter(hasPoint).map(s => [s.lng, s.lat]);
}

function fitMap({instant = false} = {}) {
  if (!state.loaded) return;
  if (state.panel.mode === 'station') { const st = currentStation(); if (st) frameStation(st, {instant}); return; }
  const pts = focusPoints();
  if (!pts.length) return;
  const b = pts.reduce((acc, p) => acc.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
  // A hub focus is framed with its surroundings (the station buildings and the focus massing).
  const pad = state.panel.mode === 'overview' && state.focusMode === 'auto' ? 0.006 : 0.002;
  const box = new maplibregl.LngLatBounds([b.getWest() - pad, b.getSouth() - pad], [b.getEast() + pad, b.getNorth() + pad]);
  const wide = box.getNorth() - box.getSouth() > 1.2 || box.getEast() - box.getWest() > 1.2;
  const preset = wide ? 'plan' : cameraPreset();
  const pitched = preset !== 'plan' && !mobilePortrait();
  const corners = [[box.getWest(), box.getSouth()], [box.getEast(), box.getSouth()], [box.getEast(), box.getNorth()], [box.getWest(), box.getNorth()]];
  fitPitched(state.map, box, {preset, padding: pitched ? pitchedPadding() : cameraPadding(), maxZoom: state.panel.mode === 'line' ? 14.5 : 15.2, minZoom: 4.5, animate: animate() && !instant, points: pitched ? corners : null, shift: mobilePortrait() && !wide ? -0.12 : null});
  state.lastPreset = preset;
}

/** Tallest roof (m) of the loaded massing and station buildings within `radius` of a point; null before the massing has loaded. */
function regionRoof([lng, lat], radius = STATION_RADIUS_M) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110574;
  const near = f => outerRings(f).some(ring => ring.some(([x, y]) => Math.hypot((x - lng) * kx, (y - lat) * ky) <= radius));
  const context = (state.contextFeatures || []).filter(near);
  if (!context.length) return null;
  return Math.max(...context.map(f => Number(f.properties?.height) || 0));
}

/**
 * Station level: the camera fits the station area — the focus-massing ring of
 * STATION_RADIUS_M around the station, with the roofs of the buildings in it —
 * to the visible map (below the toolbar, above the chart tray or the mobile sheet).
 */
function frameStation(st, {instant = false, roof = null, duration = 650} = {}) {
  if (!state.loaded || !hasPoint(st)) return;
  const map = state.map, preset = cameraPreset();
  const centre = displayPoint(st);
  const ring = circleRing(centre, STATION_RADIUS_M, 32);
  const own = Math.max(0, ...(state.buildingsByStation.get(st.id)?.features || []).map(f => Number(f.properties?.height) || 0));
  const around = roof ?? regionRoof(centre);
  const top = Math.max(own, around ?? DEFAULT_ROOF_M);
  const points = preset === 'plan' ? ring : [...ring.map(([x, y]) => [x, y, 0]), ...ring.map(([x, y]) => [x, y, top])];
  const bounds = ring.reduce((acc, p) => acc.extend(p), new maplibregl.LngLatBounds(ring[0], ring[0]));
  const padding = mobilePortrait() ? cameraPadding() : pitchedPadding();
  fitPitched(map, bounds, {preset, points, padding, maxZoom: 18.5, minZoom: 11, recenter: true, shift: 0, animate: animate() && !instant, duration});
  state.stationFrame = {id: st.id, roof: top, measured: around != null, moved: false};
}

/** Once the massing of the station area has loaded, refit if its roofs are taller than the frame allowed (only while the user has not moved the camera). */
function refitStationRoof() {
  const f = state.stationFrame, st = currentStation();
  if (!f || f.moved || !st || st.id !== f.id || state.panel.mode !== 'station' || cameraPreset() === 'plan') return;
  const roof = regionRoof(displayPoint(st));
  if (roof == null || (f.measured && roof <= f.roof + 1) || (!f.measured && Math.abs(roof - f.roof) < 12)) { if (roof != null) f.measured = true; return; }
  frameStation(st, {roof, duration: 450});
}

function provinceScopeStations() { return filterStations(state.data.stations, {...values(), province: '', line: ''}, state.data.lines); }
let datasetProvinceCodes = null;
function buildProvinceModelSafe() {
  try { return state.provinces?.features?.length ? buildProvinceModel(provinceScopeStations(), state.provinces, {datasetCodes: datasetProvinceCodes}).provinces : []; } catch { return []; }
}

/** Lines for the scene/2D layers: geometry grouped per line with focus/quiet flags. */
function sceneLines(focus) {
  const visible = new Set(state.scopeStations.flatMap(s => s.lineIds || []));
  const out = new Map();
  for (const f of state.railGeo?.features || []) {
    const id = f.properties.lineId;
    const line = state.lineById.get(id);
    if (!line || !visible.has(id)) continue;
    if (!out.has(id)) out.set(id, {id, color: line.color, status: line.status, elevation: line.elevation, quiet: Boolean(focus && !focus.has(id)), parts: []});
    const g = f.geometry, elevation = f.properties.elevation || line.elevation || 'surface';
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const coords of lines) out.get(id).parts.push({coords, elevation});
  }
  return [...out.values()];
}

function sceneStations(focus) {
  // Same grouping as the pins: one plate per interchange complex, striped with every line that meets there.
  // A station whose hall OSM maps is drawn as that hall only (no plate beside it).
  return groupComplexPins(state.scopeStations.filter(hasPoint).map(asDrawn)).filter(s => !(s.pinMembers || [s]).some(m => state.buildingsByStation.has(m.id))).map(s => {
    const members = s.pinMembers || [s];
    return {
      id: s.id, lng: s.lng, lat: s.lat, status: s.status, bearing: s.bearing || 0,
      role: isInterchange(s) ? 'hub' : 'station', elevation: s.elevation || 'surface',
      colors: [...new Set(members.flatMap(linesOf))].map(l => l.color).filter(Boolean),
      quiet: Boolean(focus && !members.some(m => (m.lineIds || []).some(id => focus.has(id)))),
    };
  });
}

function updateSpatialLayers() {
  if (!state.loaded) return;
  const map = state.map;
  const focus = focusLineIds();
  const code = $('province').value;
  const pm = state.provinceLayers?.update({rows: provinceScopeStations(), selectedCode: code, visible: true, datasetCodes: datasetProvinceCodes}) || null;
  state.provinceModel = pm;
  state.provinceLabels?.update(pm ? pm.provinces.filter(p => p.stations > 0 || p.code === code).map(p => ({id: p.code, name: p.name, count: p.stations, state: p.state, quiet: Boolean(code) && p.code !== code, labelPoint: p.feature.properties?.labelPoint, feature: p.feature})) : [], {selectedId: code, visible: true, LngLatBounds: maplibregl.LngLatBounds});
  renderLegend();
  state.rail?.update({focusLineIds: focus, selectedLineId: state.panel.mode === 'line' ? $('line').value : '', visibleLineIds: new Set(state.scopeStations.flatMap(s => s.lineIds || []))});
  state.rail?.setMode(state.view3d && Boolean(state.scene));
  // Scene content.
  if (state.scene) {
    state.scene.setEnabled(state.view3d);
    state.scene.setLines(sceneLines(focus));
    state.scene.setStations(sceneStations(focus));
    const shown = new Set(state.scopeStations.map(s => s.id));
    state.scene.setBuildings((state.buildingGeo?.features || []).filter(f => (f.properties?.stationIds || [f.properties?.stationId]).some(id => shown.has(id))));
    state.scene.setSelected(state.pinAlias.get(state.selectedStationId) || state.selectedStationId);
    state.scene.setScale({zoom: map.getZoom(), latitude: map.getCenter().lat});
  }
  // Focus massing: rings around the focused stations (≤ 6, nearest the view centre), hosts = matched station buildings.
  const c = map.getCenter();
  const anchors = focusPoints().sort((a, b) => Math.hypot(a[0] - c.lng, a[1] - c.lat) - Math.hypot(b[0] - c.lng, b[1] - c.lat)).slice(0, state.panel.mode === 'station' ? 1 : 6);
  const hosts = (state.buildingGeo?.features || []).flatMap(outerRings);
  state.massing?.update({regions: state.view3d ? anchors.map(p => circleRing(p, state.panel.mode === 'station' ? STATION_RADIUS_M : FOCUS_RADIUS_M)) : [], hosts, anchors, enabled: true, city: state.view3d, zoom: map.getZoom(), latitude: c.lat})?.catch(e => console.warn('Massing', e));
  state.pins?.layout();
}

function disposeSpatial() {
  for (const k of ['scene', 'massing', 'rail', 'optional', 'provinceLayers']) { try { state[k]?.dispose(); } catch (e) { console.warn('dispose', k, e); } state[k] = null; }
}

function installSpatialLayers() {
  const map = state.map;
  state.loaded = true;
  const palette = basemapPalette(theme());
  state.provinceLayers = state.provinces?.features?.length ? installProvinceLayers(map, state.provinces, {onSelect: code => selectProvince(code)}) : null;
  state.optional = installOptionalLayers(map, {beforeId: DATA_FILL_BEFORE, onPick: showContextPopup});
  state.rail = installRailLines(map, state.railGeo, {beforeId: MASSING_BEFORE, onSelect: id => selectLine(id, {fromMap: true})});
  state.massing = installMassing(map, {
    beforeId: MASSING_BEFORE, colors: {quiet: palette.massingQuiet, focus: palette.massingFocus, ground: palette.ground},
    tileUrl: t => (state.tileTemplate ? state.tileTemplate.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y) : ''),
    focusRenderer: state.THREE ? 'external' : 'maplibre',
    onFeatures: features => { state.contextFeatures = features || []; state.scene?.setContext(features); refitStationRoof(); },
    onResult: result => { $('map-status').dataset.massing = `${result.features || 0}`; },
  });
  if (state.THREE) {
    try {
      state.scene = installScene(map, state.THREE, maplibregl, {
        beforeId: MASSING_BEFORE, palette: scenePalette(), reducedMotion: reduced,
        onHover: (top, hits, cycle) => renderRayStatus(hits, cycle),
        onCycle: ({objects, cycle}) => renderRayStatus(objects, {cycle}),
        onSelect: hit => {
          if (!hit) return;
          if (hit.kind === 'station') selectStation(hit.id, {fromMap: true});
          else if (hit.kind === 'building' && hit.stationId) selectStation(hit.stationId, {fromMap: true});
          else if (hit.kind === 'line') selectLine(hit.lineId, {fromMap: true});
        },
      });
    } catch (e) { state.scene = null; console.warn('3D scene unavailable', e); }
  }
  for (const kind of MODE_LAYERS) if (state.layers[kind]) toggleLayer(kind, true);
  updateSpatialLayers();
  if (!state.initialCameraDone) { state.initialCameraDone = true; fitMap({instant: true}); }
}

/** The pmndrs raycast-cycling status: one dot per object under the cursor, the active one highlighted. */
function renderRayStatus(objects = [], cycle = {cycle: 0}) {
  const el = $('ray-status');
  const list = (objects || []).slice(0, 8);
  if (list.length < 1) { el.hidden = true; return; }
  const active = Math.min(list.length - 1, Number(cycle?.cycle) || 0);
  const name = o => {
    if (o.kind === 'line') return {title: state.lineById.get(o.lineId)?.name || 'สาย', kind: 'แนวสาย'};
    const st = state.stationById.get(o.stationId || o.id);
    return {title: st?.name || 'สถานี', kind: o.kind === 'building' ? 'อาคาร (OSM)' : 'สถานี'};
  };
  const n = name(list[active]);
  el.innerHTML = `<span class="ray-dots" aria-hidden="true">${list.map((_, i) => `<i class="ray-dot${i === active ? ' is-active' : ''}"></i>`).join('')}</span><span class="ray-name">${esc(n.title)}<small>${esc(n.kind)}${list.length > 1 ? ` · ${num(active + 1)}/${num(list.length)} กดซ้ำเพื่อสลับ` : ''}</small></span>`;
  el.hidden = false;
}

/** data/bus.json is stored as encoded polylines (scripts/build-data.py); the map layers take GeoJSON. */
function optionalGeoJSON(kind, raw) {
  if (!['bus', 'stops'].includes(kind) || !Array.isArray(raw?.routes)) return raw;
  const fc = features => ({type: 'FeatureCollection', features});
  const lines = raw.routes.map(r => ({type: 'Feature', properties: {class: r.c, routes: r.n}, geometry: {type: 'LineString', coordinates: decodePolyline(r.p)}}));
  const brt = (raw.brt?.routes || []).map(r => ({type: 'Feature', properties: {class: 0, routes: 1, brt: 1, name: r.name}, geometry: {type: 'LineString', coordinates: decodePolyline(r.p)}}));
  const stops = decodePoints(raw.stops || '').map(c => ({type: 'Feature', properties: {brt: 0}, geometry: {type: 'Point', coordinates: c}}));
  const brtStops = (raw.brt?.stations || []).map(st => ({type: 'Feature', properties: {brt: 1, name: st.name}, geometry: {type: 'Point', coordinates: [st.lng, st.lat]}}));
  return {meta: raw.meta, routes: fc([...lines, ...brt]), stops: fc([...stops, ...brtStops])};
}

const layerLoads = new Map();
/** Fetch one layer file once (map toggles and the station's nearby modes share it; bus routes and stops share data/bus.json). */
function loadLayer(kind) {
  if (state.optionalData[kind]) return Promise.resolve(state.optionalData[kind]);
  const file = LAYER_FILE[kind];
  if (!layerLoads.has(file)) {
    layerLoads.set(file, fetchJSON(file).then(raw => {
      const data = optionalGeoJSON(kind, raw);
      for (const k of MODE_LAYERS) if (LAYER_FILE[k] === file) state.optionalData[k] = data;
      return data;
    }).catch(e => { layerLoads.delete(file); throw e; }));
  }
  return layerLoads.get(file);
}

async function toggleLayer(kind, on = !state.layers[kind]) {
  if (!LAYER_FILE[kind]) return;
  state.layers[kind] = on;
  renderModeMenu();
  if (on && !state.optionalData[kind]) {
    try { await loadLayer(kind); }
    catch (e) { console.warn(`Optional ${kind} layer unavailable`, e); state.layers[kind] = false; renderModeMenu(); $('map-status').textContent = `โหลดชั้น${state.data?.meta?.contextLayers?.[kind]?.label || ''}ไม่สำเร็จ`; return; }
  }
  if (state.loaded && state.optional) state.optional.setVisible(kind, state.layers[kind], state.optionalData[kind]);
  renderLegend();
  saveURL();
  if (on) announce(`เปิดชั้น${state.data?.meta?.contextLayers?.[kind]?.label || ''}`);
}

/* ---------- other modes: menu, legend, popups, nearby ---------- */
const layerNote = c => [c.count != null ? `${num(c.count)} ${c.unit}` : '', c.source, c.period, c.boundary].filter(Boolean).join(' · ');
function renderModeMenu() {
  const summary = state.data?.meta?.contextLayers || {};
  // Every mode has its own toggle in one row under the toolbar, on every screen (owner 2026-11-01: the menu
  // button was not found); off by default, pressed = shown on the map.
  $('mode-chips').innerHTML = MODE_LAYERS.filter(k => summary[k]).map(k => `<button type="button" class="mode-chip" data-layer="${k}" aria-pressed="${state.layers[k]}" title="${esc(layerNote(summary[k]))}"><i class="mode-sym is-${k}" aria-hidden="true"></i><span>${esc(summary[k].short || summary[k].label)}</span></button>`).join('');
  $('mode-list').innerHTML = MODE_LAYERS.filter(k => summary[k]).map(k => {
    const c = summary[k];
    return `<li><button type="button" class="mode-item" data-layer="${k}" aria-pressed="${state.layers[k]}"><i class="mode-sym is-${k}" aria-hidden="true"></i><span class="mode-text"><strong>${esc(c.label)}</strong><small>${esc(layerNote(c))}</small></span><span class="mode-state" aria-hidden="true">${state.layers[k] ? 'เปิด' : 'ปิด'}</span></button></li>`;
  }).join('');
}
function setModeMenu(open, {focus = false} = {}) {
  $('mode-menu').hidden = !open;
  $('toggle-modes').setAttribute('aria-expanded', String(open));
  renderModeMenu();
  if (open) $('mode-list').querySelector('button')?.focus();
  else if (focus) $('toggle-modes').focus();
}

let contextPopup = null;
function showContextPopup({layer, properties: p, lngLat}) {
  const summary = state.data?.meta?.contextLayers || {};
  const kind = layer.startsWith('ctx-') ? layer.slice(4) : layer.startsWith('boat') ? 'boat' : layer.startsWith('bus-stop') ? 'stops' : '';
  const c = summary[kind] || {};
  const title = p.name || (kind === 'stops' ? 'ป้ายรถเมล์ใน GTFS' : c.label || '');
  const sub = [p.kindLabel || (kind === 'boat' ? 'ท่าเรือ' : kind === 'stops' ? (p.brt ? 'สถานี BRT' : 'จุดจอดของแหล่ง ไม่ใช่จำนวนป้ายจริง') : ''), p.code, p.area].filter(Boolean).join(' · ');
  const html = `<div class="ctx-popup"><strong>${esc(title)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}${p.status ? `<span>${esc(p.status)}</span>` : ''}<small>${esc([c.source, c.period].filter(Boolean).join(' · '))}</small></div>`;
  contextPopup?.remove();
  contextPopup = new maplibregl.Popup({closeButton: true, maxWidth: '280px', className: 'ctx-popup-wrap'}).setLngLat(lngLat).setHTML(html).addTo(state.map);
}

/** Points of a loaded layer as [{lng, lat, name}] for the nearby counts. */
function layerPoints(kind) {
  const d = state.optionalData[kind];
  if (!d) return null;
  if (kind === 'bus' || kind === 'stops') return d.stops.features.map(f => ({lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], name: f.properties.name || ''}));
  if (kind === 'boat') return d.stops.features.map(f => ({lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], name: f.properties.name || ''}));
  const i = name => (d.fields || []).indexOf(name);
  return (d.rows || []).map(r => ({lng: r[i('lng')], lat: r[i('lat')], name: r[i('name')] || ''}));
}

/** The station panel's "other modes around this station" block — counts within NEARBY_RADIUS_M and the nearest point of each layer. */
function renderStationModes() {
  const el = $('station-modes');
  const st = currentStation();
  const summary = state.data?.meta?.contextLayers;
  if (!el || !st || !summary || !hasPoint(st)) { if (el) el.hidden = true; return; }
  const points = Object.fromEntries(MODE_LAYERS.map(k => [k, layerPoints(k)]));
  const rows = nearbyModes(st, points, summary);
  const missing = rows.filter(r => r.state === 'loading').map(r => r.layer);
  const line = r => {
    if (r.state === 'outside') return `<span class="hint">นอกขอบเขตข้อมูล (${esc(r.boundary)})</span>`;
    if (r.state === 'loading') return '<span class="hint">กำลังนับ…</span>';
    const count = r.layer === 'air' ? '' : r.count ? `<strong class="data-number">${num(r.count)}</strong> ${esc(r.unit)}ใน ${num(NEARBY_RADIUS_M)} ม.` : `ไม่พบใน ${num(NEARBY_RADIUS_M)} ม.`;
    const nearest = r.nearest ? `ใกล้สุด ${esc(distanceLabel(r.nearest.distance))}${r.nearest.name ? ` · ${esc(r.nearest.name)}` : ''}` : '';
    return [count, nearest].filter(Boolean).join(' · ');
  };
  el.hidden = false;
  el.innerHTML = `<div class="section-heading"><h3>ขนส่งอื่นรอบสถานี</h3><span class="hint">ระยะเส้นตรงจากจุดอ้างอิงสถานี ไม่ใช่ระยะเดิน</span></div>
    <ul class="mode-near-list">${rows.map(r => `<li><i class="mode-sym is-${r.layer}" aria-hidden="true"></i><span class="mode-text"><strong>${esc(r.label)}</strong><span>${line(r)}</span><small>${esc([r.source, r.period].filter(Boolean).join(' · '))}</small></span><button type="button" class="btn quiet small" data-action="toggle-layer" data-id="${r.layer}" aria-pressed="${state.layers[r.layer]}">${state.layers[r.layer] ? 'ซ่อนบนแผนที่' : 'ดูบนแผนที่'}</button></li>`).join('')}</ul>`;
  if (missing.length) Promise.allSettled(missing.map(loadLayer)).then(() => { if (currentStation()?.id === st.id) renderStationModes(); });
}

function initMap() {
  if (!window.maplibregl) throw new Error('Map library is unavailable');
  state.mapTheme = theme();
  state.map = new maplibregl.Map({container: 'map', center: BANGKOK.center, zoom: BANGKOK.zoom, pitch: 0, maxPitch: 85, attributionControl: {compact: true}, style: buildMapStyle(state.mapTheme)});
  state.map.addControl(new maplibregl.NavigationControl({showCompass: true, visualizePitch: true}), 'top-right');
  state.provinceLabels = installAreaLabels(state.map, $('map'), {className: 'province-label', hostId: 'province-labels', hostLabel: 'จังหวัดบนแผนที่', minZoom: 0, maxZoom: PROVINCE_LABEL_MAX_ZOOM, verb: 'กดเพื่อดูจังหวัด', unit: 'สถานี', onSelect: code => selectProvince(code), reservedBottom: () => $('insights').getBoundingClientRect().height + 12});
  state.pins = installStationPins(state.map, $('map'), {
    reservedBottom: () => $('insights').getBoundingClientRect().height + 12,
    altitude: row => (!state.view3d || !state.scene ? 0 : Math.max(row.elevation === 'elevated' ? ELEVATION.elevated + 3 : 0, Number.isFinite(row.buildingTop) ? row.buildingTop + 2 : 0)),
    describe: row => {
      const members = row.pinMembers || [row];
      const lines = [...new Set(members.flatMap(linesOf))];
      const status = STATUS[row.status]?.label || '';
      const name = members.length > 1 ? state.complexById.get(row.complexId)?.name || row.name : row.name;
      return {label: `${name} · ${lines.map(l => l.name).join(', ') || 'ไม่ระบุสาย'} · ${status}`, shortLabel: name, color: lines[0]?.color || '', interchange: isInterchange(row), construction: row.status === 'construction'};
    },
    onSelect: r => selectStation(r.id, {fromMap: true}),
    onHover: r => state.scene?.setHover(r ? r.id : ''),
    onLayout: stats => {
      const context = stats.contextPins ? ` · บริบท ${num(stats.contextPins)}` : '';
      $('map-status').textContent = `${num(stats.visiblePins)} สถานี${context}`;
    },
  });
  updatePins();
  state.map.on('style.load', installSpatialLayers);
  state.map.on('zoomend', () => { if (state.loaded) { renderLegend(); state.scene?.setScale({zoom: state.map.getZoom(), latitude: state.map.getCenter().lat}); } });
  let moveTimer = 0;
  state.map.on('moveend', () => { clearTimeout(moveTimer); moveTimer = setTimeout(() => { if (state.loaded && state.panel.mode === 'line') updateSpatialLayers(); }, 250); });
  state.map.on('error', e => console.warn('Map resource', e.error?.message || e));
  for (const type of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart']) state.map.on(type, e => { if (e.originalEvent && state.stationFrame) state.stationFrame.moved = true; });
  fetch(TILEJSON_URL).then(r => r.json()).then(j => { state.tileTemplate = j.tiles?.[0] || ''; if (state.loaded) updateSpatialLayers(); }).catch(e => console.warn('TileJSON', e));
}

async function startMap() {
  const el = $('map-failure');
  try {
    await loadMapLibrary();
    // three.js is optional: without it the map still shows the 2D lines, pins and massing.
    try { state.THREE = await loadThree(); } catch (e) { state.THREE = null; console.warn('3D model unavailable, 2D lines only', e); }
    el.hidden = true;
    initMap();
  } catch (e) {
    el.hidden = false;
    el.innerHTML = `<p>โหลดแผนที่ไม่สำเร็จ ข้อมูล ตาราง และกราฟยังใช้งานได้</p><p class="hint">${esc(e.message || '')}</p><button type="button" class="btn">ลองโหลดแผนที่ใหม่</button>`;
    el.querySelector('button').onclick = event => { event.target.disabled = true; startMap(); };
    console.warn(e);
  }
}

/** 3D ↔ 2D: the model and massing follow; the camera eases to the matching preset at the current centre/zoom. */
function toggle3d() {
  state.view3d = !state.view3d;
  $('toggle-3d').setAttribute('aria-pressed', String(state.view3d));
  syncEyeToggle();
  renderLegend();
  updateSpatialLayers();
  updatePins();
  if (state.map) { applyPreset(state.map, cameraPreset(), {animate: animate()}); state.lastPreset = cameraPreset(); }
  saveURL();
}
function toggleTwoPoint() {
  state.twoPoint = !state.twoPoint;
  syncEyeToggle();
  if (state.map && state.view3d) { const st = currentStation(); if (st) frameStation(st); else applyPreset(state.map, cameraPreset(), {animate: animate()}); state.lastPreset = cameraPreset(); }
  saveURL();
}
function syncEyeToggle() {
  const b = $('toggle-eye');
  b.setAttribute('aria-pressed', String(state.twoPoint));
  b.disabled = !state.view3d || !stationLevel();
}

/* ---------- mobile sheet ---------- */
function openMobilePanel() {
  if (!mobilePortrait()) return;
  $('panel').classList.add('is-open');
  $('mobile-panel').setAttribute('aria-expanded', 'true');
  $('map-aha').hidden = true;
}
function closeMobilePanel() {
  const wasOpen = $('panel').classList.contains('is-open');
  $('panel').classList.remove('is-open');
  $('mobile-panel').setAttribute('aria-expanded', 'false');
  if (mobilePortrait()) {
    $('mobile-panel').focus({preventScroll: true});
    if (state.panel.mode === 'overview') renderPanel();
    else if (wasOpen && state.loaded) fitMap();
    updateSpatialLayers();
  }
}

/* ---------- data loading ---------- */
async function fetchJSON(resource) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(resource, {signal: controller.signal, cache: 'no-cache'});
    if (!r.ok) { const e = new Error('โหลดข้อมูลไม่สำเร็จ'); e.status = r.status; throw e; }
    return await r.json();
  } catch (e) { e.resource = resource; e.phase = 'data'; throw e; }
  finally { clearTimeout(timer); }
}

function fillOptions() {
  const add = (id, items) => { const s = $(id); for (const [v, label] of items) { const o = document.createElement('option'); o.value = v; o.textContent = label; s.append(o); } };
  const used = new Set(state.data.stations.flatMap(s => s.systemIds || []));
  add('system', state.data.systems.filter(x => used.has(x.id)).map(x => [x.id, x.name]));
  const lineGroup = (label, lines) => { const g = document.createElement('optgroup'); g.label = label; for (const l of lines) { const o = document.createElement('option'); o.value = l.id; o.textContent = l.name; g.append(o); } $('line').append(g); };
  const lines = [...state.data.lines].sort((a, b) => a.name.localeCompare(b.name, 'th'));
  lineGroup('เปิดให้บริการ', lines.filter(l => l.status !== 'construction'));
  const building = lines.filter(l => l.status === 'construction');
  if (building.length) lineGroup('กำลังก่อสร้าง', building);
  const codes = new Set(state.data.stations.map(s => s.provinceCode).filter(Boolean));
  datasetProvinceCodes = codes;
  add('province', PROVINCE_LIST.filter(p => codes.has(p.code)).sort((a, b) => a.th.localeCompare(b.th, 'th')).map(p => [p.code, p.th]));
}

function restoreFromURL() {
  const p = nav.read();
  const set = (id, v) => { if (v != null && [...$(id).querySelectorAll('option')].some(o => o.value === v)) $(id).value = v; };
  $('search').value = p.get('q') || '';
  set('status', p.get('status')); if (!$('status').value) $('status').value = 'current';
  set('system', p.get('system'));
  set('line', p.get('line'));
  set('province', (p.get('province') || '').toUpperCase());
  if (['lines', 'status', 'ridership'].includes(p.get('view'))) state.view = p.get('view');
  state.focusMode = p.get('focus') === 'all' ? 'none' : 'auto';
  state.view3d = p.get('view3d') !== '0';
  state.twoPoint = p.get('cam') !== 'model';
  const listed = (p.get('layers') || '').split(',');
  for (const k of MODE_LAYERS) state.layers[k] = listed.includes(k) || p.get(k) === '1';   // bus=1 / boat=1 links of 0.1 still work
  if ($('line').value) { state.panel = {mode: 'line', id: $('line').value}; state.via = $('line').value; }
  if (p.get('station') && state.stationById.has(p.get('station'))) state.panel = {mode: 'station', id: p.get('station')};
}

/** Browser back / forward (citymeter-shell): show the level the restored address names; the context layers follow. */
function restoreFromHistory() {
  const shown = {...state.layers};
  for (const f of FIELDS) $(f).value = '';
  $('status').value = 'current';
  Object.assign(state, {view: 'lines', focusMode: 'auto', panel: {mode: 'overview', id: ''}, history: [], via: ''});
  restoreFromURL();
  $('toggle-3d').setAttribute('aria-pressed', String(state.view3d));
  syncEyeToggle();
  renderModeMenu();
  update({fit: true});
  for (const k of MODE_LAYERS) if (shown[k] !== state.layers[k]) toggleLayer(k, state.layers[k]);
}

function wireEvents() {
  let timer;
  for (const f of FIELDS) $(f).addEventListener(f === 'search' ? 'input' : 'change', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.history = [];
      if (f === 'line') { if ($('line').value) { selectLine($('line').value); return; } state.via = ''; state.panel = {mode: 'overview', id: ''}; }
      else if (state.panel.mode === 'station') state.panel = $('line').value ? {mode: 'line', id: $('line').value} : {mode: 'overview', id: ''};
      update({fit: f !== 'search'});
    }, f === 'search' ? 180 : 0);
  });
  $('filters').addEventListener('reset', () => setTimeout(() => { $('status').value = 'current'; resetToOverview(); }, 0));
  for (const id of ['panel-view', 'filter-chips', 'map-aha', 'crumbs']) $(id).addEventListener('click', onPanelAction);
  const tabs = [...document.querySelectorAll('[data-view]')];
  tabs.forEach((b, i) => {
    b.onclick = () => { state.view = b.dataset.view; drawChart(); saveURL(); };
    b.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[j].focus(); tabs[j].click();
    });
  });
  $('fit-map').onclick = () => { state.focusMode = 'none'; if (state.panel.mode === 'station') { state.panel = $('line').value ? {mode: 'line', id: $('line').value} : {mode: 'overview', id: ''}; } update({fit: true}); };
  $('bangkok-map').onclick = () => { if (state.map) applyPreset(state.map, state.view3d ? 'city' : 'plan', {center: BANGKOK.center, zoom: BANGKOK.zoom, animate: animate()}); };
  $('toggle-3d').onclick = toggle3d;
  $('toggle-eye').onclick = toggleTwoPoint;
  $('toggle-modes').onclick = () => setModeMenu($('mode-menu').hidden);
  $('close-modes').onclick = () => setModeMenu(false, {focus: true});
  $('mode-list').addEventListener('click', e => { const b = e.target.closest('[data-layer]'); if (b) toggleLayer(b.dataset.layer); });
  $('mode-chips').addEventListener('click', e => { const b = e.target.closest('[data-layer]'); if (b) toggleLayer(b.dataset.layer); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('mode-menu').hidden) setModeMenu(false, {focus: true}); });
  document.addEventListener('pointerdown', e => { if (!$('mode-menu').hidden && !e.target.closest('#mode-menu, #toggle-modes, #mode-chips')) setModeMenu(false); });
  $('mobile-panel').onclick = () => { $('panel').classList.contains('is-open') ? closeMobilePanel() : openMobilePanel(); };
  $('close-mobile-panel').onclick = closeMobilePanel;
  document.querySelector('.skip').onclick = () => { openMobilePanel(); $('dataset-title').focus(); };
  $('toggle-insights').onclick = () => openInsights($('insight-content').hidden);
  if (typeof ResizeObserver === 'function') new ResizeObserver(syncBottomPanel).observe($('insights')); else window.addEventListener('resize', syncBottomPanel);
  $('open-table').onclick = () => { $('results').hidden = false; closeMobilePanel(); $('toggle-table').focus(); };
  $('toggle-table').onclick = () => { $('results').hidden = true; $('open-table').focus(); };
  $('prev-page').onclick = () => { state.page--; renderTable(); };
  $('next-page').onclick = () => { state.page++; renderTable(); };
  $('theme').onchange = applyTheme;
  const colorMedia = matchMedia('(prefers-color-scheme: dark)');
  const onColorChange = () => { if ($('theme').value === 'auto') applyTheme(); };
  if (colorMedia.addEventListener) colorMedia.addEventListener('change', onColorChange); else colorMedia.addListener(onColorChange);
  matchMedia('(max-width: 760px) and (orientation: portrait)').addEventListener?.('change', () => { if (!mobilePortrait()) $('panel').classList.remove('is-open'); renderPanel(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('results').hidden) { $('results').hidden = true; $('open-table').focus(); } });
}

/** Display colour of every line: the sourced identity HEX when the data has one, else its LDS series token for this theme. */
function resolveLineColors() {
  if (!state.data) return;
  for (const l of state.data.lines) {
    if (!('colorSourced' in l)) l.colorSourced = l.color || null;
    const token = /-(fill|ink)$/.test(l.colorToken || '') ? l.colorToken : `${l.colorToken || 'series-9'}-fill`;
    l.color = l.colorSourced || cssVar(`--${token}`, '#8AA4AA');
  }
  for (const f of state.railGeo?.features || []) f.properties.color = state.lineById.get(f.properties.lineId)?.color || null;
}

/** Centre and roof of an OSM station building: where the station is drawn when OSM maps its hall. */
function buildingAnchor(f) {
  const ring = outerRings(f)[0] || [];
  const pts = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
  if (!pts.length) return null;
  return {lng: pts.reduce((a, q) => a + q[0], 0) / pts.length, lat: pts.reduce((a, q) => a + q[1], 0) / pts.length, top: (Number(f.properties?.base) || 0) + (Number(f.properties?.height) || 0)};
}

/**
 * Where a station is drawn (pin, 3D, camera). One station, one 3D form (owner 2026-11-01: the plate at the
 * reference point and the OSM hall elsewhere read as two stations): when OSM maps the station's hall, the
 * pin sits on that hall and the hall is the station's 3D form; otherwise the plate at the reference point.
 * The panel keeps the reference coordinate and says how far the drawn position is from it.
 */
function displayPoint(st) {
  const a = state.buildingsByStation.get(st?.id)?.anchor;
  return a ? [a.lng, a.lat] : hasPoint(st) ? [st.lng, st.lat] : null;
}
const asDrawn = s => { const a = state.buildingsByStation.get(s.id)?.anchor; return a ? {...s, lng: a.lng, lat: a.lat, buildingTop: a.top} : s; };

function indexData() {
  const d = state.data;
  state.lineById = new Map(d.lines.map(l => [l.id, l]));
  state.stationById = new Map(d.stations.map(s => [s.id, s]));
  state.systemById = new Map(d.systems.map(s => [s.id, s]));
  state.complexById = new Map((d.complexes || []).map(c => [c.id, c]));
  state.sourcesById = new Map((d.meta?.sources || []).map(s => [s.id, s]));
  state.buildingsByStation = new Map();
  for (const f of state.buildingGeo?.features || []) {
    for (const id of f.properties?.stationIds || [f.properties?.stationId].filter(Boolean)) {
      if (!state.buildingsByStation.has(id)) state.buildingsByStation.set(id, {features: [], name: f.properties.name || '', osmRef: f.properties.osm_ref || '', url: f.properties.osm_url || '', heightNote: f.properties.height_note || '', anchor: buildingAnchor(f)});
      state.buildingsByStation.get(id).features.push(f);
    }
  }
  resolveLineColors();
}

async function init() {
  try {
    const resources = ['data/transit.json', 'data/rail-lines.geojson', 'data/station-buildings.geojson', 'data/provinces.geojson'];
    const results = await Promise.allSettled(resources.map(fetchJSON));
    if (results[0].status === 'rejected') throw results[0].reason;
    state.data = results[0].value;
    const fc = (r, name) => { if (r.status === 'fulfilled' && r.value?.type === 'FeatureCollection' && Array.isArray(r.value.features)) return r.value; if (r.status === 'rejected') console.warn('Optional dataset unavailable', name, r.reason); return {type: 'FeatureCollection', features: []}; };
    state.railGeo = fc(results[1], 'rail-lines');
    state.buildingGeo = fc(results[2], 'station-buildings');
    state.provinces = fc(results[3], 'provinces');
    indexData();
    fillOptions();
    restoreFromURL();
    $('toggle-3d').setAttribute('aria-pressed', String(state.view3d));
    renderModeMenu();
    syncEyeToggle();
    try { $('theme').value = localStorage.getItem('citymeter-transit-theme') || 'auto'; } catch {}
    applyTheme();
    wireEvents();
    update();
    if (state.panel.mode !== 'overview') openMobilePanel();
    state.ready = true;
    window.dispatchEvent(new CustomEvent('citymeter:ready'));
    startMap();
  } catch (e) {
    window.dispatchEvent(new CustomEvent('citymeter:load-error', {detail: {message: 'โหลดข้อมูลสถานีไม่สำเร็จ กรุณาลองอีกครั้ง', resource: e.resource, status: e.status, phase: e.phase || 'startup', diagnostic: e.message}}));
    console.error(e);
  }
}

// Developer hook for live tuning in a browser console (not an API; may change without notice).
window.__citymeter = {state, get map() { return state.map; }, update, fitMap, updateSpatialLayers, applyPreset: (name, opts) => state.map && applyPreset(state.map, name, opts), selectStation, selectLine};

init();
