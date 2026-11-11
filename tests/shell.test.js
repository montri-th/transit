/**
 * citymeter-shell — the shared code of the CityMETER demos (js/shell/): navigation (0.1.0), the map modules (0.2.0),
 * the header (0.3.0), the subdistrict, local-unit and locale levels (0.4.0, 0.4.1), a zone a dataset defines itself
 * (0.4.2), networks (0.4.3), the page language (0.5.0, words in context 0.5.1, cut titles 0.5.2, Pharmacy and Restaurants in English 0.5.3) and a demo kept inside another repository (0.5.4: Industrial Estate). This file is the same in every repository that carries the shell: the files must match
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
import {DEMOS, GROUPS, demoUrl, demoPath, hubUrl} from '../js/shell/datasets.js';
import {demoHref, currentDemo, pickerList, placeLevel, hubHref, languageLink, PHONE_QUERY} from '../js/shell/header.js';
import {NAV_ICON_CONTRACT, CONTROL_GLYPHS, CONTROL_ICON_CONTRACT, keepScore, planToolbar, PHONE_QUERY as TOOLBAR_PHONE_QUERY} from '../js/shell/navigation.js';
import {pageLanguage, languageHref, translate, translateIn, registerDictionary, registerNames, keepThai, englishDate, cutName, LANG} from '../js/shell/i18n.js';

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
    assert.match(demoUrl(d), /^https:\/\/montri-th\.github\.io\/[a-z]+(\/[a-z]+)?\/$/);
  }
  assert.ok(DEMOS.filter(d => d.at).length >= 6, 'the six Hotel-family demos open ?at=');
  // The groups as the registry reads on 2026-11-12 (R01_DATASETS.dataset_group): Hospital and School moved from
  // Location to Living that day (owner; registry change CHANGE-LIVING-HEALTH-EDUCATION-20261112-01).
  const inGroup = group => DEMOS.filter(d => d.group === group).map(d => d.path);
  assert.deepEqual(inGroup('Land'), ['hotel', 'industrialestate', 'office', 'shoppingcenter']);
  assert.deepEqual(inGroup('Location'), ['camera', 'factory', 'fitness', 'grocery', 'luxurybrands', 'pharmacy', 'restaurant']);
  assert.deepEqual(inGroup('Living'), ['governmentoffice', 'hospital', 'school', 'transit']);
  // Industrial Estate lives inside the Factory repository (0.5.4): its GitHub Pages path is factory/industrialestate,
  // its path on the CityMETER Pages site industrialestate; the page is never taken for Factory.
  const estate = DEMOS.find(d => d.path === 'industrialestate');
  assert.deepEqual([estate.group, estate.pages, estate.at, estate.en], ['Land', 'factory/industrialestate', true, true]);
  assert.equal(demoPath(estate), 'factory/industrialestate');
  assert.equal(demoUrl(estate), 'https://montri-th.github.io/factory/industrialestate/');
  assert.equal(currentDemo('/factory/industrialestate/')?.path, 'industrialestate');
  assert.equal(currentDemo('/industrialestate/')?.path, 'industrialestate');
  assert.equal(currentDemo('/factory/')?.path, 'factory');
  assert.equal(currentDemo('/factory/data/x.json')?.path, 'factory');
  assert.equal(demoHref(estate, '?at=CBI'), 'https://montri-th.github.io/factory/industrialestate/?at=CBI');
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
  const office = DEMOS.find(d => d.path === 'office'), thai = DEMOS.find(d => !d.en);
  assert.equal(office.en, true, 'Office declares English (0.5.0)');
  assert.deepEqual(DEMOS.filter(d => d.en).map(d => d.path).sort(), ['factory', 'governmentoffice', 'hospital', 'hotel', 'industrialestate', 'office', 'pharmacy', 'restaurant', 'school'],
    'Hotel and Hospital declare English (0.5.1); School, Government Office and Factory (0.5.2); Pharmacy and Restaurants (0.5.3); Industrial Estate (0.5.4)');
  assert.equal(demoHref(office, '?at=BKK/D/1039&lang=en', 'en'), 'https://montri-th.github.io/office/?at=BKK/D/1039&lang=en');
  assert.equal(demoHref(thai, '?at=BKK/D/1039&lang=en', 'en'), `https://montri-th.github.io/${thai.path}/?at=BKK/D/1039`, 'a demo without English opens in Thai');
  assert.equal(demoHref(office, '', 'en'), 'https://montri-th.github.io/office/?lang=en');
  assert.match(pickerList({pathname: '/hotel/', search: '?at=BKK&lang=en', lang: 'en'}), /CityMETER\/en\/demos\/\?at=BKK"/);
});

test('language: one Thai word can read two ways by its element — a tile label under its number, a filter label (0.5.1)', () => {
  registerDictionary({exact: {'จังหวัด': 'Province'},
    contexts: [['.metric > span', {'จังหวัด': (el, t) => t.plural(el.previousElementSibling?.textContent, 'province', 'provinces')}]]});
  const tile = n => ({matches: s => s === '.metric > span', previousElementSibling: {textContent: n}});
  const filter = {matches: () => false};
  assert.equal(translateIn(tile('77'), 'จังหวัด'), 'provinces');
  assert.equal(translateIn(tile('1'), 'จังหวัด'), 'province');
  assert.equal(translateIn(filter, 'จังหวัด'), 'Province');
  assert.equal(translateIn(null, 'จังหวัด'), 'Province');
  assert.equal(translate('จังหวัด'), 'Province', 'translate() alone never reads a context');
});

test('header: from an English page a Thai-only demo says so and opens in Thai (0.5.1)', () => {
  const html = pickerList({pathname: '/office/', search: '?at=BKK&lang=en', lang: 'en'});
  const thaiOnly = DEMOS.filter(d => !d.en);
  assert.ok(thaiOnly.length > 0);
  for (const d of thaiOnly) {
    assert.ok(html.includes(`href="${demoHref(d, '?at=BKK', 'en').replace(/&/g, '&amp;')}" hreflang="th"><span>${d.name}</span><span class="dataset-note">ภาษาไทย</span>`), d.name);
  }
  assert.doesNotMatch(pickerList({pathname: '/office/', search: '?at=BKK'}), /ภาษาไทย|hreflang/, 'a Thai page names no language');
  assert.equal(translate('ภาษาไทย'), 'in Thai');
});

test('language: a tab title cut to 60 characters still reads the name it begins with (0.5.2)', () => {
  registerNames([['โรงเรียนสาธิตทดสอบชื่อยาวมาก', 'Long Test Demonstration School']]);
  keepThai(['ศาลเจ้าทดสอบชื่อยาวมากที่ไม่มีภาษาอังกฤษ']);
  assert.equal(cutName('โรงเรียนสาธิตทดสอบ…'), 'Long Test Demonstration School');
  assert.equal(cutName('ศาลเจ้าทดสอบชื่อยาว…'), 'ศาลเจ้าทดสอบชื่อยาว…', 'a name without English stays Thai, cut as it was');
  assert.equal(cutName('ชื่อที่ไม่มีในข้อมูล…'), null, 'no registered name begins with it');
  assert.equal(cutName('โรงเรียนสาธิตทดสอบ'), null, 'only a cut text');
});

test('language: a context can read a number its own way — “41 ที่ทดสอบ” under a learning heading (0.5.2)', () => {
  registerDictionary({patterns: [[/^([\d,]+) ที่ทดสอบ$/, '$1 test schools']],
    contexts: [['.learning .hint', {}, [[/^([\d,]+) ที่ทดสอบ$/, (m, t) => `${m[1]} ${t.plural(m[1], 'learning centre', 'learning centres')}`]]]]});
  const hint = {matches: s => s === '.learning .hint'};
  assert.equal(translateIn(hint, '41 ที่ทดสอบ'), '41 learning centres');
  assert.equal(translateIn(hint, '1 ที่ทดสอบ'), '1 learning centre');
  assert.equal(translateIn({matches: () => false}, '41 ที่ทดสอบ'), '41 test schools', 'elsewhere the page pattern reads it');
});

test('language: a pattern can translate a longer piece with its separators — “ผลิต: 3 จาก 10 หน่วย · 5 หน่วย” (0.5.2)', () => {
  registerDictionary({exact: {'ผลิตทดสอบ': 'Test making'}, patterns: [
    [/^([\d,]+) จาก ([\d,]+) หน่วยทดสอบ$/, '$1 of $2 test units'],
    [/^([\d,]+) หน่วยทดสอบ$/, '$1 test units'],
    [/^([^:]+): (.+)$/, (m, t) => { const a = t.part(m[1]), b = t.text(m[2]); return a == null || b == null ? null : `${a}: ${b}`; }],
  ]});
  assert.equal(translate('ผลิตทดสอบ: 3 จาก 10 หน่วยทดสอบ · 5 หน่วยทดสอบ'), 'Test making: 3 of 10 test units · 5 test units');
});

test('the launch script and the loader pin one map library with the same integrity values (shell 0.6.0)', async () => {
  const launch = readFileSync(new URL('launch.js', SHELL), 'utf8');
  const loader = await import('../js/shell/vendors.js');
  const pinned = launch.match(/const MAP_LIBRARY=\{version:'([^']+)',script:'([^']+)',style:'([^']+)'\}/);
  assert.ok(pinned, 'launch.js names the pinned map library');
  assert.equal(pinned[1], loader.MAP_VERSION);
  assert.equal(pinned[2], loader.MAP_INTEGRITY);
  assert.equal(pinned[3], loader.MAP_CSS_INTEGRITY);
  for (const value of [loader.MAP_INTEGRITY, loader.MAP_CSS_INTEGRITY]) assert.match(value, /^sha384-[A-Za-z0-9+/]{64}$/);
  assert.equal(loader.MAP_URL, `https://unpkg.com/maplibre-gl@${loader.MAP_VERSION}/dist/maplibre-gl.js`);
});

test('the launch script keeps the app contract: ready, load-error, progress, partial and map-ready (shell 0.6.0)', () => {
  const launch = readFileSync(new URL('launch.js', SHELL), 'utf8');
  for (const name of ['citymeter:ready', 'citymeter:load-error', 'citymeter:progress', 'citymeter:partial', 'citymeter:map-ready']) {
    assert.ok(launch.includes(`addEventListener('${name}'`), `launch.js listens for ${name}`);
  }
  // The notice is built from text nodes only: a label from a data file can never become markup.
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(launch));
  const css = readFileSync(new URL('../navigation.css', import.meta.url), 'utf8');
  for (const rule of ['.data-notice', '.data-notice-toggle', '.data-notice-body', '.map-loading']) assert.ok(css.includes(rule + ' {'), `navigation.css styles ${rule}`);
  assert.ok(!/\.data-notice[^{]*\{[^}]*border-left/.test(css), 'no rail on the notice');
});

/* ---------- shell 0.6.0: the theme before the first paint, a page that was stopped, the map's budget ---------- */

