/**
 * citymeter-shell · dataset picker in the header: “CityMETER / Hotel ▾” (demo-platform-review §5.3 rule 2, §5.5).
 *
 * The product name becomes a disclosure button (LDS NAV-02: a button with a synchronised aria-expanded, the list
 * right after it in the DOM, no menu roles; Escape, a click outside or focus leaving close it, Escape returns focus
 * to the button). The list is links to the CityMETER demos, grouped Land · Location · Living as the registry groups
 * them (js/shell/datasets.js). A demo on the shell opens the same area (`?at=` of this page); the others open their
 * own start page and say “หน้าแรก”. Header budget (LDS NAV-01, the logo counts): desktop logo · picker ·
 * Product statement · theme = 4; on a phone in portrait the theme control moves to the top of the list, so the
 * header shows the logo and the picker = 2. Every target is at least 44 px high.
 *
 * Part of the shared CityMETER demo shell: edit it in every repository at once (js/shell/manifest.json).
 */
import {DEMOS, GROUPS, demoUrl} from './datasets.js';
import {parseAt} from './area-path.js';

export const PHONE_QUERY = '(max-width: 760px) and (orientation: portrait)';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/** The link to a demo: a demo on the shell keeps the area of this page (`at`); the others open their start page. */
export function demoHref(demo, search = '') {
  const at = demo.at ? new URLSearchParams(search).get('at') : null;
  return at ? `${demoUrl(demo)}?at=${encodeURIComponent(at).replace(/%2F/gi, '/')}` : demoUrl(demo);
}

/** The crumb level of the place a link hands over: the level `at` names (a zone or a site of this dataset is not part
 * of `at`, so the other demos never open it); '' without `at` (0.4.2). */
export function placeLevel(search = '') {
  const at = parseAt(new URLSearchParams(search).get('at'));
  return at ? {P: 'province', D: 'area', S: 'sub', M: 'unit', L: 'unit'}[at.kind] || '' : '';
}

/** The demo this page belongs to, by its path (/hotel/…), or null. */
export const currentDemo = (pathname = '') =>
  DEMOS.find(d => pathname === `/${d.path}` || pathname.startsWith(`/${d.path}/`)) || null;

/** Pure: the list for this page. place = the area the page shows (only when the address names one). */
export function pickerList({pathname = '', search = '', place = ''} = {}) {
  const here = currentDemo(pathname);
  const lead = place ? `เปิด${place}ในชุดข้อมูลอื่น` : 'ชุดข้อมูลอื่นของ CityMETER';
  const groups = GROUPS.map(group => {
    const id = `dataset-group-${group.toLowerCase()}`;
    const items = DEMOS.filter(d => d.group === group).map(d => {
      const current = here?.path === d.path;
      const note = d.at || current ? '' : '<span class="dataset-note">หน้าแรก</span>';
      return `<li><a class="dataset-link" href="${esc(demoHref(d, search))}"${current ? ' aria-current="page"' : ''}>`
        + `<span>${esc(d.name)}</span>${note}</a></li>`;
    }).join('');
    return `<div class="dataset-group"><p class="dataset-group-label" id="${id}">${esc(group.toUpperCase())}</p>`
      + `<ul aria-labelledby="${id}">${items}</ul></div>`;
  }).join('');
  return `<p class="dataset-lead">${esc(lead)}</p>${groups}`;
}

/** Turn `.topbar .product-name` into the picker. Returns {open, close, button, menu} or null (no header). */
export function installHeader({doc = document, win = window} = {}) {
  const name = doc.querySelector('.topbar .product-name');
  if (!name || name.closest('.dataset-switch')) return null;
  const label = name.textContent.trim();
  const wrap = doc.createElement('div');
  wrap.className = 'dataset-switch';
  wrap.innerHTML = `<button type="button" class="dataset-picker" id="dataset-picker" aria-expanded="false" aria-controls="dataset-menu" `
    + `aria-label="${esc(label)} · เปลี่ยนชุดข้อมูล"><span class="product-name">${esc(label)}</span>`
    + '<span class="picker-caret" aria-hidden="true">▾</span></button>'
    + '<div class="dataset-menu" id="dataset-menu" hidden><div class="dataset-utility"></div><div class="dataset-list"></div></div>';
  name.replaceWith(wrap);
  const button = wrap.querySelector('.dataset-picker'), menu = wrap.querySelector('.dataset-menu');
  const list = menu.querySelector('.dataset-list'), utility = menu.querySelector('.dataset-utility');
  const place = () => {
    const level = placeLevel(win.location.search);
    return level ? doc.querySelector(`#crumbs li[data-level="${level}"] .crumb`)?.textContent.trim() || '' : '';
  };

  function open() {
    list.innerHTML = pickerList({pathname: win.location.pathname, search: win.location.search, place: place()});
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
  }
  function close({focus = false} = {}) {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus({preventScroll: true});
  }
  button.addEventListener('click', () => (menu.hidden ? open() : close()));
  doc.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || menu.hidden) return;
    event.stopPropagation();
    close({focus: true});
  }, true);
  doc.addEventListener('pointerdown', event => { if (!wrap.contains(event.target)) close(); });
  doc.addEventListener('focusin', event => { if (!wrap.contains(event.target)) close(); });

  // A phone in portrait has room for two header controls (LDS NAV-01): the theme control moves to the top of the list.
  const theme = doc.querySelector('.topbar .top-actions .theme-control');
  const home = theme ? theme.parentNode : null;
  const phone = typeof win.matchMedia === 'function' ? win.matchMedia(PHONE_QUERY) : null;
  function placeTheme() {
    if (!theme) return;
    if (phone?.matches) { if (theme.parentNode !== utility) utility.append(theme); }
    else if (theme.parentNode !== home) home.append(theme);
  }
  placeTheme();
  phone?.addEventListener?.('change', placeTheme);
  return {open, close, button, menu};
}
