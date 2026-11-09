/**
 * This demo's navigation on the shared header code: the titles of its controls. The
 * nav-7 glyphs and the help dialog are js/shell/navigation.js, the dataset picker js/shell/header.js
 * (citymeter-shell: edit those in every repository at once, js/shell/manifest.json).
 */
import {installNavigation, NAV_GLYPHS, NAV_ICON_CONTRACT} from './shell/navigation.js';
import {installHeader} from './shell/header.js';

export {NAV_GLYPHS, NAV_ICON_CONTRACT};

const TITLES = {
  'fit-map': 'ปรับแผนที่ให้เห็นทุกสถานีตามตัวกรอง',
  'bangkok-map': 'กลับไปดูพื้นที่กรุงเทพฯ',
  'toggle-3d': 'สลับมุมมอง 3 มิติ (แนวสาย สถานี อาคาร) กับแผนผัง 2 มิติ',
  'toggle-eye': 'มุมสถาปนิก: เปอร์สเปกทีฟ 2 จุดที่ระดับสถานี อาคารรอบข้างจางลง',
  'toggle-bus': 'แสดงหรือซ่อนสายรถเมล์และป้ายรถเมล์ (ชั้นเสริม)',
  'toggle-boat': 'แสดงหรือซ่อนเส้นทางเรือและท่าเรือ (ชั้นเสริม)',
  'mobile-panel': 'เปิดแผงข้อมูลและตัวกรอง',
  'open-help': 'เปิดวิธีใช้',
  'toggle-insights': 'เปิดหรือย่อกราฟเปรียบเทียบสาย',
  'open-table': 'เปิดตารางสถานีตามตัวกรอง',
  'toggle-table': 'ปิดตารางและกลับไปแผนที่',
  'search': 'ค้นหาสถานี รหัสสถานี สาย หรือจังหวัด',
  'status': 'เลือกสถานีที่เปิดให้บริการ กำลังก่อสร้าง หรือทั้งหมด',
  'system': 'เลือกระบบหรือผู้ให้บริการ',
  'line': 'เลือกสาย',
  'province': 'กรองตามจังหวัด',
  'prev-page': 'ดูหน้าก่อนหน้าของตาราง',
  'next-page': 'ดูหน้าถัดไปของตาราง',
  'tab-lines': 'เปรียบเทียบจำนวนสถานีของแต่ละสาย',
  'tab-status': 'เปรียบเทียบสถานีที่เปิดแล้วและกำลังก่อสร้างของแต่ละสาย',
  'tab-ridership': 'สถานีเรียงตามผู้โดยสารที่แหล่งข้อมูลรายงาน',
};

if (typeof document !== 'undefined') {
  installNavigation({titles: TITLES, pictogramProbe: ''});
  installHeader();
}