/** Run js/shell/launch.js in a stand-in page; returns what it left on the root element and in the stores. */
function runLaunch({stored = null, darkDevice = false, life = null, search = '', themeKey = 'citymeter-test-theme'} = {}) {
  const listeners = {};
  const store = seed => { const m = new Map(Object.entries(seed)); return {getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), map: m}; };
  const metas = [{media: '(prefers-color-scheme: light)', content: '#F6F7F3'}, {media: '(prefers-color-scheme: dark)', content: '#11191D'}]
    .map(m => ({getAttribute: k => m[k], setAttribute: (k, v) => { m[k] = v; }, m}));
  const node = () => ({dataset: {}, style: {}, setAttribute() {}, appendChild() {}, append() {}, addEventListener() {}, remove() {}});
  const root = {dataset: {}, style: {}, lang: 'th'};
  const session = store(life ? {'citymeter-life:/hotel/': JSON.stringify(life)} : {});
  const win = {
    location: {search, hash: '', protocol: 'https:', origin: 'https://example.test', pathname: '/hotel/', href: 'https://example.test/hotel/' + search},
    localStorage: store(stored ? {[themeKey]: stored} : {}), sessionStorage: session,
    matchMedia: q => ({matches: /dark/.test(q) ? darkDevice : false}),
    addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); }, dispatch: (name, detail) => (listeners[name] || []).forEach(fn => fn({detail})),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, performance: {mark() {}}, navigator: {userAgent: 'test'}, innerWidth: 393, innerHeight: 659, devicePixelRatio: 3,
  };
  const doc = {
    currentScript: {dataset: {public: 'https://example.test/hotel/', name: 'Test', themeKey}}, documentElement: root, head: node(), body: null, visibilityState: 'visible',
    querySelector: () => null, querySelectorAll: sel => (/theme-color/.test(sel) ? metas : []), getElementById: () => null, createElement: node, createElementNS: node, addEventListener() {},
  };
  const source = readFileSync(new URL('launch.js', SHELL), 'utf8');
  new Function('window', 'document', 'URL', 'URLSearchParams', 'MutationObserver', 'CustomEvent', source)(win, doc, URL, URLSearchParams, class { observe() {} disconnect() {} }, class {});
  return {root, metas: metas.map(x => x.m.content), life: () => JSON.parse(session.getItem('citymeter-life:/hotel/') || 'null'), dispatch: win.dispatch};
}

