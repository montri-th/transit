/**
 * citymeter-shell · the list under the search box (0.7.0; owner 2026-11-12 12:05, VERBATIM: “ศึกษาแนวคิดเรื่อง Fuzzy
 * search แล้ว implement กับ demo web ให้ได้ user benefit สูงสุดตาม user intent ในขณะนั้น และตาม product statement”).
 *
 * What a reader means by a name depends on the name: a province or a district is a place to open, a venue is a page to
 * open, a brand or a type is a filter, and any other text is words to keep rows by. So the box no longer filters while
 * it is typed in. It lists the names js/shell/fuzzy.js finds — as typed, spelt another way, or one or two keys off —
 * and the reader says which one is meant; Enter with nothing chosen keeps the rows that hold the words, as the box
 * did before. Nothing typed is stored or sent anywhere.
 *
 * The contract of the control (LDS 0.9.7 CTRL-01, A11Y-01; method of the skill write-component-contract):
 *   job       name → the level, the item or the filter that answers it, in one step.
 *   carries   the name as the page's language writes it, the name that was found when it is another one, what the
 *             entry is and where (the demo's `note`), and how sure the match is, in words: nothing for a name as
 *             typed, “สะกดต่างจากที่พิมพ์” for another spelling, the heading “ชื่อใกล้เคียง” for a guess.
 *   states    closed · preparing (the names are still being read) · results · nothing as typed, with guesses ·
 *             nothing at all (with what to try) · failed (the box still filters by its words). A state is always
 *             words; the option the keys are on has a ring as well as a tint.
 *   effect    choosing an entry calls `pick` and empties the box; the last row and Enter apply the words as the text
 *             filter (the demo's own input takes them and its `input` listener runs). A guess is never chosen for the
 *             reader: only an entry that alone has the very name typed is marked ahead (fuzzy.js `preselect`), and
 *             Enter opens a row only when it is marked — when the words keep no row, Enter marks the first name
 *             found as typed and Enter again opens it.
 *             A filter or words chosen here are shown for the whole page, as the list counted them: the place being
 *             looked at is left (the demo's `leave`), the filters already on stay while some row still passes them
 *             all, and the ones that would leave the choice no row are lifted first (`makeWay`, filtersToLift; the
 *             list's last row counts the words the same way, rowsAfterWay). A place filter and a counting unit are
 *             never lifted: a place without the brand is a reading of the place.
 *   recovery  Escape closes the list and keeps the text, Escape again empties the box; an emptied box lifts the text
 *             filter; what was typed stays when the list closes. A place or an item opened is a step of the browser's
 *             history, as in the demo (back goes back); a filter or words chosen are taken off the demo's own way (its
 *             chip, its control, the emptied box), and a filter that was lifted to make way is not put back.
 *   boundary  it finds names the demo's data carries, in the spellings it carries; it says nothing about a place the
 *             data does not name.
 *
 * The demo's own `<input id="search">` stays the field of the applied text filter (hidden, read by the demo as
 * before); the box a reader types in is a second input this module adds. If this module does not load, the demo's
 * input is untouched and filters as it always did.
 *
 * Keyboard (WAI-ARIA combobox with a listbox): ↓ ↑ move through the options, Enter chooses, Escape closes, Tab leaves.
 * Part of the shared CityMETER demo shell: edit it in every repository at once (js/shell/manifest.json).
 */
import {LANG} from './i18n.js';
import {mapBudget} from './maplibre-guard.js';
import {clean, key1, nameHolding, STEP} from './fuzzy.js';

const PAGE = 8, MORE = 16;
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = n => Number(n).toLocaleString('en-US');
const HAS_THAI = /\p{Script=Thai}/u;

