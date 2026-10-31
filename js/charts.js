/**
 * Line charts rendered as plain HTML/SVG — no chart vendor.
 *
 *  - lines     : stations per line in the scope (LDS `count`, same HEX on both themes)
 *  - status    : operating vs under construction per line, stacked; two
 *                categorical series with their shape cues (series 8 ring =
 *                เปิดให้บริการ, series 3 triangle = กำลังก่อสร้าง)
 *  - ridership : stations ranked by ONE comparable reported metric (same metric,
 *                unit, period and aggregation; LDS `activity`); other metrics are
 *                listed by name and never mixed into the bars
 *
 * Every mark is a real <button>, so keyboard and screen-reader users get the
 * same actions as pointer users. Clicks emit {type: 'line'|'station', id}.
 */
import {buildCountClasses, classify, FAMILIES} from './scales.js';

const NUMBER = new Intl.NumberFormat('th-TH', {maximumFractionDigits: 0});
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = n => NUMBER.format(n);
const swatch = l => `<i class="line-swatch${l.status === 'construction' ? ' is-construction' : ''}" style="--line-color:${esc(l.color || '')}" aria-hidden="true"></i>`;

const CUES = {
  ring: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="none" stroke-width="2.2" stroke="currentColor"/></svg>',
  triangle: '<svg viewBox="0 0 12 12" aria-hidden="true"><polygon points="6,1.5 11,10.5 1,10.5"/></svg>',
};

function empty(element, message) {
  element.innerHTML = `<div class="chart-empty"><p>${esc(message)}</p></div>`;
}

function lineRanking(element, rows, select, selectedId) {
  const classes = buildCountClasses(rows.map(r => r.stations));
  const max = Math.max(1, ...rows.map(r => r.stations));
  element.innerHTML = `<p class="chart-caption">${num(rows.length)} สาย · จำนวนสถานีในตัวกรอง · สีระดับเดียวกับกรอบจังหวัด</p><ol class="chart-bars">${rows.map((l, i) => {
    const cls = classify(l.stations, classes), pressed = l.id === selectedId;
    return `<li><button type="button" class="bar-row${pressed ? ' is-selected' : ''}" data-line="${esc(l.id)}" aria-pressed="${pressed}"
      aria-label="อันดับ ${i + 1} ${esc(l.name)}: ${num(l.stations)} สถานี กดเพื่อดูสายนี้">
      <span class="bar-rank data-number" aria-hidden="true">${i + 1}</span>
      <span class="bar-label">${swatch(l)} ${esc(l.name)}</span>
      <span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${Math.max(2, Math.round((l.stations / max) * 100))}%;background:${cls.fill}"></span></span>
      <span class="bar-value" aria-hidden="true"><b class="data-number">${num(l.stations)}</b><small>สถานี</small></span></button></li>`;
  }).join('')}</ol>
  <p class="chart-legend"><span class="legend-title">ระดับสี (สถานีต่อสาย, ${num(classes.classCount)} ระดับเท่าช่วง):</span>${classes.classes.map(c => `<span class="legend-step"><i style="background:${c.fill}" aria-hidden="true"></i>${esc(c.label)}</span>`).join('')}</p>`;
  element.querySelectorAll('[data-line]').forEach(b => b.addEventListener('click', () => select({type: 'line', id: b.dataset.line})));
}

function statusStacked(element, rows, select, selectedId) {
  const list = rows.filter(r => r.operating + r.construction > 0);
  const max = Math.max(1, ...list.map(r => r.operating + r.construction));
  element.innerHTML = `<p class="chart-caption">${num(list.length)} สาย · สถานีเปิดให้บริการและกำลังก่อสร้าง</p>
    <p class="chart-legend"><span class="legend-item"><i class="cue seg-operating">${CUES.ring}</i>เปิดให้บริการ</span><span class="legend-item"><i class="cue seg-construction">${CUES.triangle}</i>กำลังก่อสร้าง</span></p>
    <ol class="chart-bars">${list.map(l => {
      const pressed = l.id === selectedId, op = Math.round((l.operating / max) * 100), co = Math.round((l.construction / max) * 100);
      return `<li><button type="button" class="bar-row stacked${pressed ? ' is-selected' : ''}" data-line="${esc(l.id)}" aria-pressed="${pressed}"
        aria-label="${esc(l.name)}: เปิดให้บริการ ${num(l.operating)} สถานี, กำลังก่อสร้าง ${num(l.construction)} สถานี กดเพื่อดูสายนี้">
        <span class="bar-label">${swatch(l)} ${esc(l.name)}</span>
        <span class="bar-track" aria-hidden="true"><span class="bar-fill seg-operating" style="width:${op}%">${l.operating ? `<span>${num(l.operating)}</span>` : ''}</span><span class="bar-fill seg-construction" style="width:${co}%">${l.construction ? `<span>${num(l.construction)}</span>` : ''}</span></span>
        <span class="bar-value" aria-hidden="true"><b class="data-number">${num(l.operating + l.construction)}</b><small>สถานี</small></span></button></li>`;
    }).join('')}</ol>`;
  element.querySelectorAll('[data-line]').forEach(b => b.addEventListener('click', () => select({type: 'line', id: b.dataset.line})));
}