test('the launch script sets the theme before the first paint: the reader\'s choice for this demo, else the device\'s (shell 0.6.0)', () => {
  const chosenDark = runLaunch({stored: 'dark', darkDevice: false});
  assert.equal(chosenDark.root.dataset.theme, 'dark');
  assert.equal(chosenDark.root.style.colorScheme, 'dark');
  assert.deepEqual(chosenDark.metas, ['#11191D', '#11191D'], 'the browser bar takes the page\'s theme, whatever the device prefers');
  assert.equal(runLaunch({stored: null, darkDevice: true}).root.dataset.theme, 'dark');
  assert.equal(runLaunch({stored: 'auto', darkDevice: true}).root.dataset.theme, 'dark');
  const chosenLight = runLaunch({stored: 'light', darkDevice: true});
  assert.equal(chosenLight.root.dataset.theme, 'light');
  assert.deepEqual(chosenLight.metas, ['#F6F7F3', '#F6F7F3']);
  assert.equal(runLaunch({stored: null, darkDevice: false}).root.dataset.theme, 'light');
});

test('a page the browser ended while it was on screen starts lean the next time; a clean exit does not (shell 0.6.0)', () => {
  const now = Date.now();
  const ended = runLaunch({life: {state: 'visible', at: now - 5000, ended: 0, lean: '', log: []}});
  assert.equal(ended.root.dataset.lean, 'recovered');
  assert.equal(ended.life().ended, 1);
  assert.equal(ended.life().state, 'visible', 'the new page marks itself on screen');
  for (const state of ['closed', 'hidden']) assert.equal(runLaunch({life: {state, at: now - 5000, ended: 0, lean: '', log: []}}).root.dataset.lean, undefined, state);
  assert.equal(runLaunch({life: {state: 'visible', at: now - 7 * 3600 * 1000, ended: 0, lean: '', log: []}}).root.dataset.lean, undefined, 'a mark from another day is not a stop');
  assert.equal(runLaunch({life: {state: 'closed', at: now, ended: 1, lean: 'recovered', log: []}}).root.dataset.lean, 'recovered', 'the tab stays lean');
  // The reader's own choice of the full map holds until the page is ended again.
  assert.equal(runLaunch({life: {state: 'closed', at: now, ended: 1, lean: 'off', log: []}}).root.dataset.lean, undefined);
  assert.equal(runLaunch({life: {state: 'visible', at: now, ended: 1, lean: 'off', log: []}}).root.dataset.lean, 'recovered');
  assert.equal(runLaunch({search: '?lean=phone'}).root.dataset.lean, 'phone');
  assert.equal(runLaunch({search: '?lean=1'}).root.dataset.lean, 'recovered');
  assert.equal(runLaunch({search: '?lean=0', life: {state: 'closed', at: now, ended: 2, lean: 'recovered', log: []}}).root.dataset.lean, undefined);
  // A map that lost its context turns the tab lean at once, and the event is kept for a report.
  const live = runLaunch({});
  live.dispatch('citymeter:map-trouble', {kind: 'context-lost', note: 'restart 1'});
  assert.equal(live.root.dataset.lean, 'recovered');
  assert.match(live.life().log.at(-1)[1], /^context-lost/);
});

