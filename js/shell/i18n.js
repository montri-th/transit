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
const contexts = []; // [selector, Map(thai → english | (element, tools) => english | null)], the latest first
const names = new Map();
const keep = new Set(); // names with no English source: they stay Thai and count as done
const norm = text => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * Add translations: {exact: {thai: english}, patterns: [[/^…$/, 'english $1' | (match, tools) => english | null]],
 * contexts: [[selector, {thai: english | (element, tools) => english | null}, patterns?]]}. A context entry wins for a
 * text node whose element matches its selector, so one Thai word can read two ways: จังหวัด is “Province” on a filter
 * and “77 provinces” under a tile's number (the function gets the element: its number is a sibling). A context's own
 * patterns (0.5.2) read a text with a number there: “41 แห่ง” is “41 learning centres” under a learning heading and
 * “41 schools” elsewhere (the function gets the match, the tools and the element).
 */
export function registerDictionary({exact: entries = {}, patterns: list = [], contexts: scoped = []} = {}) {
  for (const [th, en] of Object.entries(entries)) exact.set(norm(th), en);
  patterns.push(...list);
  for (const [selector, map = {}, own = []] of scoped) contexts.unshift([selector, new Map(Object.entries(map).map(([th, en]) => [norm(th), en])), own]);
}

/** English for a text in its element's context, or null when no context entry applies. */
function inContext(element, text) {
  const s = norm(text);
  for (const [selector, map, own] of contexts) {
    if ((!map.has(s) && !own.length) || !element.matches?.(selector)) continue;
    if (map.has(s)) {
      const en = map.get(s);
      const r = typeof en === 'function' ? en(element, tools) : en;
      if (r != null) return r;
    }
    for (const [re, out] of own) {
      const m = re.exec(s);
      if (!m || m[0] !== s) continue;
      const r = typeof out === 'function' ? out(m, tools, element) : out.replace(/\$(\d)/g, (_, i) => m[+i] ?? '');
      if (r != null) return r;
    }
  }
  return null;
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
  /** Translate a longer piece the way a text node is (split on the separators too); null when it has no English (0.5.2). */
  text: text => (THAI.test(norm(text)) ? translate(text) : norm(text)),
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

/** English for a text inside an element: its context entry, else translate(). Pure once the dictionaries are registered. */
export const translateIn = (element, text) => (element ? inContext(element, text) : null) ?? translate(text);

let started = false;
const written = new WeakMap(); // node → the value this module wrote, so its own change is not translated again

const markedThai = new WeakSet(); // elements this module marked lang="th" (a name that stays Thai is all they hold)
/** A name that stays Thai and is the whole of its element is marked lang="th" for screen readers (0.5.2). */
function markLanguage(parent, thai) {
  if (thai) {
    if (parent.childNodes.length === 1 && !parent.hasAttribute('lang')) { parent.setAttribute('lang', 'th'); markedThai.add(parent); }
  } else if (markedThai.has(parent)) {
    parent.removeAttribute('lang'); markedThai.delete(parent);
  }
}

function translateText(node) {
  const value = node.nodeValue;
  if (!value || written.get(node) === value || !THAI.test(value)) return;
  const parent = node.parentElement;
  if (!parent || parent.closest(SKIP)) return;
  if (parent.tagName === 'TITLE') return translateTitle(node);
  const en = translateIn(parent, value);
  if (en == null) { report.missing.add(norm(value)); return; }
  markLanguage(parent, en === norm(value) && keep.has(en));
  const next = value.match(/^\s*/)[0] + en + value.match(/\s*$/)[0];
  written.set(node, next);
  if (next !== value) node.nodeValue = next;
}

/**
 * A page part pageTitle cut to fit 60 characters (“โรงเรียนสาธิต… ประสาน…”): the name it begins with, in English, or the
 * cut text itself when that name stays Thai; null when no registered name begins with it. Pure once the names are in.
 */
export function cutName(page) {
  const s = norm(page);
  if (!s.endsWith('…')) return null;
  const head = s.slice(0, -1).trimEnd();
  if (!head || !THAI.test(head)) return null;
  for (const [th, en] of names) if (th.startsWith(head)) return en;
  for (const th of keep) if (th.startsWith(head)) { report.thaiNames.add(th); return s; }
  return null;
}

function translateTitle(node) {
  const value = norm(node.nodeValue);
  const tail = ` · ${PRODUCT}`;
  const page = value.endsWith(tail) ? value.slice(0, -tail.length) : value;
  const en = translate(page) ?? cutName(page);
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
    'เพิ่มเติม': 'More',
    'เครื่องมือแผนที่เพิ่มเติม': 'More map tools',
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
    'ภาษาไทย': 'in Thai',
    // The list under the search box (0.7.0, js/shell/search.js).
    'ผลการค้นหา': 'Search results',
    'กำลังเตรียมรายชื่อ…': 'Reading the names…',
    'ชื่อใกล้เคียง': 'Similar names',
    'สะกดต่างจากที่พิมพ์': 'Another spelling',
    'ดูเพิ่ม': 'Show more',
    'พิมพ์ต่อเพื่อให้ตรงขึ้น': 'Keep typing to narrow the list',
    'ลองพิมพ์ชื่อให้สั้นลง หรือชื่อพื้นที่': 'Try a shorter name, or the name of a place',
    'เตรียมรายชื่อไม่สำเร็จ': 'The names could not be read',
    'ลองใหม่': 'Try again',
    'ค้นหา': 'Search',
    'พิมพ์ชื่อแล้วเลือกจากรายการ · สะกดอีกแบบหรือลืมเปลี่ยนภาษาแป้นพิมพ์ก็พบ · ลูกศรขึ้นลงเลื่อน Enter เลือก · Enter โดยไม่เลือก = กรองด้วยคำที่พิมพ์':
      'Type a name and choose from the list · another spelling, or the keyboard left in the other language, is still found · the arrow keys move, Enter chooses · Enter with nothing chosen keeps the rows with the words typed',
  },
  patterns: [
    [DATE_PATTERN, m => englishDate(m[0])],
    [/^ไม่พบ “(.+)”$/, 'No match for “$1”'],
    [/^อ่านตามแป้นพิมพ์ไทย “(.+)”$/, 'Read on the Thai keyboard: “$1”'],
    [/^อ่านตามแป้นพิมพ์อังกฤษ “(.+)”$/, 'Read on the English keyboard: “$1”'],
    [/^([\d,]+) ชื่อ$/, (m, t) => `${m[1]} ${t.plural(m[1], 'name', 'names')}`],
    [/^อีก ([\d,]+) ชื่อ$/, '$1 more'],
    [/^กรองด้วยคำว่า “(.+)”$/, 'Keep the rows with “$1”'],
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
