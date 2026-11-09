/**
 * citymeter-shell · breadcrumb — ประเทศไทย › จังหวัด › เขต/อำเภอ › แขวง/ตำบล, or ประเทศไทย › จังหวัด › อปท.,
 * the CityMETER production hierarchy.
 *
 * Every administrative crumb carries the production deep link of its level (js/shell/area-path.js#productionHref),
 * so a demo crumb and a production page name the same place. An item, a station or a building is the panel
 * heading, never a crumb (demo-platform-review §5.3). A local administrative unit (อปท.) is another way of dividing
 * the province, so it follows the province directly and never sits under a district (§5.3 rule 5). A zone a dataset
 * defines itself (an analytical ย่าน, 0.4.2) is not a production area: its crumb has no production link, nor has a
 * network the reader came through (a rail line, a brand page, 0.4.3). With four levels
 * the upper ones fold behind “…” on narrow screens. The dataset passes its own lookups, so the module knows no
 * dataset:
 *   ctx = {dataset: 'hotel', provinceByCode: code => {code, th} | null, areaWord: provinceCode => 'เขต' | 'อำเภอ',
 *          subWord: provinceCode => 'แขวง' | 'ตำบล'}
 * A dataset that production does not carry yet passes dataset '' and its links name the place alone.
 *
 * Part of the shared CityMETER demo shell: edit it in every repository at once (js/shell/manifest.json).
 */
import {productionHref} from './area-path.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/**
 * Pure model. sel.province = production code or ''; sel.area = a district record ({id, name, province}) or null;
 * sel.sub = a subdistrict record ({id, name, province, district, districtName}) or null — its district crumb comes
 * from sel.area when given, else from its own district fields; sel.unit = a local administrative unit or a locale
 * ({id, name, province, kind: 'M' | 'L'}, kind M when absent) or null; sel.zone = an area the dataset defines itself
 * ({id, name, province}) or null — after the administrative crumbs, with no production link (0.4.2); sel.network = a
 * network the reader came through ({id, name}: a rail line, a brand) or null — after the area crumbs, with no production
 * link (0.4.3); sel.site = a site
 * the reader is inside ({id, name, province}) or null — the last crumb, with no production link (§5.3 rule 4). Crumb
 * actions: crumb-country, crumb-province, crumb-area (district), crumb-sub (subdistrict), crumb-unit (local
 * administrative unit or locale), crumb-zone, crumb-network, crumb-site.
 */
export function buildBreadcrumb({province = '', area = null, sub = null, unit = null, zone = null, network = null, site = null} = {},
  {dataset = '', provinceByCode = () => null, areaWord = () => '', subWord = () => ''} = {}) {
  const crumbs = [{level: 'country', label: 'ประเทศไทย', action: 'crumb-country', href: productionHref(dataset)}];
  const code = sub?.province || area?.province || unit?.province || zone?.province || province || site?.province || '';
  const p = provinceByCode(code);
  if (p) crumbs.push({level: 'province', label: p.th, id: p.code, action: 'crumb-province', href: productionHref(dataset, {province: p.code, kind: 'P'})});
  if (unit) {
    crumbs.push({level: 'unit', label: unit.name, id: unit.id, action: 'crumb-unit', href: productionHref(dataset, {province: code, kind: unit.kind === 'L' ? 'L' : 'M', code: unit.id})});
  } else {
    const district = area || (sub?.district ? {id: sub.district, name: sub.districtName || '', province: code} : null);
    if (district) {
      crumbs.push({level: 'area', label: `${areaWord(code)}${district.name}`, id: district.id, action: 'crumb-area',
        href: productionHref(dataset, {province: code, kind: 'D', code: district.id})});
    }
    if (sub) {
      crumbs.push({level: 'sub', label: `${subWord(code)}${sub.name}`, id: sub.id, action: 'crumb-sub',
        href: productionHref(dataset, {province: code, kind: 'S', code: sub.id})});
    }
  }
  if (zone) crumbs.push({level: 'zone', label: zone.name, id: zone.id, action: 'crumb-zone'});
  if (network) crumbs.push({level: 'network', label: network.name, id: network.id, action: 'crumb-network'});
  if (site) crumbs.push({level: 'site', label: site.name, id: site.id, action: 'crumb-site'});
  crumbs[crumbs.length - 1].current = true;
  return crumbs;
}

/** HTML for the panel header; the last crumb is the current level (aria-current="location"). Each item names its level
 * (data-level), so the dataset picker can name the place it hands over (js/shell/header.js#placeLevel). */
export function renderBreadcrumb(crumbs) {
  const collapsible = crumbs.length >= 4;
  const items = crumbs.map((c, i) => {
    const fold = collapsible && i < crumbs.length - 2;
    const inner = c.current
      ? `<span class="crumb is-current" aria-current="location">${esc(c.label)}</span>`
      : `<button type="button" class="crumb" data-action="${esc(c.action)}" data-id="${esc(c.id || '')}">${esc(c.label)}</button>`;
    return `<li${fold ? ' class="is-collapsible"' : ''} data-level="${esc(c.level)}">${inner}</li>`;
  });
  if (collapsible) items.splice(crumbs.length - 2, 0, '<li class="crumb-ellipsis"><button type="button" class="crumb crumb-more" data-action="crumb-expand" aria-expanded="false" aria-label="แสดงระดับบน">…</button></li>');
  return `<ol class="crumbs${collapsible ? ' is-collapsible' : ''}">${items.join('')}</ol>`;
}

/** Compact text form for the mobile map card. */
export const breadcrumbText = crumbs => crumbs.map(c => c.label).join(' › ');

/** Production deep link of the deepest administrative crumb (for “ดูใน CityMETER”). */
export const deepestHref = (crumbs, dataset = '') => [...crumbs].reverse().find(c => c.href)?.href || productionHref(dataset);
