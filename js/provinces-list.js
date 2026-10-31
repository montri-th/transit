/**
 * Province registry — 77 provinces with the DOPA two-digit code (from the
 * OpenGISData-Thailand layer, see data/provinces.geojson metadata), the Thai and
 * English names used by the research sheets, and the three-letter code used in
 * the breadcrumb URL (?province=CODE).
 *
 * Codes: the nine codes BKK PKT CMI SPK NBI CBI PTE UDN NMA were observed on
 * CityMETER production (landometer.com/v3/citymeter, 2026-10-22, Luxury Brands
 * demo). The remaining 68 follow the same three-letter convention (TIS 1099
 * province abbreviations) and are NOT yet verified against production — see
 * DATA_METHOD.md. A code is a URL key only; the DOPA code and the Thai name
 * stay the identity.
 */
export const PROVINCE_LIST = Object.freeze([
  ['10', 'BKK', 'กรุงเทพมหานคร', 'Bangkok'], ['11', 'SPK', 'สมุทรปราการ', 'Samut Prakan'], ['12', 'NBI', 'นนทบุรี', 'Nonthaburi'], ['13', 'PTE', 'ปทุมธานี', 'Pathum Thani'],
  ['14', 'AYA', 'พระนครศรีอยุธยา', 'Phra Nakhon Si Ayutthaya'], ['15', 'ATG', 'อ่างทอง', 'Ang Thong'], ['16', 'LRI', 'ลพบุรี', 'Lop Buri'], ['17', 'SBR', 'สิงห์บุรี', 'Sing Buri'],
  ['18', 'CNT', 'ชัยนาท', 'Chai Nat'], ['19', 'SRI', 'สระบุรี', 'Saraburi'], ['20', 'CBI', 'ชลบุรี', 'Chon Buri'], ['21', 'RYG', 'ระยอง', 'Rayong'],
  ['22', 'CTI', 'จันทบุรี', 'Chanthaburi'], ['23', 'TRT', 'ตราด', 'Trat'], ['24', 'CCO', 'ฉะเชิงเทรา', 'Chachoengsao'], ['25', 'PRI', 'ปราจีนบุรี', 'Prachin Buri'],
  ['26', 'NYK', 'นครนายก', 'Nakhon Nayok'], ['27', 'SKW', 'สระแก้ว', 'Sa Kaeo'], ['30', 'NMA', 'นครราชสีมา', 'Nakhon Ratchasima'], ['31', 'BRM', 'บุรีรัมย์', 'Buri Ram'],
  ['32', 'SRN', 'สุรินทร์', 'Surin'], ['33', 'SSK', 'ศรีสะเกษ', 'Si Sa Ket'], ['34', 'UBN', 'อุบลราชธานี', 'Ubon Ratchathani'], ['35', 'YST', 'ยโสธร', 'Yasothon'],
  ['36', 'CPM', 'ชัยภูมิ', 'Chaiyaphum'], ['37', 'ACR', 'อำนาจเจริญ', 'Amnat Charoen'], ['38', 'BKN', 'บึงกาฬ', 'Bueng Kan'], ['39', 'NBP', 'หนองบัวลำภู', 'Nong Bua Lam Phu'],
  ['40', 'KKN', 'ขอนแก่น', 'Khon Kaen'], ['41', 'UDN', 'อุดรธานี', 'Udon Thani'], ['42', 'LEI', 'เลย', 'Loei'], ['43', 'NKI', 'หนองคาย', 'Nong Khai'],
  ['44', 'MKM', 'มหาสารคาม', 'Maha Sarakham'], ['45', 'RET', 'ร้อยเอ็ด', 'Roi Et'], ['46', 'KSN', 'กาฬสินธุ์', 'Kalasin'], ['47', 'SNK', 'สกลนคร', 'Sakon Nakhon'],
  ['48', 'NPM', 'นครพนม', 'Nakhon Phanom'], ['49', 'MDH', 'มุกดาหาร', 'Mukdahan'], ['50', 'CMI', 'เชียงใหม่', 'Chiang Mai'], ['51', 'LPN', 'ลำพูน', 'Lamphun'],
  ['52', 'LPG', 'ลำปาง', 'Lampang'], ['53', 'UTD', 'อุตรดิตถ์', 'Uttaradit'], ['54', 'PRE', 'แพร่', 'Phrae'], ['55', 'NAN', 'น่าน', 'Nan'],
  ['56', 'PYO', 'พะเยา', 'Phayao'], ['57', 'CRI', 'เชียงราย', 'Chiang Rai'], ['58', 'MSN', 'แม่ฮ่องสอน', 'Mae Hong Son'], ['60', 'NSN', 'นครสวรรค์', 'Nakhon Sawan'],
  ['61', 'UTI', 'อุทัยธานี', 'Uthai Thani'], ['62', 'KPT', 'กำแพงเพชร', 'Kamphaeng Phet'], ['63', 'TAK', 'ตาก', 'Tak'], ['64', 'STI', 'สุโขทัย', 'Sukhothai'],
  ['65', 'PLK', 'พิษณุโลก', 'Phitsanulok'], ['66', 'PCT', 'พิจิตร', 'Phichit'], ['67', 'PNB', 'เพชรบูรณ์', 'Phetchabun'], ['70', 'RBR', 'ราชบุรี', 'Ratchaburi'],
  ['71', 'KRI', 'กาญจนบุรี', 'Kanchanaburi'], ['72', 'SPB', 'สุพรรณบุรี', 'Suphan Buri'], ['73', 'NPT', 'นครปฐม', 'Nakhon Pathom'], ['74', 'SKN', 'สมุทรสาคร', 'Samut Sakhon'],
  ['75', 'SKM', 'สมุทรสงคราม', 'Samut Songkhram'], ['76', 'PBI', 'เพชรบุรี', 'Phetchaburi'], ['77', 'PKN', 'ประจวบคีรีขันธ์', 'Prachuap Khiri Khan'], ['80', 'NRT', 'นครศรีธรรมราช', 'Nakhon Si Thammarat'],
  ['81', 'KBI', 'กระบี่', 'Krabi'], ['82', 'PNA', 'พังงา', 'Phangnga'], ['83', 'PKT', 'ภูเก็ต', 'Phuket'], ['84', 'SNI', 'สุราษฎร์ธานี', 'Surat Thani'],
  ['85', 'RNG', 'ระนอง', 'Ranong'], ['86', 'CPN', 'ชุมพร', 'Chumphon'], ['90', 'SKA', 'สงขลา', 'Songkhla'], ['91', 'STN', 'สตูล', 'Satun'],
  ['92', 'TRG', 'ตรัง', 'Trang'], ['93', 'PLG', 'พัทลุง', 'Phatthalung'], ['94', 'PTN', 'ปัตตานี', 'Pattani'], ['95', 'YLA', 'ยะลา', 'Yala'],
  ['96', 'NWT', 'นราธิวาส', 'Narathiwat'],
].map(([dopaCode, code, th, en]) => Object.freeze({dopaCode, code, th, en})));