/** The words of the list. Thai is the source text; js/shell/i18n.js carries their English. */
export const WORDS = Object.freeze({
  list: 'ผลการค้นหา',
  preparing: 'กำลังเตรียมรายชื่อ…',
  near: 'ชื่อใกล้เคียง',
  spelling: 'สะกดต่างจากที่พิมพ์',
  none: text => `ไม่พบ “${text}”`,
  layout: (text, thai) => `อ่านตามแป้นพิมพ์${thai ? 'ไทย' : 'อังกฤษ'} “${text}”`,
  count: n => `${num(n)} ชื่อ`,
  more: 'ดูเพิ่ม',
  left: n => `อีก ${num(n)} ชื่อ`,
  narrow: 'พิมพ์ต่อเพื่อให้ตรงขึ้น',
  filter: text => `กรองด้วยคำว่า “${text}”`,
  hint: 'ลองพิมพ์ชื่อให้สั้นลง หรือชื่อพื้นที่',
  failed: 'เตรียมรายชื่อไม่สำเร็จ',
  retry: 'ลองใหม่',
  helpTitle: 'ค้นหา',
  help: 'พิมพ์ชื่อแล้วเลือกจากรายการ · สะกดอีกแบบหรือลืมเปลี่ยนภาษาแป้นพิมพ์ก็พบ · ลูกศรขึ้นลงเลื่อน Enter เลือก · Enter โดยไม่เลือก = กรองด้วยคำที่พิมพ์',
});

/**
 * Which of an entry's names heads its row (its `label` when it has no name), and which other one is said under it. Pure.
 *   lang     the page's language: its name comes first, the other when there is no such name.
 *   matched  the name the search found, as written ('' for a word or a piece of a name).
 * → {name, thai: is the heading Thai on an English page, also: the name found when it is not the heading}
 */
export function rowNames(entry, matched = '', lang = 'th') {
  const th = entry.name || '', en = entry.nameEn || '';
  // An entry the data keeps without a name (found by its code) is headed by its label.
  const name = (lang === 'en' ? en || th : th || en) || entry.label || '';
  // Said under the heading only when it adds something: a short name that stands inside the heading does not.
  const also = matched && !key1(name).includes(key1(matched)) ? matched : '';
  return {name, thai: lang === 'en' && HAS_THAI.test(name), also};
}

/**
 * The rows of one result, in the order they are listed. Pure.
 *   result  what fuzzy.js gives; limit: how many entries are shown; rows: how many rows the words would keep as a text
 *   filter (0 or null: no such row).
 * → {groups: [{kind: 'sure' | 'near' | 'layout', items}], more: entries not shown yet, capped: are there more than the
 *    result keeps, filter: rows}
 */
export function planRows(result, {limit = PAGE, rows = 0} = {}) {
  const shown = result.items.slice(0, limit);
  const sure = shown.filter(i => i.show !== 'near');
  const layout = shown.filter(i => i.show === 'near' && i.step === STEP.layout);
  const near = shown.filter(i => i.show === 'near' && i.step !== STEP.layout);
  const guesses = [{kind: 'near', items: near}, {kind: 'layout', items: layout}].filter(g => g.items.length);
  // Two kinds of guess stand in the order of their best entry.
  if (guesses.length === 2 && shown.indexOf(layout[0]) < shown.indexOf(near[0])) guesses.reverse();
  return {groups: [{kind: 'sure', items: sure}, ...guesses].filter(g => g.items.length),
    more: Math.max(0, result.items.length - shown.length), capped: result.total > result.items.length && shown.length >= result.items.length, filter: rows || 0};
}

/**
 * Which of the other filters to lift so that a filter chosen by name shows what it names. Pure.
 *   values   the filter values now ({field: value}); field, id: the filter chosen and its value.
 *   fields   the filters that may be lifted, in the order to try them (never a place, a counting unit or a measure).
 *   context  the place filters ('' is everywhere): never lifted, and set aside when a place alone leaves the choice
 *            no row — a filter that could go with the choice nowhere is still lifted, the place stays.
 *   count    values → how many rows they keep.
 * → [] while some row passes them all, or when no lifting gives the choice a row; else the one filter whose lifting
 *   is enough (the first such in `fields`), else every one that is on.
 */
export function filtersToLift({values, field, id, fields, context = [], count}) {
  const chosen = {...values, [field]: id};
  if (count(chosen) > 0) return [];
  const on = fields.filter(f => f !== field && chosen[f]);
  if (!on.length) return [];
  const without = (base, list) => { const v = {...base}; for (const f of list) v[f] = ''; return v; };
  const judge = base => {
    for (const f of on) if (count(without(base, [f])) > 0) return [f];
    return on.length > 1 && count(without(base, on)) > 0 ? on : null;
  };
  const here = judge(chosen);
  if (here) return here;
  // No lifting helps in the place being read. Apart from the place: filters that go with the choice somewhere stay
  // (the place has none of it, which is a reading of the place); one that goes with it nowhere is lifted.
  const apart = without(chosen, context.filter(f => f !== field));
  return count(apart) > 0 ? [] : judge(apart) || [];
}

