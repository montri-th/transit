/**
 * citymeter-shell · names found the way people type them (0.7.0; owner 2026-11-12 12:05, VERBATIM: “ศึกษาแนวคิดเรื่อง
 * Fuzzy search แล้ว implement กับ demo web ให้ได้ user benefit สูงสุดตาม user intent ในขณะนั้น และตาม product statement”).
 *
 * The method is the one of the CityMETER area-search brief (02-CityMETER__fuzzy-search-tech-brief__v1__2026-10-19,
 * revised 20 Oct 2026), moved from PostgreSQL to the browser because a demo is a static site:
 *  - clean(): changes that never change which name it is (NFC, lower case, Thai digits, invisible characters, เเ → แ,
 *    ํา → ำ, accents on Latin letters);
 *  - key1(): what is left without tone marks, ็ ์ ํ ๎ ฺ ๆ, spaces and punctuation — a name typed without its marks;
 *  - key2(): key1 with the letters people swap because they sound alike read as one (ศ ษ → ส, ณ → น, ร ฬ → ล, long
 *    vowels as short …). Every syllable stays, so two different names almost never share a key (the brief measured
 *    1.4 % against 37–74 % for the Thai soundex codes);
 *  - a slip of the keys (one dropped, one too many, two swapped, the key beside) is a guess: an edit distance, tried
 *    only when the sure steps found little, shown apart as “ชื่อใกล้เคียง” and never chosen for the reader.
 *
 * The steps, best first (the brief's eleven; `word` is new here because a demo also finds venues, whose names have
 * several words):
 *    1 code      a code or an abbreviation, typed whole                                  sure
 *    2 name      the name, letter for letter (also another name it goes by)              sure
 *    3 marks     the same once tone marks and ์ are left out                             another spelling
 *    4 start     the name begins with what was typed                                     sure
 *    5 word      a word of the name begins with it                                       sure
 *    6 sound     the same, or its beginning, once letters that sound alike are one       another spelling
 *    7 within    a name and the place it is in (“หาดใหญ่ สงขลา”)                         as its name part
 *    8 part      what was typed stands inside the name (three letters or more)           sure
 *    9 nearIn    a name one or two keys off, and the place it is in                      a guess
 *   10 layout    typed with the keyboard in the other language (g=up'.s,j → เชียงใหม่)    a guess
 *   11 near      one or two keys off the name, or off one of its words                   a guess
 *   12 nearStart one or two keys off the beginning of the name                           a guess
 * Guesses (9–12) are made only when steps 1–6 found fewer than three entries, none of them whole (1–3), and no entry
 * holds every word typed. A key of two letters or fewer is never guessed; three to seven letters may be one key off,
 * eight or more two. Two neighbouring letters swapped count as one.
 *
 * Pure: no DOM, no network, nothing stored. js/shell/search.js is the list a reader sees.
 * Part of the shared CityMETER demo shell: edit it in every repository at once (js/shell/manifest.json).
 */

/* ------------------------------------------------------------------ text */

/** Characters by their number, so that no invisible character and no bare combining mark stands in this file. */
const ch = (...codes) => String.fromCharCode(...codes);
const chars = (...parts) => parts.map(p => (Array.isArray(p) ? `${ch(p[0])}-${ch(p[1])}` : typeof p === 'number' ? ch(p) : p)).join('');
const anyOf = (...parts) => new RegExp(`[${chars(...parts)}]`, 'g');

const LATIN_MARKED = anyOf([0xC0, 0x24F]);                    // Latin letters that may carry an accent
const ACCENTS = anyOf([0x300, 0x36F]);                        // the accents, once the letter is taken apart
const THAI_DIGITS = anyOf([0x0E50, 0x0E59]);                  // ๐–๙
const SPACE_LIKE = anyOf(',', 0xA0);                          // a comma, a no-break space
const INVISIBLE = anyOf(0xAD, [0x200B, 0x200D], 0x2060, 0xFEFF); // soft hyphen, zero-width space and joiners, word joiner, byte-order mark
const PAIYANNOI = anyOf(0x0E2F);                              // ฯ
const TWO_SARA_E = new RegExp(ch(0x0E40, 0x0E40), 'g');       // เ + เ typed for แ
const NIKHAHIT_AA = new RegExp(`${ch(0x0E4D)}([${chars([0x0E48, 0x0E4B])}]?)${ch(0x0E32)}`, 'g'); // ํ + า typed for ำ, a tone mark between or not
/** What key1 leaves out of a Thai name: ฺ, ๆ, ็, the four tone marks, ์, ํ and ๎. */
const THAI_SIGNS = anyOf(0x0E3A, [0x0E46, 0x0E4E]);
const HAS_THAI = new RegExp(`[${chars([0x0E00, 0x0E7F])}]`);
const NOT_LETTER = /[^\p{L}\p{N}\p{M}]/gu;

/*
 * Most names are Thai letters, lower-case Latin letters, digits and plain punctuation, and for those the Unicode
 * property classes below are slow work for nothing: an index of 75,000 names took 1.5 s with them and takes a third
 * of that with the plain ranges. `PLAIN` says a text is only such characters; the answers are the same either way
 * (tests/shell.test.js compares the two on every kind of character).
 */
const THAI_LETTERS = [[0x0E01, 0x0E2E], [0x0E30, 0x0E39], [0x0E40, 0x0E45]];   // consonants and vowels: what key1 keeps
const PLAIN = new RegExp(`^[${chars([0x00, 0x7F], [0x0E01, 0x0E4E])}]*$`);
/** Something clean() has to change: a capital, a comma, ฯ, ํ, a Thai digit, เเ, marks typed out of order, spaces to tidy. */
const NEEDS_CLEANING = new RegExp(`[A-Z,${chars(0x0E2F, 0x0E4D)}]|[${chars([0x00, 0x1F])}]|  |^ | $|${ch(0x0E40, 0x0E40)}|[${chars([0x0E48, 0x0E4B])}][${chars([0x0E38, 0x0E3A])}]|[${chars(0x0E38, 0x0E39)}]${ch(0x0E3A)}`);
const NOT_KEY0 = new RegExp(`[^A-Za-z0-9${chars([0x0E01, 0x0E2E], [0x0E30, 0x0E3A], [0x0E40, 0x0E4E])}]`, 'g');
const NOT_KEY1 = new RegExp(`[^A-Za-z0-9${chars(...THAI_LETTERS)}]`, 'g');
const NOT_WORD = new RegExp(`[^A-Za-z0-9${chars([0x0E01, 0x0E2E], [0x0E30, 0x0E3A], [0x0E40, 0x0E4E])}]+`);

