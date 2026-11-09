/**
 * citymeter-shell · the CityMETER demos, for the dataset picker in the header (js/shell/header.js).
 *
 * Group and address per the dataset registry, R01_DATASETS (`dataset_group`, `demo_web_url`), read 2026-11-08;
 * Factory's demo address was added to the registry that day. `at: true` marks a demo on citymeter-shell: it opens
 * the area of `?at=` (a production path such as BKK/D/1039 or BKK/S/103902; a demo opens the deepest level it
 * carries). The others open their own start page until they move onto the shell (since 0.4.3 every demo is on it).
 * `en: true` marks a demo whose pages declare English (0.5.0: Office; 0.5.1: Hotel, Hospital; 0.5.2: School, Government
 * Office, Factory; 0.5.3: Pharmacy, Restaurants): from an English page its
 * link carries lang=en.
 * Names are the English names the demos show in their header (live 2026-11-08), except Shopping Center, whose header
 * reads ศูนย์การค้า. Change this list only when the registry or a demo changes, in every
 * repository at once.
 *
 * Part of the shared CityMETER demo shell: edit it in every repository at once (js/shell/manifest.json).
 */

export const DEMO_ORIGIN = 'https://montri-th.github.io';
export const GROUPS = Object.freeze(['Land', 'Location', 'Living']);

export const DEMOS = Object.freeze([
  {path: 'hotel', name: 'Hotel', group: 'Land', at: true, en: true},
  {path: 'office', name: 'Office', group: 'Land', at: true, en: true},
  {path: 'shoppingcenter', name: 'Shopping Center', group: 'Land', at: true},
  {path: 'camera', name: 'Camera Shops', group: 'Location', at: true},
  {path: 'factory', name: 'Factory', group: 'Location', at: true, en: true},
  {path: 'fitness', name: 'Fitness', group: 'Location', at: true},
  {path: 'grocery', name: 'Grocery', group: 'Location', at: true},
  {path: 'hospital', name: 'Hospital', group: 'Location', at: true, en: true},
  {path: 'luxurybrands', name: 'Luxury Brands', group: 'Location', at: true},
  {path: 'pharmacy', name: 'Pharmacy', group: 'Location', at: true, en: true},
  {path: 'restaurant', name: 'Restaurants', group: 'Location', at: true, en: true},
  {path: 'school', name: 'School', group: 'Location', at: true, en: true},
  {path: 'governmentoffice', name: 'Government Office', group: 'Living', at: true, en: true},
  {path: 'transit', name: 'Transit', group: 'Living', at: true},
].map(Object.freeze));

/** The start page of a demo. */
export const demoUrl = demo => `${DEMO_ORIGIN}/${demo.path}/`;

/** The demo hub on the showcase, one page per language. The logo keeps going to production; the picker ends with a
 * link here (owner 2026-11-09, “ตามที่เสนอ”; demo-platform-review §7). */
export const hubUrl = (lang = 'th') => `${DEMO_ORIGIN}/CityMETER/${lang === 'en' ? 'en/' : ''}demos/`;
