/**
 * Reading panel views as HTML strings. Pure: no DOM access, no map.
 *
 * Every actionable element carries data-action (and data-id / data-value) and
 * the app binds one delegated click handler. Actions:
 *   select-line · select-station · select-province · back · explore-top ·
 *   clear-focus · open-charts · open-table · clear-filter · search
 *
 * Copy is Thai, short and natural (owner instruction carried over from Luxury
 * Brands 2026-10-22: no caveats on screen — provenance lives in the data
 * section, help and docs). Units: สถานี = one station record (see js/model.js),
 * สาย = one line or service of a system, จุดเปลี่ยนสาย = a station record served
 * by two or more lines or listed in the interchange register. Missing is never
 * zero; a value is shown with its unit, period and source or not at all.
 */
import {STATUS, ELEVATION_LABEL, hasPoint, provinceByCode} from './model.js';

const NUMBER = new Intl.NumberFormat('th-TH', {maximumFractionDigits: 0});
const DECIMAL = new Intl.NumberFormat('th-TH', {maximumFractionDigits: 1});
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const num = n => NUMBER.format(n);
export const dec = n => DECIMAL.format(n);
const safeURL = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };

export function link(url, label, cls = 'source-link') {
  const u = safeURL(url);
  return u ? `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener">${esc(label)}</a>` : '';
}

export function thaiDate(iso) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso || '');
  if (!m) return iso || '';
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const y = Number(m[1]) + 543, mo = months[Number(m[2]) - 1];
  return m[3] ? `${Number(m[3])} ${mo} ${y}` : `${mo} ${y}`;
}

export function statusPill(status, detail = '') {
  const s = STATUS[status];
  if (!s) return '';
  return `<span class="status-pill tone-${esc(s.tone)}"${detail ? ` title="${esc(detail)}"` : ''}>${esc(s.label)}</span>`;
}

/** Identity swatch of one line: the colour in the line's own name, always next to its name. */
export const swatch = (line, {construction = false} = {}) => `<i class="line-swatch${construction ? ' is-construction' : ''}" style="--line-color:${esc(line?.color || '')}" aria-hidden="true"></i>`;
export const lineBadge = line => line ? `<span class="line-badge" title="${esc(line.name)}${line.nameEn ? ` · ${esc(line.nameEn)}` : ''}">${swatch(line, {construction: line.status === 'construction'})}${esc(line.short || line.code || line.name)}</span>` : '';
export const lineBadges = (ids, lineById) => `<span class="line-badges">${(ids || []).map(id => lineBadge(lineById.get(id))).join('')}</span>`;

/** Metric tile with a legend-symbol cue; the one-word label carries the meaning. */
export function metricTile(value, label, kind = 'plain') {
  const shown = Number.isFinite(value) ? num(value) : '—';
  return `<div class="metric metric-${esc(kind)}"><i class="metric-symbol sym-${esc(kind)}" aria-hidden="true"></i><strong class="data-number">${shown}</strong><span>${esc(label)}</span></div>`;
}

/* ---------- Overview ---------- */

/**
 * focusMode: 'auto' (default — the top hubs carry the detail, the rest is quiet),
 * 'explicit' (a chosen line) or 'none' (everything in detail).
 */
