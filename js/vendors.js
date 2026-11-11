/**
 * Optional browser library loaders. Core CityMETER data never depends on them.
 *
 * Two pinned official distributions only — MapLibre GL (basemap, camera, 2D
 * layers) and three.js (the 3D transit scene drawn inside a MapLibre custom
 * layer, js/scene.js). Charts are rendered by js/charts.js without a vendor.
 * There is no eval, no alternate CDN and no silent version substitution. A
 * failed or timed-out load rejects with a retryable error and removes the
 * injected element so a retry never duplicates scripts or stylesheets.
 *
 * MapLibre 5.6.2 is kept on purpose (verified live by the Luxury Brands demo on
 * 2026-10-22: fill-extrusion horizon constraint, custom-layer mainMatrix). three
 * 0.186.1 (2026-09-24) is loaded as an ES module; its build imports
 * ./three.core.js relative to the same pinned URL.
 */
const TIMEOUT_MS = 20_000;
// MapLibre comes from the shared loader (citymeter-shell 0.6.0: integrity values, and the early start that
// js/shell/launch.js gives the two files); three.js stays here.
export {MAP_VERSION, MAP_URL, MAP_CSS_URL, loadMapLibrary, mapExport} from './shell/vendors.js';
export const THREE_VERSION = '0.186.1';
export const THREE_URL = `https://unpkg.com/three@${THREE_VERSION}/build/three.module.js`;

let threeTask = null;

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


/** The three.js module namespace (pinned build) — verified by REVISION, retryable on failure. */
export function loadThree({importer = resource => import(/* webpackIgnore: true */ resource), url = THREE_URL} = {}) {
  if (threeTask) return threeTask;
  threeTask = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(libraryError('ไลบรารี 3 มิติ', url, 'LIBRARY_TIMEOUT')), TIMEOUT_MS);
    importer(url).then(mod => {
      clearTimeout(timer);
      const expected = THREE_VERSION.split('.')[1];
      if (!mod || typeof mod.WebGLRenderer !== 'function' || String(mod.REVISION || '').replace(/[^0-9]/g, '') !== expected) {
        reject(libraryError('ไลบรารี 3 มิติ', url, 'LIBRARY_EXPORT_MISSING', 'ไฟล์ตอบกลับแต่ไม่พบไลบรารีรุ่นที่กำหนด กรุณาลองอีกครั้ง'));
        return;
      }
      resolve(mod);
    }).catch(error => { clearTimeout(timer); reject(libraryError('ไลบรารี 3 มิติ', url, 'LIBRARY_LOAD_FAILED', error?.message)); });
  }).catch(error => { threeTask = null; throw error; });
  return threeTask;
}