/** A name as typed, without the differences that never change which name it is. */
export function clean(text) {
  const raw = String(text ?? '');
  if (PLAIN.test(raw) && !NEEDS_CLEANING.test(raw)) return raw;
  return raw.normalize('NFC').toLowerCase()
    .replace(LATIN_MARKED, c => c.normalize('NFD').replace(ACCENTS, ''))
    .replace(THAI_DIGITS, d => String(d.charCodeAt(0) - 0x0E50))
    .replace(SPACE_LIKE, ' ')
    .replace(INVISIBLE, '').replace(PAIYANNOI, '')
    .replace(TWO_SARA_E, ch(0x0E41)).replace(NIKHAHIT_AA, `$1${ch(0x0E33)}`)
    .replace(/\s+/g, ' ').trim();
}

const exact0 = cleaned => (PLAIN.test(cleaned) ? cleaned.replace(NOT_KEY0, '') : cleaned.replace(NOT_LETTER, ''));
/** Thai vowels written above and below are marks to Unicode and letters to a reader: they stay in key1. */
const exact1 = cleaned => (PLAIN.test(cleaned) ? cleaned.replace(NOT_KEY1, '') : cleaned.replace(THAI_SIGNS, '').replace(NOT_LETTER, ''));

/** The name with only its letters, digits and marks: equal means typed letter for letter. */
export const key0 = text => exact0(clean(text));
/** The name without tone marks, ็ ์ ํ ๎ ฺ ๆ, spaces and punctuation. แม่ฮ่องสอน → แมฮองสอน, Chiang-Mai → chiangmai. */
export const key1 = text => exact1(clean(text));

/** Letters read as one in key2: consonants that sound alike, ใ as ไ, and a long vowel as its short one (ี ื ู → ิ ึ ุ). */
const SOUND = {'ศ': 'ส', 'ษ': 'ส', 'ณ': 'น', 'ร': 'ล', 'ฬ': 'ล', 'ญ': 'ย', 'ฎ': 'ด', 'ฏ': 'ต', 'ฐ': 'ท', 'ฑ': 'ท', 'ฒ': 'ท', 'ธ': 'ท',
  'ภ': 'พ', 'ฆ': 'ค', 'ฌ': 'ช', 'ฃ': 'ข', 'ฅ': 'ค', 'ใ': 'ไ'};
for (const [long, short] of [[0x0E35, 0x0E34], [0x0E37, 0x0E36], [0x0E39, 0x0E38]]) SOUND[ch(long)] = ch(short);
const SOUND_RE = new RegExp(`[${Object.keys(SOUND).join('')}]`, 'g');
/** Spellings of one Thai sound in Latin letters, in the brief's order. */
const ROMAN = [['kh', 'k'], ['ph', 'p'], ['th', 't'], ['tch', 't'], ['bh', 'b'], ['dh', 'd'], ['ee', 'i'], ['oo', 'u'], ['ue', 'u'], ['aa', 'a'],
  ['sri', 'si'], ['koh', 'ko'], ['orn', 'on']];
const roman = word => { for (const [from, to] of ROMAN) if (word.includes(from)) word = word.split(from).join(to); return word; };
/** key2 of a key1. */
export function soundKey(k1) {
  const thai = k1.replace(SOUND_RE, c => SOUND[c]);
  return /[a-z]/.test(thai) ? thai.replace(/[a-z]+/g, roman) : thai;
}
/** key1 with the letters that sound alike read as one. ชมภู and ชมพู share it; ข/ค, ถ/ท, ผ/พ and ส/ซ stay apart. */
export const key2 = text => soundKey(key1(text));

/* ---------------------------------------------------------- the keyboard */

const QWERTY = '`1234567890-=qwertyuiop[]\\asdfghjkl;\'zxcvbnm,./~!@#$%^&*()_+QWERTYUIOP{}|ASDFGHJKL:"ZXCVBNM<>?';
const KEDMANEE = '_ๅ/-ภถุึคตจขชๆไำพะัีรนยบลฃฟหกดเ้่าสวงผปแอิืทมใฝ%+๑๒๓๔ู฿๕๖๗๘๙๐"ฎฑธํ๊ณฯญฐ,ฅฤฆฏโฌ็๋ษศซ.()ฉฮฺ์?ฒฬฦ';
const TO_THAI = new Map([...QWERTY].map((c, i) => [c, [...KEDMANEE][i]]));
const TO_LATIN = new Map([...KEDMANEE].map((c, i) => [c, [...QWERTY][i]]).filter(([c]) => HAS_THAI.test(c)));
/** With the signs the Thai layout shares with ASCII read as keys too: ? is Shift+M, " is Shift+W, ( is Shift+Z. */
const TO_LATIN_LOOSE = new Map([...KEDMANEE].map((c, i) => [c, [...QWERTY][i]]));

/**
 * What the same keys give on the other layout (Thai Kedmanee and US QWERTY), or '' when the text mixes Thai and Latin
 * letters or has neither: g=up'.s,j → เชียงใหม่, ืนอนะำส → novotel. Takes the text as typed, before clean().
 * A word that is only digits stays a number (“ik, 61” → ราม 61), while a digit inside a word is the Thai letter on
 * that key (4 gives ภ). `loose` also reads ? " ( ) and the like as the keys they share: a capital typed on the Thai
 * layout (“?ฟพพรนะะ” → Marriott).
 */
