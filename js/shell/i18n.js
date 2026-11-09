/**
 * citymeter-shell · page language (demo-platform-review §5.2 `lang`, §5.8; owner 2026-11-08: TH/EN on every page).
 *
 * One language per page, from `?lang=` as production writes it: English when lang=en, Thai otherwise; never guessed
 * from the browser. The language link reloads the page at the same address in the other language, so every state
 * (`at`, `e`, filters, camera) stays, and js/shell/url.js keeps `lang` on every later change.
 *
 * Thai is the source text. In English the page's text is replaced in the DOM from dictionaries keyed by the Thai text:
 * an exact string, then a pattern (numbers and names pass through), then the parts between " · " one by one — at start
 * and on every change (MutationObserver), text nodes and the attributes people or screen readers read. Text with no
 * English stays Thai, never blank, and is listed in window.__citymeterI18n.missing for the checks.
 * Place names are never translated by hand (§5.8): a demo registers the English names its own sources carry
 * (registerNames); a name without one stays Thai and is listed in window.__citymeterI18n.thaiNames.
 *
 * A demo opts in with <meta name="citymeter:languages" content="th en"> once its dictionary covers its pages; only then
 * does the language link show. Until the English is reviewed it is a draft (§5.8), and the page says so.
 * In English the page stays hidden (html[data-i18n="pending"], navigation.css) until the first pass is done; launch.js
 * sets the mark and lifts it after a few seconds whatever happens.
 *
 * Part of the shared CityMETER demo shell: edit it in every repository at once (js/shell/manifest.json).
 */
import {serialize} from './url.js';
import {pageTitle, PRODUCT} from './title.js';

// Thai letters, vowels and tone marks; not the baht sign (U+0E3F) or Thai digits, which need no translation.
const THAI = /[\u0E01-\u0E3A\u0E40-\u0E4E]/;
const SEPARATORS = [' · ', ' — ', ' | ', ' › '];
const SKIP = 'script, style, textarea, code, pre, noscript, [translate="no"], [data-i18n-skip]';
const ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt', 'aria-description', 'aria-roledescription', 'data-tooltip'];

/** 'en' when the address says lang=en, else 'th'. Pure. */
export const pageLanguage = (search = '') => new URLSearchParams(search).get('lang') === 'en' ? 'en' : 'th';

/** The languages a page declares (<meta name="citymeter:languages">); Thai alone without the meta. */
export function languagesOf(doc = typeof document === 'undefined' ? null : document) {
  const content = doc?.querySelector?.('meta[name="citymeter:languages"]')?.getAttribute('content') || 'th';
  return content.split(/[\s,]+/).filter(Boolean);
}

/** The language of this page: English only when the address asks for it and the page declares it. */
export const LANG = typeof location === 'undefined' || pageLanguage(location.search) !== 'en' || !languagesOf().includes('en')
  ? 'th' : 'en';

/** The same address in the other language: every parameter stays, `lang` is set or dropped. Pure. */
export function languageHref(pathname = '/', search = '', lang = 'en') {
  const params = new URLSearchParams(search);
  params.delete('lang');
  if (lang === 'en') params.set('lang', 'en');
  const query = serialize(params);
  return query ? `${pathname}?${query}` : pathname;
}

const exact = new Map();
const patterns = [];
const names = new Map();
const keep = new Set(); // names with no English source: they stay Thai and count as done
const norm = text => String(text ?? '').replace(/\s+/g, ' ').trim();

/** Add translations: {exact: {thai: english}, patterns: [[/^…$/, 'english $1' | (match, tools) => english | null]]}. */
export function registerDictionary({exact: entries = {}, patterns: list = []} = {}) {
  for (const [th, en] of Object.entries(entries)) exact.set(norm(th), en);
  patterns.push(...list);
}

/** Add place names a demo's own sources give in English: [[thai, english], …]. A later call re-translates the page. */
export function registerNames(pairs) {
  for (const [th, en] of pairs) {
    const key = norm(th), value = norm(en);
    if (key && value && !THAI.test(value)) names.set(key, value);
  }
  if (started) translateTree(document.documentElement);
}

/** Names that have no English source and stay Thai (an organisation's or a building's Thai name): a text that is
 * one of them, alone or as a part between separators, counts as translated and is listed in thaiNames. */
