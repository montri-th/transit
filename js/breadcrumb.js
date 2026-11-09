/**
 * Breadcrumb — ประเทศไทย › จังหวัด › สาย › สถานี, through the shared shell (js/shell/breadcrumb.js, citymeter-shell 0.4.3).
 *
 * The province crumb links its production page /v3/citymeter/{code}; production has no transit dataset checked yet
 * (`transit` is the code in the dataset registry), so the links carry no `d`. A line is a network the reader came
 * through and a station the place the reader is in: neither is a production area, so neither crumb has a production
 * link. The address names them `n=line:<id>` and `e=station:<id>` (js/app.js). Rules:
 *   - the province crumb comes from the station's own province (point-in-polygon at build time,
 *     data/transit.json stations[].provinceCode), else the filter;
 *   - the สาย crumb appears only when the reader came through a line (line panel, line filter) — a station served by
 *     several lines never picks one silently;
 *   - a line that spans several provinces shows the province only when the province filter is set (a line is not
 *     "in" one province);
 *   - with four crumbs on narrow screens the upper levels collapse behind “…”.
 */
import {provinceByCode} from './provinces-list.js';
import {buildBreadcrumb as shellBreadcrumb, renderBreadcrumb, breadcrumbText} from './shell/breadcrumb.js';

/** Production carries no transit dataset yet (not checked): crumbs link the place alone (no `?d=`). */
const PRODUCTION_DATASET = '';
const shellProvince = code => { const p = provinceByCode(code); return p ? {code: p.code, th: p.th} : null; };

/** Pure model. `provinceCode`: the station's or filter's province; `line`: {id, name} or null; `station`: {id, name} or null. */
export function buildBreadcrumb({provinceCode = '', line = null, station = null} = {}) {
  const code = provinceByCode(provinceCode)?.code || '';
  return shellBreadcrumb({
    province: code,
    network: line ? {id: line.id, name: line.name} : null,
    site: station ? {id: station.id, name: station.name, province: code} : null,
  }, {dataset: PRODUCTION_DATASET, provinceByCode: shellProvince});
}

export {renderBreadcrumb, breadcrumbText};
