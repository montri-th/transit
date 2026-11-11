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
 * Phone controls (0.6.0, owner 2026-11-12 00:36, VERBATIM: “on mobile เราย่อ ข้อความยาวๆให้สั้น หรือ แทนที่ ด้วย icon /
 * symbol แทนได้มั้ยครับ เช็ค LDS นะ”). LDS 0.9.7 answers in three rules, applied here and in navigation.css:
 * ICON-01 — a control may be a symbol alone when the symbol is conventional and the control has an accessible name;
 * an ambiguous action keeps its words. CTRL-01 — every target is at least 44 × 44 CSS px, words in a capsule, a
 * symbol alone in a circle. LAYOUT-01 — a crowded component is repaired in this order: less non-essential content,
 * another composition, a stack, the lower-priority actions moved, a compact label; never by a smaller type, a cut
 * label or hidden evidence. So on a phone the sheet opener (menu), the way back (arrow), help (question mark) and
 * the rest of the toolbar (chevron) are symbols with their names kept for assistive technology and as the fallback;
 * “3D” is its own symbol; every other toolbar action keeps its words; the toolbar is one row that never scrolls or
 * cuts a button — what does not fit moves, lowest priority first, into the list the chevron opens (fitToolbar).
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

/** Control glyphs every demo carries for its phone controls (0.6.0): a subset of the pictogram font the owner approved
 * for Shopping Center's UI roles on 2026-10-25, same family and axes as nav-7, whose bytes stay unchanged. Built by
 * shoppingcenter/scripts/build-controls-font.py; the record is assets/icons/material-controls-300.json. */