export function keepThai(list) {
  for (const th of list) { const key = norm(th); if (key && THAI.test(key) && !names.has(key)) keep.add(key); }
  if (started) translateTree(document.documentElement);
}

const report = {missing: new Set(), thaiNames: new Set()};
if (typeof window !== 'undefined') window.__citymeterI18n = report;

/** The English name of a Thai place name, or the Thai itself (listed) when no source gives one. */
function nameOf(th) {
  const key = norm(th);
  if (!key || !THAI.test(key)) return key;
  const en = names.get(key) ?? exact.get(key);
  if (en) return en;
  report.thaiNames.add(key);
  return key;
}
/** The English of a registered name, or null (no Thai fallback): for patterns that need a known place. */
const knownName = th => names.get(norm(th)) ?? exact.get(norm(th)) ?? null;
/** For a demo's own code (a search question, a label it builds): on an English page the English name its data gives,
 * otherwise the name as it is. */
export const englishName = th => (LANG === 'en' ? names.get(norm(th)) ?? norm(th) : th);

const MONTHS = Object.freeze({'ม.ค.': 'Jan', 'ก.พ.': 'Feb', 'มี.ค.': 'Mar', 'เม.ย.': 'Apr', 'พ.ค.': 'May', 'มิ.ย.': 'Jun',
  'ก.ค.': 'Jul', 'ส.ค.': 'Aug', 'ก.ย.': 'Sep', 'ต.ค.': 'Oct', 'พ.ย.': 'Nov', 'ธ.ค.': 'Dec',
  'มกราคม': 'January', 'กุมภาพันธ์': 'February', 'มีนาคม': 'March', 'เมษายน': 'April', 'พฤษภาคม': 'May', 'มิถุนายน': 'June',
  'กรกฎาคม': 'July', 'สิงหาคม': 'August', 'กันยายน': 'September', 'ตุลาคม': 'October', 'พฤศจิกายน': 'November', 'ธันวาคม': 'December'});
const MONTH = Object.keys(MONTHS).map(m => m.replace(/\./g, '\\.')).join('|');
/** A Thai date phrase → English: month names and abbreviations, Buddhist-era years (25xx) → CE (§5.8: พ.ศ. in Thai,
 * ค.ศ. in English). "29 ต.ค. 2569" → "29 Oct 2026", "พ.ค.–ต.ค. 2569" → "May–Oct 2026". Text without a Thai month is
 * returned unchanged; other Thai words stay. Pure. */
export function englishDate(text) {
  return String(text ?? '').replace(new RegExp(`(${MONTH})`, 'g'), m => MONTHS[m])
    .replace(/(^|[^\d])(25\d\d)(?!\d)/g, (_, pre, y) => `${pre}${Number(y) - 543}`)
    .replace(/(พ\.ศ\.|ค\.ศ\.) ?/g, '');
}
/** A whole date phrase: optional day, one month or a month range, a year. */
export const DATE_PATTERN = new RegExp(`^(?:\\d{1,2} )?(?:${MONTH})(?:[–-](?:${MONTH}))?(?: (?:พ\\.ศ\\. )?\\d{4})?$`);

const tools = {
  name: nameOf,
  known: knownName,
  date: englishDate,
  /** Translate a part (a phrase inside a pattern); null when it has no English. */
  part: text => (THAI.test(norm(text)) ? whole(norm(text)) : norm(text)),
  /** 1 → 'office', otherwise 'offices' (numbers arrive as written, "1,234"). */
  plural: (count, one, many) => (String(count).replace(/,/g, '') === '1' ? one : many),
};

function whole(s) {
  if (exact.has(s)) return exact.get(s);
  if (names.has(s)) return names.get(s);
  if (keep.has(s)) { report.thaiNames.add(s); return s; }
  for (const [re, out] of patterns) {
    const m = re.exec(s);
    if (!m || m[0] !== s) continue;
    const r = typeof out === 'function' ? out(m, tools) : out.replace(/\$(\d)/g, (_, i) => m[+i] ?? '');
    if (r != null) return r;
  }
  return null;
}

/** English for one piece of Thai text, or null when the dictionaries have none. Text without Thai → null. Pure once
 * the dictionaries are registered. */