/**
 * How many rows words keep once they are chosen: with the filters that are on, else with the ones that stay when
 * the fewest are lifted for them (filtersToLift) — what the page then shows. Pure.
 *   values, fields, context, count  as for filtersToLift; text: the words.
 * → {n: the rows, lifted: the filters that go for them ([] when none has to)}
 */
export function rowsAfterWay({values, text, fields, context = [], count}) {
  const chosen = {...values, search: text};
  const here = Number(count(chosen)) || 0;
  if (here > 0) return {n: here, lifted: []};
  const lifted = filtersToLift({values, field: 'search', id: text, fields, context, count});
  if (!lifted.length) return {n: 0, lifted};
  for (const f of lifted) chosen[f] = '';
  return {n: Number(count(chosen)) || 0, lifted};
}

/**
 * Which filters keep an item out, so that an item chosen by name always opens. Pure.
 *   values  the filter values now; fields: every filter that may hide an item (its place filters too);
 *   passes  values → truthy when the item passes them.
 * → the filters the item does not pass, each judged alone; [] when it is out even with all of them lifted (a
 *   counting unit hides it: the demo's own action answers that).
 */
export function filtersAgainst({values, fields, passes}) {
  const base = {...values};
  for (const f of fields) base[f] = '';
  if (!passes(base)) return [];
  return fields.filter(f => values[f] && !passes({...base, [f]: values[f]}));
}

/**
 * Put the list under a demo's search box.
 *   input    the demo's search input: from now on the field of the applied text filter.
 *   index    a createIndex() of js/shell/fuzzy.js, empty; `entries()` gives what goes in (called once, when a reader
 *            first comes to the box, and read in pieces).
 *   note     entry → the Thai line under its name: what it is and where, its parts joined by “ · ”.
 *   pick     entry → open it. The box is already empty and the text filter lifted (its value only: the demo draws —
 *            an action that does not draw by itself asks `makeWayFor` first, which says what was lifted).
 *   scope    () → {province, area}: what the reader is looking at; an entry there comes first among equals.
 *   rows     text → how many rows the text filter would keep, with `unit` the word after that number (“แห่ง”); a
 *            demo with two kinds of row answers {n, unit} for the kind the words keep.
 *   hint     what to try when nothing is found.
 *   filters  {fields, context?, values(), count(values), leave?(), lift?(field)}: what `makeWay` needs — the demo's
 *            filters that may be lifted (never a place or a counting unit), its place filters (default ['province']),
 *            their values now, how many rows a set of values keeps on the overview, how the place being looked at is
 *            left (state only: the demo's own action draws), and how one filter is lifted (default: the element with
 *            that id takes '').
 *   onFocus  the reader came to the box (a phone sheet can stand taller).
 *   ahead    read the names ahead once the map is up (default: on a desktop; a phone reads them when the reader
 *            comes to the box, so the map keeps the phone's memory until then).
 * → {sync(): the demo changed its text filter itself, filter(text): apply words as the text filter, makeWay(field, id):
 *    lift the filters that would leave the filter about to be set no row (→ the fields lifted), makeWayFor(passes):
 *    lift the filters an item about to be opened does not pass (→ the fields lifted, with 'search' when the words
 *    were lifted for this choice: the demo draws again when the answer is not empty), prepare(), close()}
 */
