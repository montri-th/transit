/**
 * citymeter-shell · dataset picker in the header: “CityMETER / Hotel ▾” (demo-platform-review §5.3 rule 2, §5.5).
 *
 * The product name becomes a disclosure button (LDS NAV-02: a button with a synchronised aria-expanded, the list
 * right after it in the DOM, no menu roles; Escape, a click outside or focus leaving close it, Escape returns focus
 * to the button). The list is links to the CityMETER demos, grouped Land · Location · Living as the registry groups
 * them (js/shell/datasets.js). A demo on the shell opens the same area (`?at=` of this page); the others open their
 * own start page and say “หน้าแรก”. The list ends with “ดูเดโมทั้งหมด”, the demo hub on the showcase in the page's
 * language with the same `at`; the logo keeps going to production (owner 2026-11-09, demo-platform-review §7).
 * Header budget (LDS NAV-01, the logo counts): desktop logo · picker · Product statement · language = 4, the language
 * link only on a page that declares English (js/shell/i18n.js); the theme control sits at the top of the list on
 * every width (0.5.0; §5.5 puts it in the menu). On a phone in portrait the language link joins it there, so the
 * header shows the logo and the picker = 2. Every target is at least 44 × 44 px.
 *
 * Part of the shared CityMETER demo shell: edit it in every repository at once (js/shell/manifest.json).
 */
import {DEMOS, GROUPS, demoUrl, hubUrl} from './datasets.js';
import {parseAt} from './area-path.js';
import {LANG, languagesOf, languageHref} from './i18n.js';

export const PHONE_QUERY = '(max-width: 760px) and (orientation: portrait)';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/** The link to a demo: a demo on the shell keeps the area of this page (`at`); the others open their start page.
 * From an English page, a demo that declares English opens in English (0.5.0). */
export function demoHref(demo, search = '', lang = 'th') {
  const at = demo.at ? new URLSearchParams(search).get('at') : null;
  const query = [at ? `at=${encodeURIComponent(at).replace(/%2F/gi, '/')}` : '', lang === 'en' && demo.en ? 'lang=en' : '']
    .filter(Boolean).join('&');
  return query ? `${demoUrl(demo)}?${query}` : demoUrl(demo);
}

/** The crumb level of the place a link hands over: the level `at` names (a zone or a site of this dataset is not part
 * of `at`, so the other demos never open it); '' without `at` (0.4.2). */
export function placeLevel(search = '') {
  const at = parseAt(new URLSearchParams(search).get('at'));
  return at ? {P: 'province', D: 'area', S: 'sub', M: 'unit', L: 'unit'}[at.kind] || '' : '';
}

/** The demo hub for this page's language, with the area of this page (`at`) when it names one (0.5.0). */
export function hubHref(search = '', lang = 'th') {
  const at = new URLSearchParams(search).get('at');
  return at ? `${hubUrl(lang)}?at=${encodeURIComponent(at).replace(/%2F/gi, '/')}` : hubUrl(lang);
}

/** The demo this page belongs to, by its path (/hotel/…), or null. */
export const currentDemo = (pathname = '') =>
  DEMOS.find(d => pathname === `/${d.path}` || pathname.startsWith(`/${d.path}/`)) || null;

/** Pure: the list for this page. place = the area the page shows (only when the address names one). */
export function pickerList({pathname = '', search = '', place = '', lang = 'th'} = {}) {
  const here = currentDemo(pathname);
  const lead = place ? `เปิด${place}ในชุดข้อมูลอื่น` : 'ชุดข้อมูลอื่นของ CityMETER';
  const groups = GROUPS.map(group => {
    const id = `dataset-group-${group.toLowerCase()}`;
    const items = DEMOS.filter(d => d.group === group).map(d => {
      const current = here?.path === d.path;
      // From an English page a demo that is Thai only says so (it opens in Thai).
      const notes = [d.at || current ? '' : 'หน้าแรก', lang === 'en' && !d.en && !current ? 'ภาษาไทย' : ''].filter(Boolean);
      const note = notes.length ? `<span class="dataset-note">${notes.join(' · ')}</span>` : '';
      return `<li><a class="dataset-link" href="${esc(demoHref(d, search, lang))}"${current ? ' aria-current="page"' : ''}`
        + `${lang === 'en' && !d.en ? ' hreflang="th"' : ''}><span>${esc(d.name)}</span>${note}</a></li>`;
    }).join('');
    return `<div class="dataset-group"><p class="dataset-group-label" id="${id}">${esc(group.toUpperCase())}</p>`
      + `<ul aria-labelledby="${id}">${items}</ul></div>`;
  }).join('');
  const hub = `<p class="dataset-hub"><a class="dataset-link" href="${esc(hubHref(search, lang))}">ดูเดโมทั้งหมด</a></p>`;
  return `<p class="dataset-lead">${esc(lead)}</p>${groups}${hub}`;
}

/** The language link of a page that declares English: the other language at the same address (0.5.0). */
export function languageLink(pathname = '/', search = '', lang = 'th') {
  const other = lang === 'en' ? 'th' : 'en';
  return {href: languageHref(pathname, search, other), lang: other, label: other === 'en' ? 'EN' : 'ไทย',
    title: other === 'en' ? 'Read in English (draft translation)' : 'อ่านเป็นภาษาไทย'};
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
    list.innerHTML = pickerList({pathname: win.location.pathname, search: win.location.search, place: place(), lang: LANG});
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

  // The theme control sits at the top of the list on every width (0.5.0). The language link, on a page that declares
  // English, stays in the header on a wide screen; a phone in portrait has room for two header controls (LDS
  // NAV-01), so there it joins the theme control. Its address is the same view in the other language, refreshed
  // whenever it is about to be used, so it follows every change of `at`, `e` or a filter.
  const actions = doc.querySelector('.topbar .top-actions');
  const theme = actions?.querySelector('.theme-control');
  if (theme) utility.append(theme);
  // The product statement is written in Thai; on an English page every link to it says so.
  for (const statement of LANG === 'en' ? doc.querySelectorAll('a[href$="PRODUCT_STATEMENT.md"]') : []) {
    const label = [...statement.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim());
    if (label && !/\(Thai\)/.test(label.nodeValue)) label.nodeValue = `${label.nodeValue.trim()} (Thai)`;
    statement.title = 'Written in Thai';
  }
  let langLink = doc.querySelector('.topbar .lang-link');
  if (languagesOf(doc).includes('en')) {
    if (!langLink && actions) {
      langLink = doc.createElement('a');
      langLink.className = 'lang-link';
      actions.append(langLink);
    }
  } else if (langLink) {
    langLink.remove();
    langLink = null;
  }
  const refreshLanguage = () => {
    if (!langLink) return;
    const link = languageLink(win.location.pathname, win.location.search, LANG);
    langLink.href = link.href;
    langLink.lang = link.lang;
    langLink.hreflang = link.lang;
    langLink.title = link.title;
    langLink.setAttribute('translate', 'no');
    langLink.textContent = link.label;
  };
  refreshLanguage();
  for (const type of ['pointerenter', 'focus', 'pointerdown', 'click']) langLink?.addEventListener(type, refreshLanguage);
  const home = actions;
  const phone = typeof win.matchMedia === 'function' ? win.matchMedia(PHONE_QUERY) : null;
  function placeLanguage() {
    if (!langLink) return;
    if (phone?.matches) { if (langLink.parentNode !== utility) utility.append(langLink); }
    else if (langLink.parentNode !== home) home.append(langLink);
  }
  placeLanguage();
  phone?.addEventListener?.('change', placeLanguage);
  return {open, close, button, menu};
}