export function renderOverview({insight, summary, lineRanking = [], provinces = [], focusMode = 'auto', asOf = '', provinceName = ''}) {
  let aha;
  if (!summary.stations) {
    aha = `<section class="aha" aria-label="ข้อค้นพบ"><p class="eyebrow">ข้อค้นพบแรก</p><h2>ไม่พบสถานีตามตัวกรองนี้</h2>
      <div class="aha-actions"><button type="button" data-action="clear-filter" data-id="all" class="btn">ล้างตัวกรอง</button></div></section>`;
  } else if (insight?.hubs?.length) {
    const names = insight.hubs.map(h => `<button type="button" class="link-button" data-action="select-station" data-id="${esc(h.id)}">${esc(h.name)}</button> <span class="data-number">${num(h.lines)}</span>`).join(' · ');
    const toggle = focusMode === 'auto'
      ? `<button type="button" data-action="clear-focus" class="btn">ดูทั้งหมด</button>`
      : `<button type="button" data-action="explore-top" class="btn primary">โฟกัสจุดเปลี่ยนสาย</button>`;
    aha = `<section class="aha${focusMode === 'auto' ? ' is-auto' : ''}" aria-label="ข้อค้นพบ"><p class="eyebrow">ข้อค้นพบแรก${provinceName ? ` · ${esc(provinceName)}` : ''}</p>
      <h2><span class="aha-number data-number">${num(insight.interchanges)}</span><span class="aha-headline">จุดเปลี่ยนสาย จาก ${num(insight.stations)} สถานีที่เปิดให้บริการ</span></h2>
      <p class="aha-copy">เชื่อมได้หลายสายที่สุด: ${names}</p>
      ${insight.construction ? `<p class="aha-secondary">กำลังก่อสร้างอีก <strong class="data-number">${num(insight.construction)}</strong> สถานี ใน ${num(insight.constructionLines)} สาย</p>` : ''}
      <div class="aha-actions">${toggle}<button type="button" data-action="open-charts" class="btn quiet">เปรียบเทียบสาย</button></div></section>`;
  } else {
    aha = `<section class="aha" aria-label="ข้อค้นพบ"><p class="eyebrow">ข้อค้นพบแรก${provinceName ? ` · ${esc(provinceName)}` : ''}</p>
      <h2><span class="aha-number data-number">${num(summary.stations)}</span><span class="aha-headline">สถานีตามตัวกรองนี้</span></h2>
      <p class="aha-copy"><strong class="data-number">${num(summary.operating)}</strong> เปิดให้บริการ · <strong class="data-number">${num(summary.construction)}</strong> กำลังก่อสร้าง</p>
      <div class="aha-actions"><button type="button" data-action="open-table" class="btn">ดูสถานี</button><button type="button" data-action="open-charts" class="btn quiet">เปรียบเทียบสาย</button></div></section>`;
  }
  const metrics = `<section class="metrics" aria-label="ตัวเลขของข้อมูลที่เลือก">
    ${metricTile(summary.operating, 'เปิดให้บริการ', 'station')}
    ${metricTile(summary.construction, 'กำลังก่อสร้าง', 'construction')}
    ${metricTile(summary.lines, 'สาย', 'line')}
    ${metricTile(summary.interchanges, 'จุดเปลี่ยนสาย', 'interchange')}
  </section>`;
  const max = Math.max(1, ...lineRanking.map(l => l.stations));
  const lineList = lineRanking.length ? `<section class="panel-section" aria-labelledby="line-rank-title">
    <div class="section-heading"><h3 id="line-rank-title">สายเรียงตามจำนวนสถานี</h3><span class="hint">${num(lineRanking.length)} สาย</span></div>
    <ol class="rank-list">${lineRanking.slice(0, 14).map((l, i) => `<li><button type="button" class="rank-row" data-action="select-line" data-id="${esc(l.id)}" aria-label="อันดับ ${i + 1} ${esc(l.name)} ${num(l.stations)} สถานี">
        <span class="rank-index data-number" aria-hidden="true">${i + 1}</span>
        <span class="rank-name">${swatch(l, {construction: l.status === 'construction'})} ${esc(l.name)}<small>${esc(l.systemName || '')}${l.construction ? ` · กำลังก่อสร้าง ${num(l.construction)}` : ''}</small></span>
        <span class="rank-track" aria-hidden="true"><span class="rank-fill" style="width:${Math.max(3, Math.round((l.stations / max) * 100))}%;background:${esc(l.fill || 'var(--scale-count-3)')}"></span></span>
        <span class="rank-value data-number" aria-hidden="true">${num(l.stations)}</span></button></li>`).join('')}</ol>
    ${lineRanking.length > 14 ? `<p class="hint">+ อีก ${num(lineRanking.length - 14)} สายในกราฟ</p>` : ''}
  </section>` : '';
  const provinceList = provinces.length > 1 ? `<section class="panel-section" aria-labelledby="province-title">
    <div class="section-heading"><h3 id="province-title">จังหวัดที่มีสถานี</h3><span class="hint">${num(provinces.length)} จังหวัด</span></div>
    <ul class="province-list">${provinces.slice(0, 20).map(p => `<li><button type="button" class="province-row" data-action="select-province" data-id="${esc(p.code)}" aria-label="${esc(p.name)} ${num(p.stations)} สถานี ${num(p.lines)} สาย กดเพื่อดูจังหวัด"><i class="province-swatch" style="background:${esc(p.fill)}" aria-hidden="true"></i><span class="province-name">${esc(p.name)}</span><span class="province-count data-number">${num(p.stations)}<small>สถานี · ${num(p.lines)} สาย</small></span></button></li>`).join('')}</ul>
  </section>` : '';
  return `${aha}${metrics}${lineList}${provinceList}<p class="hint panel-foot">CityMETER Transit · ข้อมูล ${esc(thaiDate(asOf))}</p>`;
}

