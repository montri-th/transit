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
    const names = insight.hubs.map(h => `<button type="button" class="link-button" data-action="select-station" data-id="${esc(h.stationId)}">${esc(h.name)}</button> <span class="data-number">${num(h.lines)}</span>&nbsp;สาย`).join(' · ');
    const toggle = focusMode === 'auto'
      ? `<button type="button" data-action="clear-focus" class="btn">ดูทั้งหมด</button>`
      : `<button type="button" data-action="explore-top" class="btn primary">โฟกัสจุดเปลี่ยนสาย</button>`;
    aha = `<section class="aha${focusMode === 'auto' ? ' is-auto' : ''}" aria-label="ข้อค้นพบ"><p class="eyebrow">ข้อค้นพบแรก${provinceName ? ` · ${esc(provinceName)}` : ''}</p>
      <h2><span class="aha-number data-number">${num(insight.interchanges)}</span><span class="aha-headline">จุดเปลี่ยนสาย บนรถไฟฟ้า ${num(insight.lines)} สายที่เปิดให้บริการ</span></h2>
      <p class="aha-copy">เชื่อมหลายสายที่สุด: ${names}</p>
      ${insight.construction ? `<p class="aha-secondary">กำลังก่อสร้างอีก <strong class="data-number">${num(insight.construction)}</strong> สถานี ใน ${num(insight.constructionLines)} โครงการ</p>` : ''}
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
  const construction = l.status === 'construction';
  const stations = p.stations.map((s, i) => `<li><button type="button" class="station-row" data-action="select-station" data-id="${esc(s.id)}">
      <span class="station-seq" aria-hidden="true">${esc(s.code || String(i + 1))}</span>
      <span class="station-text"><strong>${esc(s.name)}</strong><span>${esc(s.nameEn || '')}${s.otherLines ? `${s.nameEn ? ' · ' : ''}เปลี่ยนสาย ${esc(s.otherLines)}` : ''}</span></span>
      ${s.status !== 'operating' ? statusPill(s.status) : ''}</button></li>`).join('');
  const measures = (p.progressAll || []).filter(m => Number.isFinite(m.value));
  const progress = measures.length ? `<section class="panel-section"><div class="section-heading"><h3>ความคืบหน้า</h3><span class="hint">ระดับโครงการ ไม่ใช่รายสถานี</span></div>
      ${measures.map(m => `<div class="progress-item"><p class="progress-label">${esc(m.metric)}<span class="hint">${m.period ? ` · ${esc(thaiDate(m.period))}` : ''}${m.source ? ` · ${link(m.source, 'แหล่ง')}` : ''}</span></p>
        <div class="progress" role="img" aria-label="${esc(m.metric)} ${dec(m.value)} เปอร์เซ็นต์"><span class="progress-track"><span class="progress-fill" style="width:${Math.max(1, Math.min(100, m.value))}%"></span></span><span class="progress-value">${dec(m.value)}%</span></div></div>`).join('')}
    </section>` : '';
  const facts = [
    l.operator ? `<dt>ผู้ให้บริการ</dt><dd>${esc(l.operator)}<br><span class="hint">ตาม GTFS ของ สนข.</span></dd>` : '',
    construction && p.stage ? `<dt>ขั้นงาน</dt><dd>${esc(p.stage)}</dd>` : '',
    construction && p.target ? `<dt>เป้าหมาย</dt><dd>${esc(p.target)}<br><span class="hint">${esc(p.targetNote || 'เป้าหมายตามแหล่ง ไม่ใช่วันเปิดจริง')}</span></dd>` : '',
    Number.isFinite(p.lengthKm) ? `<dt>แนวเส้น</dt><dd><span class="data-number">${dec(p.lengthKm)}</span> กม.<br><span class="hint">${esc(p.lengthSource || '')}</span></dd>` : '',
    construction && p.alignmentNote ? `<dt>แนวเส้น</dt><dd><span class="hint">${esc(p.alignmentNote)}</span></dd>` : '',
  ].join('');
  return `<section class="detail-head line">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow">สาย${p.systemName ? ` · ${esc(p.systemName)}` : ''}</p>
      <h2>${swatch(l, {construction})} ${esc(l.name)}</h2>
      <p class="subtle">${esc(l.nameEn || '')}</p>
      <p class="store-status">${statusPill(construction ? 'construction' : 'operating')}${l.elevation ? ` <span class="status-pill tone-neutral">${esc(ELEVATION_LABEL[l.elevation] || l.elevation)}</span>` : ''}</p>
      <div class="metrics compact">${construction ? metricTile(p.construction, 'สถานีใหม่', 'construction') : metricTile(p.operating, 'สถานี', 'station')}${construction ? metricTile(p.connections, 'เชื่อมสายอื่นในอนาคต', 'interchange') : metricTile(p.interchanges, 'จุดเปลี่ยนสาย', 'interchange')}${metricTile(p.provinces, 'จังหวัด', 'province')}</div>
      ${facts ? `<dl class="facts">${facts}</dl>` : ''}
      <div class="detail-actions"><button type="button" class="btn" data-action="open-table">ดูสถานี</button><button type="button" class="btn quiet" data-action="open-charts">เปรียบเทียบสาย</button></div>
    </section>
    ${progress}
    <section class="panel-section"><div class="section-heading"><h3>สถานี</h3><span class="hint">${num(p.stations.length)}${p.ordered ? ' · เรียงตามแนวสาย' : ''}</span></div><ol class="outlet-list">${stations}</ol></section>
    ${p.sources.length ? `<section class="panel-section"><div class="section-heading"><h3>แหล่งข้อมูล</h3></div><p class="links">${p.sources.map(x => link(x.url, x.title)).join(' ')}</p></section>` : ''}`;
}

/* ---------- Station ---------- */

const SCOPE_PILL = {current: 'เชื่อมตามผัง', branch: 'เปลี่ยนขบวน', future: 'อนาคต'};

export function renderStation(d, {lineById}) {
  if (!d) return '';
  const s = d.station;
  const coords = hasPoint(s) ? `${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}` : 'ยังไม่มีพิกัด';
  const province = provinceByCode(s.provinceCode);
  const lines = (s.lineIds || []).map(id => lineById.get(id)).filter(Boolean);
  const complexLines = (d.complex?.lineIds || []).map(id => lineById.get(id)).filter(l => l && !lines.includes(l));
  const lineChips = [...lines, ...complexLines].map(l => `<li><button type="button" class="line-chip" data-action="select-line" data-id="${esc(l.id)}">${swatch(l, {construction: l.status === 'construction'})}<span>${esc(l.name)}${s.codes?.length && lines.includes(l) ? ` <small class="data-number">${esc(s.codes.join(' / '))}</small>` : ''}</span></button></li>`).join('');
  const ridership = (d.ridership || []).map(r => `<dd><strong class="data-number">${num(r.value)}</strong> ${esc(r.unit)}<br><span class="hint">${esc(r.label)} · ${esc(r.period)}${r.source ? ` · ${link(r.source, r.dataset ? 'แหล่ง' : 'แหล่ง')}` : ''}</span></dd>`).join('');
  const c = d.construction;
  const work = c ? `<dt>ก่อสร้าง</dt><dd>${esc(c.stage || '')}${c.projectStage ? `<br><span class="hint">โครงการ: ${esc(c.projectStage)}</span>` : ''}${Number.isFinite(c.percent) ? `<br><span class="progress" role="img" aria-label="ความคืบหน้า${esc(c.percentScope || '')} ${dec(c.percent)} เปอร์เซ็นต์"><span class="progress-track"><span class="progress-fill" style="width:${Math.max(1, Math.min(100, c.percent))}%"></span></span><span class="progress-value">${dec(c.percent)}%</span></span><span class="hint">${esc(c.percentScope || '')}${c.period ? ` ณ ${esc(thaiDate(c.period))}` : ''}</span>` : ''}${!Number.isFinite(c.percent) && c.period ? `<br><span class="hint">หลักฐานล่าสุด ${esc(thaiDate(c.period))}</span>` : ''}</dd>
      ${Number.isFinite(c.projectPercent) ? `<dt>ทั้งโครงการ</dt><dd><strong class="data-number">${dec(c.projectPercent)}%</strong><br><span class="hint">${esc(c.projectMetric || '')}${c.projectPeriod ? ` · ${esc(thaiDate(c.projectPeriod))}` : ''}${c.evidence ? ` · ${link(c.evidence, 'แหล่ง')}` : ''}</span></dd>` : ''}
      ${c.target ? `<dt>เป้าหมาย</dt><dd>${esc(c.target)}<br><span class="hint">ตามแหล่ง ไม่ใช่วันเปิดจริง</span></dd>` : ''}` : '';
  const building = d.building ? `<dt>อาคาร</dt><dd>${esc(d.building.name || 'อาคารสถานี')}<br><span class="hint">OpenStreetMap ${link(d.building.url, d.building.osmRef)}${d.building.heightNote ? ` · ${esc(d.building.heightNote)}` : ''}</span></dd>` : '';
  const connections = (d.connections || []).map(x => {
    const body = `<span class="station-seq" aria-hidden="true">${x.scope === 'future' ? '…' : '↔'}</span><span class="station-text"><strong>${esc(x.name)}</strong><span>${esc(x.lineName || '')}${x.pathway ? ` · ${esc(x.pathway)}` : ''}</span></span><span class="status-pill tone-${x.scope === 'future' ? 'pending' : 'neutral'}">${esc(SCOPE_PILL[x.scope] || x.status || '')}</span>`;
    return `<li>${x.id ? `<button type="button" class="station-row" data-action="select-station" data-id="${esc(x.id)}">${body}</button>` : `<div class="station-row is-static">${body}</div>`}</li>`;
  }).join('');
  return `<section class="detail-head station">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow">สถานี${d.complex ? ` · จุดเปลี่ยนสาย ${esc(d.complex.name)}` : ''}</p>
      <h2>${esc(s.name)}</h2>
      <p class="subtle">${esc([s.nameEn, (s.codes || []).join(' / ')].filter(Boolean).join(' · '))}</p>
      <p class="store-status">${statusPill(s.status, s.statusBasis || '')}${s.elevation ? ` <span class="status-pill tone-neutral">${esc(ELEVATION_LABEL[s.elevation] || s.elevation)}</span>` : ''}</p>
      <ul class="chip-list" aria-label="สายที่ผ่านหรือเปลี่ยนได้ที่สถานีนี้">${lineChips}</ul>
      <dl class="facts">
        <dt>จังหวัด</dt><dd>${province ? `<button type="button" class="link-button" data-action="select-province" data-id="${esc(province.code)}">${esc(province.th)}</button>` : 'ไม่ระบุ'}${s.district ? ` · ${esc(s.district)}` : ''}</dd>
        <dt>พิกัด</dt><dd><span class="data-number">${esc(coords)}</span><br><span class="hint">${esc(d.coordinateNote || '')}${d.displayNote ? `<br>${esc(d.displayNote)}` : ''}</span></dd>
        ${ridership ? `<dt>ผู้โดยสาร</dt>${ridership}` : ''}
        ${work}
        ${building}
        <dt>สถานะ</dt><dd>${esc(s.statusBasis || STATUS[s.status]?.label || '')}</dd>
        <dt>ตรวจเมื่อ</dt><dd>${esc(thaiDate(s.checkedOn)) || '—'}</dd>
      </dl>
      <p class="links">${(d.sources || []).map(x => link(x.url, x.label)).join(' ')}</p>
    </section>
    ${connections ? `<section class="panel-section"><div class="section-heading"><h3>การเชื่อมต่อ</h3><span class="hint">${num(d.connections.length)}</span></div><ul class="outlet-list">${connections}</ul></section>` : ''}
    <section class="panel-section" id="station-modes" aria-live="polite" hidden></section>`;
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
