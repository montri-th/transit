/**
 * citymeter-shell · the address of a view.
 *
 * One grammar for every CityMETER demo, equal to production (demo-platform-review §5.2, owner 2026-11-08 “ทำงาน ตาม
 * demo platform review ระยะถัดไปต่อเลยครับ”):
 *   d       dataset — the production `?d=` code (a dataset with no code in the registry yet writes none, 0.4.3)
 *   at      area — the production path after /v3/citymeter/ (js/shell/area-path.js)
 *   e       the thing open — `<kind>:<id>`, split at the first colon; the id is the registry's stable key, verbatim
 *   n       network — `<kind>:<id>` (brand | company | operator | line)
 *   m       measure · f.<name> filters · focus · view · v3d · cam · lang
 * Changing d, at, e or n adds a browser history entry, so the back button goes up a level; every other change
 * replaces the current entry. `/`, `:` and `,` stay readable in the address (RFC 3986 allows them in a query).
 *
 * A dataset keeps its own parameter names inside (`?area=`, `?hotel=` …): `createCodec` translates them to and from
 * this grammar, and old links keep working — they are read once and the address is rewritten in the new grammar.
 * The `e` kinds are provisional until the dataset registry declares them; an old kind can be kept as an alias.
 * A zone a dataset defines itself (an analytical ย่าน that is not a production area) stays a filter, `f.<name>`, but
 * opening it adds a browser history entry like `at` (`levelFilters`, 0.4.2).
 *
 * Part of the shared CityMETER demo shell: edit it in every repository at once (js/shell/manifest.json).
 */
import {parseAt, formatAt, clampAt} from './area-path.js';

/** Keys whose change adds a browser history entry. */
export const LEVEL_KEYS = Object.freeze(['d', 'at', 'e', 'n']);
/** Keys of the shared grammar (filters are `f.<name>`). */
export const SHARED_KEYS = Object.freeze(['d', 'at', 'e', 'n', 'part', 'm', 'focus', 'cmp', 'view', 'v3d', 'cam', 'camx', 'lang']);
const HEAD = ['d', 'at', 'e', 'n', 'part', 'm'];
const TAIL = ['focus', 'cmp', 'view', 'v3d', 'cam', 'camx', 'lang'];
const SHARED = new Set(SHARED_KEYS);
const KIND = /^[a-z][a-z0-9-]*$/;
/** Own parameter → shared key, unless a dataset says otherwise. */
const RENAME = Object.freeze({metric: 'm', areas: 'focus', view: 'view', view3d: 'v3d'});

/** 'station:CONSTCAT:MRT_ORANGE:OR02' → {kind: 'station', id: 'CONSTCAT:MRT_ORANGE:OR02'}; invalid → null. */
export function splitRef(value) {
  if (typeof value !== 'string') return null;
  const i = value.indexOf(':');
  if (i <= 0 || i === value.length - 1) return null;
  const kind = value.slice(0, i);
  return KIND.test(kind) ? {kind, id: value.slice(i + 1)} : null;
}

/** {kind, id} → 'kind:id'. */
export const joinRef = (kind, id) => `${kind}:${id}`;

const encodeValue = v => encodeURIComponent(v).replace(/%2F/gi, '/').replace(/%3A/gi, ':').replace(/%2C/gi, ',');

/** URLSearchParams → the canonical query string (no leading "?"): shared keys in order, filters, then the rest. */
export function serialize(params) {
  const seen = new Set(), out = [];
  const put = k => {
    if (seen.has(k)) return;
    seen.add(k);
    for (const v of params.getAll(k)) out.push(`${encodeURIComponent(k)}=${encodeValue(v)}`);
  };
  for (const k of HEAD) if (params.has(k)) put(k);
  for (const k of params.keys()) if (k.startsWith('f.')) put(k);
  for (const k of TAIL) if (params.has(k)) put(k);
  for (const k of params.keys()) put(k);
  return out.join('&');
}