/* ---------- Line profile ---------- */

export function renderLine(p) {
  if (!p) return '';
  const l = p.line;
  const stations = p.stations.map((s, i) => `<li><button type="button" class="station-row" data-action="select-station" data-id="${esc(s.id)}">
      <span class="station-seq" aria-hidden="true">${esc(s.code || String(i + 1))}</span>
      <span class="station-text"><strong>${esc(s.name)}</strong><span>${esc(s.nameEn || '')}${s.otherLines ? ` · เปลี่ยนสาย ${esc(s.otherLines)}` : ''}</span></span>
      ${s.status !== 'operating' ? statusPill(s.status) : ''}</button></li>`).join('');
  const progress = Number.isFinite(p.progressPercent) ? `<div class="panel-section"><div class="section-heading"><h3>ความคืบหน้าโครงการ</h3><span class="hint">${esc(p.progressMetric || '')}${p.progressPeriod ? ` · ${esc(thaiDate(p.progressPeriod))}` : ''}</span></div>
      <div class="progress" role="img" aria-label="ความคืบหน้า ${dec(p.progressPercent)} เปอร์เซ็นต์"><span class="progress-track"><span class="progress-fill" style="width:${Math.max(1, Math.min(100, p.progressPercent))}%"></span></span><span class="progress-value">${dec(p.progressPercent)}%</span></div>
      ${link(p.progressSource, 'รายงานความคืบหน้า')}</div>` : '';
  return `<section class="detail-head line">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow">สาย${p.systemName ? ` · ${esc(p.systemName)}` : ''}</p>
      <h2>${swatch(l, {construction: l.status === 'construction'})} ${esc(l.name)}</h2>
      <p class="subtle">${esc([l.nameEn, l.operator].filter(Boolean).join(' · '))}</p>
      <p class="store-status">${statusPill(l.status === 'construction' ? 'construction' : 'operating')}${l.elevation ? ` <span class="status-pill tone-neutral">${esc(ELEVATION_LABEL[l.elevation] || l.elevation)}</span>` : ''}</p>
      <div class="metrics compact">${metricTile(p.operating, 'เปิดแล้ว', 'station')}${metricTile(p.construction, 'กำลังสร้าง', 'construction')}${metricTile(p.interchanges, 'เปลี่ยนสาย', 'interchange')}${metricTile(p.provinces, 'จังหวัด', 'province')}</div>
      ${Number.isFinite(p.lengthKm) ? `<p class="hint">ความยาวแนวเส้นทาง ${dec(p.lengthKm)} กม. ตาม${esc(p.lengthSource || 'แหล่งข้อมูล')}</p>` : ''}
      <div class="detail-actions"><button type="button" class="btn" data-action="open-table">ดูสถานี</button><button type="button" class="btn quiet" data-action="open-charts">เปรียบเทียบสาย</button></div>
    </section>
    ${progress}
    <section class="panel-section"><div class="section-heading"><h3>สถานี</h3><span class="hint">${num(p.stations.length)}${p.ordered ? ' · เรียงตามแนวสาย' : ''}</span></div><ol class="outlet-list">${stations}</ol></section>
    ${p.sources.length ? `<section class="panel-section"><div class="section-heading"><h3>แหล่งข้อมูล</h3></div><p class="links">${p.sources.map(s => link(s.url, s.title)).join(' ')}</p></section>` : ''}`;
}

/* ---------- Station ---------- */