test('the map\'s budget: a desktop keeps everything, a touch-first device and a page that was stopped get less (shell 0.6.0)', async () => {
  const {mapBudget, budgetPixelRatio, MAP_BUDGETS, capTerrainPool, watchContext, GUARDED_VERSION} = await import('../js/shell/maplibre-guard.js');
  const page = ({lean = '', coarse = false, fine = !coarse, memory, ratio = 2} = {}) => ({document: {documentElement: {dataset: lean ? {lean} : {}}}, navigator: {deviceMemory: memory}, devicePixelRatio: ratio,
    matchMedia: q => ({matches: q === '(pointer: coarse)' ? coarse : q === '(any-pointer: fine)' ? fine : false})});
  assert.equal(mapBudget(page()).level, 'full');
  assert.equal(mapBudget(page({coarse: true})).level, 'phone');
  assert.equal(mapBudget(page({coarse: true, fine: true})).level, 'full', 'a touch screen with a mouse is a desktop');
  assert.equal(mapBudget(page({memory: 4})).level, 'phone');
  assert.equal(mapBudget(page({memory: 8})).level, 'full');
  assert.equal(mapBudget(page({lean: 'recovered'})).level, 'recovered');
  assert.equal(mapBudget(page({lean: 'phone'})).level, 'phone');
  assert.equal(mapBudget(null).level, 'full');
  // A lean level never asks for more than the level above it.
  for (const key of ['tiles', 'cmRequests', 'terrainPool', 'cacheZoomLevels']) assert.ok(MAP_BUDGETS.recovered[key] <= MAP_BUDGETS.phone[key] && MAP_BUDGETS.phone[key] <= MAP_BUDGETS.full[key], key);
  assert.ok(MAP_BUDGETS.phone.radiusM > MAP_BUDGETS.recovered.radiusM && MAP_BUDGETS.full.radiusM === 0);
  assert.equal(MAP_BUDGETS.recovered.terrain, false);
  assert.equal(budgetPixelRatio(MAP_BUDGETS.full, page({ratio: 3})), undefined);
  assert.equal(budgetPixelRatio(MAP_BUDGETS.phone, page({ratio: 3})), 2);
  assert.equal(budgetPixelRatio(MAP_BUDGETS.phone, page({ratio: 1})), 1);
  assert.equal(budgetPixelRatio(MAP_BUDGETS.recovered, page({ratio: 3})), 1.5);

  // The terrain pool: only a fresh pool of the pinned MapLibre is capped.
  const pool = () => ({_size: 30, _objects: [], isFull() { return false; }});
  const fresh = {painter: {renderToTexture: {pool: pool()}}};
  assert.equal(capTerrainPool(fresh, 12), true);
  assert.equal(fresh.painter.renderToTexture.pool._size, 12);
  const used = {painter: {renderToTexture: {pool: {...pool(), _objects: [{}]}}}};
  assert.equal(capTerrainPool(used, 12), false);
  assert.equal(used.painter.renderToTexture.pool._size, 30);
  assert.equal(capTerrainPool({painter: {renderToTexture: {pool: pool()}}}, 12, '6.0.0'), false);
  assert.equal(capTerrainPool({painter: {renderToTexture: {pool: pool()}}}, 40), false);
  assert.equal(capTerrainPool({}, 12), false);
  assert.equal(capTerrainPool(fresh, 12, GUARDED_VERSION), false, 'already at the cap');

  // A lost context calls back once, a little later; a watch that was stopped never does.
  const emitter = () => { const on = {}; return {on: (n, f) => { on[n] = f; }, off: n => { delete on[n]; }, fire: n => on[n]?.()}; };
  let calls = 0;
  const map = emitter();
  watchContext(map, () => { calls++; }, {delay: 5});
  map.fire('webglcontextlost'); map.fire('webglcontextlost');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls, 1);
  const other = emitter();
  watchContext(other, () => { calls++; }, {delay: 5})();
  other.fire('webglcontextlost');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls, 1);
});