export function installSearch({input, index, entries, note, pick, scope, rows, unit = '', hint = WORDS.hint, filters = null, onFocus, ahead = true, lang = LANG}) {
  const doc = input.ownerDocument, view = doc.defaultView;
  const field = input.closest('label') || input.parentElement;
  const now = () => (view.performance ? view.performance.now() : Date.now());

  /* The box a reader types in. The demo's own input keeps the applied filter. */
  const box = doc.createElement('input');
  box.type = 'search'; box.id = 'find-input'; box.autocomplete = 'off'; box.spellcheck = false; box.enterKeyHint = 'search';
  for (const [k, v] of [['autocapitalize', 'off'], ['autocorrect', 'off'], ['role', 'combobox'], ['aria-autocomplete', 'list'], ['aria-haspopup', 'listbox'],
    ['aria-expanded', 'false'], ['aria-controls', 'find-list']]) box.setAttribute(k, v);
  box.placeholder = input.placeholder || '';
  if (input.title) box.title = input.title;
  box.value = input.value;
  input.before(box);
  input.hidden = true; input.tabIndex = -1; input.setAttribute('aria-hidden', 'true'); input.style.display = 'none';
  field.after(input);

  const wrap = doc.createElement('div');
  wrap.className = 'find'; wrap.id = 'find';
  wrap.innerHTML = `<p class="find-status is-quiet" id="find-status" role="status" aria-live="polite" aria-atomic="true"></p>
<div class="find-list" id="find-list" role="listbox" aria-label="${esc(WORDS.list)}" hidden></div>
<p class="find-foot" id="find-foot" hidden></p>`;
  field.after(wrap);
  const status = wrap.querySelector('.find-status'), list = wrap.querySelector('.find-list'), foot = wrap.querySelector('.find-foot');
  doc.documentElement.classList.add('find-ready');
  // The help dialog of the demo says how the box works, once.
  const steps = doc.querySelector('.usage-dialog .help-steps');
  if (steps && !steps.querySelector('.help-find')) {
    const step = doc.createElement('li');
    step.className = 'help-find';
    step.innerHTML = `<strong>${esc(WORDS.helpTitle)}</strong><p>${esc(WORDS.help)}</p>`;
    steps.append(step);
  }

  let ready = false, failed = false, reading = null, urgent = false, busy = false;
  let job = null, shown = -1, timer = 0, result = null, asked = '', done = false, limit = PAGE, kept = null, keptUnit = '';
  /** The text the rows on screen are for: the list's own words name it, not what stands in the box by then. */
  let shownFor = '';
  /**
   * The rows the words would keep: a number, or {n, unit} from a demo with two kinds of row. When the filters that
   * are on leave the words no row, it is the rows they keep once chosen — `filter()` lifts the same filters.
   */
  const count = text => {
    let answer = 0;
    try { answer = rows ? rows(text) : 0; } catch { answer = 0; }
    keptUnit = typeof answer === 'object' && answer ? answer.unit || '' : '';
    const n = Number(typeof answer === 'object' && answer ? answer.n : answer) || 0;
    if (n || !rows || !filters || !text) return n;
    try {
      const values = {...filters.values(), search: ''};
      if (!filters.fields.some(f => values[f])) return 0;
      return rowsAfterWay({values, text, fields: filters.fields, context: filters.context || ['province'], count: filters.count}).n;
    } catch { return 0; }
  };
  let options = [], active = -1, moved = false, open = false, applied = input.value, wordsLifted = false;

  /* ---- the names, read in pieces ---- */
  function read() {
    busy = false;
    if (ready || failed || !reading) return;
    const until = now() + (urgent ? 24 : 6);
    try {
      for (;;) {
        const next = reading.next();
        if (next.done) { ready = true; reading = null; break; }
        index.add(next.value);
        if (now() >= until) break;
      }
    } catch (e) { fail(e); return; }
    if (ready) { if (clean(box.value) && doc.activeElement === box) run(); } else later();
  }
  function later() { if (!busy) { busy = true; view.setTimeout(read, urgent ? 0 : 12); } }
  function prepare(now_ = false) {
    if (ready || failed) return;
    if (now_) urgent = true;
    if (!reading) { try { reading = entries()[Symbol.iterator](); } catch (e) { fail(e); return; } }
    later();
  }
  function fail(e) {
    failed = true; reading = null;
    view.console?.warn?.('Search names unavailable', e);
    if (clean(box.value)) say(WORDS.failed, {visible: true, retry: true});
  }

  /* ---- what the list says ---- */
  function say(text, {visible = false, retry = false} = {}) {
    status.classList.toggle('is-quiet', !visible);
    status.textContent = text;
    if (retry) {
      const again = doc.createElement('button');
      again.type = 'button'; again.className = 'find-retry'; again.textContent = WORDS.retry;
      again.onclick = () => { failed = false; say(WORDS.preparing, {visible: true}); prepare(true); box.focus(); };
      status.append(' ', again);
    }
  }
  function show(yes) {
    open = yes;
    list.hidden = !yes;
    box.setAttribute('aria-expanded', String(yes));
    if (!yes) { foot.hidden = true; setActive(-1); }
  }
  /**
   * The list ends above the bottom of what is on screen — the window, or what an on-screen keyboard leaves of it — and
   * scrolls inside itself beyond that; three rows at least.
   */
  function fit() {
    if (!open || list.hidden) return;
    const vv = view.visualViewport;
    const bottom = vv ? vv.offsetTop + vv.height : view.innerHeight;
    const tail = foot.hidden ? 0 : foot.getBoundingClientRect().height + 4;
    list.style.maxHeight = `${Math.max(140, Math.floor(bottom - list.getBoundingClientRect().top - tail - 12))}px`;
  }
  function close({quiet = true} = {}) {
    job = null; view.clearTimeout(timer);
    show(false);
    if (quiet) say('');
  }

  const optionHTML = (cls, name, noteHTML, attrs = '') => {
    const i = options.length;
    return `<div class="find-option${cls ? ` ${cls}` : ''}" role="option" id="find-o-${i}" aria-selected="false" data-i="${i}"${attrs}>${name}${noteHTML ? `<span class="find-note">${noteHTML}</span>` : ''}</div>`;
  };
  function entryHTML(item) {
    // The name that was found: the one the search names, else the one that holds what was typed (read on the other
    // keyboard layout for an entry found that way).
    const found = item.matched || nameHolding(item.entry, item.step === STEP.layout ? result.layout : shownFor);
    const {name, thai, also} = rowNames(item.entry, found, lang);
    const where = note ? note(item.entry) : '';
    const parts = [];
    if (also) parts.push(`<span class="find-also" translate="no">${esc(also)}</span>`);
    // Each part of the line is an element of its own, so a dictionary can read a word by where it stands.
    for (const part of String(where).split(' · ')) if (part.trim()) parts.push(`<span class="find-where">${esc(part.trim())}</span>`);
    if (item.show === 'spelling') parts.push(`<span class="find-tag">${esc(WORDS.spelling)}</span>`);
    const html = optionHTML('', `<span class="find-name" translate="no"${thai ? ' lang="th"' : ''}>${esc(name)}</span>`, parts.join('<span class="find-sep" aria-hidden="true"> · </span>'));
    options.push({type: 'entry', item});
    return html;
  }

  function draw() {
    if (!result) return;
    // Still looking and nothing yet: what is on screen stays.
    if (!done && !result.total) return;
    const typed = shownFor.trim();
    const plan = planRows(result, {limit, rows: done ? kept : 0});
    options = [];
    let html = '', heading = 0;
    for (const g of plan.groups) {
      const body = g.items.map(entryHTML).join('');
      if (g.kind === 'sure') { html += body; continue; }
      const id = `find-g-${heading++}`;
      const words = g.kind === 'layout' ? WORDS.layout(result.layout, /[A-Za-z]/.test(typed)) : WORDS.near;
      html += `<div class="find-group" role="group" aria-labelledby="${id}"><div class="find-heading" id="${id}" role="presentation">${esc(words)}</div>${body}</div>`;
    }
    if (plan.more) {
      html += optionHTML('find-more', `<span class="find-name">${esc(WORDS.more)}</span>`, `<span class="find-where">${esc(WORDS.left(plan.more))}</span>`);
      options.push({type: 'more'});
    }
    if (plan.filter) {
      html += optionHTML('find-filter', `<span class="find-name">${esc(WORDS.filter(typed))}</span>`, `<span class="find-where">${esc(`${num(plan.filter)} ${keptUnit || unit}`.trim())}</span>`);
      options.push({type: 'filter', text: typed});
    }
    list.innerHTML = html;
    const nothing = !result.total, guessed = !result.sure && result.total > 0;
    say(nothing || guessed ? WORDS.none(typed) : WORDS.count(result.total), {visible: nothing || guessed});
    const tail = nothing && !plan.filter ? hint : plan.capped ? WORDS.narrow : '';
    foot.textContent = tail; foot.hidden = !tail;
    show(options.length > 0 || Boolean(tail));
    list.hidden = !options.length;
    // Marked ahead only when one entry alone has the very name typed, and the reader has not moved yet.
    const ahead = done && result.preselect ? options.findIndex(o => o.type === 'entry' && o.item.entry === result.preselect) : -1;
    const keep = moved && active >= 0 && active < options.length;
    setActive(keep ? active : ahead, {auto: !keep});
    fit();
  }

  function setActive(i, {auto = false} = {}) {
    const before = list.querySelector('.is-active');
    if (before) { before.classList.remove('is-active'); before.setAttribute('aria-selected', 'false'); }
    active = i >= 0 && i < options.length ? i : -1;
    if (!auto) moved = active >= 0;
    const el = active >= 0 ? list.querySelector(`#find-o-${active}`) : null;
    if (el) { el.classList.add('is-active'); el.setAttribute('aria-selected', 'true'); box.setAttribute('aria-activedescendant', el.id); if (!auto) el.scrollIntoView?.({block: 'nearest'}); }
    else box.removeAttribute('aria-activedescendant');
  }

  /* ---- looking ---- */
  function run() {
    const raw = box.value;
    if (!clean(raw)) return;
    let where = {};
    try { where = scope?.() || {}; } catch { where = {}; }
    const mine = job = index.begin(raw, where);
    shown = -1; done = false; kept = null; asked = raw;
    const pump = () => {
      if (job !== mine) return;
      const finished = mine.step(8);
      if (finished) { done = true; kept = count(raw.trim()); }
      if (finished || mine.version !== shown) { shown = mine.version; result = mine.result; shownFor = raw; draw(); }
      if (!finished) view.setTimeout(pump, 0);
    };
    pump();
  }

  /** Finish the search for what is in the box now, at once (Enter must not depend on how fast it was pressed). */
  function settle() {
    view.clearTimeout(timer);
    const raw = box.value;
    if (!ready || !clean(raw) || (done && asked === raw)) return;
    let where = {};
    try { where = scope?.() || {}; } catch { where = {}; }
    job = null;
    result = index.search(raw, where); asked = raw; done = true; shownFor = raw;
    kept = count(raw.trim());
    draw();
  }

  function onInput() {
    view.clearTimeout(timer);
    // A search for what stood in the box before is of no use now: it stops. What is on screen stays, with the
    // text it was for, until the next answer.
    job = null;
    limit = PAGE; moved = false; active = -1;
    if (!clean(box.value)) {
      close();
      result = null;
      // An emptied box lifts the text filter it showed.
      if (applied) filter('');
      return;
    }
    if (failed) { say(WORDS.failed, {visible: true, retry: true}); return; }
    if (!ready) { prepare(true); say(WORDS.preparing, {visible: true}); return; }
    timer = view.setTimeout(run, 40);
  }

  /** Apply words as the demo's text filter (or lift it with ''). The demo's own listener does the rest. */
  function filter(text) {
    const words = String(text ?? '').trim();
    close();
    // Words chosen keep rows of the whole page, as the list counted them (lifting them changes nothing else).
    if (words) makeWay('search', words);
    input.value = words; applied = words; box.value = words;
    input.dispatchEvent(new view.Event('input', {bubbles: true}));
  }

  function choose(i) {
    const o = options[i];
    if (!o) return;
    if (o.type === 'more') { limit += MORE; const first = options.filter(x => x.type === 'entry').length; draw(); setActive(Math.min(first, options.length - 1)); return; }
    // The last row applies the words it names.
    if (o.type === 'filter') { filter(o.text); leave(); return; }
    const entry = o.item.entry;
    close();
    box.value = ''; result = null;
    // The text was a name to find, not words to keep rows by.
    wordsLifted = Boolean(input.value);
    if (input.value) input.value = '';
    applied = '';
    try { pick(entry, o.item); } finally { wordsLifted = false; }
    leave();
  }
  /** On a touch screen the keyboard steps aside once a choice is made. */
  function leave() { if (view.matchMedia?.('(pointer: coarse)').matches) box.blur(); }

  function onKey(e) {
    if (e.isComposing || e.keyCode === 229) return;
    const n = options.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!n) return;
      e.preventDefault();
      if (!open) { show(true); list.hidden = false; fit(); }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(active < 0 ? (step > 0 ? 0 : n - 1) : (active + step + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const typed = box.value.trim();
      if (!clean(typed)) return;
      settle();
      if (open && active >= 0) { choose(active); return; }
      // Nothing chosen: the words keep rows, as the box always did. When they keep none, the first name found as
      // typed is marked and Enter again opens it — a row is never opened unmarked, and a guess is never marked for
      // the reader (the brief's decision: a row is chosen ahead only when one place alone has the very name).
      let n0 = kept;
      if (n0 == null || !done || asked !== box.value) n0 = rows ? count(typed) : 1;
      if (n0 > 0 || !rows) { filter(typed); leave(); return; }
      const first = options.findIndex(o => o.type === 'entry' && o.item.show !== 'near');
      if (done && asked === box.value && first >= 0) { if (!open) { show(true); list.hidden = false; fit(); } setActive(first); }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); show(false); }
      else if (box.value) { e.preventDefault(); box.value = ''; onInput(); }
    }
  }

  box.addEventListener('input', onInput);
  box.addEventListener('keydown', onKey);
  const phone = () => Boolean(view.matchMedia?.('(max-width: 760px) and (orientation: portrait)').matches);
  box.addEventListener('focus', () => {
    prepare();
    // While a name is typed on a phone the panel stands tall and the box comes to its top (navigation.css), so the
    // list has room above the keyboard.
    doc.documentElement.classList.add('find-typing');
    try { onFocus?.(); } catch { /* the list works without it */ }
    if (clean(box.value) && box.value.trim() !== applied) { if (result && options.length) { show(true); list.hidden = false; } else onInput(); }
    view.requestAnimationFrame?.(() => { if (phone()) box.scrollIntoView?.({block: 'start'}); fit(); });
  });
  view.visualViewport?.addEventListener('resize', fit);
  view.visualViewport?.addEventListener('scroll', fit);
  view.addEventListener('resize', fit);
  box.addEventListener('blur', () => view.setTimeout(() => {
    if (doc.activeElement === box || wrap.contains(doc.activeElement)) return;
    show(false);
    doc.documentElement.classList.remove('find-typing');
  }, 0));
  // A press on the list must not take the focus from the box (the list would close before the click).
  list.addEventListener('mousedown', e => e.preventDefault());
  list.addEventListener('click', e => { const el = e.target.closest?.('.find-option'); if (el && list.contains(el)) choose(Number(el.dataset.i)); });
  list.addEventListener('pointermove', e => { const el = e.target.closest?.('.find-option'); if (el && Number(el.dataset.i) !== active && e.pointerType === 'mouse') setActive(Number(el.dataset.i), {auto: false}); });
  input.form?.addEventListener('submit', e => e.preventDefault());
  input.form?.addEventListener('reset', () => { close(); result = null; });

  if (ahead) view.addEventListener('citymeter:map-ready', () => { if (mapBudget(view).level === 'full') view.setTimeout(() => prepare(), 1200); }, {once: true});

  /**
   * A filter chosen by name is about to be set (`field` takes `id`; 'search' for words): the place being looked at is
   * left and the other filters that would leave the choice no row are lifted first. The demo then sets the filter and
   * draws once, as it always did.
   */
  function makeWay(field, id) {
    if (!filters) return [];
    let lifted = [];
    try {
      filters.leave?.();
      lifted = filtersToLift({values: {...filters.values(), search: ''}, field, id, fields: filters.fields, context: filters.context || ['province'], count: filters.count});
      for (const f of lifted) liftField(f);
    } catch (e) { view.console?.warn?.('Filters kept as they were', e); lifted = []; }
    return lifted;
  }
  function liftField(f) {
    if (filters.lift) filters.lift(f);
    else { const el = doc.getElementById(f); if (el) el.value = ''; }
  }

  /**
   * An item chosen by name is about to be opened: the filters it does not pass are lifted first. → the fields
   * lifted, with 'search' when words were lifted for this choice; when the answer is not empty the demo draws again
   * before it opens the item (its scope was worked out with them).
   */
  function makeWayFor(passes) {
    const lifted = wordsLifted ? ['search'] : [];
    wordsLifted = false;
    if (!filters) return lifted;
    try {
      const fields = [...filters.fields, ...(filters.context || ['province'])];
      for (const f of filtersAgainst({values: {...filters.values(), search: ''}, fields, passes})) { liftField(f); lifted.push(f); }
    } catch (e) { view.console?.warn?.('Filters kept as they were', e); }
    return lifted;
  }

  /** The demo changed its text filter itself (a chip closed, a link opened, the filters cleared): the box follows. */
  function sync() {
    // A demo whose placeholder follows a mode writes it on its own input.
    if (input.placeholder && box.placeholder !== input.placeholder) box.placeholder = input.placeholder;
    if (input.value === applied) return;
    if (doc.activeElement !== box || box.value.trim() === applied) { box.value = input.value; if (open) close(); }
    applied = input.value;
  }

  return {sync, filter, makeWay, makeWayFor, prepare: () => prepare(), close: () => close(), box,
    get state() { return {ready, failed, open, active, options: options.length, total: result?.total ?? 0}; }};
}