export function renderStation(d, {lineById}) {
  if (!d) return '';
  const s = d.station;
  const coords = hasPoint(s) ? `${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}` : 'ยังไม่มีพิกัด';
  const province = provinceByCode(s.provinceCode);
  const lines = (s.lineIds || []).map(id => lineById.get(id)).filter(Boolean);
  const lineChips = lines.map(l => `<li><button type="button" class="line-chip" data-action="select-line" data-id="${esc(l.id)}">${swatch(l, {construction: l.status === 'construction'})}<span>${esc(l.name)}${l.code ? ` <small class="data-number">${esc(l.code)}</small>` : ''}</span></button></li>`).join('');
  const ridership = (d.ridership || []).map(r => `<dd><strong class="data-number">${num(r.value)}</strong> ${esc(r.unit)}<br><span class="hint">${esc(r.label)} · ${esc(r.period)}${r.source ? ` · ${link(r.source, 'แหล่ง')}` : ''}</span></dd>`).join('');
  const work = d.construction ? `<dt>ก่อสร้าง</dt><dd>${esc(d.construction.stage || '')}${Number.isFinite(d.construction.percent) ? `<br><span class="progress" role="img" aria-label="ความคืบหน้าสถานี ${dec(d.construction.percent)} เปอร์เซ็นต์"><span class="progress-track"><span class="progress-fill" style="width:${Math.max(1, Math.min(100, d.construction.percent))}%"></span></span><span class="progress-value">${dec(d.construction.percent)}%</span></span>` : ''}${d.construction.period ? `<span class="hint">ณ ${esc(thaiDate(d.construction.period))}</span>` : ''}</dd>` : '';
  const building = d.building ? `<dt>อาคาร</dt><dd>${esc(d.building.name || 'อาคารสถานี')}<br><span class="hint">OpenStreetMap ${link(d.building.url, d.building.osmRef)}${d.building.heightNote ? ` · ${esc(d.building.heightNote)}` : ''}</span></dd>` : '';
  const connections = (d.connections || []).map(c => `<li><button type="button" class="station-row" data-action="select-station" data-id="${esc(c.id)}"><span class="station-seq" aria-hidden="true">↔</span><span class="station-text"><strong>${esc(c.name)}</strong><span>${esc(c.lineName || '')}${c.pathway ? ` · ${esc(c.pathway)}` : ''}</span></span>${c.status ? `<span class="status-pill tone-neutral">${esc(c.status)}</span>` : ''}</button></li>`).join('');
  return `<section class="detail-head station">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow">สถานี${lines.length > 1 ? ' · จุดเปลี่ยนสาย' : ''}</p>
      <h2>${esc(s.name)}</h2>
      <p class="subtle">${esc([s.nameEn, (s.codes || []).join(' / ')].filter(Boolean).join(' · '))}</p>
      <p class="store-status">${statusPill(s.status, s.statusBasis || '')}</p>
      <ul class="chip-list" aria-label="สายที่ผ่านสถานีนี้">${lineChips}</ul>
      <dl class="facts">
        <dt>จังหวัด</dt><dd>${province ? `<button type="button" class="link-button" data-action="select-province" data-id="${esc(province.code)}">${esc(province.th)}</button>` : 'ไม่ระบุ'}${s.district ? ` · ${esc(s.district)}` : ''}</dd>
        <dt>พิกัด</dt><dd><span class="data-number">${esc(coords)}</span><br><span class="hint">${esc(d.coordinateNote || '')}</span></dd>
        ${ridership ? `<dt>ผู้โดยสาร</dt>${ridership}` : ''}
        ${work}
        ${building}
        <dt>ตรวจเมื่อ</dt><dd>${esc(thaiDate(s.checkedOn)) || '—'}</dd>
      </dl>
      <p class="links">${(d.sources || []).map(x => link(x.url, x.label)).join(' ')}</p>
    </section>
    ${connections ? `<section class="panel-section"><div class="section-heading"><h3>เปลี่ยนสายที่นี่</h3><span class="hint">${num(d.connections.length)}</span></div><ul class="outlet-list">${connections}</ul></section>` : ''}`;
}

/* ---------- Active filter chips ---------- */

export function renderFilterChips(values, labels) {
  const chips = [];
  const push = (key, text) => chips.push(`<li><button type="button" class="filter-chip" data-action="clear-filter" data-id="${esc(key)}" aria-label="ล้างตัวกรอง ${esc(text)}"><span>${esc(text)}</span><i aria-hidden="true">×</i></button></li>`);
  if (values.search) push('search', `ค้นหา “${values.search}”`);
  if (values.status && values.status !== 'current') push('status', labels.status[values.status] || values.status);
  if (values.system) push('system', labels.system[values.system] || values.system);
  if (values.line) push('line', labels.line[values.line] || values.line);
  if (values.province) push('province', labels.province[values.province] || values.province);
  return chips.length ? `<ul class="filter-chips" aria-label="ตัวกรองที่ใช้อยู่">${chips.join('')}<li><button type="button" class="filter-chip clear-all" data-action="clear-filter" data-id="all">ล้างทั้งหมด</button></li></ul>` : '';
}
