/**
 * citymeter-shell · tab title.
 *
 * LDS 0.9.7 FAVICON-01: `<title>` is `[page] · [product]`, at most 60 characters, page first. The page part names
 * what the view shows — “ห้องพัก เขตวัฒนา”, a hotel's name, “สถานีอโศก” — never the whole area path
 * (demo-platform-review §5.3 rule 10). A long page part is cut at a character boundary (a Thai vowel or tone mark
 * stays with its letter) and ends with “…”. Length counts UTF-16 code units, the strictest reading of the rule.
 *
 * Part of the shared CityMETER demo shell: edit it in every repository at once (js/shell/manifest.json).
 */

export const PRODUCT = 'CityMETER';
export const TITLE_MAX = 60;
const SEPARATOR = ' · ';

function graphemes(text) {
  try { return [...new Intl.Segmenter('th', {granularity: 'grapheme'}).segment(text)].map(s => s.segment); }
  catch { return Array.from(text); }
}

/** `[page] · CityMETER`, ≤ 60 characters. An empty page gives the product name alone. */
export function pageTitle(page, {product = PRODUCT, max = TITLE_MAX} = {}) {
  const tail = `${SEPARATOR}${product}`;
  const clean = String(page ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return product;
  if (clean.length + tail.length <= max) return clean + tail;
  const room = max - tail.length - 1; // one for "…"
  let cut = '';
  for (const g of graphemes(clean)) {
    if (cut.length + g.length > room) break;
    cut += g;
  }
  return `${cut.trimEnd()}…${tail}`;
}