export function translate(text) {
  const s = norm(text);
  if (!s || !THAI.test(s)) return null;
  const direct = whole(s);
  if (direct != null) return direct;
  // A fragment that ends or starts with a separator ("หมุดอยู่ในรูปอาคาร ·", "· กำลังสร้าง") is the phrase plus it.
  const edge = /^(·\s|—\s)?(.*?)(\s·|\s—|:)?$/.exec(s);
  if (edge && (edge[1] || edge[3]) && edge[2]) {
    const core = translate(edge[2]);
    if (core != null) return `${edge[1] || ''}${core}${edge[3] || ''}`;
  }
  for (const sep of SEPARATORS) {
    if (!s.includes(sep)) continue;
    const parts = s.split(sep).map(p => (THAI.test(p) ? translate(p) : p));
    if (parts.every(p => p != null)) return parts.join(sep);
  }
  return null;
}

let started = false;
const written = new WeakMap(); // node → the value this module wrote, so its own change is not translated again

function translateText(node) {
  const value = node.nodeValue;
  if (!value || written.get(node) === value || !THAI.test(value)) return;
  const parent = node.parentElement;
  if (!parent || parent.closest(SKIP)) return;
  if (parent.tagName === 'TITLE') return translateTitle(node);
  const en = translate(value);
  if (en == null) { report.missing.add(norm(value)); return; }
  const next = value.match(/^\s*/)[0] + en + value.match(/\s*$/)[0];
  written.set(node, next);
  if (next !== value) node.nodeValue = next;
}

function translateTitle(node) {
  const value = norm(node.nodeValue);
  const tail = ` · ${PRODUCT}`;
  const page = value.endsWith(tail) ? value.slice(0, -tail.length) : value;
  const en = translate(page);
  if (en == null) { report.missing.add(page); return; }
  const next = page === value ? en : pageTitle(en);
  written.set(node, next);
  if (next !== node.nodeValue) node.nodeValue = next;
}

const writtenAttributes = new WeakMap();
function translateAttributes(element) {
  if (element.closest(SKIP)) return;
  for (const name of ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (!value || !THAI.test(value)) continue;
    const seen = writtenAttributes.get(element);
    if (seen?.[name] === value) continue;
    const en = translate(value);
    if (en == null) { report.missing.add(norm(value)); continue; }
    writtenAttributes.set(element, {...seen, [name]: en});
    element.setAttribute(name, en);
  }
  if (element.matches('meta[name="description"], meta[property="og:description"], meta[property="og:title"]')) {
    const value = element.getAttribute('content');
    const en = value && THAI.test(value) ? translate(value) : null;
    if (en != null) element.setAttribute('content', en);
  }
}

function translateTree(root) {
  if (!root) return;
  if (root.nodeType === 3) return translateText(root);
  if (root.nodeType !== 1) return;
  translateAttributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) translateText(node);
    else translateAttributes(node);
  }
}

/** In English: translate the page now and on every change. Does nothing in Thai. Returns whether it runs. */
export function startTranslation(doc = document) {
  if (LANG !== 'en' || started || typeof MutationObserver === 'undefined') return started;
  started = true;
  doc.documentElement.lang = 'en';
  translateTree(doc.documentElement);
  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'characterData') translateText(r.target);
      else if (r.type === 'attributes') translateAttributes(r.target);
      else for (const node of r.addedNodes) translateTree(node);
    }
  }).observe(doc.documentElement, {subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: [...ATTRIBUTES, 'content']});
  delete doc.documentElement.dataset.i18n;
  return true;
}

