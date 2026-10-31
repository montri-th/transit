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
 * URL state: filters, line, station, focus, view, view3d, cam, bus, boat.
 */
import {STATUS, hasPoint, isInterchange, filterStations, summarize, provinceByCode, PROVINCE_LIST} from './model.js';
import {computeInsight, rankLines, buildLineProfile, buildStationDetail} from './profile-model.js';
import {renderOverview, renderLine, renderStation, renderFilterChips, statusPill, link, esc, num, lineBadges} from './panel.js';
import {renderInsightChart} from './charts.js';
import {loadMapLibrary, loadThree} from './vendors.js';
import {installStationPins} from './pins.js';
import {installRailLines, installOptionalLayers, installAreaLabels} from './map-layers.js';
import {installProvinceLayers, buildProvinceModel, PROVINCE_FILL_MAX_ZOOM, PROVINCE_LABEL_MAX_ZOOM} from './provinces.js';
import {buildMapStyle, basemapPalette, TILEJSON_URL, MASSING_BEFORE, DATA_FILL_BEFORE} from './map-style.js';
import {installMassing, outerRings} from './massing.js';
import {installScene, ELEVATION} from './scene.js';
import {presetFor, applyPreset, fitPitched, framePoint} from './camera.js';
import {buildBreadcrumb, renderBreadcrumb, breadcrumbText} from './breadcrumb.js';

const $ = id => document.getElementById(id);
const FIELDS = ['search', 'status', 'system', 'line', 'province'];
const BANGKOK = {center: [100.535, 13.755], zoom: 11.6};
const FOCUS_RADIUS_M = 700;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobilePortrait = () => matchMedia('(max-width: 760px) and (orientation: portrait)').matches;
const animate = () => !reduced();

const state = {
  data: null, railGeo: null, buildingGeo: null, provinces: null, optionalData: {bus: null, boat: null},
  lineById: new Map(), stationById: new Map(), systemById: new Map(), buildingsByStation: new Map(), sourcesById: new Map(),
  scopeStations: [], baseStations: [], focusStations: [],
  view: 'lines', page: 0,
  focusMode: 'auto', selectedStationId: '', panel: {mode: 'overview', id: ''}, history: [], via: '',
  map: null, loaded: false, mapTheme: '', initialCameraDone: false, tileTemplate: '', lastPreset: '',
  view3d: true, twoPoint: true, layers: {bus: false, boat: false},
  pins: null, rail: null, optional: null, provinceLayers: null, provinceLabels: null, provinceModel: null, massing: null, scene: null, THREE: null,
  ray: {objects: [], cycle: 0},
};

/* ---------- helpers ---------- */
const values = () => Object.fromEntries(FIELDS.map(k => [k, $(k).value]));
const theme = () => document.documentElement.dataset.theme;
const announce = text => { $('announcement').textContent = text; };
const activeFilterCount = f => FIELDS.filter(k => f[k] && !(k === 'status' && f[k] === 'current')).length;
const sheetOffset = () => (mobilePortrait() ? [0, -Math.round(window.innerHeight * 0.2)] : [0, 0]);
const sheetOpen = () => mobilePortrait() && $('panel').classList.contains('is-open');
const stationLevel = () => state.panel.mode === 'station';
const cameraPreset = () => presetFor({view3d: state.view3d, mode: state.panel.mode === 'overview' ? 'overview' : 'detail', twoPoint: state.twoPoint && stationLevel() && !sheetOpen()});
const selectedLine = () => state.lineById.get($('line').value) || null;
const currentStation = () => (state.panel.mode === 'station' ? state.stationById.get(state.panel.id) || null : null);
const linesOf = s => (s?.lineIds || []).map(id => state.lineById.get(id)).filter(Boolean);
const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

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
  if (state.layers.bus) p.set('bus', '1');
  if (state.layers.boat) p.set('boat', '1');
  history.replaceState(null, '', location.pathname + (p.size ? '?' + p : ''));
}