export function otherLayout(raw, {loose = false} = {}) {
  const text = String(raw ?? '');
  const thai = HAS_THAI.test(text), latin = /[A-Za-z]/.test(text);
  if (thai === latin) return '';
  const map = latin ? TO_THAI : loose ? TO_LATIN_LOOSE : TO_LATIN;
  return text.split(' ').map(word => (/^[0-9]+$/.test(word) ? word : [...word].map(c => map.get(c) ?? c).join(''))).join(' ');
}

/* ----------------------------------------------------- looking for a text */

/**
 * A text that is looked for in many others. Chrome's engine finds the first letter of a text by one of its two bytes,
 * the larger; for ก to ฎ (U+0E01–0E0E) that is the byte every Thai letter has, so each letter of the text being read
 * has to be compared and the search is some thirteen times slower — in the 440,005 row texts of Government Office,
 * “กรุงเทพ” took 295 ms and “ภูเก็ต” 22 ms (Node 22, 2026-11-12). So the search starts from the first letter whose
 * own byte is the larger one, and the letters before it are compared afterwards (41 ms): always the answer of
 * String.prototype.includes. A text of such letters alone is looked for as it is.
 * → {text, k: the letters standing before that letter (0: look for the text as it is), tail: the text from it on}
 */
export function needle(text) {
  let k = 0;
  while (k < text.length && (text.charCodeAt(k) & 0xFF) <= (text.charCodeAt(k) >> 8)) k++;
  if (k === text.length) k = 0;
  return {text, k, tail: k ? text.slice(k) : text};
}
/** Does `hay` hold the text of a needle()? What hay.includes(n.text) answers. */
export function has(hay, n) {
  const k = n.k;
  if (!k) return hay.includes(n.text);
  const text = n.text, tail = n.tail;
  for (let i = hay.indexOf(tail, k); i >= 0; i = hay.indexOf(tail, i + 1)) {
    let j = 0;
    while (j < k && hay.charCodeAt(i - k + j) === text.charCodeAt(j)) j++;
    if (j === k) return true;
  }
  return false;
}

/* --------------------------------------------------------- edit distance */

const FAR = 250;
let rows = [new Uint8Array(96), new Uint8Array(96), new Uint8Array(96)];

/**
 * How many keys apart two keys are — one dropped, one too many, one wrong, or two neighbours swapped (each counts
 * one) — or max + 1 as soon as it is more than max. Only the cells within max of the diagonal are filled.
 */
export function editDistance(a, b, max = 2) {
  if (a === b) return 0;
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > max) return max + 1;
  if (!n || !m) return Math.max(n, m) > max ? max + 1 : Math.max(n, m);
  if (m + 2 > rows[0].length) rows = rows.map(() => new Uint8Array(m * 2 + 2));
  let [before, prev, row] = rows;
  for (let j = 0; j <= m; j++) prev[j] = j <= max ? j : FAR;
  for (let i = 1; i <= n; i++) {
    const ca = a.charCodeAt(i - 1), lo = Math.max(1, i - max), hi = Math.min(m, i + max);
    let low = row[lo - 1] = lo === 1 ? Math.min(i, FAR) : FAR;
    for (let j = lo; j <= hi; j++) {
      const cb = b.charCodeAt(j - 1);
      let v = prev[j - 1] + (ca === cb ? 0 : 1);
      if (prev[j] + 1 < v) v = prev[j] + 1;
      if (row[j - 1] + 1 < v) v = row[j - 1] + 1;
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb && before[j - 2] + 1 < v) v = before[j - 2] + 1;
      row[j] = v > FAR ? FAR : v;
      if (v < low) low = v;
    }
    if (hi < m) row[hi + 1] = FAR;
    if (low > max) return max + 1;
    const spare = before; before = prev; prev = row; row = spare;
  }
  return prev[m] > max ? max + 1 : prev[m];
}

/** Keys a guess may be off, by the length of what was typed (its key1). */
export const allowedEdits = length => (length <= 2 ? 0 : length <= 7 ? 1 : 2);

/* ----------------------------------------------------------- lead words */

/** Words that say which level a name is: before a Thai name, or as a word of its own in English. */
const LEADS = [
  ['province', /^(?:จังหวัด|จ\.|จ(?= ))\s*(.+)$/],
  ['district', /^(?:อำเภอ|อ\.|อ(?= )|เขต)\s*(.+)$/],
  ['subdistrict', /^(?:ตำบล|ต\.|ต(?= )|แขวง)\s*(.+)$/],
  ['locale', /^ย่าน\s*(.+)$/],
  ['station', /^สถานี\s*(.+)$/],
];
const LEVEL_WORDS = {province: 'province', changwat: 'province', district: 'district', amphoe: 'district', amphur: 'district', khet: 'district',
  subdistrict: 'subdistrict', tambon: 'subdistrict', khwaeng: 'subdistrict', station: 'station'};
/** Level words standing alone among other words: left aside when an entry does not carry them. */
const LEVEL_TOKENS = new Set([...Object.keys(LEVEL_WORDS), 'จังหวัด', 'อำเภอ', 'เขต', 'ตำบล', 'แขวง', 'ย่าน', 'สถานี']);

/** {level, rest}: the level a cleaned text names by its lead word and the name after it, or null. */
export function leadOf(cleaned) {
  for (const [level, re] of LEADS) { const m = cleaned.match(re); if (m && exact1(m[1]).length >= 2) return {level, rest: m[1]}; }
  const words = cleaned.split(' ');
  if (words.length > 1) for (const at of [0, words.length - 1]) {
    const level = LEVEL_WORDS[words[at]];
    if (level) return {level, rest: words.filter((_, i) => i !== at).join(' ')};
  }
  return null;
}

/* ------------------------------------------------- other names of places */

/**
 * Names a province goes by that are no piece of its name, or that are how it is said every day. Four provinces; the
 * brief leaves the owner of the full list open (“ใครดูแลรายการชื่อเรียกอื่น”), so anything further waits for that decision.
 */