/** The shell's own words (breadcrumb, header, help, terrain, loaders). A demo adds its own with registerDictionary. */
export const SHELL_EN = Object.freeze({
  exact: {
    'ประเทศไทย': 'Thailand',
    'แสดงระดับบน': 'Show upper levels',
    'ชุดข้อมูลอื่นของ CityMETER': 'Other CityMETER datasets',
    'ดูเดโมทั้งหมด': 'All demos',
    'หน้าแรก': 'start page',
    'ล้างตัวกรอง': 'Clear filters',
    'ธีม': 'Theme',
    'รูปแบบหน้าจอและแผนที่': 'Page and map theme',
    'ข้ามไปแผงข้อมูล': 'Skip to the data panel',
    'วิธีใช้': 'How to use',
    'ปิดวิธีใช้': 'Close help',
    'คีย์บอร์ด:': 'Keyboard:',
    'ภูมิประเทศ:': 'Terrain:',
    'อาคาร:': 'Buildings:',
    'จุดอยู่บนทะเล': 'The point is on the sea',
    'จุดตกในอาคาร': 'The point falls inside a building',
    'ไลบรารีแผนที่': 'map library',
    'รูปแบบแผนที่': 'map style',
    'ต้องเปิดหน้าเว็บในเบราว์เซอร์แล้วลองอีกครั้ง': 'Open the page in a web browser and try again.',
    'ไฟล์ตอบกลับแต่ไม่พบไลบรารีรุ่นที่กำหนด กรุณาลองอีกครั้ง': 'The file loaded but the required library version was not found. Please try again.',
    'ไฟล์รูปแบบตอบกลับแต่ยังใช้งานไม่ได้ กรุณาลองอีกครั้ง': 'The style file loaded but cannot be used yet. Please try again.',
    'ตรวจการเชื่อมต่อหรือการบล็อกแหล่งไฟล์ แล้วลองอีกครั้ง': 'Check the connection or whether the file source is blocked, then try again.',
    'ลองโหลดใหม่': 'Reload',
    'ดูที่มาใน GitHub': 'View the source on GitHub',
    'รายละเอียดเพื่อแจ้งปัญหา': 'Details for reporting a problem',
    'ที่มาใน GitHub': 'Source on GitHub',
    'วิธีจัดทำข้อมูล': 'How the data was prepared',
  },
  patterns: [
    [DATE_PATTERN, m => englishDate(m[0])],
    [/^เปิด(.+)ในชุดข้อมูลอื่น$/, (m, t) => `Open ${t.name(m[1])} in another dataset`],
    [/^(.+) · เปลี่ยนชุดข้อมูล$/, '$1 · change dataset'],
    [/^([\d,.]+) ม\.$/, '$1 m'],
    [/^([\d,.]+) กม\.$/, '$1 km'],
    [/^พื้นดินสูงจากระดับทะเลราว ([\d,.]+) ม\.$/, 'Ground about $1 m above sea level'],
    [/^ต่างระดับ ([\d,.]+) ม\.$/, 'Relief $1 m'],
    [/^ความสูงพื้นดินต่างกัน ([\d,.]+) ม\. ในรัศมี ([\d,.]+) ม\.$/, 'Ground height varies by $1 m within $2 m'],
    [/^สูงกว่ารอบข้าง ([\d,.]+) ม\.$/, '$1 m above the surroundings'],
    [/^ต่ำกว่ารอบข้าง ([\d,.]+) ม\.$/, '$1 m below the surroundings'],
    [/^เทียบกับค่าเฉลี่ยของวงรัศมี ([\d,.]+) ม\.$/, 'Compared with the average within $1 m'],
    [/^ทะเล ≤ ([\d,.]+) ม\.$/, 'Sea ≤ $1 m'],
    [/^จุด(.*)อยู่บนพื้นน้ำทะเลในแผนที่$/, (m, t) => {
      const subject = m[1] ? t.part(m[1]) : '';
      return subject == null ? null : `The ${subject ? `${subject.toLowerCase()} ` : ''}point is on sea water on the map`;
    }],
    [/^มีทะเลภายใน ([\d,.]+) ม\. \(ระยะตรง\)$/, 'Sea within $1 m (straight line)'],
    [/^ต้นไม้ ([\d,.]+)%$/, 'Trees $1%'],
    [/^สัดส่วนพื้นที่ป่าและต้นไม้ในรัศมี ([\d,.]+) ม\. ตามแผนที่ OSM$/, 'Share of forest and trees within $1 m, from the OSM map'],
    [/^โหลด(.+)ไม่เสร็จภายใน 20 วินาที ตรวจการเชื่อมต่อแล้วลองอีกครั้ง$/, (m, t) => {
      const what = t.part(m[1]);
      return what == null ? null : `The ${what} did not load within 20 seconds. Check the connection and try again.`;
    }],
    [/^โหลด(ไลบรารีแผนที่|รูปแบบแผนที่)ไม่สำเร็จ (.+)$/, (m, t) => {
      const what = t.part(m[1]), detail = t.part(m[2]);
      return what == null || detail == null ? null : `The ${what} did not load. ${detail}`;
    }],
  ],
});
registerDictionary(SHELL_EN);