test('a demo without its own restart reloads once after a lost context, never twice in a lean tab (shell 0.6.0)', async () => {
  const {reloadOnContextLoss} = await import('../js/shell/maplibre-guard.js');
  const run = async lean => {
    const on = {}, sent = [];
    let reloads = 0;
    const win = {document: {documentElement: {dataset: lean ? {lean} : {}}}, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
      dispatchEvent: e => { sent.push(e); win.document.documentElement.dataset.lean = 'recovered'; }, location: {reload: () => { reloads++; }}};
    reloadOnContextLoss({on: (n, f) => { on[n] = f; }, off() {}}, win);
    const realTimeout = globalThis.setTimeout;
    on.webglcontextlost();
    await new Promise(resolve => realTimeout(resolve, 450));
    return {reloads, sent};
  };
  const first = await run('');
  assert.equal(first.reloads, 1);
  assert.deepEqual(first.sent.map(e => [e.type, e.detail.kind, e.detail.note]), [['citymeter:map-trouble', 'context-lost', 'reload']]);
  const again = await run('recovered');
  assert.equal(again.reloads, 0, 'a lean tab is not reloaded again');
  assert.equal(again.sent[0].detail.note, 'again');
});

test('phone controls: the control glyphs match their font, its record and the stylesheet (0.6.0)', () => {
  const bytes = readFileSync(new URL(`../${CONTROL_ICON_CONTRACT.file}`, import.meta.url));
  assert.equal(bytes.length, CONTROL_ICON_CONTRACT.bytes);
  assert.equal(sha256(bytes), CONTROL_ICON_CONTRACT.sha256);
  const record = JSON.parse(readFileSync(new URL(`../${CONTROL_ICON_CONTRACT.manifest}`, import.meta.url), 'utf8'));
  assert.deepEqual([record.file, record.bytes, record.sha256], ['material-controls-300.woff2', CONTROL_ICON_CONTRACT.bytes, CONTROL_ICON_CONTRACT.sha256]);
  assert.deepEqual(record.axes, {...CONTROL_ICON_CONTRACT.axes}, 'the LDS axes of interface icons: FILL 0, wght 300');
  assert.deepEqual(record.axes, {...NAV_ICON_CONTRACT.axes}, 'the same axes as the approved nav-7 subset');
  const glyphs = Object.fromEntries(Object.entries(record.glyphs).map(([role, g]) => [role, String.fromCodePoint(parseInt(g.codepoint.slice(2), 16))]));
  assert.deepEqual(glyphs, {...CONTROL_GLYPHS});
  assert.deepEqual(Object.values(record.glyphs).map(g => g.name), ['arrow_back', 'expand_more', 'help'], 'conventional symbols only (LDS ICON-01)');
  const css = readFileSync(new URL('../navigation.css', import.meta.url), 'utf8');
  assert.ok(css.includes(`material-controls-300.woff2?v=${CONTROL_ICON_CONTRACT.sha256.slice(0, 8)}`), 'the stylesheet address carries the font hash');
  assert.ok(css.includes(`material-nav-300.woff2?v=${NAV_ICON_CONTRACT.sha256.slice(0, 8)}`), 'nav-7 is unchanged');
  // Each glyph face is the first available font of its own box (U+0020 in its range), so a glyph stands in the middle.
  const ranges = [...css.matchAll(/unicode-range: ([^;]+);/g)].map(m => m[1].split(', '));
  assert.equal(ranges.length, 2);
  for (const range of ranges) assert.equal(range[0], 'U+0020');
  assert.deepEqual(ranges[1].slice(1), Object.values(record.glyphs).map(g => g.codepoint));
});

