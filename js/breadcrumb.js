/**
 * Breadcrumb — ประเทศไทย › จังหวัด › สาย › สถานี — aligned with CityMETER production.
 *
 * Production (landometer.com/v3/citymeter, observed 2026-10-22 for the Luxury
 * Brands demo) drills country → province with three-letter province codes in
 * the path (/v3/citymeter/{CODE}). This static demo keeps the same codes and
 * serialises the lower levels as query parameters: ?province=BKK&line=<id>&station=<id>.
 *
 * Rules:
 *   - the province crumb comes from the station's own province (point-in-polygon
 *     at build time, data/transit.json stations[].provinceCode), else the filter;
 *   - the สาย crumb appears only when the reader came through a line (line panel,
 *     line filter) — a station served by several lines never picks one silently;
 *   - a line that spans several provinces shows the province only when the
 *     province filter is set (a line is not "in" one province);
 *   - with four crumbs on narrow screens the upper levels collapse behind “…”.
 */
import {provinceByCode} from './provinces-list.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/** Pure model. `provinceCode`: the station's or filter's province; `line`: {id, name} or null; `station`: {id, name} or null. */
export function buildBreadcrumb({provinceCode = '', line = null, station = null} = {}) {
  const crumbs = [{level: 'country', label: 'ประเทศไทย', action: 'crumb-country'}];
  const province = provinceByCode(provinceCode);
  if (province) crumbs.push({level: 'province', label: province.th, code: province.code, action: 'crumb-province'});
  if (line) crumbs.push({level: 'line', label: line.name, id: line.id, action: 'crumb-line'});
  if (station) crumbs.push({level: 'station', label: station.name, id: station.id, action: 'crumb-station'});
  crumbs[crumbs.length - 1].current = true;
  return crumbs;
}

/** HTML for the panel header; the last crumb is the current level (aria-current). */
export function renderBreadcrumb(crumbs) {
  const collapsible = crumbs.length >= 4;
  const items = crumbs.map((c, i) => {
    const fold = collapsible && i < crumbs.length - 2;
    const inner = c.current
      ? `<span class="crumb is-current" aria-current="location">${esc(c.label)}</span>`
      : `<button type="button" class="crumb" data-action="${esc(c.action)}" data-id="${esc(c.id || c.code || '')}">${esc(c.label)}</button>`;
    return `<li${fold ? ' class="is-collapsible"' : ''}>${inner}</li>`;
  });
  if (collapsible) items.splice(crumbs.length - 2, 0, '<li class="crumb-ellipsis"><button type="button" class="crumb crumb-more" data-action="crumb-expand" aria-expanded="false" aria-label="แสดงระดับบน">…</button></li>');
  return `<ol class="crumbs${collapsible ? ' is-collapsible' : ''}">${items.join('')}</ol>`;
}

/** Compact text form for the mobile map card and the document title. */
export const breadcrumbText = crumbs => crumbs.map(c => c.label).join(' › ');