export const PROVINCE_AKA = Object.freeze({
  'กรุงเทพมหานคร': Object.freeze(['กรุงเทพฯ', 'กทม', 'กทม.']),
  'นครราชสีมา': Object.freeze(['โคราช', 'Korat']),
  'พระนครศรีอยุธยา': Object.freeze(['อยุธยา', 'Ayutthaya']),
  'ฉะเชิงเทรา': Object.freeze(['แปดริ้ว']),
});
/** A district named เมือง… also goes by the rest (“อ.เชียงใหม่”): ['เชียงใหม่'], or nothing for a name that is not. */
export const withoutMueang = name => (String(name || '').startsWith('เมือง') && String(name).length >= 8 ? [String(name).slice(5)] : undefined);

/* ---------------------------------------------------------------- index */

/**
 * Which of an entry's own names holds what was typed best: the list says it under the heading when it is another
 * name (a stay found by the name it was recorded under). Letters first, then the sound, then a word one or two keys
 * off; the first name wins a tie, and '' when no name holds any of it. For one row of a list, not for ranking.
 */
export function nameHolding(entry, typed) {
  const names = [entry.name, entry.nameEn, ...(entry.aka || [])].filter(Boolean);
  const tokens = clean(typed).split(' ').map(exact1).filter(t => t.length >= 2);
  let best = '', top = 0;
  for (const name of names) {
    const c = clean(name), k1 = exact1(c), k2 = soundKey(k1), words = wordsOf(c);
    let score = 0;
    for (const t of tokens) {
      const max = allowedEdits(t.length);
      if (k1.includes(t)) score += 4;
      else if (k2.includes(soundKey(t))) score += 3;
      else if (max && words.some(w => w.length - t.length <= max && t.length - w.length <= max && editDistance(t, w, max) <= max)) score += 2;
      else if (max && words.some(w => w.length > t.length && editDistance(t, w.slice(0, t.length), max) <= max)) score += 1;
    }
    if (score > top) { top = score; best = name; }
  }
  return best;
}

export const STEP = Object.freeze({code: 1, name: 2, marks: 3, start: 4, word: 5, sound: 6, within: 7, part: 8, nearIn: 9, layout: 10, near: 11, nearStart: 12});
const NONE = 99;
/** The number of a name that stands for “no one name”: a word or a piece of some name was found. */
const NOFORM = 49;
const SEP = ch(1);

/** How a step is shown: 'sure', 'spelling' (another spelling of what was typed) or 'near' (a guess). */
export function classOf(step, inner = 0) {
  if (step >= STEP.nearIn) return 'near';
  const s = step === STEP.within ? inner : step;
  return s === STEP.marks || s === STEP.sound ? 'spelling' : 'sure';
}

const wordsOf = cleaned => cleaned.split(PLAIN.test(cleaned) ? NOT_WORD : /[^\p{L}\p{N}\p{M}]+/u).map(exact1).filter(w => w.length >= 2);
const countSep = (text, upTo) => { let n = 0; for (let i = text.indexOf(SEP); i >= 0 && i < upTo; i = text.indexOf(SEP, i + 1)) n++; return n; };
const makeQuery = (cleaned, minPart = 3) => {
  const q1 = exact1(cleaned), q2 = soundKey(q1);
  return {text: cleaned, q0: exact0(cleaned), q1, q2, n1: needle(q1), n2: needle(q2), s1: SEP + q1, s2: SEP + q2, w1: ' ' + q1, minPart, latin: /^[a-z0-9]+$/.test(q1)};
};

/**
 * An index of the names a demo knows.
 *
 *   kinds  [{id, level?, auto?}] in the order kinds stand among equals (places before brands before venues is the
 *          usual one); `level` is the level a lead word names: province | district | subdistrict | locale | station;
 *          `auto` marks the kinds the list may choose ahead when one entry of those kinds alone has the name typed —
 *          places and filters, not venues, whose names are often a common word (a resort named “พัทยา” in ขอนแก่น).
 *   heads  words a venue's name may begin with, or carry, that people add or leave out (โรงแรม, hotel …). Words in
 *          an array are one word written several ways — the word and its abbreviations (['โรงพยาบาล', 'รพ.']): a
 *          name typed with one is also looked for with the others (“รพ.ศิริราช” is “โรงพยาบาลศิริราช”).
 *
 * An entry: {id, kind, name, nameEn?, aka?: [other names it goes by], also?: [looser forms of its name, found but
 * never the name itself: “เชียงใหม่” for อำเภอเมืองเชียงใหม่], codes?: [typed whole], within?: [names of the places
 * it is in; entries of one place may share the array], province?, area?, weight?} and whatever the caller wants back
 * (a row …). The index keeps the entry and three short keys of its names; nothing is copied from it.
 */
