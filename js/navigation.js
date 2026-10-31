/**
 * Approved LDS nav-7 glyphs and the accessible help dialog.
 *
 * Codepoints were verified from this exact font's cmap + GSUB tables. The
 * registry approves only the seven names below; unsupported actions keep
 * visible text and explanatory titles instead of borrowing misleading symbols.
 * Decoration is idempotent and never touches pins, charts, filters or data.
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

const TITLES = {
  'fit-map': 'ปรับแผนที่ให้เห็นทุกสถานีตามตัวกรอง',
  'bangkok-map': 'กลับไปดูพื้นที่กรุงเทพฯ',
  'toggle-3d': 'สลับมุมมอง 3 มิติ (แนวสาย สถานี อาคาร) กับแผนผัง 2 มิติ',
  'toggle-eye': 'มุมสถาปนิก: เปอร์สเปกทีฟ 2 จุดที่ระดับสถานี อาคารรอบข้างจางลง',
  'toggle-bus': 'แสดงหรือซ่อนสายรถเมล์และป้ายรถเมล์ (ชั้นเสริม)',
  'toggle-boat': 'แสดงหรือซ่อนเส้นทางเรือและท่าเรือ (ชั้นเสริม)',
  'mobile-panel': 'เปิดแผงข้อมูลและตัวกรอง',
  'open-help': 'เปิดวิธีใช้',
  'toggle-insights': 'เปิดหรือย่อกราฟเปรียบเทียบสาย',
  'open-table': 'เปิดตารางสถานีตามตัวกรอง',
  'toggle-table': 'ปิดตารางและกลับไปแผนที่',
  'search': 'ค้นหาสถานี รหัสสถานี สาย หรือจังหวัด',
  'status': 'เลือกสถานีที่เปิดให้บริการ กำลังก่อสร้าง หรือทั้งหมด',
  'system': 'เลือกระบบหรือผู้ให้บริการ',
  'line': 'เลือกสาย',
  'province': 'กรองตามจังหวัด',
  'prev-page': 'ดูหน้าก่อนหน้าของตาราง',
  'next-page': 'ดูหน้าถัดไปของตาราง',
  'tab-lines': 'เปรียบเทียบจำนวนสถานีของแต่ละสาย',
  'tab-status': 'เปรียบเทียบสถานีที่เปิดแล้วและกำลังก่อสร้างของแต่ละสาย',
  'tab-ridership': 'สถานีเรียงตามผู้โดยสารที่แหล่งข้อมูลรายงาน',
};

function decorateNavigation() {
  const byId = (id, name) => decorate(document.getElementById(id), name);
  byId('close-help', 'close');
  byId('mobile-panel', 'menu');
  byId('close-mobile-panel', 'close');
  byId('toggle-table', 'close');
  const mode = document.getElementById('theme');
  if (mode) decorate(mode.closest('label'), mode.value === 'dark' ? 'dark_mode' : mode.value === 'light' ? 'light_mode' : 'contrast');
  for (const anchor of document.querySelectorAll('.source-link[target="_blank"], .usage-dialog a[target="_blank"], .top-actions a[target="_blank"], .links a[target="_blank"]')) {
    // This glyph only marks destinations that really open a new browsing context.
    decorate(anchor, 'open_in_new');
  }
  for (const [id, title] of Object.entries(TITLES)) {
    const element = document.getElementById(id);
    if (element && element.title !== title) element.title = title;
  }
  const reset = document.querySelector('#filters button[type="reset"]');
  if (reset) reset.title = 'ล้างตัวกรอง';
}

function installHelp() {
  const dialog = document.getElementById('usage-help'), opener = document.getElementById('open-help'), close = document.getElementById('close-help');
  if (!dialog || !opener || !close) return;
  let returnFocus = opener;
  opener.addEventListener('click', () => {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : opener;
    if (!dialog.open) dialog.showModal();
    close.focus({preventScroll: true});
  });
  close.addEventListener('click', () => dialog.close());
  // Native dialog supplies modal focus containment and Escape/cancel behavior.
  dialog.addEventListener('close', () => { const target = returnFocus?.isConnected ? returnFocus : opener; target.focus({preventScroll: true}); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
}

export function installNavigation() {
  decorateNavigation();
  installHelp();
  document.getElementById('theme')?.addEventListener('change', decorateNavigation);
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; decorateNavigation(); });
  });
  observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded']});
  if (document.fonts?.load) {
    document.fonts.load('300 24px "LDS Material Symbols Rounded Nav"', '')
      .then(faces => { document.documentElement.classList.add(faces.length ? 'nav-icons-ready' : 'nav-icons-unavailable'); })
      .catch(() => document.documentElement.classList.add('nav-icons-unavailable'));
  } else document.documentElement.classList.add('nav-icons-unavailable');
  return () => observer.disconnect();
}

if (typeof document !== 'undefined') installNavigation();