test('phone toolbar: one row, the lowest priority leaves first, the sheet opener and 3D never (0.6.0)', () => {
  assert.equal(TOOLBAR_PHONE_QUERY, PHONE_QUERY, 'one definition of a phone in portrait');
  const item = (id, width, pressed = false) => ({id, width, score: keepScore({id, pressed})});
  // The Hotel family in Thai: the five buttons fit 333 px (393 − 8 − 52), nothing leaves, no “more” button.
  const family = [item('mobile-panel', 44), item('fit-map', 74), item('country-map', 83), item('toggle-neighborhoods', 52, true), item('toggle-3d', 44, true)];
  assert.deepEqual(planToolbar(family, 333), []);
  // Grocery: two jumps and help beside the same four. Help leaves first, then the jumps, the later one first.
  const grocery = [item('mobile-panel', 44), item('fit-map', 74), item('country-map', 90), item('bangkok-map', 75), item('toggle-areas', 52, true), item('toggle-3d', 44, true), item('open-help', 52)];
  assert.deepEqual(planToolbar(grocery, 333), ['country-map', 'bangkok-map', 'open-help']);
  // A demo's own layer stays longer than a jump; the architect's view while it can be used stays longer than a jump too.
  const estate = [item('mobile-panel', 44), item('fit-map', 74), item('country-map', 83), item('toggle-around', 119, true), item('toggle-3d', 44, true)];
  assert.deepEqual(planToolbar(estate, 333), ['country-map', 'toggle-around']);
  assert.ok(keepScore({id: 'toggle-register', pressed: true}) > keepScore({id: 'toggle-eye', pressed: true}));
  assert.ok(keepScore({id: 'toggle-eye', pressed: true}) > keepScore({id: 'bangkok-map'}));
  // The row that is left always holds the “more” button too.
  const width = ids => grocery.filter(b => !ids.includes(b.id)).reduce((sum, b) => sum + b.width + 6, 0) + 44;
  assert.ok(width(planToolbar(grocery, 333)) <= 333);
  // The sheet opener and the 3D switch never leave, however narrow the row.
  const left = planToolbar(family, 120);
  assert.ok(!left.includes('mobile-panel') && !left.includes('toggle-3d'));
  assert.deepEqual(left, ['fit-map', 'country-map', 'toggle-neighborhoods']);
});