/**
 * Ridership: `metrics` = [{key, label, unit, period, aggregation, values: [{stationId, name, value, lineIds}]}]
 * pre-grouped so each group is internally comparable. The largest group is drawn.
 */
function ridership(element, metrics, select, selectedId, lineById, groupKey = '') {
  const groups = (metrics || []).filter(g => g.values?.length);
  if (!groups.length) { empty(element, 'แหล่งข้อมูลยังไม่รายงานผู้โดยสารรายสถานีที่เทียบกันได้ในตัวกรองนี้'); return; }
  const g = groups.find(x => x.key === groupKey) || groups[0];
  const rows = [...g.values].sort((a, b) => b.value - a.value).slice(0, 20);
  const fam = FAMILIES.activity;
  const max = Math.max(1, ...rows.map(r => r.value));
  const lut = fam.lut;
  const switcher = groups.length > 1 ? `<div class="metric-switch" role="group" aria-label="เลือกชุดข้อมูลผู้โดยสาร">${groups.map(x => `<button type="button" class="chip-button" data-metric="${esc(x.key)}" aria-pressed="${x === g}">${esc(x.label)} · ${esc(x.period)}</button>`).join('')}</div>` : '';
  element.innerHTML = `${switcher}<p class="chart-caption">${esc(g.label)} · ${esc(g.unit)} · ${esc(g.period)} · ${num(g.values.length)} สถานี${g.dataset ? ` · ${esc(g.dataset)}` : ''}${g.source ? ` · <a class="source-link" href="${esc(g.source)}" target="_blank" rel="noopener">แหล่ง</a>` : ''}</p>
    <ol class="chart-bars">${rows.map((r, i) => {
      const pressed = r.stationId === selectedId;
      const fill = lut[Math.round((r.value / max) * 40)];
      const lines = (r.lineIds || []).map(id => lineById.get(id)).filter(Boolean);
      return `<li><button type="button" class="bar-row${pressed ? ' is-selected' : ''}" data-station="${esc(r.stationId)}" aria-pressed="${pressed}"
        aria-label="อันดับ ${i + 1} ${esc(r.name)}: ${num(r.value)} ${esc(g.unit)} กดเพื่อดูสถานีนี้">
        <span class="bar-rank data-number" aria-hidden="true">${i + 1}</span>
        <span class="bar-label">${lines.slice(0, 2).map(swatch).join('')} ${esc(r.name)}</span>
        <span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${Math.max(2, Math.round((r.value / max) * 100))}%;background:${fill}"></span></span>
        <span class="bar-value" aria-hidden="true"><b class="data-number">${num(r.value)}</b><small>${esc(g.unit)}</small></span></button></li>`;
    }).join('')}</ol>
    <p class="chart-legend">สีตามค่า (LDS activity, ค่าสูงสุดในกราฟ = สีเข้มสุด)${g.note ? ` · ${esc(g.note)}` : ''}</p>`;
  element.querySelectorAll('[data-station]').forEach(b => b.addEventListener('click', () => select({type: 'station', id: b.dataset.station})));
  element.querySelectorAll('[data-metric]').forEach(b => b.addEventListener('click', () => select({type: 'metric', id: b.dataset.metric})));
}

/** Render one view into #elementId. Returns an idempotent disposer. */
export function renderInsightChart({elementId, view = 'lines', lineRows = [], ridershipMetrics = [], ridershipGroup = '', selectedLineId = '', selectedStationId = '', lineById = new Map(), theme} = {}, onSelect = () => {}) {
  const element = document.getElementById(elementId);
  if (!element) return () => {};
  const select = typeof onSelect === 'function' ? onSelect : () => {};
  element.replaceChildren();
  if (theme) element.dataset.chartTheme = theme;
  const labels = {lines: 'สายเรียงตามจำนวนสถานี', status: 'สถานีเปิดให้บริการและกำลังก่อสร้างต่อสาย', ridership: 'สถานีเรียงตามผู้โดยสารที่แหล่งรายงาน'};
  element.setAttribute('aria-label', labels[view] || labels.lines);
  try {
    if (view === 'ridership') ridership(element, ridershipMetrics, select, selectedStationId, lineById, ridershipGroup);
    else if (!lineRows.length) empty(element, 'ไม่พบสายตามตัวกรอง');
    else if (view === 'status') statusStacked(element, lineRows, select, selectedLineId);
    else lineRanking(element, lineRows, select, selectedLineId);
  } catch (error) {
    console.error('CityMETER Transit chart could not render:', error);
    empty(element, 'แสดงกราฟไม่ได้ในขณะนี้ โปรดดูข้อมูลเดียวกันในตาราง');
  }
  return () => element.replaceChildren();
}