/**
 * The translator between a dataset's own parameters and the shared grammar.
 *   dataset     production `?d=` code, e.g. 'hotel'; '' when the dataset has no code in the registry yet (no `d`)
 *   levels      area levels the dataset opens, e.g. ['P', 'D'] (js/shell/area-path.js#clampAt)
 *   place       own parameters that carry the area: {province: 'province', D: 'area'} (+ S for a subdistrict,
 *               M for a local administrative unit, L for a locale; M and L may share one parameter)
 *   items       own parameter → `e` kind, first match wins: {hotel: 'hotel', station: 'station'}
 *   networks    own parameter → `n` kind, first match wins: {company: 'company'} (brand | company | operator | line)
 *   filters     own filter parameters → `f.<name>` (the province parameter is part of `at`, not a filter)
 *   levelFilters  filters that open a level of the dataset's own — a zone it defines itself, never a production area,
 *               so it never goes in `at`: a change adds a browser history entry (codec.levelKeys, 0.4.2)
 *   rename      own → shared key for the rest (default: metric → m, areas → focus, view → view, view3d → v3d)
 *   provinceOf  (code, kind) → the production province code of one of the dataset's districts / subdistricts /
 *               local administrative units / locales (kind 'D', 'S', 'M' or 'L'; '' when the code is not of that kind)
 * A district opened inside a province filter keeps that filter as `f.province`, so the view comes back the same.
 */
export function createCodec(config) {
  const place = {province: 'province', ...(config.place || {D: 'area'})};
  const levels = config.levels || ['P', 'D'];
  const items = config.items || {};
  const kinds = Object.fromEntries(Object.entries(items).map(([param, kind]) => [kind, param]));
  const networks = config.networks || {};
  const netKinds = Object.fromEntries(Object.entries(networks).map(([param, kind]) => [kind, param]));
  const filters = (config.filters || []).filter(f => f !== place.province);
  const levelKeys = (config.levelFilters || []).filter(f => filters.includes(f)).map(f => `f.${f}`);
  const rename = config.rename || RENAME;
  const owned = new Set([place.province, place.D, place.S, place.M, place.L, ...Object.keys(items), ...Object.keys(networks), ...filters, ...Object.keys(rename)].filter(Boolean));
  const provinceOf = config.provinceOf || (() => '');

  /** Own parameters (as the dataset writes them) → shared grammar (URLSearchParams). */
  function encode(own) {
    const out = new URLSearchParams();
    if (config.dataset) out.set('d', config.dataset);
    const province = own.get(place.province) || '';
    const sub = place.S ? own.get(place.S) || '' : '';
    const district = place.D ? own.get(place.D) || '' : '';
    const unit = place.M ? own.get(place.M) || '' : '';
    const locale = place.L ? own.get(place.L) || '' : '';
    let at = null;
    if (unit) { const p = provinceOf(unit, 'M'); if (p) at = {province: p, kind: 'M', code: unit}; }
    if (!at && locale) { const p = provinceOf(locale, 'L'); if (p) at = {province: p, kind: 'L', code: locale}; }
    if (!at && sub) { const p = provinceOf(sub, 'S'); if (p) at = {province: p, kind: 'S', code: sub}; }
    if (!at && district) { const p = provinceOf(district, 'D'); if (p) at = {province: p, kind: 'D', code: district}; }
    if (!at && province) at = {province, kind: 'P', code: ''};
    const path = formatAt(at);
    if (path) out.set('at', path);
    else { // never lose a place the address cannot spell: keep the own parameters as they are
      if (province) out.set(place.province, province);
      if (district) out.set(place.D, district);
      if (sub) out.set(place.S, sub);
      if (unit) out.set(place.M, unit);
      if (locale && !out.has(place.L)) out.set(place.L, locale);
    }
    for (const [param, kind] of Object.entries(items)) {
      const v = own.get(param);
      if (v && !out.has('e')) out.set('e', joinRef(kind, v));
    }
    for (const [param, kind] of Object.entries(networks)) {
      const v = own.get(param);
      if (v && !out.has('n')) out.set('n', joinRef(kind, v));
    }
    if (path && at.kind !== 'P' && province) out.set('f.province', province);
    for (const f of filters) { const v = own.get(f); if (v) out.set(`f.${f}`, v); }
    for (const [mine, shared] of Object.entries(rename)) if (own.get(mine)) out.set(shared, own.get(mine));
    for (const [k, v] of own) if (!owned.has(k) && !out.has(k)) out.set(k, v);
    return out; // key order is serialize()'s job
  }

  /**
   * Any address — shared grammar, old own parameters, or a mix — → own parameters (shared keys win).
   * `legacy` says an old own parameter was read (the next commit rewrites the address).
   */
  function decode(search) {
    const src = new URLSearchParams(search);
    const own = new URLSearchParams();
    let legacy = false;
    const at = clampAt(parseAt(src.get('at')), levels);
    if (at) {
      if (at.kind === 'P') own.set(place.province, at.province);
      else {
        if (at.kind === 'D' && place.D) own.set(place.D, at.code);
        if (at.kind === 'S' && place.S) own.set(place.S, at.code);
        if (at.kind === 'M' && place.M) own.set(place.M, at.code);
        if (at.kind === 'L' && place.L) own.set(place.L, at.code);
        if (src.get('f.province')) own.set(place.province, src.get('f.province'));
      }
    }
    const ref = splitRef(src.get('e'));
    if (ref && kinds[ref.kind]) own.set(kinds[ref.kind], ref.id);
    const net = splitRef(src.get('n'));
    if (net && netKinds[net.kind]) own.set(netKinds[net.kind], net.id);
    for (const [mine, shared] of Object.entries(rename)) if (src.has(shared)) own.set(mine, src.get(shared));
    for (const f of filters) if (src.has(`f.${f}`)) own.set(f, src.get(`f.${f}`));
    for (const [k, v] of src) {
      if (SHARED.has(k) || k.startsWith('f.')) continue;
      if (owned.has(k)) legacy = true;
      if (!own.has(k)) own.set(k, v);
    }
    return {own, legacy};
  }

  return {encode, decode, dataset: config.dataset, levelKeys};
}

