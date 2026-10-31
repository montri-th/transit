/**
 * Breadcrumb — ประเทศไทย › จังหวัด › ย่าน › สถานที่ — aligned with CityMETER production.
 *
 * Production (landometer.com/v3/citymeter, observed 2026-10-22) drills
 * country → province → one third level whose type is encoded in the path:
 *   /v3/citymeter/{PROVINCE_CODE}                 e.g. BKK, PKT, CMI
 *   /v3/citymeter/{PROVINCE_CODE}/L/{locale uuid}  Locale (ย่านจาก Locale Insight)
 *   /v3/citymeter/{PROVINCE_CODE}/M/{dopa code}    เทศบาล
 * This dataset's third level is its own analytical core (ย่าน, data/
 * neighborhoods.geojson), not yet a registered Locale, so the demo keeps the
 * same province codes but serialises the levels as query parameters (static
 * hosting): ?province=BKK&neighborhood=siam&place=<center id>.
 *
 * Fourth level (owner decision 2026-10-22): the venue — a shopping center or
 * plain venue label. Matched centers carry the CityMETER Shopping Center id
 * (data/luxury.json centers[].id / externalId SC-…), so the crumb already names
 * the production entity. Rules:
 *   - the ย่าน crumb appears when a neighborhood is selected or when the venue's
 *     representative point lies inside a core (point-in-polygon, never by name);
 *   - a venue outside every core skips that level: ประเทศไทย › ภูเก็ต › Central Phuket;
 *   - a store is not a crumb (it is a record, not a container) — the panel heading names it;
 *   - with four crumbs on narrow screens the upper levels collapse behind “…”.
 * Proposed production mapping: /v3/citymeter/{code}/N/{neighborhood id}/V/{center id}
 * ?d=luxuryBrands until each core is registered as a Locale (then /L/{uuid}).
 */
import {provinceByName, provinceByCode} from './model.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/**
 * Pure model. `area` is the selected or containing neighborhood feature (or
 * null); `provinceName` is the dataset province filter value (e.g. "Bangkok")
 * or ''; `venue` is `{id, label, province}` for the open venue/store host (or
 * null). Province precedence: the area's own province (properties.provinceCode)
 * → the filter → the venue's province.
 */
export function buildBreadcrumb({area = null, provinceName = '', venue = null} = {}) {
  const crumbs = [{level: 'country', label: 'ประเทศไทย', action: 'crumb-country'}];
  const areaProvince = area ? provinceByCode(area.properties?.provinceCode) : null;
  const province = areaProvince || provinceByName(provinceName) || (venue?.province ? provinceByName(venue.province) : null);
  if (province) crumbs.push({level: 'province', label: province.th, code: province.code, action: 'crumb-province'});
  if (area) crumbs.push({level: 'neighborhood', label: area.properties.name, id: area.id || area.properties.id, action: 'crumb-area'});
  if (venue && venue.label) crumbs.push({level: 'venue', label: venue.label, id: venue.id || '', value: venue.label, action: 'crumb-venue'});
  crumbs[crumbs.length - 1].current = true;
  return crumbs;
}

/**
 * HTML for the panel header; the last crumb is the current level (aria-current).
 * With four or more levels the upper ones get `is-collapsible` so narrow
 * screens can fold them behind an “…” toggle (the last two always stay visible).
 */
export function renderBreadcrumb(crumbs) {
  const collapsible = crumbs.length >= 4;
  const items = crumbs.map((c, i) => {
    const fold = collapsible && i < crumbs.length - 2;
    const inner = c.current
      ? `<span class="crumb is-current" aria-current="location">${esc(c.label)}</span>`
      : `<button type="button" class="crumb" data-action="${esc(c.action)}" data-id="${esc(c.id || c.code || '')}"${c.value ? ` data-value="${esc(c.value)}"` : ''}>${esc(c.label)}</button>`;
    return `<li${fold ? ' class="is-collapsible"' : ''}>${inner}</li>`;
  });
  if (collapsible) items.splice(crumbs.length - 2, 0, '<li class="crumb-ellipsis"><button type="button" class="crumb crumb-more" data-action="crumb-expand" aria-expanded="false" aria-label="แสดงระดับบน">…</button></li>');
  return `<ol class="crumbs${collapsible ? ' is-collapsible' : ''}">${items.join('')}</ol>`;
}

/** Compact text form for the mobile map card and the document title. */
export const breadcrumbText = crumbs => crumbs.map(c => c.label).join(' › ');