/* ---------- theme ---------- */
function scenePalette() {
  return {
    plate: cssVar('--scene-solid', '#FFFFFF'), plateQuiet: cssVar('--basemap-massing-quiet', '#ECEDE8'), building: cssVar('--scene-solid', '#FFFFFF'),
    context: cssVar('--scene-context', '#FFFFFF'), pier: cssVar('--scene-pier', '#FFFFFF'), lineQuiet: cssVar('--scene-line-quiet', '#B4BDB7'),
    hover: cssVar('--map-hover-stroke', '#347DA8'), selected: cssVar('--map-selected-stroke', '#176B82'), shadowOpacity: Number(cssVar('--scene-shadow-opacity', '0.2')) || 0.2,
  };
}
function applyTheme() {
  const value = $('theme').value;
  const next = value === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : value;
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('citymeter-transit-theme', value); } catch {}
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

  const s = summarize(state.baseStations, state.data.lines);
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
  if (state.panel.mode === 'station') { const st = currentStation(); return st ? new Set(st.lineIds || []) : null; }
  const line = selectedLine();
  return line ? new Set([line.id]) : null;
}

function updatePins() {
  if (!state.pins) return;
  const focus = focusLineIds();
  const rows = focus ? state.scopeStations.filter(s => (s.lineIds || []).some(id => focus.has(id))) : state.baseStations;
  const ids = new Set(rows.map(r => r.id));
  state.pins.update(rows, {contextRows: state.scopeStations.filter(r => !ids.has(r.id))});
  if (state.selectedStationId) state.pins.select(state.selectedStationId);
}

/* ---------- breadcrumb ---------- */
function renderCrumbs() {
  const station = currentStation();
  const line = state.panel.mode === 'line' ? selectedLine() : (station && state.via && (station.lineIds || []).includes(state.via) ? state.lineById.get(state.via) : null);
  const provinceCode = station?.provinceCode || $('province').value || '';
  const crumbs = buildBreadcrumb({provinceCode, line: line ? {id: line.id, name: line.name} : null, station: station ? {id: station.id, name: station.name} : null});
  $('crumbs').innerHTML = renderBreadcrumb(crumbs);
  document.title = `${breadcrumbText(crumbs)} · Transit · CityMETER`;
  return crumbs;
}

/* ---------- panel ---------- */
function renderPanel(summary = summarize(state.baseStations, state.data.lines)) {
  const view = $('panel-view');
  const mode = state.panel.mode;
  renderCrumbs();
  syncEyeToggle();
  let html = '';
  if (mode === 'line') html = renderLine(buildLineProfile(selectedLine(), state.scopeStations, {stationById: state.stationById, lineById: state.lineById, systems: state.data.systems}));
  else if (mode === 'station') html = renderStation(buildStationDetail(currentStation(), {stationById: state.stationById, lineById: state.lineById, interchanges: state.data.interchanges || [], buildingsByStation: state.buildingsByStation, sourcesById: state.sourcesById}), {lineById: state.lineById});
  if (!html) {
    const insight = computeInsight(state.scopeStations);
    const ranking = rankLines(state.scopeStations, state.data.lines, state.data.systems).rows;
    const provinces = $('province').value ? [] : (state.provinceModel?.provinces || buildProvinceModelSafe()).filter(p => p.stations > 0).sort((a, b) => b.stations - a.stations || b.lines - a.lines);
    html = renderOverview({insight, summary: summarize(state.scopeStations, state.data.lines), lineRanking: ranking, provinces, focusMode: state.focusMode, asOf: state.data.meta?.asOf || '', provinceName: provinceByCode($('province').value)?.th || ''});
    renderMapAha(insight);
  } else {
    $('map-aha').hidden = true;
  }
  view.innerHTML = html;
  view.dataset.mode = mode;
  const key = `${mode}:${state.panel.id}:${$('line').value}:${$('province').value}`;
  if (key !== renderPanel.lastKey) $('panel').scrollTop = 0;
  renderPanel.lastKey = key;
}

function renderMapAha(insight) {
  const el = $('map-aha');
  if (!insight.stations) { el.hidden = true; return; }
  el.hidden = $('panel').classList.contains('is-open');
  const crumb = `<p class="map-aha-crumb">${esc(breadcrumbText(buildBreadcrumb({provinceCode: $('province').value})))}</p>`;
  el.innerHTML = `<div>${crumb}<h2>${num(insight.interchanges)} จุดเปลี่ยนสาย · ${num(insight.stations)} สถานี</h2><p>${insight.hubs.map(h => esc(h.name)).join(' · ')}</p></div>${state.focusMode === 'auto'
    ? '<button type="button" class="btn" data-action="clear-focus">ดูทั้งหมด</button>'
    : '<button type="button" class="btn primary" data-action="explore-top">โฟกัส</button>'}`;
}

