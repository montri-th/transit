/**
 * CityMETER · Transit — the rail agencies' logos (0.4.0; owner 2026-11-26 06:14, VERBATIM: “เช็คหน่อยว่า โลโก้ขึ้นหรือยัง
 * ใน web demo ทุกๆ dataset รวม transit ด้วย”). data/operator-logos.json is written only by
 * scripts/add-operator-logos.py from the research team's transit logo library (every file's bytes equal the library's
 * SHA-256). A line takes the logos of the GTFS agency its system names (`systems[].operatorId`): the brand of the
 * agency's service (BTS Skytrain, MRT) beside the line's name, the agency itself (BEM, MRTA, SRTET) beside “ผู้ให้บริการ”.
 * Never by name. The file is optional: without it every line reads by its name alone. Pure: no DOM access.
 */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const PLATES = new Set(['#FFFFFF', '#182327']);

/** data/operator-logos.json → {logos: Map(key → logo), agencies: Map(agency → {system, operator})}; null on a bad file. */
export function decodeOperatorLogos(json) {
  if (!json || typeof json.logos !== 'object' || typeof json.agencies !== 'object') return null;
  const logos = new Map();
  for (const [key, x] of Object.entries(json.logos)) {
    if (!/^OL-[0-9a-f]{16}$/.test(key) || !/^assets\/operator-logos\/[0-9a-f]{20}\.(svg|png|jpg|webp)$/.test(x?.file || '')) continue;
    if (!x.sha256?.startsWith(key.slice(3)) || !PLATES.has(x.plate)) continue;
    logos.set(key, Object.freeze({key, file: x.file, plate: x.plate, width: x.width, height: x.height, label: x.label || '', role: x.role || ''}));
  }
  const agencies = new Map();
  for (const [agency, slots] of Object.entries(json.agencies)) {
    const pick = k => (k && logos.has(k) ? logos.get(k) : null);
    agencies.set(agency, Object.freeze({system: pick(slots.system), operator: pick(slots.operator)}));
  }
  return {logos, agencies};
}

/**
 * The logos of a line: its system's GTFS agency → {system, operator}. Only a line in service whose GTFS names its
 * operator (`line.operator`): a line under construction takes no logo, even where its system has an agency — who will
 * run it is not in the data, and a logo would read as a service that does not run yet. Both null without the file.
 */
export function lineLogos(line, systemById, reg) {
  if (!line || line.status === 'construction' || !String(line.operator || '').trim()) return {system: null, operator: null};
  const agency = systemById?.get(line.systemId)?.operatorId;
  const slots = agency && reg?.agencies.get(agency);
  return {system: slots?.system || null, operator: slots?.operator || null};
}

/** The one mark that names a line in a chip: the service brand, else the agency. */
export const lineMark = (line, systemById, reg) => { const l = lineLogos(line, systemById, reg); return l.system || l.operator; };

/**
 * A logo on its plate (the library's recommended surface, the same on both themes), never recoloured. Decorative
 * (`alt=""`): the name it stands beside is the identity. `height`: 32 in a heading, 18 in a chip or a fact.
 */
export function logoPlate(logo, {height = 32, cls = ''} = {}) {
  if (!logo) return '';
  const w = Number(logo.width) || 0, h = Number(logo.height) || 0;
  const width = w && h ? Math.max(1, Math.round(Math.min(height * 3.5, (w / h) * height))) : height;
  return `<span class="logo-plate${cls ? ` ${cls}` : ''}" style="background:${esc(logo.plate)}" title="${esc(logo.label)}"><img src="${esc(logo.file)}" alt="" width="${width}" height="${height}" loading="lazy" decoding="async"></span>`;
}
