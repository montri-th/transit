/**
 * Optional browser library loader. Core CityMETER data never depends on it.
 *
 * Only MapLibre GL is loaded from a pinned official distribution URL; charts
 * are rendered by js/charts.js without a vendor. There is no eval, no
 * alternate CDN and no silent version substitution. A failed or timed-out
 * load rejects with a retryable error and removes the injected element so a
 * retry never duplicates scripts or stylesheets.
 *
 * Part of the shared CityMETER demo shell: edit it in every repository at once (js/shell/manifest.json).
 */
const TIMEOUT_MS = 20_000;
export const MAP_VERSION = '5.6.2';
export const MAP_URL = `https://unpkg.com/maplibre-gl@${MAP_VERSION}/dist/maplibre-gl.js`;
export const MAP_CSS_URL = `https://unpkg.com/maplibre-gl@${MAP_VERSION}/dist/maplibre-gl.css`;

const scripts = new Map();
const stylesheets = new Map();
let mapTask = null;

function libraryError(label, resource, code, detail) {
  const message = code === 'LIBRARY_TIMEOUT'
    ? `โหลด${label}ไม่เสร็จภายใน 20 วินาที ตรวจการเชื่อมต่อแล้วลองอีกครั้ง`
    : `โหลด${label}ไม่สำเร็จ ${detail || 'ตรวจการเชื่อมต่อหรือการบล็อกแหล่งไฟล์ แล้วลองอีกครั้ง'}`;
  const error = new Error(message);
  error.name = 'LibraryLoadError';
  error.phase = 'library';
  error.resource = resource;
  error.code = code;
  error.retryable = true;
  return error;
}

const browserWindow = () => (typeof window === 'undefined' ? null : window);

/** The pinned MapLibre export, or null when absent or a different version. */
export function mapExport() {
  const value = browserWindow()?.maplibregl;
  if (typeof value?.Map !== 'function' || typeof value?.LngLatBounds !== 'function' ||
      typeof value?.getVersion !== 'function' || value.getVersion() !== MAP_VERSION) return null;
  return value;
}

function verifiedExport(readExport) {
  try { return readExport(); } catch { return null; }
}

function loadScript(resource, label, readExport) {
  const previous = scripts.get(resource);
  if (previous?.state === 'pending') return previous.promise;
  const ready = verifiedExport(readExport);
  if (previous?.state === 'fulfilled' && ready) return previous.promise;
  if (ready) {
    const promise = Promise.resolve(ready);
    scripts.set(resource, {state: 'fulfilled', promise});
    return promise;
  }
  if (previous) scripts.delete(resource);
  if (typeof document === 'undefined' || !document.head || !browserWindow()) {
    return Promise.reject(libraryError(label, resource, 'LIBRARY_ENVIRONMENT', 'ต้องเปิดหน้าเว็บในเบราว์เซอร์แล้วลองอีกครั้ง'));
  }
  const entry = {state: 'pending', promise: null};
  scripts.set(resource, entry);
  entry.promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false, timer;
    const cleanup = () => { clearTimeout(timer); script.onload = null; script.onerror = null; };
    const fail = error => {
      if (settled) return;
      settled = true; entry.state = 'rejected'; cleanup(); script.remove();
      if (scripts.get(resource) === entry) scripts.delete(resource);
      reject(error);
    };
    script.async = true;
    script.src = resource;
    script.dataset.citymeterLibrary = label;
    script.onload = () => {
      if (settled) return;
      const value = verifiedExport(readExport);
      if (!value) { fail(libraryError(label, resource, 'LIBRARY_EXPORT_MISSING', 'ไฟล์ตอบกลับแต่ไม่พบไลบรารีรุ่นที่กำหนด กรุณาลองอีกครั้ง')); return; }
      settled = true; entry.state = 'fulfilled'; cleanup(); resolve(value);
    };
    script.onerror = () => fail(libraryError(label, resource, 'LIBRARY_LOAD_FAILED'));
    timer = setTimeout(() => fail(libraryError(label, resource, 'LIBRARY_TIMEOUT')), TIMEOUT_MS);
    try { document.head.appendChild(script); } catch { fail(libraryError(label, resource, 'LIBRARY_LOAD_FAILED')); }
  });
  return entry.promise;
}

function loadStylesheet(resource, label) {
  const previous = stylesheets.get(resource);
  if (previous?.state === 'pending' || (previous?.state === 'fulfilled' && previous.element.sheet && previous.element.isConnected)) return previous.promise;
  if (previous) stylesheets.delete(resource);
  if (typeof document === 'undefined' || !document.head || !browserWindow()) {
    return Promise.reject(libraryError(label, resource, 'LIBRARY_ENVIRONMENT', 'ต้องเปิดหน้าเว็บในเบราว์เซอร์แล้วลองอีกครั้ง'));
  }
  // Reuse a loaded same-URL stylesheet without touching cross-origin cssRules.
  const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find(link => link.href === resource && link.sheet);
  if (existing) {
    const promise = Promise.resolve(existing);
    stylesheets.set(resource, {state: 'fulfilled', promise, element: existing});
    return promise;
  }
  const link = document.createElement('link');
  const entry = {state: 'pending', promise: null, element: link};
  stylesheets.set(resource, entry);
  entry.promise = new Promise((resolve, reject) => {
    let settled = false, timer;
    const cleanup = () => { clearTimeout(timer); link.onload = null; link.onerror = null; };
    const fail = error => {
      if (settled) return;
      settled = true; entry.state = 'rejected'; cleanup(); link.remove();
      if (stylesheets.get(resource) === entry) stylesheets.delete(resource);
      reject(error);
    };
    link.rel = 'stylesheet';
    link.href = resource;
    link.dataset.citymeterLibrary = label;
    link.onload = () => {
      if (settled) return;
      if (!link.sheet) { fail(libraryError(label, resource, 'LIBRARY_STYLESHEET_MISSING', 'ไฟล์รูปแบบตอบกลับแต่ยังใช้งานไม่ได้ กรุณาลองอีกครั้ง')); return; }
      settled = true; entry.state = 'fulfilled'; cleanup(); resolve(link);
    };
    link.onerror = () => fail(libraryError(label, resource, 'LIBRARY_LOAD_FAILED'));
    timer = setTimeout(() => fail(libraryError(label, resource, 'LIBRARY_TIMEOUT')), TIMEOUT_MS);
    try { document.head.appendChild(link); } catch { fail(libraryError(label, resource, 'LIBRARY_LOAD_FAILED')); }
  });
  return entry.promise;
}

/** Resolve only when pinned MapLibre JS and its stylesheet are both ready. */
export function loadMapLibrary() {
  if (mapTask) return mapTask;
  mapTask = Promise.all([
    loadScript(MAP_URL, 'ไลบรารีแผนที่', mapExport),
    loadStylesheet(MAP_CSS_URL, 'รูปแบบแผนที่'),
  ]).then(([maplibre]) => maplibre).catch(error => { mapTask = null; throw error; });
  return mapTask;
}