function pushHistory() { state.history.push({...state.panel, line: $('line').value}); if (state.history.length > 20) state.history.shift(); }

function goBack() {
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
  if (state.loaded && fly) frameStation(st);
  state.lastPreset = cameraPreset();
  if (!fromMap || mobilePortrait()) openMobilePanel();
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
    case 'crumb-country': $('province').value = ''; $('line').value = ''; resetToOverview(); break;
    case 'crumb-province': $('province').value = id; $('line').value = ''; resetToOverview(); break;
    case 'crumb-line': selectLine(id); break;
    case 'crumb-station': selectStation(id); break;
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
  // Group reported values by metric + unit + period + aggregation so a bar chart never mixes incomparable values.
  const groups = new Map();
  for (const s of state.baseStations) for (const r of s.ridership || []) {
    const key = [r.metric, r.unit, r.period, r.aggregation].join('|');
    if (!groups.has(key)) groups.set(key, {key, label: r.label, unit: r.unit, period: r.period, aggregation: r.aggregation, values: []});
    groups.get(key).values.push({stationId: s.id, name: s.name, value: r.value, lineIds: s.lineIds});
  }
  return [...groups.values()].sort((a, b) => b.values.length - a.values.length);
}
function drawChart() {
  if (!state.data) return;
  chartDispose?.(); chartDispose = null;
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-selected', String(b.dataset.view === state.view));
  $('chart').setAttribute('aria-labelledby', 'tab-' + state.view);
  $('chart-scope').textContent = `${num(state.scopeStations.length)} สถานีในตัวกรอง`;
  if ($('insight-content').hidden) return;
  const rows = rankLines(state.scopeStations, state.data.lines, state.data.systems).rows;
  chartDispose = renderInsightChart({elementId: 'chart', view: state.view, lineRows: rows, ridershipMetrics: ridershipMetrics(), selectedLineId: $('line').value, selectedStationId: state.selectedStationId, lineById: state.lineById, theme: theme()}, selection => {
    if (selection.type === 'line') selectLine(selection.id, {fromMap: true});
    if (selection.type === 'station') selectStation(selection.id, {fromMap: true});
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
function cameraPadding() {
  const height = $('map').clientHeight, panel = $('insights').getBoundingClientRect().height;
  const edge = Math.min(48, Math.max(12, (height - panel) / 6));
  const mapTop = $('map').getBoundingClientRect().top, toolbar = document.querySelector('.map-toolbar').getBoundingClientRect();
  const aha = $('map-aha'), legend = $('map-legend');
  const chromeTop = !aha.hidden && aha.offsetHeight ? aha.getBoundingClientRect().top : legend.offsetHeight ? legend.getBoundingClientRect().top : null;
  let bottom = chromeTop != null ? height - (chromeTop - mapTop) + 12 : panel + edge;
  if (mobilePortrait() && $('panel').classList.contains('is-open')) bottom = Math.max(bottom, Math.round(window.innerHeight * 0.64) - (window.innerHeight - height - mapTop) + 8);
  return {top: Math.max(edge, toolbar.bottom - mapTop + 12), left: edge, right: edge, bottom: Math.min(height * 0.7, bottom)};
}
function pitchedPadding() {
  const mapTop = $('map').getBoundingClientRect().top, toolbar = document.querySelector('.map-toolbar').getBoundingClientRect();
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
  if (st && hasPoint(st)) return [[st.lng, st.lat]];
  const line = selectedLine();
  if (line) return state.scopeStations.filter(s => (s.lineIds || []).includes(line.id) && hasPoint(s)).map(s => [s.lng, s.lat]);
  if (state.focusMode === 'auto') {
    const hubs = computeInsight(state.scopeStations).hubs.filter(h => Number.isFinite(h.lat));
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

/** Station level: the two-point view framed on the station's building(s) (roofs included), else its plate. */
function frameStation(st, {instant = false} = {}) {
  if (!state.loaded || !hasPoint(st)) return;
  const map = state.map, preset = cameraPreset();
  const buildings = state.buildingsByStation.get(st.id)?.features || [];
  if (buildings.length && preset !== 'plan' && !mobilePortrait()) {
    const ground = [], roof = [];
    for (const f of buildings) for (const ring of outerRings(f)) for (const [lng, lat] of ring) { ground.push([lng, lat, 0]); roof.push([lng, lat, Number(f.properties?.height) || 10]); }
    const bounds = ground.reduce((acc, p) => acc.extend([p[0], p[1]]), new maplibregl.LngLatBounds([ground[0][0], ground[0][1]], [ground[0][0], ground[0][1]]));
    const h = map.getContainer().clientHeight;
    const padding = {top: Math.round(h * (preset === 'eye' ? 0.14 : 0.1)), bottom: 56, left: 56, right: 56};
    const foot = fitPitched(map, bounds, {preset, points: ground, padding, maxZoom: 17.4, minZoom: 14.5, apply: false});
    fitPitched(map, bounds, {preset, points: [...ground, ...roof], padding, maxZoom: 17.4, minZoom: Math.max(14.5, (foot?.zoom ?? 17.4) - 1), animate: animate() && !instant});
    return;
  }
  framePoint(map, [st.lng, st.lat], {preset, zoom: 16.4, offset: sheetOffset(), animate: animate() && !instant});
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
  return state.scopeStations.filter(hasPoint).map(s => ({
    id: s.id, lng: s.lng, lat: s.lat, status: s.status, bearing: s.bearing || 0,
    role: isInterchange(s) ? 'hub' : 'station', elevation: s.elevation || 'surface',
    colors: linesOf(s).map(l => l.color).filter(Boolean),
    quiet: Boolean(focus && !(s.lineIds || []).some(id => focus.has(id))),
  }));
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
    state.scene.setBuildings((state.buildingGeo?.features || []).filter(f => shown.has(f.properties?.stationId)));
    state.scene.setSelected(state.selectedStationId);
    state.scene.setScale({zoom: map.getZoom(), latitude: map.getCenter().lat});
  }
  // Focus massing: rings around the focused stations (≤ 6, nearest the view centre), hosts = matched station buildings.
  const c = map.getCenter();
  const anchors = focusPoints().sort((a, b) => Math.hypot(a[0] - c.lng, a[1] - c.lat) - Math.hypot(b[0] - c.lng, b[1] - c.lat)).slice(0, state.panel.mode === 'station' ? 1 : 6);
  const hosts = (state.buildingGeo?.features || []).flatMap(outerRings);
  state.massing?.update({regions: state.view3d ? anchors.map(p => circleRing(p, state.panel.mode === 'station' ? 450 : FOCUS_RADIUS_M)) : [], hosts, anchors, enabled: true, city: state.view3d, zoom: map.getZoom(), latitude: c.lat})?.catch(e => console.warn('Massing', e));
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
  state.optional = installOptionalLayers(map, {beforeId: DATA_FILL_BEFORE});
  state.rail = installRailLines(map, state.railGeo, {beforeId: MASSING_BEFORE, onSelect: id => selectLine(id, {fromMap: true})});
  state.massing = installMassing(map, {
    beforeId: MASSING_BEFORE, colors: {quiet: palette.massingQuiet, focus: palette.massingFocus, ground: palette.ground},
    tileUrl: t => (state.tileTemplate ? state.tileTemplate.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y) : ''),
    focusRenderer: state.THREE ? 'external' : 'maplibre',
    onFeatures: features => state.scene?.setContext(features),
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
          if (hit.kind === 'station') selectStation(hit.id, {fly: false, fromMap: true});
          else if (hit.kind === 'building' && hit.stationId) selectStation(hit.stationId, {fly: false, fromMap: true});
          else if (hit.kind === 'line') selectLine(hit.lineId, {fromMap: true});
        },
      });
    } catch (e) { state.scene = null; console.warn('3D scene unavailable', e); }
  }
  for (const kind of ['bus', 'boat']) if (state.layers[kind]) toggleLayer(kind, true);
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

async function toggleLayer(kind, on = !state.layers[kind]) {
  state.layers[kind] = on;
  $(`toggle-${kind}`).setAttribute('aria-pressed', String(on));
  if (on && !state.optionalData[kind]) {
    try { state.optionalData[kind] = await fetchJSON(`data/${kind}.json`); }
    catch (e) { console.warn(`Optional ${kind} layer unavailable`, e); state.layers[kind] = false; $(`toggle-${kind}`).setAttribute('aria-pressed', 'false'); $('map-status').textContent = kind === 'bus' ? 'โหลดชั้นรถเมล์ไม่สำเร็จ' : 'โหลดชั้นเรือไม่สำเร็จ'; return; }
  }
  if (state.loaded && state.optional) state.optional.setVisible(kind, state.layers[kind], state.optionalData[kind]);
  renderLegend();
  saveURL();
}

function initMap() {
  if (!window.maplibregl) throw new Error('Map library is unavailable');
  state.mapTheme = theme();
  state.map = new maplibregl.Map({container: 'map', center: BANGKOK.center, zoom: BANGKOK.zoom, pitch: 0, maxPitch: 85, attributionControl: {compact: true}, style: buildMapStyle(state.mapTheme)});
  state.map.addControl(new maplibregl.NavigationControl({showCompass: true, visualizePitch: true}), 'top-right');
  state.provinceLabels = installAreaLabels(state.map, $('map'), {className: 'province-label', hostId: 'province-labels', hostLabel: 'จังหวัดบนแผนที่', minZoom: 0, maxZoom: PROVINCE_LABEL_MAX_ZOOM, verb: 'กดเพื่อดูจังหวัด', unit: 'สถานี', onSelect: code => selectProvince(code), reservedBottom: () => $('insights').getBoundingClientRect().height + 12});
  state.pins = installStationPins(state.map, $('map'), {
    reservedBottom: () => $('insights').getBoundingClientRect().height + 12,
    altitude: row => (state.view3d && state.scene && row.elevation === 'elevated' ? ELEVATION.elevated + 3 : 0),
    describe: row => {
      const lines = linesOf(row);
      const status = STATUS[row.status]?.label || '';
      return {label: `${row.name} · ${lines.map(l => l.name).join(', ') || 'ไม่ระบุสาย'} · ${status}`, shortLabel: row.name, color: lines[0]?.color || '', interchange: isInterchange(row), construction: row.status === 'construction'};
    },
    onSelect: r => selectStation(r.id, {fly: false, fromMap: true}),
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
  const p = new URLSearchParams(location.search);
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
  state.layers.bus = p.get('bus') === '1';
  state.layers.boat = p.get('boat') === '1';
  if ($('line').value) { state.panel = {mode: 'line', id: $('line').value}; state.via = $('line').value; }
  if (p.get('station') && state.stationById.has(p.get('station'))) state.panel = {mode: 'station', id: p.get('station')};
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
  $('toggle-bus').onclick = () => toggleLayer('bus');
  $('toggle-boat').onclick = () => toggleLayer('boat');
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

function indexData() {
  const d = state.data;
  state.lineById = new Map(d.lines.map(l => [l.id, l]));
  state.stationById = new Map(d.stations.map(s => [s.id, s]));
  state.systemById = new Map(d.systems.map(s => [s.id, s]));
  state.sourcesById = new Map((d.meta?.sources || []).map(s => [s.id, s]));
  state.buildingsByStation = new Map();
  for (const f of state.buildingGeo?.features || []) {
    const id = f.properties?.stationId;
    if (!id) continue;
    if (!state.buildingsByStation.has(id)) state.buildingsByStation.set(id, {features: [], name: f.properties.name || '', osmRef: f.properties.osm_ref || '', url: f.properties.osm_url || '', heightNote: f.properties.height_note || ''});
    state.buildingsByStation.get(id).features.push(f);
  }
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
    for (const kind of ['bus', 'boat']) $(`toggle-${kind}`).setAttribute('aria-pressed', String(state.layers[kind]));
    syncEyeToggle();
    try { $('theme').value = localStorage.getItem('citymeter-transit-theme') || 'auto'; } catch {}
    applyTheme();
    wireEvents();
    update();
    if (state.panel.mode !== 'overview') openMobilePanel();
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