test('controls and type: 44 px targets and a caption floor at every width, a phone toolbar that never scrolls (0.6.0, LDS CTRL-01)', () => {
  const css = readFileSync(new URL('../navigation.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* Controls and type (citymeter-shell 0.6.0');
  assert.ok(start > 0, 'navigation.css has the block');
  const block = css.slice(start), phoneAt = block.indexOf(`@media ${PHONE_QUERY} {`);
  assert.ok(phoneAt > 0, 'the phone composition is its own block');
  const every = block.slice(0, phoneAt), phone = block.slice(phoneAt);
  for (const target of ['.map-toolbar > button', '.insight-heading button', '.map-aha .btn', '.metric-switch button', '.sheet-links .link-button',
    '#filter-details > summary', '#close-mobile-panel', '.tabs button', '.pagination button', '#results .row-name', '#panel .ask-link', '.crumbs button.crumb']) {
    const rule = every.split('\n').find(line => line.includes(target) && line.includes('min-height'));
    assert.ok(rule && rule.includes('min-height: 44px'), `${target} is a 44 px target at every width`);
  }
  assert.ok(every.includes('.maplibregl-ctrl-group > button { width: 44px; height: 44px; }'), 'the map library\'s own buttons too');
  assert.ok(phone.includes('.map-toolbar > button#toggle-3d { width: 44px;'), '3D is a circle');
  assert.ok(phone.includes('.nav-icons-ready .map-toolbar > button#mobile-panel { width: 44px;'), 'the sheet opener is a symbol in a circle once its glyph has loaded');
  assert.ok(phone.includes('.map-toolbar[data-fit] { flex-wrap: nowrap; }') && !phone.includes('overflow-x: auto'), 'one row that never scrolls');
  // Caption (0.75rem) is the smallest text; a control shows label size (0.8125rem); 0 hides the words of a symbol-only control.
  for (const m of block.matchAll(/font-size: ([^;]+);/g)) assert.ok(['0', '.75rem', '.8125rem'].includes(m[1].trim()), `font-size ${m[1]}`);
  assert.ok(!/border-left|border-inline-start/.test(css), 'no coloured side rail (LDS LAYOUT-01)');
});