export function createIndex({kinds = [], heads = []} = {}) {
  const order = new Map(kinds.map((k, i) => [k.id, i]));
  const levels = new Map(kinds.map(k => [k.id, k.level || '']));
  const auto = new Set(kinds.filter(k => k.auto).map(k => k.id));
  const headTexts = [...new Set(heads.flat().map(clean).filter(Boolean))].sort((a, b) => b.length - a.length);
  /** A head word → the other ways it is written. */
  const sameHead = new Map();
  for (const group of heads) if (Array.isArray(group)) { const all = [...new Set(group.map(clean).filter(Boolean))]; for (const h of all) sameHead.set(h, all.filter(x => x !== h)); }
  const headKeys = [...new Set(headTexts.map(exact1).filter(Boolean))].sort((a, b) => b.length - a.length);
  const isHead = new Set(headKeys);
  /** A head word as typed, or one key off it (“รสอร์ท”, “hotwl”): a word the entry need not carry. */
  const headLike = k1 => isHead.has(k1) || (k1.length >= 4 && headKeys.some(h => h.length - k1.length <= 1 && k1.length - h.length <= 1 && editDistance(k1, h, 1) <= 1));
  /**
   * The text after a head word it begins with (“โรงแรมแมนดาริน” → “แมนดาริน”, “รพ.ศิริราช” → “ศิริราช”), or ''. A head in
   * Latin letters is a word of its own (“the grand”, never “theatre”); Thai is written without spaces.
   */
  const afterHead = (cleaned, head = null) => {
    for (const h of headTexts) {
      if (!cleaned.startsWith(h)) continue;
      const tail = cleaned.slice(h.length);
      if (/[a-z0-9]$/.test(h) && /^[a-z0-9]/.test(tail)) continue;
      const rest = tail.replace(/^[^\p{L}\p{N}\p{M}]+/u, '');
      if (exact1(rest).length >= 2) { if (head) head.is = h; return rest; }
    }
    return '';
  };
  /** Is one of the entry's names — as it is written, or without the head word it begins with — what was typed letter for letter? */
  const lettersEqual = (e, q0) => [e.name, e.nameEn, ...(e.aka || []), ...(e.also || [])].some(name => {
    if (!name) return false;
    const c = clean(name);
    return exact0(c) === q0 || (headTexts.length > 0 && exact0(afterHead(c)) === q0);
  });
  const records = [];
  const contexts = new Map(), shared = new WeakMap();

  /** The keys of the places an entry is in. Entries that share the array share the keys (a district's venues). */
  const contextOf = within => {
    if (!within) return null;
    if (shared.has(within)) return shared.get(within);
    const list = within.filter(Boolean), id = list.join(SEP);
    let ctx = list.length ? contexts.get(id) : null;
    if (list.length && !ctx) { const keys = [...new Set(list.map(key1).filter(Boolean))]; ctx = {i1: SEP + keys.join(SEP), i2: SEP + keys.map(soundKey).join(SEP), keys}; contexts.set(id, ctx); }
    shared.set(within, ctx);
    return ctx;
  };

  function add(entry) {
    const real = [entry.name, entry.nameEn, ...(entry.aka || [])].filter(Boolean);
    const names = [...real, ...(entry.also || []).filter(Boolean)], own = real.length;
    const keys = [], forms = [], words = new Set(), rests = [];
    let main = 0;
    names.forEach((name, i) => {
      const c = clean(name), k = exact1(c);
      if (!k || keys.includes(k) || keys.length >= NOFORM) return;
      keys.push(k); forms.push(name);
      if (i < own) main = keys.length;
      for (const w of wordsOf(c)) words.add(w);
      // A name that begins with a head word also goes by the rest (“โรงพยาบาลศิริราช” is “ศิริราช” to most people).
      const rest = i < own ? afterHead(c) : '';
      if (rest) rests.push(exact1(rest));
    });
    // The rests are names of the entry too, after its own: found as a name, never shown as one (forms holds '') and
    // never the reason it is chosen ahead (`written` counts the names it is written with).
    const written = main;
    if (rests.length) {
      const looser = keys.splice(main), looserForms = forms.splice(main);
      for (const k of rests) if (!keys.includes(k) && keys.length < NOFORM) { keys.push(k); forms.push(''); words.add(k); }
      main = keys.length;
      looser.forEach((k, i) => { if (!keys.includes(k) && keys.length < NOFORM) { keys.push(k); forms.push(looserForms[i]); } });
    }
    const codes = (entry.codes || []).map(key0).filter(Boolean);
    if (!keys.length && !codes.length) return;
    records.push({e: entry, a1: SEP + keys.join(SEP), a2: SEP + keys.map(soundKey).join(SEP), w1: ' ' + [...words].join(' '), main, written, forms, codes,
      ctx: contextOf(entry.within), ko: order.get(entry.kind) ?? order.size, level: levels.get(entry.kind) || '', weight: Number(entry.weight) || 0, len: keys[0]?.length || 0});
  }

  /**
   * The step one text reaches on a record's own names (no places, no guesses): step * 100 + the number of the name
   * (under 49; 49 when a word or a piece of some name was found), + 50 when step 6 holds for the beginning of the
   * name only.
   */
  function own(r, q) {
    const q1 = q.q1;
    let step = NONE, form = 0;
    // Every word of a name is a piece of its key, so a key that does not hold the text rules steps 2–5 and 8 out.
    if (has(r.a1, q.n1)) {
      // A name that is whole (the next name or the end follows) beats one that only begins so; the earliest one wins.
      for (let i = r.a1.indexOf(q.s1); i >= 0; i = r.a1.indexOf(q.s1, i + 1)) {
        const end = i + 1 + q1.length, whole = end === r.a1.length || r.a1[end] === SEP;
        const s = whole ? STEP.marks : STEP.start;
        if (s < step) { step = s; form = countSep(r.a1, i); }
        if (whole) break;
      }
      if (step === STEP.marks && lettersEqual(r.e, q.q0)) step = STEP.name;
      if (step > STEP.word && r.w1.includes(q.w1)) { step = STEP.word; form = NOFORM; }
      if (step > STEP.part && q1.length >= q.minPart) { step = STEP.part; form = NOFORM; }
    }
    let begun = 0;
    if (step > STEP.sound && q.q2.length >= 2 && has(r.a2, q.n2)) {
      for (let i = r.a2.indexOf(q.s2); i >= 0; i = r.a2.indexOf(q.s2, i + 1)) {
        const end = i + 1 + q.q2.length, whole = end === r.a2.length || r.a2[end] === SEP;
        if (step > STEP.sound || whole) { step = STEP.sound; form = countSep(r.a2, i); begun = whole ? 0 : 1; }
        if (whole) break;
      }
    }
    return step * 100 + begun * 50 + form;
  }

  /**
   * Does a record's name hold one word of several? A word in Latin letters must begin a word of the name (“ssi” in
   * Cassia is no word of “Bang Ssi”); Thai is written without spaces, so a Thai word may stand anywhere in it.
   */
  const holds = (r, v) => (v.latin ? r.w1.includes(v.w1) || r.a2.includes(v.s2) : has(r.a1, v.n1) || has(r.a2, v.n2));

  /**
   * Several words: each stands in the record's names or in the names of the places it is in, and at least one in its
   * own names. The words of its own name, read together, give the step: 7 when they are the name by steps 2–6 and
   * another word is its place (“หาดใหญ่ สงขลา”), else 8. `tight` says every word begins a word of the name: only
   * then does the entry count as holding what was typed (“ssi” inside Cassia is no word of “Bang Ssi”).
   */
  function within(r, tokens) {
    let nameText = '', inName = 0, solid = 0, asked = tokens.length, tight = true, weak = false;
    for (const t of tokens) {
      let got = 0, v = t.a;
      if (holds(r, v)) got = 1;
      else if (t.b && holds(r, t.b)) { got = 1; v = t.b; }
      else if (r.ctx && ((t.b && (has(r.ctx.i1, t.b.n1) || has(r.ctx.i2, t.b.n2))) || has(r.ctx.i1, t.a.n1) || has(r.ctx.i2, t.a.n2))) got = 2;
      // A head or level word (“โรงแรม”, “hotel”, “district”) the entry does not carry is left aside, not held against it.
      if (!got) { if (t.head) { asked--; if (!t.sure) weak = true; continue; } return null; }
      if (got === 1) { inName++; if (!t.head) solid++; nameText += (nameText ? ' ' : '') + v.text; if (tight && !r.w1.includes(v.w1)) tight = false; }
    }
    // Head words alone say nothing about which entry is meant (“the … hotel”).
    if (!inName || !solid) return null;
    const one = asked < 2;
    const reached = own(r, makeQuery(nameText, one ? 3 : 2)), step = Math.floor(reached / 100);
    // Only one word is left once the head words are aside (“novotel hotel”): it is looked for as one word.
    // 1: a head word was left aside; 2: a word only like one (“ลีสอร์ท”), which says less.
    const aside = asked < tokens.length ? (weak ? 2 : 1) : 0;
    if (one) return step < NONE ? {step, inner: reached % 100 >= 50 ? 1 : 0, form: reached % 50, rested: true, aside} : null;
    if (step <= STEP.sound) return inName < asked ? {step: STEP.within, inner: step, form: reached % 50, words: true} : {step, inner: reached % 100 >= 50 ? 1 : 0, form: reached % 50, rested: true, aside, words: true};
    return {step: STEP.part, inner: tight ? 0 : 1, form: NOFORM, words: tight};
  }

  /** What steps 1–8 need to know about a text, worked out once. */
  function prepare(cleaned) {
    const lead = leadOf(cleaned), ql = lead ? makeQuery(lead.rest) : null;
    // With a lead word (“จ.เชียงใหม่”) the text as typed is still a name some entry may have, but no longer a piece
    // to look for inside other names: จ + เชียงใหม่ stands inside “… เฮอริเทจ เชียงใหม่”.
    const q = makeQuery(cleaned, lead ? Infinity : 3);
    // A head word typed before a name that is kept without it (“โรงแรมแมนดาริน”): the rest is looked for as well —
    // and so is the name with the head written its other ways (“รพ.ศิริราช” → “โรงพยาบาลศิริราช”).
    const head = {is: ''}, rest = lead ? '' : afterHead(cleaned, head), qh = rest ? makeQuery(rest) : null;
    const same = rest ? (sameHead.get(head.is) || []).map(h => makeQuery(h + rest, Infinity)) : [];
    // A word of one letter, or a lead abbreviation standing alone (“จ เชียงใหม่”), is not a word to look for.
    const tokens = cleaned.split(' ').map(t => { const l = leadOf(t), a = makeQuery(t), sure = LEVEL_TOKENS.has(t) || isHead.has(a.q1); return {a, b: l ? makeQuery(l.rest) : null, head: sure || headLike(a.q1), sure}; }).filter(t => t.a.q1.length >= 2);
    return {q, lead, ql, qh, same, tokens, many: tokens.length > 1, long: q.q1.length >= 2, empty: !q.q1 && !q.q0};
  }

  /** Steps 1–8 for records [from, to): found gets record → {step, inner, form, edits: 0}. */
  function scan(p, found, from, to) {
    if (p.empty) return;
    const {q, lead, ql, qh, same, tokens, many, long} = p;
    for (let n = from; n < to; n++) {
      const r = records[n];
      let hit = null;
      if (r.codes.length && r.codes.includes(q.q0)) hit = {step: STEP.code, inner: 0, form: 0};
      else if (long) {
        let reached = own(r, q), rested = false;
        if (ql && r.level === lead.level) { const x = own(r, ql); if (x < reached) reached = x; }
        for (const qs of same) { const x = own(r, qs); if (x < reached) reached = x; }
        if (qh && reached >= STEP.marks * 100) { const x = own(r, qh); if (Math.floor(x / 100) < Math.floor(reached / 100)) { reached = x; rested = true; } }
        if (reached < NONE * 100) hit = {step: Math.floor(reached / 100), inner: reached % 100 >= 50 ? 1 : 0, form: reached % 50, rested, aside: rested ? 1 : 0};
      }
      if (many && (!hit || hit.step > STEP.sound)) { const w = within(r, tokens); if (w && (!hit || w.step < hit.step)) hit = w; }
      if (hit) { hit.edits = 0; found.set(r, hit); }
    }
  }

  /** What steps 9, 11 and 12 need to know about a text. */
  function prepareNear(cleaned) {
    const q = makeQuery(cleaned), max = allowedEdits(q.q1.length);
    const tokens = cleaned.split(' ').map(t => { const a = makeQuery(t); return {...a, head: LEVEL_TOKENS.has(t) || headLike(a.q1)}; }).filter(t => t.q1.length >= 2);
    return {q, max, tokens, single: tokens.length < 2};
  }

  /** How far `text` is from the beginning of `word` — as long as the text, or one letter more or less — or max + 1. */
  function startEdits(text, word, max) {
    const n = text.length;
    let d = editDistance(text, word.slice(0, n), max);
    if (d > 1) d = Math.min(d, editDistance(text, word.slice(0, n + 1), max), editDistance(text, word.slice(0, n - 1), max));
    return d;
  }

  /** Steps 9, 11 and 12 for records [from, to) the sure steps did not find. */
  function guess(p, found, out, from, to) {
    const {q, max, tokens, single} = p, q1 = q.q1, q2 = q.q2, n1 = q1.length, n2 = q2.length;
    const first1 = q1.charCodeAt(0), first2 = q2.charCodeAt(0), wordLead = ' ' + q1[0];
    for (let at = from; at < to; at++) {
      const r = records[at];
      if (found.has(r)) continue;
      let step = NONE, edits = 0, form = 0, rank = Infinity;
      if (max) {
        const a1 = r.a1, w1 = r.w1;
        for (let i = 1, n = 0; i < a1.length; n++) {
          let end = a1.indexOf(SEP, i); if (end < 0) end = a1.length;
          const len = end - i, same = a1.charCodeAt(i) === first1;
          if (len - n1 <= max && n1 - len <= max) {
            const d = editDistance(q1, a1.slice(i, end), max);
            if (d <= max) { const k = STEP.near * 10 + d + (same ? 0 : 0.5); if (k < rank) { rank = k; step = STEP.near; edits = d; form = n; } }
          }
          // The beginning of a longer name, for one word typed: its first letter as typed.
          if (same && single && n1 >= 4 && len > n1 && step > STEP.near) {
            const d = startEdits(q1, a1.slice(i, end), max);
            if (d <= max) { const k = STEP.nearStart * 10 + d; if (k < rank) { rank = k; step = STEP.nearStart; edits = d; form = n; } }
          }
          i = end + 1;
        }
        if (step > STEP.near) {
          const a2 = r.a2;
          for (let i = 1, n = 0; i < a2.length; n++) {
            let end = a2.indexOf(SEP, i); if (end < 0) end = a2.length;
            const len = end - i;
            if (len - n2 <= max && n2 - len <= max) {
              const d = editDistance(q2, a2.slice(i, end), max);
              if (d <= max) { const k = STEP.near * 10 + d + (a2.charCodeAt(i) === first2 ? 0 : 0.5); if (k < rank) { rank = k; step = STEP.near; edits = d; form = n; } }
            }
            i = end + 1;
          }
        }
        // A word of the name, from four letters typed and for one word only: its first letter as typed. The whole
        // word (step 11), else its beginning (step 12) — a name still being typed. A name is a word of itself.
        if (single && step > STEP.near && n1 >= 4) for (let i = w1.indexOf(wordLead); i >= 0; i = w1.indexOf(wordLead, i + 1)) {
          let end = w1.indexOf(' ', i + 1); if (end < 0) end = w1.length;
          const len = end - i - 1;
          if (len - n1 <= max && n1 - len <= max) {
            const d = editDistance(q1, w1.slice(i + 1, end), max);
            if (d && d <= max) { const k = STEP.near * 10 + d + 0.25; if (k < rank) { rank = k; step = STEP.near; edits = d; form = NOFORM; } }
          }
          if (len > n1 && step > STEP.nearStart) {
            const d = startEdits(q1, w1.slice(i + 1, end), max);
            if (d <= max) { const k = STEP.nearStart * 10 + d; if (k < rank) { rank = k; step = STEP.nearStart; edits = d; form = NOFORM; } }
          }
        }
      }
      if (!single) {
        // One word a key off, the others as typed (a head word the entry does not carry is left aside): off a name of
        // the record or one of its words; off the beginning of a word when it is the last word typed; or — when
        // another word is in its name — off the name of its place.
        let miss = null, inName = 0, inPlace = 0, ok = true;
        for (const t of tokens) {
          if (t.latin ? r.w1.includes(t.w1) : has(r.a1, t.n1)) inName++;
          else if (r.ctx && has(r.ctx.i1, t.n1)) inPlace++;
          else if (t.head) continue;
          else if (miss) { ok = false; break; } else miss = t;
        }
        const allow = ok && miss ? allowedEdits(miss.q1.length) : 0;
        if (allow && (inName || inPlace)) {
          const m1 = miss.q1, mn = m1.length, a1 = r.a1, w1 = r.w1, lead = ' ' + m1[0], last = miss === tokens[tokens.length - 1];
          let d = allow + 1;
          for (let i = 1; i < a1.length;) {
            let end = a1.indexOf(SEP, i); if (end < 0) end = a1.length;
            if (end - i - mn <= allow && mn - (end - i) <= allow) d = Math.min(d, editDistance(m1, a1.slice(i, end), allow));
            i = end + 1;
          }
          if (d > allow) for (let i = w1.indexOf(lead); i >= 0 && d > allow; i = w1.indexOf(lead, i + 1)) {
            let end = w1.indexOf(' ', i + 1); if (end < 0) end = w1.length;
            const len = end - i - 1;
            if (len - mn <= allow && mn - len <= allow) d = Math.min(d, editDistance(m1, w1.slice(i + 1, end), allow));
            else if (last && len > mn) d = Math.min(d, startEdits(m1, w1.slice(i + 1, end), allow));
          }
          if (d > allow && inName && r.ctx) for (const k of r.ctx.keys) if (k.length - mn <= allow && mn - k.length <= allow) d = Math.min(d, editDistance(m1, k, allow));
          if (d <= allow) { const k = STEP.nearIn * 10 + d; if (k < rank) { rank = k; step = STEP.nearIn; edits = d; form = NOFORM; } }
        }
      }
      if (step < NONE) out.set(r, {step, inner: 0, form, edits, rank});
    }
  }

  /**
   * Where a hit stands. A name found with a head word left aside comes right after the names that reach the same step
   * with all that was typed (“โรงเรียนสวนกุหลาบวิทยาลัย” typed: the school the data keeps as “สวนกุหลาบวิทยาลัย” before a
   * longer name that begins with it). When the word left aside was only like a head word (“ชวนชม ลีสอร์ท”), the name
   * comes after every name that holds all that was typed by steps 1–6, in the order of its own step.
   */
  const place = h => (!h.aside || h.step > STEP.sound ? h.step : h.aside === 1 ? h.step + 0.5 : STEP.sound + h.step / 10);
  const KEEP = 240;
  /** The entries found, in order; the first KEEP are kept, `total` counts them all. */
  function assemble(result, found, guesses, province, area) {
    const list = [];
    const push = (r, h) => list.push({r, h, here: area && r.e.area === area ? 0 : province && r.e.province === province ? 1 : 2});
    for (const [r, h] of found) push(r, h);
    for (const [r, h] of guesses) push(r, h);
    list.sort((x, y) => (place(x.h) - place(y.h)) || ((x.h.rank ?? 0) - (y.h.rank ?? 0)) || (x.h.inner - y.h.inner) || (x.here - y.here) || (x.r.ko - y.r.ko)
      || (Number(x.h.form >= x.r.main) - Number(y.h.form >= y.r.main)) || (y.r.weight - x.r.weight) || (x.r.len - y.r.len) || (x.r.a1 < y.r.a1 ? -1 : x.r.a1 > y.r.a1 ? 1 : 0));
    result.total = list.length;
    result.sure = found.size;
    result.items = list.slice(0, KEEP).map(({r, h}) => ({entry: r.e, step: h.step, inner: h.inner, show: classOf(h.step, h.inner), edits: h.edits,
      alt: h.form !== NOFORM && h.form >= r.main, matched: h.form < r.main ? r.forms[h.form] || '' : ''}));
    // Chosen ahead for the reader only when one place alone has the name or the code typed (the brief's decision of
    // 10 Oct 2026: “เลือกแถวให้อัตโนมัติเฉพาะเมื่อมีพื้นที่เดียวที่ชื่อตรง”). Here a place is an entry of a kind the caller
    // lets the list choose (places and filters). A venue of the same name stands in the list beside it and is never
    // chosen, nor does it stop the place from being chosen (“บางรัก” is the district; its district office is the next row).
    // Nor does a place that only goes by the name once its head word is left out (“ภูเก็ต” is the province;
    // เทศบาลนครภูเก็ต is found by it and stands in the next row): the very name is a name the entry is written with.
    let one = null, more = false;
    for (const x of list) { if (place(x.h) > STEP.name) break; if (x.h.form < x.r.written && !x.h.rested && auto.has(x.r.e.kind)) { if (one) { more = true; break; } one = x.r.e; } }
    // The same for a name typed with its place (“หาดใหญ่ สงขลา”), when nothing has the whole text as its own name.
    if (!one && !more && list.length && list[0].h.step === STEP.within) {
      for (const x of list) { if (x.h.step !== STEP.within || x.h.inner > STEP.name) break; if (x.h.form < x.r.written && auto.has(x.r.e.kind)) { if (one) { more = true; break; } one = x.r.e; } }
    }
    result.preselect = one && !more ? one : null;
    return result;
  }

  const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());
  const SLICE = 3000;

  /**
   * Begin a search that is made in pieces, so a long list of names never holds the page: the sure steps first, then —
   * only when they found little — the guesses, then the other keyboard layout.
   *   {province, area}  what the reader is looking at: among equals an entry there comes first.
   * → a job: `step(ms)` works for about ms and returns true once nothing is left; `result` is what is known so far
   *   and `version` grows each time it changes:
   *   {query, items: [{entry, step, inner, show: 'sure' | 'spelling' | 'near', edits, alt, matched: the name of the
   *    entry that was found, as it is written, or '' for a word or a piece}] (the first 240), total,
   *    sure: how many the sure steps found, preselect: entry | null, guessed: were guesses looked for,
   *    layout: the text on the other keyboard layout when that found names}
   */
  function begin(raw, {province = '', area = ''} = {}) {
    const cleaned = clean(raw);
    const job = {result: {query: cleaned, items: [], total: 0, sure: 0, preselect: null, guessed: false, layout: ''}, version: 0, pending: Boolean(cleaned)};
    if (!cleaned) { job.step = () => true; return job; }
    const found = new Map(), guesses = new Map(), p = prepare(cleaned);
    let phase = 'sure', at = 0, pn = null, others = [], po = null, swapped = null;
    const publish = () => { job.result = assemble({...job.result}, found, guesses, province, area); job.version++; };
    job.step = (ms = 8) => {
      const until = now() + ms;
      for (;;) {
        if (phase === 'sure') {
          const to = Math.min(records.length, at + SLICE); scan(p, found, at, to); at = to;
          if (at >= records.length) {
            // Guesses: only when the sure steps found little — fewer than three by steps 1–6, none whole, and no
            // entry that holds every word typed (steps 7 and 8 for several words).
            let strong = 0, whole = 0, placed = 0;
            for (const h of found.values()) { if (h.step <= STEP.sound) strong++; if (h.step <= STEP.marks) whole++; if (h.words) placed++; }
            if (strong < 3 && !whole && !placed && p.q.q1.length >= 3) {
              phase = 'near'; at = 0; pn = prepareNear(cleaned); job.result.guessed = true;
              if (found.size) publish();
            } else phase = 'done';
          }
        } else if (phase === 'near') {
          const to = Math.min(records.length, at + SLICE / 2); guess(pn, found, guesses, at, to); at = to;
          if (at >= records.length) {
            // The other keyboard layout: only for a text that is no name at all as typed.
            others = found.size ? [] : [...new Set([otherLayout(raw), otherLayout(raw, {loose: true})].map(clean))].filter(t => exact1(t).length >= 2);
            phase = others.length ? 'layout' : 'done';
            at = 0; po = null;
          }
        } else if (phase === 'layout') {
          if (!po) { po = prepare(others[0]); swapped = new Map(); }
          const to = Math.min(records.length, at + SLICE); scan(po, swapped, at, to); at = to;
          if (at >= records.length) {
            let any = false;
            for (const [r, h] of swapped) {
              if (h.step > STEP.part) continue;
              any = true;
              const g = guesses.get(r);
              if (!g || g.step > STEP.layout) guesses.set(r, {step: STEP.layout, inner: h.step, form: h.form, edits: 0, rank: STEP.layout * 10 + h.step / 10});
            }
            if (any) { job.result.layout = others[0]; phase = 'done'; }
            else { others.shift(); at = 0; po = null; if (!others.length) phase = 'done'; }
          }
        }
        if (phase === 'done') { job.pending = false; publish(); return true; }
        if (now() >= until) return false;
      }
    };
    return job;
  }

  /** The whole search at once (tests, small indexes). */
  function search(raw, scope) { const job = begin(raw, scope); while (!job.step(Infinity)) { /* until done */ } return job.result; }

  return {add, addAll: entries => { for (const e of entries) add(e); }, begin, search, get size() { return records.length; }};
}