/** Codes verified on CityMETER production (2026-10-22). */
export const PRODUCTION_VERIFIED_CODES = Object.freeze(['BKK', 'PKT', 'CMI', 'SPK', 'NBI', 'CBI', 'PTE', 'UDN', 'NMA']);

const strip = s => String(s || '').trim().replace(/^จังหวัด/, '').replace(/\s+/g, ' ').toLowerCase();
const byCode = new Map(PROVINCE_LIST.map(p => [p.code, p]));
const byDopa = new Map(PROVINCE_LIST.map(p => [p.dopaCode, p]));
const byName = new Map();
for (const p of PROVINCE_LIST) {
  byName.set(strip(p.th), p);
  byName.set(strip(p.en), p);
  byName.set(strip(p.en).replace(/ /g, ''), p);
}
// Common spelling variants seen in public sources.
const VARIANTS = {'chonburi': 'CBI', 'lopburi': 'LRI', 'singburi': 'SBR', 'chainat': 'CNT', 'prachinburi': 'PRI', 'buriram': 'BRM', 'sisaket': 'SSK', 'nongbualamphu': 'NBP', 'phang nga': 'PNA', 'phang-nga': 'PNA', 'suphanburi': 'SPB', 'ayutthaya': 'AYA', 'phra nakhon si ayutthaya': 'AYA', 'bangkok metropolis': 'BKK', 'krung thep maha nakhon': 'BKK', 'krung thep': 'BKK', 'กรุงเทพฯ': 'BKK', 'กรุงเทพ': 'BKK', 'กทม.': 'BKK', 'กทม': 'BKK'};
for (const [k, code] of Object.entries(VARIANTS)) byName.set(strip(k), byCode.get(code));

export const provinceByCode = code => byCode.get(String(code || '').toUpperCase()) || null;
export const provinceByDopa = code => byDopa.get(String(code || '').padStart(2, '0')) || null;
/** Resolve a province by Thai or English name, a production code or a DOPA code. */
export function resolveProvince(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  return byCode.get(s.toUpperCase()) || (/^\d{1,2}$/.test(s) ? byDopa.get(s.padStart(2, '0')) : null) || byName.get(strip(s)) || byName.get(strip(s).replace(/ /g, '')) || null;
}
