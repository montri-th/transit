/**
 * citymeter-shell · the CityMETER demos, for the dataset picker in the header (js/shell/header.js).
 *
 * Group and address per the dataset registry, R01_DATASETS (`dataset_group`, `demo_web_url`), read 2026-11-12.
 * Hospital and School are Living since the owner's decision of 2026-11-12 (registry change
 * CHANGE-LIVING-HEALTH-EDUCATION-20261112-01, `group_basis` owner_2026-11-12_basic_service_access_and_coverage: access to
 * care and to education, and how far basic services reach, read as quality of life); they were Location in the reading
 * of 2026-11-08. The other thirteen groups read the same as on 2026-11-08 and 2026-11-10. University moved with them;
 * its demo (registry research.TH.university, montri-th/university) joined in 0.6.1, 2026-11-12. Factory's demo address
 * was added to the registry on 2026-11-08. Industrial Estate (registry
 * research.TH.industrial_estates, group Land) lives inside the Factory repository: `pages` is its path on GitHub Pages
 * (montri-th.github.io/factory/industrialestate/), `path` its path on the CityMETER Pages site (0.5.4). `at: true` marks a demo on citymeter-shell: it opens
 * the area of `?at=` (a production path such as BKK/D/1039 or BKK/S/103902; a demo opens the deepest level it
 * carries). The others open their own start page until they move onto the shell (since 0.4.3 every demo is on it).
 * `en: true` marks a demo whose pages declare English (0.5.0: Office; 0.5.1: Hotel, Hospital; 0.5.2: School, Government
 * Office, Factory; 0.5.3: Pharmacy, Restaurants; 0.5.4: Industrial Estate; 0.6.1: University): from an English page its
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
  {path: 'industrialestate', pages: 'factory/industrialestate', name: 'Industrial Estate', group: 'Land', at: true, en: true},
  {path: 'office', name: 'Office', group: 'Land', at: true, en: true},
  {path: 'shoppingcenter', name: 'Shopping Center', group: 'Land', at: true},
  {path: 'camera', name: 'Camera Shops', group: 'Location', at: true},
  {path: 'factory', name: 'Factory', group: 'Location', at: true, en: true},
  {path: 'fitness', name: 'Fitness', group: 'Location', at: true},
  {path: 'grocery', name: 'Grocery', group: 'Location', at: true},
  {path: 'luxurybrands', name: 'Luxury Brands', group: 'Location', at: true},
  {path: 'pharmacy', name: 'Pharmacy', group: 'Location', at: true, en: true},
  {path: 'restaurant', name: 'Restaurants', group: 'Location', at: true, en: true},
  {path: 'governmentoffice', name: 'Government Office', group: 'Living', at: true, en: true},
  {path: 'hospital', name: 'Hospital', group: 'Living', at: true, en: true},
  {path: 'school', name: 'School', group: 'Living', at: true, en: true},
  {path: 'transit', name: 'Transit', group: 'Living', at: true},
  {path: 'university', name: 'University', group: 'Living', at: true, en: true},
].map(Object.freeze));

/** The path of a demo on this origin: a demo kept inside another repository (`pages`) has its own path on GitHub Pages
 * and its `path` on the CityMETER Pages site (0.5.4). */
export const demoPath = demo => (demo.pages && /\.github\.io$/.test(new URL(DEMO_ORIGIN).hostname) ? demo.pages : demo.path);

/** The start page of a demo. */
export const demoUrl = demo => `${DEMO_ORIGIN}/${demoPath(demo)}/`;

/** The demo hub on the showcase, one page per language. The logo keeps going to production; the picker ends with a
 * link here (owner 2026-11-09, “ตามที่เสนอ”; demo-platform-review §7). */
export const hubUrl = (lang = 'th') => `${DEMO_ORIGIN}/CityMETER/${lang === 'en' ? 'en/' : ''}demos/`;