/**
 * The page's address, read and written through a codec.
 *   read()            own parameters of the current address
 *   commit(own)       write them: a change of d / at / e / n (or of a codec's levelKeys) pushes a history entry,
 *                     anything else replaces;
 *                     the first commit after load always replaces (it rewrites an old link in the new grammar)
 *   canGoBack()       an earlier entry of this page exists (the panel's back button can use the browser's)
 * onPop(own) runs on the browser's back and forward buttons with the restored parameters. `lang` is kept as is.
 */
export function createNavigator(codec, {onPop = null, win = globalThis} = {}) {
  const initial = win.history && win.history.state;
  let depth = initial && initial.citymeterShell ? initial.depth : 0;
  let started = false, last = '';
  const levelKeys = [...LEVEL_KEYS, ...(codec.levelKeys || [])];
  const query = () => win.location.search.replace(/^\?/, '');

  function read() { return codec.decode(win.location.search).own; }

  function commit(own, {replace = false} = {}) {
    const next = codec.encode(own);
    const current = new URLSearchParams(win.location.search);
    if (current.get('lang') && !next.has('lang')) next.set('lang', current.get('lang'));
    const text = serialize(next);
    if (started && text === query()) return false;
    const prev = new URLSearchParams(started ? last : query());
    const level = started && !replace && levelKeys.some(k => (prev.get(k) || '') !== (next.get(k) || ''));
    const url = `${win.location.pathname}${text ? `?${text}` : ''}${win.location.hash || ''}`;
    if (level) { depth += 1; win.history.pushState({citymeterShell: 1, depth}, '', url); }
    else win.history.replaceState({citymeterShell: 1, depth}, '', url);
    started = true;
    last = text;
    return level;
  }

  if (typeof win.addEventListener === 'function') {
    win.addEventListener('popstate', event => {
      depth = event.state && event.state.citymeterShell ? event.state.depth : 0;
      last = query();
      started = true;
      if (onPop) onPop(read());
    });
  }

  return {read, commit, canGoBack: () => depth > 0, back: () => win.history.back(), get depth() { return depth; }};
}
