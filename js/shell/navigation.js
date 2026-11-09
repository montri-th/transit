/**
 * citymeter-shell · approved LDS nav-7 glyphs and the accessible help dialog.
 *
 * Codepoints were verified from this exact font's cmap + GSUB tables. The
 * registry approves only the seven names below; unsupported actions keep
 * visible text and explanatory titles instead of borrowing misleading symbols.
 * Decoration is idempotent and never touches pins, charts, filters or data.
 * Each demo passes the titles of its own controls and the pictogram its font is probed with
 * (js/navigation.js), which also starts the dataset picker (js/shell/header.js).
 *
 * Part of the shared CityMETER demo shell: edit it in every repository at once (js/shell/manifest.json).
 */
export const NAV_GLYPHS = Object.freeze({
  open_in_new: '', menu: '', close: '',
  light_mode: '', dark_mode: '', contrast: '', groups: '',
});
export const NAV_ICON_CONTRACT = Object.freeze({
  assetId: 'icon.material-symbols-rounded.nav-7.300.01',
  file: 'assets/icons/material-nav-300.woff2', bytes: 2500,
  sha256: 'd7e283106ed2898726b24504c4e0f5ad524292984a90a4d29553c7dcf53b9657',
  axes: Object.freeze({FILL: 0, wght: 300, GRAD: 0, opsz: 24}),
  fallback: 'Visible labels remain usable; hide icon glyphs if the font cannot load.',
});

function makeIcon(name) {
  if (!Object.hasOwn(NAV_GLYPHS, name)) throw new Error(`Unapproved navigation glyph: ${name}`);
  const icon = document.createElement('span');
  icon.className = 'nav-icon';
  icon.dataset.navIcon = name;
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = NAV_GLYPHS[name];
  return icon;
}
function decorate(element, name) {
  if (!element) return;
  const current = [...element.children].find(child => child.classList.contains('nav-icon'));
  if (current?.dataset.navIcon === name) return;
  if (current) current.replaceWith(makeIcon(name)); else element.prepend(makeIcon(name));
  element.classList.add('nav-decorated');
}

function decorateNavigation(titles = {}, externalLinks = '') {
  const byId = (id, name) => decorate(document.getElementById(id), name);
  byId('close-help', 'close');
  byId('mobile-panel', 'menu');
  byId('close-mobile-panel', 'close');
  byId('toggle-table', 'close');
  const mode = document.getElementById('theme');
  if (mode) decorate(mode.closest('label'), mode.value === 'dark' ? 'dark_mode' : mode.value === 'light' ? 'light_mode' : 'contrast');
  const external = ['.source-link[target="_blank"]', '.usage-dialog a[target="_blank"]', '.top-actions a[target="_blank"]', '.links a[target="_blank"]'];
  if (externalLinks) external.push(externalLinks);
  for (const anchor of document.querySelectorAll(external.join(', '))) {
    // This glyph only marks destinations that really open a new browsing context.
    decorate(anchor, 'open_in_new');
  }
  for (const [id, title] of Object.entries(titles)) {
    const element = document.getElementById(id);
    if (element && element.title !== title) element.title = title;
  }
  const reset = document.querySelector('#filters button[type="reset"]');
  if (reset) reset.title = 'ล้างตัวกรอง';
}

function installHelp() {
  // Two openers: the map toolbar (desktop) and the information sheet (phone portrait, where six toolbar
  // buttons do not fit in 330 px — live walk 2026-10-23).
  const dialog = document.getElementById('usage-help'), close = document.getElementById('close-help');
  const openers = ['open-help', 'open-help-sheet'].map(id => document.getElementById(id)).filter(Boolean);
  if (!dialog || !openers.length || !close) return;
  const shown = el => el?.isConnected && el.getClientRects().length > 0;
  let returnFocus = openers[0];
  // `section`: a part of the dialog to open at; focus goes to its tabindex="-1" heading, else to the close button.
  const open = (opener, section = null) => {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : opener;
    if (!dialog.open) dialog.showModal();
    if (section && dialog.contains(section)) {
      (section.querySelector('[tabindex="-1"]') || close).focus({preventScroll: true});
      section.scrollIntoView({block: 'start'});
    } else close.focus({preventScroll: true});
  };
  for (const opener of openers) opener.addEventListener('click', () => open(opener));
  // A link outside the dialog with data-open-help="<id of a section>" opens the dialog at that section (Shopping
  // Center's map credit “ที่มา” opens “ที่มาของแผนที่”); without JavaScript it stays an in-page link.
  document.addEventListener('click', event => {
    const link = event.target instanceof Element ? event.target.closest('[data-open-help]') : null;
    if (!link || dialog.contains(link)) return;
    event.preventDefault();
    open(link, document.getElementById(link.dataset.openHelp));
  });
  close.addEventListener('click', () => dialog.close());
  // Native dialog supplies modal focus containment and Escape/cancel behavior.
  dialog.addEventListener('close', () => { const target = shown(returnFocus) ? returnFocus : openers.find(shown) || openers[0]; target.focus({preventScroll: true}); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
}

/** Decorate the controls, wire the help dialog, watch the fonts. titles: {elementId: title}; pictogramProbe: one
 * glyph of the demo's pictogram subset (the font is reported ready once that glyph loads); externalLinks: a selector
 * of this demo's own links that open a new tab, marked like the shared ones. */
export function installNavigation({titles = {}, pictogramProbe = '', externalLinks = ''} = {}) {
  const redecorate = () => decorateNavigation(titles, externalLinks);
  redecorate();
  installHelp();
  document.getElementById('theme')?.addEventListener('change', redecorate);
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; redecorate(); });
  });
  observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded']});
  if (document.fonts?.load) {
    document.fonts.load('300 24px "LDS Material Symbols Rounded Nav"', '')
      .then(faces => { document.documentElement.classList.add(faces.length ? 'nav-icons-ready' : 'nav-icons-unavailable'); })
      .catch(() => document.documentElement.classList.add('nav-icons-unavailable'));
    document.fonts.load('300 20px "LDS Material Symbols Rounded Pictogram"', pictogramProbe)
      .then(faces => { document.documentElement.classList.add(faces.length ? 'pictograms-ready' : 'pictograms-unavailable'); })
      .catch(() => document.documentElement.classList.add('pictograms-unavailable'));
  } else document.documentElement.classList.add('nav-icons-unavailable', 'pictograms-unavailable');
  return () => observer.disconnect();
}

