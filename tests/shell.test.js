/**
 * citymeter-shell — the shared code of the CityMETER demos (js/shell/): navigation (0.1.0), the map modules (0.2.0),
 * the header (0.3.0), the subdistrict, local-unit and locale levels (0.4.0, 0.4.1), a zone a dataset defines itself
 * (0.4.2), networks (0.4.3) and the page language (0.5.0). This file is the same in every repository that carries the shell: the files must match
 * js/shell/manifest.json byte for byte (and so must the files it lists under `shared`), and the navigation modules
 * must keep the contract of demo-platform-review §5.2–5.3 (address grammar, history, breadcrumb, tab title). The map
 * modules keep their own tests in each repository (tests/camera.test.js, tests/terrain.test.js …); the launch card
 * and the picker are walked in a browser before each release.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {parseAt, formatAt, clampAt, districtOf, productionHref} from '../js/shell/area-path.js';
import {splitRef, joinRef, serialize, createCodec, createNavigator, LEVEL_KEYS} from '../js/shell/url.js';
import {buildBreadcrumb, renderBreadcrumb, breadcrumbText, deepestHref} from '../js/shell/breadcrumb.js';
import {pageTitle, TITLE_MAX} from '../js/shell/title.js';
import {terrainChips} from '../js/shell/terrain.js';
import {DEMOS, GROUPS, demoUrl, hubUrl} from '../js/shell/datasets.js';
import {demoHref, currentDemo, pickerList, placeLevel, hubHref, languageLink} from '../js/shell/header.js';
import {pageLanguage, languageHref, translate, registerDictionary, registerNames, keepThai, englishDate, LANG} from '../js/shell/i18n.js';

const SHELL = new URL('../js/shell/', import.meta.url);
const sha256 = buf => createHash('sha256').update(buf).digest('hex');

test('the shell files match their manifest byte for byte, and the manifest lists every shell module', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', SHELL), 'utf8'));
  assert.equal(manifest.name, 'citymeter-shell');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  const modules = readdirSync(SHELL).filter(f => f.endsWith('.js')).map(f => `js/shell/${f}`).sort();
  assert.deepEqual(Object.keys(manifest.files).sort(), modules);
  for (const [path, hash] of Object.entries({...manifest.files, ...(manifest.shared || {})})) {
    assert.equal(sha256(readFileSync(new URL(`../${path}`, import.meta.url))), hash, `${path} differs from citymeter-shell ${manifest.version}`);
  }
});

test('area paths are the production path after /v3/citymeter/, letter for letter', () => {
  assert.deepEqual(parseAt('BKK'), {province: 'BKK', kind: 'P', code: ''});
  assert.deepEqual(parseAt('BKK/D/1039'), {province: 'BKK', kind: 'D', code: '1039'});
  assert.deepEqual(parseAt('BKK/S/103902'), {province: 'BKK', kind: 'S', code: '103902'});
  assert.deepEqual(parseAt('CBI/M/03200701'), {province: 'CBI', kind: 'M', code: '03200701'});
  assert.equal(parseAt('BKK/L/a29ec31e-3a36-4ab7-9670-7cef38873c80').kind, 'L');
  for (const bad of ['', 'bkk', 'BKK/D/103', 'BKK/D/10390', 'BKK/X/1039', 'BKK/D', 'BKK/D/1039/x', null]) assert.equal(parseAt(bad), null, String(bad));
  assert.equal(formatAt(parseAt('BKK/S/103902')), 'BKK/S/103902');
  assert.equal(formatAt({province: 'BKK'}), 'BKK');
  assert.equal(formatAt({province: 'BKK', kind: 'D', code: 'x'}), '');
  assert.equal(districtOf(parseAt('BKK/S/103902')), '1039');
  // A dataset opens the deepest level it supports.
  assert.deepEqual(clampAt(parseAt('BKK/S/103902'), ['P', 'D']), {province: 'BKK', kind: 'D', code: '1039'});
  assert.deepEqual(clampAt(parseAt('CBI/M/03200701'), ['P', 'D']), {province: 'CBI', kind: 'P', code: ''});
  assert.deepEqual(clampAt(parseAt('BKK/S/103902'), ['P', 'D', 'S']), parseAt('BKK/S/103902'));
  assert.equal(productionHref('hotel'), 'https://landometer.com/v3/citymeter?d=hotel');
  assert.equal(productionHref('hotel', parseAt('BKK/D/1039')), 'https://landometer.com/v3/citymeter/BKK/D/1039?d=hotel');
  assert.equal(productionHref('governmentOfficer', {province: 'PKT', kind: 'P'}), 'https://landometer.com/v3/citymeter/PKT?d=governmentOfficer');
});

test('e and n split at the first colon; the id is kept verbatim', () => {
  assert.deepEqual(splitRef('station:CONSTCAT:MRT_ORANGE:OR02'), {kind: 'station', id: 'CONSTCAT:MRT_ORANGE:OR02'});
  assert.deepEqual(splitRef('hotel:HT-3e3f6a0b'), {kind: 'hotel', id: 'HT-3e3f6a0b'});
  for (const bad of ['', 'hotel', 'hotel:', ':x', 'Hotel:x', null]) assert.equal(splitRef(bad), null, String(bad));
  assert.equal(joinRef('company', 'HGRP-accor'), 'company:HGRP-accor');
});

test('the canonical address keeps the shared keys in order and "/", ":" and "," readable', () => {
  const p = new URLSearchParams([['view3d', '0'], ['f.group', 'resort'], ['e', 'station:CONSTCAT:MRT_ORANGE:OR02'], ['at', 'BKK/D/1039'], ['d', 'hotel'], ['focus', '1039,1033'], ['m', 'count'], ['f.search', 'ภูเขา ทะเล']]);
  assert.equal(serialize(p), 'd=hotel&at=BKK/D/1039&e=station:CONSTCAT:MRT_ORANGE:OR02&m=count&f.group=resort&f.search=%E0%B8%A0%E0%B8%B9%E0%B9%80%E0%B8%82%E0%B8%B2%20%E0%B8%97%E0%B8%B0%E0%B9%80%E0%B8%A5&focus=1039,1033&view3d=0');
  assert.equal(new URLSearchParams(serialize(p)).get('f.search'), 'ภูเขา ทะเล');
});

const PROVINCES = {'10': 'BKK', '83': 'PKT'};
const codec = () => createCodec({
  dataset: 'hotel', levels: ['P', 'D'], place: {province: 'province', D: 'area'},
  items: {hotel: 'hotel', station: 'station'}, filters: ['search', 'group', 'province'],
  provinceOf: code => PROVINCES[code.slice(0, 2)] || '',
});

test('the codec writes a dataset\'s own parameters in the shared grammar and reads them back', () => {
  const c = codec();
  const own = new URLSearchParams([['search', 'resort'], ['province', 'BKK'], ['metric', 'count'], ['area', '1039'], ['areas', 'all'], ['view', 'mix'], ['hotel', 'HT-1'], ['view3d', '0']]);
  const shared = c.encode(own);
  assert.equal(serialize(shared), 'd=hotel&at=BKK/D/1039&e=hotel:HT-1&m=count&f.province=BKK&f.search=resort&focus=all&view=mix&v3d=0');
  const back = c.decode(serialize(shared));
  assert.equal(back.legacy, false);
  for (const k of ['search', 'province', 'metric', 'area', 'areas', 'view', 'hotel', 'view3d']) assert.equal(back.own.get(k), own.get(k), k);
  // A province alone is the area; a district opened from the whole country carries no province filter.
  assert.equal(serialize(c.encode(new URLSearchParams('province=PKT'))), 'd=hotel&at=PKT');
  assert.equal(serialize(c.encode(new URLSearchParams('area=8301'))), 'd=hotel&at=PKT/D/8301');
  assert.equal(c.decode('at=PKT/D/8301').own.get('province'), null);
  // A district the address cannot spell is kept as it is, never dropped.
  assert.equal(serialize(c.encode(new URLSearchParams('area=9999'))), 'd=hotel&area=9999');
});

test('old links keep working, the shared keys win, and deeper or unknown places fall back', () => {
  const c = codec();
  const old = c.decode('?province=BKK&area=1039&hotel=HT-1&metric=count&view3d=0');
  assert.equal(old.legacy, true);
  assert.equal(serialize(c.encode(old.own)), 'd=hotel&at=BKK/D/1039&e=hotel:HT-1&m=count&f.province=BKK&v3d=0');
  assert.equal(c.decode('at=BKK/D/1039&area=1001').own.get('area'), '1039');
  assert.equal(c.decode('at=BKK/S/103902').own.get('area'), '1039');
  assert.equal(c.decode('at=CBI/M/03200701').own.get('province'), 'CBI');
  assert.equal(c.decode('e=shop:X').own.get('hotel'), null);
  assert.equal(c.decode('e=station:CONSTCAT:MRT_ORANGE:OR02').own.get('station'), 'CONSTCAT:MRT_ORANGE:OR02');
  assert.equal(c.decode('d=hotel&lang=en').legacy, false);
});

function fakeWindow(search = '') {
  const listeners = {}, entries = [{state: null, url: `/hotel/${search}`}];
  let index = 0;
  const searchOf = url => { const q = url.indexOf('?'); return q >= 0 ? url.slice(q) : ''; };
  const win = {
    location: {pathname: '/hotel/', hash: '', search},
    history: {
      get state() { return entries[index].state; },
      get length() { return entries.length; },
      pushState(state, _t, url) { entries.splice(index + 1); entries.push({state, url}); index += 1; win.location.search = searchOf(url); },
      replaceState(state, _t, url) { entries[index] = {state, url}; win.location.search = searchOf(url); },
      back() { index -= 1; win.location.search = searchOf(entries[index].url); listeners.popstate?.({state: entries[index].state}); },
    },
    addEventListener(type, fn) { listeners[type] = fn; },
  };
  return {win, entries: () => entries.map(e => e.url), index: () => index};
}

test('a change of d, at, e or n pushes a history entry; anything else replaces it; back restores the level', () => {
  assert.deepEqual([...LEVEL_KEYS], ['d', 'at', 'e', 'n']);
  const w = fakeWindow('?area=1039&lang=en');
  const popped = [];
  const nav = createNavigator(codec(), {win: w.win, onPop: own => popped.push(own.get('area'))});
  assert.equal(nav.read().get('area'), '1039');
  assert.equal(nav.commit(nav.read()), false, 'the first commit replaces (rewrites the old link)');
  assert.deepEqual(w.entries(), ['/hotel/?d=hotel&at=BKK/D/1039&lang=en']);
  assert.equal(nav.commit(new URLSearchParams('area=1039&metric=count')), false, 'a measure change replaces');
  assert.equal(nav.commit(new URLSearchParams('area=1039&metric=count&hotel=HT-1')), true, 'opening an item pushes');
  assert.equal(nav.commit(new URLSearchParams('area=1039&metric=count&hotel=HT-1')), false, 'the same address is not written twice');
  assert.equal(w.entries().length, 2);
  assert.equal(nav.canGoBack(), true);
  nav.back();
  assert.deepEqual(popped, ['1039']);
  assert.equal(nav.canGoBack(), false);
  assert.match(w.entries()[0], /lang=en$/);
});

test('the tab title is [page] · CityMETER, at most 60 characters, cut at a character boundary', () => {
  assert.equal(pageTitle('ห้องพัก เขตวัฒนา'), 'ห้องพัก เขตวัฒนา · CityMETER');
  assert.equal(pageTitle(''), 'CityMETER');
  const page = 'โรงแรมแกรนด์ไฮแอท เอราวัณ กรุงเทพ ราชประสงค์ ประตูน้ำ สุขุมวิท ถนนเพลินจิตตะวันออก';
  const long = pageTitle(page);
  assert.ok(long.length <= TITLE_MAX, `${long.length}`);
  assert.ok(long.endsWith('… · CityMETER'));
  const cut = long.slice(0, long.length - '… · CityMETER'.length);
  assert.ok(page.startsWith(cut));
  assert.doesNotMatch(page.slice(cut.length, cut.length + 1), /[ัิ-ฺ็-๎]/u, 'a vowel or tone mark is never cut from its letter');
  for (const p of ['a'.repeat(47), 'a'.repeat(48), 'a'.repeat(200)]) assert.ok(pageTitle(p).length <= TITLE_MAX, `${p.length}`);
});

test('the breadcrumb is the administrative path with production deep links; items are never crumbs', () => {
  const ctx = {dataset: 'hotel', provinceByCode: c => ({BKK: {code: 'BKK', th: 'กรุงเทพมหานคร'}}[c] || null), areaWord: c => (c === 'BKK' ? 'เขต' : 'อำเภอ')};
  const crumbs = buildBreadcrumb({province: 'BKK', area: {id: '1039', name: 'วัฒนา', province: 'BKK'}}, ctx);
  assert.equal(breadcrumbText(crumbs), 'ประเทศไทย › กรุงเทพมหานคร › เขตวัฒนา');
  assert.equal(crumbs[2].href, 'https://landometer.com/v3/citymeter/BKK/D/1039?d=hotel');
  assert.equal(crumbs.at(-1).current, true);
  assert.equal(deepestHref(crumbs), 'https://landometer.com/v3/citymeter/BKK/D/1039?d=hotel');
  assert.equal(breadcrumbText(buildBreadcrumb({}, ctx)), 'ประเทศไทย');
  const html = renderBreadcrumb(crumbs);
  assert.ok(html.includes('aria-current="location"'));
  assert.ok(html.includes('data-action="crumb-province"'));
  assert.ok(!html.includes('crumb-more'), 'three levels never fold');
});

test('subdistricts and local administrative units travel in `at` for the demos that open them (0.4.0)', () => {
  const s = createCodec({
    dataset: 'pharmacy', levels: ['P', 'D', 'S'], place: {province: 'province', D: 'district', S: 'area'},
    items: {store: 'store'}, filters: ['search', 'province'], provinceOf: code => PROVINCES[code.slice(0, 2)] || '',
  });
  assert.equal(serialize(s.encode(new URLSearchParams('area=103902&store=PHO-1'))), 'd=pharmacy&at=BKK/S/103902&e=store:PHO-1');
  assert.equal(s.decode('at=BKK/S/103902').own.get('area'), '103902');
  assert.equal(s.decode('at=BKK/D/1039').own.get('district'), '1039');
  const old = s.decode('?district=1039&view3d=0');
  assert.equal(old.legacy, true);
  assert.equal(serialize(s.encode(old.own)), 'd=pharmacy&at=BKK/D/1039&v3d=0');
  const m = createCodec({
    dataset: 'grocery', levels: ['P', 'D', 'M'], place: {province: 'province', D: 'district', M: 'unit'},
    provinceOf: (code, kind) => (kind === 'M' ? {'03200701': 'CBI'}[code] : PROVINCES[code.slice(0, 2)]) || '',
  });
  assert.equal(serialize(m.encode(new URLSearchParams('unit=03200701'))), 'd=grocery&at=CBI/M/03200701');
  assert.equal(m.decode('at=CBI/M/03200701').own.get('unit'), '03200701');
  assert.equal(serialize(m.encode(new URLSearchParams('unit=9'))), 'd=grocery&unit=9', 'a unit the address cannot spell is kept');
  assert.equal(codec().decode('at=CBI/M/03200701').own.get('area'), null, 'a demo without the level opens the province');
  // One own parameter for both a local unit and a locale (Grocery, 0.4.1): the key's kind decides the path.
  const LOC = 'a29ec31e-3a36-4ab7-9670-7cef38873c80';
  const g = createCodec({dataset: 'grocery', levels: ['P', 'D', 'M', 'L'], place: {province: 'province', D: 'district', M: 'unit', L: 'unit'},
    provinceOf: (code, kind) => ({M: {'03200701': 'CBI'}, L: {[LOC]: 'BKK'}, D: {'2001': 'CBI'}}[kind] || {})[code] || ''});
  assert.equal(serialize(g.encode(new URLSearchParams('unit=03200701'))), 'd=grocery&at=CBI/M/03200701');
  assert.equal(serialize(g.encode(new URLSearchParams(`unit=${LOC}`))), `d=grocery&at=BKK/L/${LOC}`);
  assert.equal(g.decode(`at=BKK/L/${LOC}`).own.get('unit'), LOC);
  assert.equal(g.decode('at=CBI/M/03200701').own.get('unit'), '03200701');
  assert.equal(serialize(g.encode(new URLSearchParams('unit=zz'))), 'd=grocery&unit=zz', 'an unknown key is kept once');
  const r = createCodec({dataset: 'restaurant', levels: ['P', 'D', 'S'], place: {province: 'province', D: 'district', S: 'area'},
    items: {store: 'store', place: 'venue'}, networks: {company: 'company'}, provinceOf: code => PROVINCES[code.slice(0, 2)] || ''});
  assert.equal(serialize(r.encode(new URLSearchParams('company=RCO-minor-food&area=103902'))), 'd=restaurant&at=BKK/S/103902&n=company:RCO-minor-food');
  assert.equal(r.decode('n=company:RCO-minor-food').own.get('company'), 'RCO-minor-food');
  assert.equal(r.decode('n=line:MRT_BLUE').own.get('company'), null, 'a network kind the dataset lacks is ignored');
});

test('the breadcrumb reaches the subdistrict, and a local unit follows the province (0.4.0)', () => {
  const ctx = {
    dataset: '', provinceByCode: c => ({BKK: {code: 'BKK', th: 'กรุงเทพมหานคร'}, CBI: {code: 'CBI', th: 'ชลบุรี'}}[c] || null),
    areaWord: c => (c === 'BKK' ? 'เขต' : 'อำเภอ'), subWord: c => (c === 'BKK' ? 'แขวง' : 'ตำบล'),
  };
  const sub = {id: '103902', name: 'คลองตันเหนือ', province: 'BKK', district: '1039', districtName: 'วัฒนา'};
  const crumbs = buildBreadcrumb({sub}, ctx);
  assert.equal(breadcrumbText(crumbs), 'ประเทศไทย › กรุงเทพมหานคร › เขตวัฒนา › แขวงคลองตันเหนือ');
  assert.deepEqual(crumbs.map(c => c.action), ['crumb-country', 'crumb-province', 'crumb-area', 'crumb-sub']);
  assert.equal(crumbs[2].href, 'https://landometer.com/v3/citymeter/BKK/D/1039');
  assert.equal(deepestHref(crumbs), 'https://landometer.com/v3/citymeter/BKK/S/103902', 'a dataset production lacks: the place alone');
  assert.ok(renderBreadcrumb(crumbs).includes('crumb-ellipsis'), 'four levels fold on narrow screens');
  const unit = buildBreadcrumb({unit: {id: '03200701', name: 'เทศบาลนครแหลมฉบัง', province: 'CBI'}}, {...ctx, dataset: 'grocery'});
  assert.equal(breadcrumbText(unit), 'ประเทศไทย › ชลบุรี › เทศบาลนครแหลมฉบัง');
  assert.equal(unit.at(-1).href, 'https://landometer.com/v3/citymeter/CBI/M/03200701?d=grocery');
  assert.equal(unit.at(-1).action, 'crumb-unit');
  const loc = buildBreadcrumb({unit: {id: 'a29ec31e-3a36-4ab7-9670-7cef38873c80', name: 'อโศก', province: 'BKK', kind: 'L'}}, {...ctx, dataset: 'grocery'});
  assert.equal(breadcrumbText(loc), 'ประเทศไทย › กรุงเทพมหานคร › อโศก', 'a locale follows the province too');
  assert.equal(loc.at(-1).href, 'https://landometer.com/v3/citymeter/BKK/L/a29ec31e-3a36-4ab7-9670-7cef38873c80?d=grocery');
  const site = buildBreadcrumb({site: {id: 'RV-1', name: 'เซ็นทรัลเวิลด์', province: 'BKK'}}, ctx);
  assert.equal(breadcrumbText(site), 'ประเทศไทย › กรุงเทพมหานคร › เซ็นทรัลเวิลด์');
  assert.equal(site.at(-1).href, undefined, 'a site has no production page');
});

test('terrain: the sea tooltip names what the demo passes as subject, and says only “จุด…” without one (0.2.0)', () => {
  const facts = {elevation: 2, relief: 0, above: 0, position: 'level', seaBand: 0, treeShare: null};
  const sea = opts => terrainChips(facts, opts).find(c => c.kind === 'sea').title;
  assert.equal(sea({}), 'จุดอยู่บนพื้นน้ำทะเลในแผนที่');
  assert.equal(sea({subject: 'ที่พัก'}), 'จุดของที่พักอยู่บนพื้นน้ำทะเลในแผนที่');
  assert.deepEqual(terrainChips(null), [], 'no facts: no chips, nothing shown as 0');
});

test('header: the demo list is one entry per demo, grouped Land · Location · Living (0.3.0)', () => {
  assert.deepEqual(GROUPS, ['Land', 'Location', 'Living']);
  assert.equal(new Set(DEMOS.map(d => d.path)).size, DEMOS.length);
  for (const d of DEMOS) {
    assert.ok(GROUPS.includes(d.group), d.path);
    assert.match(demoUrl(d), /^https:\/\/montri-th\.github\.io\/[a-z]+\/$/);
  }
  assert.ok(DEMOS.filter(d => d.at).length >= 6, 'the six Hotel-family demos open ?at=');
});

test('header: a demo on the shell opens the same area, the others their start page (0.3.0)', () => {
  const hotel = DEMOS.find(d => d.path === 'hotel'), later = {path: 'later', name: 'Later', group: 'Living', at: false};
  assert.equal(demoHref(hotel, '?d=office&at=BKK/D/1039&e=office:OFF-1'), 'https://montri-th.github.io/hotel/?at=BKK/D/1039');
  assert.equal(demoHref(hotel, '?d=office'), 'https://montri-th.github.io/hotel/');
  assert.equal(demoHref(later, '?at=BKK/D/1039'), 'https://montri-th.github.io/later/', 'a demo not on the shell opens its start page');
  assert.equal(demoHref(DEMOS.find(d => d.path === 'pharmacy'), '?at=BKK/S/103902'), 'https://montri-th.github.io/pharmacy/?at=BKK/S/103902');
  assert.equal(demoHref(DEMOS.find(d => d.path === 'restaurant'), '?at=BKK/S/103902'), 'https://montri-th.github.io/restaurant/?at=BKK/S/103902');
  assert.equal(demoHref(DEMOS.find(d => d.path === 'grocery'), '?at=CBI/M/03200701'), 'https://montri-th.github.io/grocery/?at=CBI/M/03200701');
  assert.equal(currentDemo('/governmentoffice/')?.path, 'governmentoffice');
  assert.equal(currentDemo('/hotelx/'), null);
  const html = pickerList({pathname: '/hotel/', search: '?d=hotel&at=BKK/D/1039', place: 'เขตวัฒนา'});
  assert.match(html, /เปิดเขตวัฒนาในชุดข้อมูลอื่น/);
  assert.match(html, /href="https:\/\/montri-th\.github\.io\/hotel\/\?at=BKK\/D\/1039" aria-current="page"/);
  assert.match(html, /href="https:\/\/montri-th\.github\.io\/school\/\?at=BKK\/D\/1039"><span>School<\/span><\/a>/);
  assert.match(html, /href="https:\/\/montri-th\.github\.io\/transit\/\?at=BKK\/D\/1039"><span>Transit<\/span><\/a>/, 'every demo is on the shell (0.4.3)');
  assert.doesNotMatch(html, /dataset-note/);
  assert.equal((html.match(/aria-current/g) || []).length, 1);
  assert.doesNotMatch(html, /role="menu/, 'a disclosure of links, never menu roles (LDS NAV-02)');
  assert.match(pickerList({pathname: '/hotel/'}), /ชุดข้อมูลอื่นของ CityMETER/);
});

test('a zone a dataset defines itself stays a filter, and opening it adds a history entry (0.4.2)', () => {
  const zones = () => createCodec({
    dataset: 'luxuryBrands', levels: ['P'], place: {province: 'province'}, items: {store: 'store', place: 'venue'},
    filters: ['search', 'neighborhood', 'province'], levelFilters: ['neighborhood', 'nowhere'],
    rename: {areas: 'focus', view: 'view', view3d: 'v3d', cam: 'cam'},
  });
  const c = zones();
  assert.deepEqual(c.levelKeys, ['f.neighborhood'], 'only a declared filter can open a level');
  assert.equal(serialize(c.encode(new URLSearchParams('province=BKK&neighborhood=siam'))), 'd=luxuryBrands&at=BKK&f.neighborhood=siam');
  assert.equal(c.decode('at=BKK&f.neighborhood=siam').own.get('neighborhood'), 'siam');
  assert.equal(c.decode('at=BKK/L/a29ec31e-3a36-4ab7-9670-7cef38873c80').own.get('province'), 'BKK', 'a production locale opens the province');
  assert.equal(c.decode('?neighborhood=siam&place=49b5afdc-2436-48bc-8a89-007ac5541d98').legacy, true);
  assert.equal(codec().levelKeys.length, 0);
  const w = fakeWindow('?province=BKK');
  const nav = createNavigator(c, {win: w.win});
  nav.commit(nav.read());
  assert.equal(nav.commit(new URLSearchParams('province=BKK&neighborhood=siam')), true, 'opening a zone pushes');
  assert.equal(nav.commit(new URLSearchParams('province=BKK&neighborhood=siam&search=Dior')), false, 'a search replaces');
  assert.equal(nav.commit(new URLSearchParams('province=BKK&search=Dior')), true, 'leaving the zone pushes');
  assert.deepEqual(w.entries(), ['/hotel/?d=luxuryBrands&at=BKK', '/hotel/?d=luxuryBrands&at=BKK&f.search=Dior&f.neighborhood=siam', '/hotel/?d=luxuryBrands&at=BKK&f.search=Dior']);
  // A production locale held in the dataset's own ย่าน parameter travels in `at` (Camera Shops).
  const LOC = 'a29ec31e-3a36-4ab7-9670-7cef38873c80';
  const cam = createCodec({dataset: 'cameraShops', levels: ['P', 'L'], place: {province: 'province', L: 'neighborhood'},
    items: {store: 'store', place: 'venue'}, filters: ['search', 'venue'], provinceOf: (code, kind) => (kind === 'L' && code === LOC ? 'BKK' : '')});
  assert.equal(serialize(cam.encode(new URLSearchParams(`neighborhood=${LOC}&place=49b5afdc`))), `d=cameraShops&at=BKK/L/${LOC}&e=venue:49b5afdc`);
  assert.equal(cam.decode(`at=BKK/L/${LOC}`).own.get('neighborhood'), LOC);
  assert.equal(cam.decode('at=BKK/D/1039').own.get('province'), 'BKK', 'a district link opens the province');
});

test('a zone crumb has no production link; every crumb names its level for the picker (0.4.2)', () => {
  const ctx = {dataset: '', provinceByCode: c => ({BKK: {code: 'BKK', th: 'กรุงเทพมหานคร'}}[c] || null)};
  const crumbs = buildBreadcrumb({province: 'BKK', zone: {id: 'siam', name: 'สยาม', province: 'BKK'}, site: {id: '49b5afdc', name: 'Siam Paragon', province: 'BKK'}}, ctx);
  assert.equal(breadcrumbText(crumbs), 'ประเทศไทย › กรุงเทพมหานคร › สยาม › Siam Paragon');
  assert.deepEqual(crumbs.map(c => c.action), ['crumb-country', 'crumb-province', 'crumb-zone', 'crumb-site']);
  assert.equal(crumbs[2].href, undefined, 'a zone is not a production area');
  assert.equal(deepestHref(crumbs), 'https://landometer.com/v3/citymeter/BKK');
  const zoneOnly = buildBreadcrumb({zone: {id: 'nimman', name: 'นิมมาน', province: 'BKK'}}, ctx);
  assert.deepEqual(zoneOnly.map(c => c.level), ['country', 'province', 'zone'], 'the zone gives the province');
  const html = renderBreadcrumb(crumbs);
  assert.deepEqual([...html.matchAll(/data-level="([a-z]+)"/g)].map(m => m[1]), ['country', 'province', 'zone', 'site']);
  assert.match(html, /<li class="is-collapsible" data-level="country"><button type="button" class="crumb" data-action="crumb-country" data-id="">ประเทศไทย<\/button><\/li>/);
  assert.match(html, /data-level="site"><span class="crumb is-current" aria-current="location">Siam Paragon<\/span>/);
});

test('header: the picker names the place `at` hands over, and Camera Shops and Luxury Brands are on the shell (0.4.2)', () => {
  assert.equal(placeLevel('?d=hotel&at=BKK/D/1039&e=hotel:HT-1'), 'area');
  assert.equal(placeLevel('?at=BKK/S/103902'), 'sub');
  assert.equal(placeLevel('?at=CBI/M/03200701'), 'unit');
  assert.equal(placeLevel('?at=BKK/L/a29ec31e-3a36-4ab7-9670-7cef38873c80&e=venue:x'), 'unit');
  assert.equal(placeLevel('?d=luxuryBrands&at=BKK&f.neighborhood=siam'), 'province', 'a zone is not handed over');
  assert.equal(placeLevel('?d=luxuryBrands&f.neighborhood=siam'), '');
  assert.equal(placeLevel('?at=nowhere'), '');
  for (const path of ['camera', 'luxurybrands']) assert.equal(DEMOS.find(d => d.path === path).at, true, path);
  const loc = '?at=BKK/L/a29ec31e-3a36-4ab7-9670-7cef38873c80';
  assert.equal(demoHref(DEMOS.find(d => d.path === 'camera'), loc), `https://montri-th.github.io/camera/${loc}`);
  assert.equal(demoHref(DEMOS.find(d => d.path === 'luxurybrands'), '?at=BKK&f.neighborhood=siam'), 'https://montri-th.github.io/luxurybrands/?at=BKK');
});

test('a network the reader came through gets a crumb without a production link; no registry code, no `d` (0.4.3)', () => {
  const ctx = {dataset: '', provinceByCode: c => ({BKK: {code: 'BKK', th: 'กรุงเทพมหานคร'}}[c] || null)};
  const crumbs = buildBreadcrumb({province: 'BKK', network: {id: 'BTS_SUKHUMVIT', name: 'สายสุขุมวิท'}, site: {id: 'CONSTCAT:BTS_SUKHUMVIT:E4', name: 'สถานีอโศก', province: 'BKK'}}, ctx);
  assert.equal(breadcrumbText(crumbs), 'ประเทศไทย › กรุงเทพมหานคร › สายสุขุมวิท › สถานีอโศก');
  assert.deepEqual(crumbs.map(c => c.level), ['country', 'province', 'network', 'site']);
  assert.equal(crumbs[2].action, 'crumb-network');
  assert.equal(crumbs[2].href, undefined, 'a network is not a production area');
  assert.equal(deepestHref(crumbs), 'https://landometer.com/v3/citymeter/BKK');
  const brand = buildBreadcrumb({network: {id: 'B-1', name: 'Uniqlo'}}, ctx);
  assert.deepEqual(brand.map(c => c.label), ['ประเทศไทย', 'Uniqlo'], 'a brand page: the country, then the brand');
  const none = createCodec({dataset: '', levels: ['P', 'D'], place: {province: 'province', D: 'area'}, items: {store: 'store'},
    provinceOf: code => PROVINCES[code.slice(0, 2)] || ''});
  assert.equal(serialize(none.encode(new URLSearchParams('area=1039&store=FIT-1'))), 'at=BKK/D/1039&e=store:FIT-1', 'no code in the registry: no `d`');
  assert.equal(none.decode('at=BKK/D/1039&e=store:FIT-1').own.get('store'), 'FIT-1');
  const w = fakeWindow('?area=1039');
  const nav = createNavigator(none, {win: w.win});
  nav.commit(nav.read());
  assert.equal(nav.commit(new URLSearchParams('area=1039&store=FIT-1')), true, 'opening an item still pushes');
  assert.deepEqual(w.entries(), ['/hotel/?at=BKK/D/1039', '/hotel/?at=BKK/D/1039&e=store:FIT-1']);
  for (const path of ['shoppingcenter', 'fitness', 'transit']) assert.equal(DEMOS.find(d => d.path === path).at, true, path);
});

test('language: ?lang=en as production writes it; Thai otherwise; the link keeps every parameter (0.5.0)', () => {
  assert.equal(pageLanguage('?d=office&lang=en'), 'en');
  assert.equal(pageLanguage('?d=office&lang=EN'), 'th', 'only the production value');
  assert.equal(pageLanguage(''), 'th');
  assert.equal(LANG, 'th', 'no page, no English');
  assert.equal(languageHref('/office/', '?d=office&at=BKK/D/1039&e=office:OFF-1', 'en'), '/office/?d=office&at=BKK/D/1039&e=office:OFF-1&lang=en');
  assert.equal(languageHref('/office/', '?d=office&at=BKK/D/1039&lang=en', 'th'), '/office/?d=office&at=BKK/D/1039');
  assert.equal(languageHref('/office/', '?lang=en', 'th'), '/office/');
  assert.equal(languageHref('/transit/', '?e=station:RAILCAT:BTS_SUKHUMVIT:E4', 'en'), '/transit/?e=station:RAILCAT:BTS_SUKHUMVIT:E4&lang=en', '":" stays readable');
  const th = languageLink('/office/', '?at=BKK', 'th'), en = languageLink('/office/', '?at=BKK&lang=en', 'en');
  assert.deepEqual([th.label, th.lang, th.href], ['EN', 'en', '/office/?at=BKK&lang=en']);
  assert.match(th.title, /draft/);
  assert.deepEqual([en.label, en.lang, en.href], ['ไทย', 'th', '/office/?at=BKK']);
});

test('language: dictionaries by the Thai text — exact, patterns, parts between separators; names never translated by hand (0.5.0)', () => {
  assert.equal(translate('ประเทศไทย'), 'Thailand', 'the shell words come with the shell');
  assert.equal(translate('฿850'), null, 'the baht sign and numbers need nothing');
  assert.equal(translate('English'), null);
  registerDictionary({exact: {'สำนักงาน': 'Offices', 'กำลังสร้าง': 'under construction'},
    patterns: [[/^([\d,]+) แห่ง$/, (m, t) => `${m[1]} ${t.plural(m[1], 'office', 'offices')}`]]});
  assert.equal(translate('1 แห่ง'), '1 office');
  assert.equal(translate('1,234 แห่ง'), '1,234 offices');
  assert.equal(translate('สำนักงาน · 3 แห่ง'), 'Offices · 3 offices');
  assert.equal(translate('ประเทศไทย › จังหวัดที่ไม่มี'), null, 'a part with no English leaves the whole Thai');
  assert.equal(translate('· กำลังสร้าง'), '· under construction');
  registerNames([['เขตวัฒนา', 'Watthana'], ['วัฒนา', 'Watthana'], ['ชื่อไทย', 'ยังไทย']]);
  assert.equal(translate('เขตวัฒนา · 3 แห่ง'), 'Watthana · 3 offices');
  assert.equal(translate('ชื่อไทย'), null, 'an "English" name in Thai script is not taken');
  assert.equal(translate('เปิดเขตวัฒนาในชุดข้อมูลอื่น'), 'Open Watthana in another dataset');
  keepThai(['บริษัท ตัวอย่าง จำกัด']);
  assert.equal(translate('บริษัท ตัวอย่าง จำกัด · 3 แห่ง'), 'บริษัท ตัวอย่าง จำกัด · 3 offices', 'a name with no English stays Thai');
  assert.equal(translate('ดูเดโมทั้งหมด'), 'All demos');
});

test('language: Thai dates read in English with the Christian-era year (0.5.0)', () => {
  assert.equal(englishDate('29 ต.ค. 2569'), '29 Oct 2026');
  assert.equal(englishDate('พ.ค.–ต.ค. 2569'), 'May–Oct 2026');
  assert.equal(englishDate('8 พฤศจิกายน 2569'), '8 November 2026');
  assert.equal(translate('2 พ.ย. 2569'), '2 Nov 2026');
  assert.equal(translate('ต.ค. 2569'), 'Oct 2026');
});

test('header: the list ends with all demos on the showcase, in the page language, with the same `at`; English demos stay English (0.5.0)', () => {
  assert.equal(hubUrl('th'), 'https://montri-th.github.io/CityMETER/demos/');
  assert.equal(hubUrl('en'), 'https://montri-th.github.io/CityMETER/en/demos/');
  assert.equal(hubHref('?d=office&at=BKK/D/1039&e=office:OFF-1', 'th'), 'https://montri-th.github.io/CityMETER/demos/?at=BKK/D/1039');
  assert.equal(hubHref('?d=office', 'en'), 'https://montri-th.github.io/CityMETER/en/demos/');
  const html = pickerList({pathname: '/hotel/', search: '?at=BKK/D/1039'});
  assert.match(html, /<p class="dataset-hub"><a class="dataset-link" href="https:\/\/montri-th\.github\.io\/CityMETER\/demos\/\?at=BKK\/D\/1039">ดูเดโมทั้งหมด<\/a><\/p>$/);
  const office = DEMOS.find(d => d.path === 'office'), hotel = DEMOS.find(d => d.path === 'hotel');
  assert.equal(office.en, true, 'Office declares English (0.5.0)');
  assert.equal(demoHref(office, '?at=BKK/D/1039&lang=en', 'en'), 'https://montri-th.github.io/office/?at=BKK/D/1039&lang=en');
  assert.equal(demoHref(hotel, '?at=BKK/D/1039&lang=en', 'en'), 'https://montri-th.github.io/hotel/?at=BKK/D/1039', 'a demo without English opens in Thai');
  assert.equal(demoHref(office, '', 'en'), 'https://montri-th.github.io/office/?lang=en');
  assert.match(pickerList({pathname: '/hotel/', search: '?at=BKK&lang=en', lang: 'en'}), /CityMETER\/en\/demos\/\?at=BKK"/);
});