export const CONTROL_GLYPHS = Object.freeze({back: '\uE5C4', more: '\uE5CF', help: '\uE8FD'});
export const CONTROL_ICON_CONTRACT = Object.freeze({
  family: 'LDS Material Symbols Rounded Controls',
  file: 'assets/icons/material-controls-300.woff2', bytes: 968,
  sha256: 'a8d78ffa177e28282b416f071713a4ca1a115ce32bebb3e6ca8c5062499b527a',
  manifest: 'assets/icons/material-controls-300.json',
  axes: Object.freeze({FILL: 0, wght: 300, GRAD: 0, opsz: 24}),
  status: 'test exception to LDS nav-7 for phone controls (owner 2026-11-12; glyphs approved as UI roles for Shopping Center 2026-10-25); not an LDS-registered asset',
  fallback: 'The control keeps its words when the font cannot load.',
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
function makeControlIcon(name) {
  if (!Object.hasOwn(CONTROL_GLYPHS, name)) throw new Error(`Unknown control glyph: ${name}`);
  const icon = document.createElement('span');
  icon.className = 'ctl-icon';
  icon.dataset.ctlIcon = name;
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = CONTROL_GLYPHS[name];
  return icon;
}
/** A control glyph before the control's words; the words stay in the DOM (the accessible name and the fallback). */
function decorateControl(element, name) {
  if (!element || [...element.children].some(child => child.classList.contains('ctl-icon'))) return;
  element.prepend(makeControlIcon(name));
  element.classList.add('ctl-decorated');
}

function decorateNavigation(titles = {}, externalLinks = '') {
  const byId = (id, name) => decorate(document.getElementById(id), name);
  byId('close-help', 'close');
  byId('mobile-panel', 'menu');
  byId('close-mobile-panel', 'close');
  byId('toggle-table', 'close');
  decorateControl(document.getElementById('sheet-back'), 'back');
  decorateControl(document.getElementById('open-help-sheet'), 'help');
  // The dataset picker's caret (js/shell/header.js writes “▾”): the family's chevron once its font is ready.
  const caret = document.querySelector('.dataset-picker .picker-caret');
  if (caret && !caret.querySelector('.ctl-icon')) {
    const text = document.createElement('span');
    text.className = 'ctl-fallback';
    text.textContent = caret.textContent;
    caret.replaceChildren(text, makeControlIcon('more'));
  }
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

/** A phone in portrait: the same query as js/shell/header.js and the phone blocks of the stylesheets. */
export const PHONE_QUERY = '(max-width: 760px) and (orientation: portrait)';

/** How long a toolbar button stays on the phone's single row (higher stays longer): the sheet opener and the 3D
 * switch always; then the fit, the area layer, a demo's own layers, the architect's view while it can be used, the
 * jumps to a fixed place, anything else, help. */
export function keepScore({id = '', pressed = false} = {}) {
  if (id === 'mobile-panel') return 100;
  if (id === 'toggle-3d') return 90;
  if (id === 'fit-map') return 80;
  if (id === 'toggle-neighborhoods' || id === 'toggle-areas') return 70;
  if (id === 'toggle-eye') return 50;
  if (pressed) return 60;
  if (/-map$/.test(id)) return 40;
  if (id === 'open-help') return 10;
  return 30;
}

/**
 * Pure: which buttons leave a row of `available` px. items: [{id, width, score}] in the order they stand; the row
 * holds them with `gap` between; once one leaves, the row also holds the “more” button (`more` px). The lowest score
 * leaves first, the later one among equals; a score of 90 or more never leaves. Returns the ids that leave, in the
 * order they stand.
 */
export function planToolbar(items, available, {gap = 6, more = 44} = {}) {
  const width = list => list.reduce((sum, item) => sum + item.width, 0) + gap * Math.max(0, list.length - 1);
  if (width(items) <= available + 0.5) return [];
  const kept = [...items];
  const leaving = items.map((item, index) => ({item, index})).filter(({item}) => item.score < 90)
    .sort((a, b) => a.item.score - b.item.score || b.index - a.index);
  for (const {item} of leaving) {
    if (width(kept) + gap + more <= available + 0.5) break;
    kept.splice(kept.indexOf(item), 1);
  }
  return items.filter(item => !kept.includes(item)).map(item => item.id);
}

/**
 * The map toolbar on a phone: one row, nothing scrolled away or cut (LDS LAYOUT-01). The buttons that do not fit
 * move, in the DOM, into a list right after a “more” button (a disclosure: aria-expanded, Escape and a press outside
 * close it, focus returns to the button — LDS NAV-02); wider screens get every button back in its place. The buttons
 * keep their ids and listeners. Without this script the toolbar wraps and still shows every button (navigation.css).
 */
function installToolbar() {
  const bar = document.querySelector('.map-toolbar');
  if (!bar || bar.dataset.toolbar || typeof matchMedia !== 'function') return;
  bar.dataset.toolbar = 'ready';
  const opener = bar.querySelector(':scope > #mobile-panel');
  if (opener) bar.prepend(opener);                       // first in the DOM as on the screen (hidden on wide screens)
  const order = new Map([...bar.querySelectorAll(':scope > button')].map((button, index) => [button, index]));
  const more = document.createElement('button');
  more.type = 'button';
  more.id = 'toolbar-more';
  more.className = 'toolbar-more';
  more.hidden = true;
  more.title = 'เครื่องมือแผนที่เพิ่มเติม';
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-controls', 'toolbar-more-list');
  const label = document.createElement('span');
  label.className = 'toolbar-more-label';
  label.textContent = 'เพิ่มเติม';
  more.append(makeControlIcon('more'), label);
  const list = document.createElement('div');
  list.id = 'toolbar-more-list';
  list.className = 'toolbar-more-list';
  list.hidden = true;
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'เครื่องมือแผนที่เพิ่มเติม');
  bar.append(more, list);
  const phone = matchMedia(PHONE_QUERY);
  const setOpen = (open, {focus = false} = {}) => {
    list.hidden = !open || more.hidden;
    more.setAttribute('aria-expanded', String(!list.hidden));
    if (focus) more.focus({preventScroll: true});
  };
  const buttons = () => [...order.keys()].filter(button => button.isConnected).sort((a, b) => order.get(a) - order.get(b));
  let observer = null, queued = false;
  const watch = () => observer?.observe(bar, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'hidden']});
  function fit() {
    queued = false;
    observer?.disconnect();
    // Moving a button, or hiding the “more” button for a moment, takes the focus from it: it is given back below.
    const focused = bar.contains(document.activeElement) ? document.activeElement : null;
    for (const button of bar.querySelectorAll(':scope > button, :scope > .toolbar-more-list > button')) {
      if (button !== more && !order.has(button)) order.set(button, order.size);   // a button a demo added later
    }
    for (const button of buttons()) bar.insertBefore(button, more);
    more.hidden = true;
    if (!phone.matches) { delete bar.dataset.fit; setOpen(false); watch(); return; }
    bar.dataset.fit = '';
    const shown = buttons().filter(button => button.getClientRects().length);
    if (bar.clientWidth && shown.length) {
      more.hidden = false;
      const moreWidth = more.getBoundingClientRect().width;
      more.hidden = true;
      const gap = parseFloat(getComputedStyle(bar).columnGap) || 0;
      const leave = new Set(planToolbar(shown.map((button, index) => ({id: button.id || `#${index}`, width: button.getBoundingClientRect().width,
        score: keepScore({id: button.id, pressed: button.hasAttribute('aria-pressed')})})), bar.clientWidth, {gap, more: moreWidth}));
      shown.forEach((button, index) => { if (leave.has(button.id || `#${index}`)) list.append(button); });
      more.hidden = !leave.size;
    }
    if (more.hidden) setOpen(false); else setOpen(!list.hidden);
    if (focused && document.activeElement !== focused && focused.getClientRects().length) focused.focus({preventScroll: true});
    watch();
  }
  const schedule = () => { if (queued) return; queued = true; requestAnimationFrame(fit); };
  // The list opening or closing is this module's own change: only a change to the buttons themselves asks for a fit.
  observer = new MutationObserver(records => { if (records.some(record => record.target !== more && record.target !== list)) schedule(); });
  more.addEventListener('click', () => setOpen(list.hidden));
  list.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (button && !button.hasAttribute('aria-pressed')) setOpen(false);     // an action closes the list; a switch stays
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || list.hidden) return;
    event.stopPropagation();
    setOpen(false, {focus: true});
  }, true);
  document.addEventListener('pointerdown', event => { if (!list.hidden && !list.contains(event.target) && !more.contains(event.target)) setOpen(false); });
  phone.addEventListener?.('change', schedule);
  if (typeof ResizeObserver === 'function') new ResizeObserver(schedule).observe(bar);
  window.addEventListener('resize', schedule);
  document.fonts?.ready?.then(schedule);
  // The glyph fonts arrive after the first fit (html.nav-icons-ready, html.controls-ready): the buttons change width.
  new MutationObserver(schedule).observe(document.documentElement, {attributes: true, attributeFilter: ['class', 'lang']});
  fit();
}

/** Decorate the controls, wire the help dialog, watch the fonts. titles: {elementId: title}; pictogramProbe: one
 * glyph of the demo's pictogram subset (the font is reported ready once that glyph loads); externalLinks: a selector
 * of this demo's own links that open a new tab, marked like the shared ones. */
export function installNavigation({titles = {}, pictogramProbe = '', externalLinks = ''} = {}) {
  const redecorate = () => decorateNavigation(titles, externalLinks);
  redecorate();
  installHelp();
  installToolbar();
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
    document.fonts.load('300 22px "LDS Material Symbols Rounded Controls"', CONTROL_GLYPHS.back)
      .then(faces => { document.documentElement.classList.add(faces.length ? 'controls-ready' : 'controls-unavailable'); })
      .catch(() => document.documentElement.classList.add('controls-unavailable'));
  } else document.documentElement.classList.add('nav-icons-unavailable', 'pictograms-unavailable', 'controls-unavailable');
  return () => observer.disconnect();
}

