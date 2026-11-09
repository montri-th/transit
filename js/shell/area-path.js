/**
 * citymeter-shell · area paths.
 *
 * The `at` parameter is the production path after /v3/citymeter/, letter for letter (demo-platform-review §5.2),
 * so a demo link and a production link name the same place:
 *   BKK               จังหวัด (production 3-letter code)
 *   BKK/D/1039        เขต/อำเภอ (DOPA district code)
 *   BKK/S/103902      แขวง/ตำบล (DOPA subdistrict code; it nests in its district: 103902 → 1039)
 *   CBI/M/03200701    อปท. (local administrative unit code as production writes it)
 *   BKK/L/<uuid>      ย่าน (a Locale of production)
 * A dataset opens the deepest level it supports (`clampAt`); a deeper link falls back to its district, else to its
 * province, and the page rewrites the address to what it shows.
 *
 * Part of the shared CityMETER demo shell: edit it in every repository at once (js/shell/manifest.json).
 */

const PROVINCE = /^[A-Z]{3}$/;
const CODE = Object.freeze({
  D: /^\d{4}$/,
  S: /^\d{6}$/,
  M: /^\d{5,10}$/,
  L: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
});

/** Area levels: P province, D district, S subdistrict, M local administrative unit, L locale. */
export const LEVELS = Object.freeze(['P', 'D', 'S', 'M', 'L']);

export const PRODUCTION = 'https://landometer.com/v3/citymeter';

/** 'BKK/D/1039' → {province: 'BKK', kind: 'D', code: '1039'}; a province alone has kind 'P'. Invalid → null. */
export function parseAt(value) {
  if (typeof value !== 'string' || !value) return null;
  const parts = value.split('/');
  if (!PROVINCE.test(parts[0])) return null;
  if (parts.length === 1) return {province: parts[0], kind: 'P', code: ''};
  if (parts.length !== 3 || !CODE[parts[1]] || !CODE[parts[1]].test(parts[2])) return null;
  return {province: parts[0], kind: parts[1], code: parts[2]};
}

/** {province, kind, code} → 'BKK/D/1039' (or 'BKK'); null or an invalid path → ''. */
export function formatAt(at) {
  if (!at || !PROVINCE.test(at.province || '')) return '';
  if (!at.kind || at.kind === 'P') return at.province;
  if (!CODE[at.kind] || !CODE[at.kind].test(at.code || '')) return '';
  return `${at.province}/${at.kind}/${at.code}`;
}

/** The district code that holds a path ('' when the path names no district). */
export function districtOf(at) {
  if (!at) return '';
  if (at.kind === 'D') return at.code;
  if (at.kind === 'S') return at.code.slice(0, 4);
  return '';
}

/**
 * The deepest level of `at` a dataset can open. `levels` lists what it supports, e.g. ['P', 'D'].
 * A subdistrict falls back to its district; a local unit or a locale falls back to the province.
 */
export function clampAt(at, levels = ['P', 'D']) {
  if (!at) return null;
  if (at.kind === 'P' || levels.includes(at.kind)) return at;
  if (at.kind === 'S' && levels.includes('D')) return {province: at.province, kind: 'D', code: at.code.slice(0, 4)};
  return {province: at.province, kind: 'P', code: ''};
}

/** Production deep link of a path (null → the national page), with the dataset code. */
export function productionHref(dataset, at = null) {
  const path = formatAt(at);
  return `${PRODUCTION}${path ? `/${path}` : ''}${dataset ? `?d=${encodeURIComponent(dataset)}` : ''}`;
}
