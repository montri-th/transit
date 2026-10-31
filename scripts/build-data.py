#!/usr/bin/env python3
"""Build the published data of CityMETER Transit from the research-master export.

Inputs (read-only):
  --export DIR   folder of the verified Google Sheets export
                 (DIR/transit-research-master/*.csv, DIR/dataset-registry/*.csv,
                 DIR/manifest.json) — "CityMETER Transit Thailand — Research Master
                 2026-10-30" and "CityMETER Dataset Registry".
  --osm FILE     optional Overpass API JSON (OpenStreetMap, ODbL) for the station
                 buildings, the elevation of each alignment and line colours.

Outputs (written to --out, default ./data):
  transit.json             systems, lines, stations, interchanges, complexes, meta
  rail-lines.geojson       rail alignments (GTFS shapes, project alignments)
  station-buildings.geojson OSM building footprints matched to stations (empty
                           FeatureCollection with a reason when no OSM file)
  bus.json, boat.json      optional context layers (lazy-loaded by the page)
  build-report.json        counts, holds and checks of this build

Rules carried from the research master and the CityMETER project instructions:
  * one station record = one station–line identity (17_RAIL_CATALOG
    station_catalog_id) or one station–project membership
    (23_CONSTRUCTION_STATIONS construction_station_id). Records are never merged:
    31_INTERCHANGES says physical_entity_merge = FALSE for every relation.
  * "complexes" are a presentation group of records joined by CURRENT interchange
    relations (connected components). They carry no identity claim.
  * statuses are never upgraded: operator roster listed → operating; project
    membership → construction; anything else → unverified.
  * missing is never zero; a held value stays held; values of different series,
    units or periods are never mixed.
  * no Google Drive / Docs links, local file paths or credentials are published —
    the build fails if one reaches an output.

Run:  python3 -I scripts/build-data.py --export <dir> [--osm <overpass.json>] [--out data]
"""
import argparse
import collections
import csv
import datetime
import hashlib
import json
import math
import os
import re
import sys

csv.field_size_limit(1 << 30)
sys.dont_write_bytecode = True  # the OSM stage is imported from this folder; keep the repo free of .pyc
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

RELEASE = 'transit-data-2026-10-31-r1'
AS_OF = '2026-10-31'

# --------------------------------------------------------------------------- IO

class Export:
    def __init__(self, root):
        self.root = root
        self.cache = {}
        with open(os.path.join(root, 'manifest.json'), encoding='utf-8') as fh:
            self.manifest = json.load(fh)

    def tab(self, name, folder='transit-research-master'):
        key = (folder, name)
        if key not in self.cache:
            with open(os.path.join(self.root, folder, name + '.csv'), encoding='utf-8', newline='') as fh:
                self.cache[key] = list(csv.DictReader(fh))
        return self.cache[key]


def iso_date(value):
    """'10/30/2026' → '2026-10-30'; '46326' (sheet serial) → ISO; ISO kept; else ''."""
    v = (value or '').strip()
    if not v:
        return ''
    m = re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{4})', v)
    if m:
        return f'{int(m.group(3)):04d}-{int(m.group(1)):02d}-{int(m.group(2)):02d}'
    if re.fullmatch(r'\d{5}', v):
        return (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(v))).isoformat()
    m = re.fullmatch(r'(\d{4})-(\d{2})(?:-(\d{2}))?', v)
    if m:
        return v
    return ''


def to_float(value):
    v = (value or '').replace(',', '').strip()
    if not v or v in ('-', '–', '—'):
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    return f if math.isfinite(f) else None


def jload(value, default):
    try:
        return json.loads(value) if value else default
    except ValueError:
        return default


# --------------------------------------------------------------------- geometry
LAT0 = 13.75
LNG0 = 100.5
KX = 111320.0 * math.cos(math.radians(LAT0))
KY = 110574.0


def to_xy(lng, lat):
    return ((lng - LNG0) * KX, (lat - LAT0) * KY)


def to_ll(x, y):
    return (LNG0 + x / KX, LAT0 + y / KY)


def decode_polyline(encoded, precision=8):
    """Google encoded polyline → [(lng, lat)]. The sheet stores (lat, lng) pairs at precision 8."""
    coords, index, lat, lng = [], 0, 0, 0
    factor = 10 ** precision
    n = len(encoded)
    while index < n:
        values = []
        for _ in (0, 1):
            shift = result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            values.append(~(result >> 1) if result & 1 else result >> 1)
        lat += values[0]
        lng += values[1]
        coords.append((lng / factor, lat / factor))
    return coords


def geodesic_m(a, b):
    """Equirectangular distance in metres between (lng, lat) points (fine below ~100 km)."""
    k = 111320.0 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((b[0] - a[0]) * k, (b[1] - a[1]) * KY)


def path_length_m(coords):
    return sum(geodesic_m(a, b) for a, b in zip(coords, coords[1:]))


def densify_xy(points, step):
    out = [points[0]]
    for (ax, ay), (bx, by) in zip(points, points[1:]):
        d = math.hypot(bx - ax, by - ay)
        n = int(d // step)
        for i in range(1, n + 1):
            t = i * step / d
            if t < 1:
                out.append((ax + (bx - ax) * t, ay + (by - ay) * t))
        out.append((bx, by))
    return out


def simplify_xy(points, tol):
    """Douglas–Peucker in metres; keeps both ends."""
    if len(points) <= 2:
        return list(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        (ax, ay), (bx, by) = points[i], points[j]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        best, at = -1.0, -1
        for k in range(i + 1, j):
            px, py = points[k]
            if L2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > best:
                best, at = d, k
        if best > tol and at > 0:
            keep[at] = True
            stack.append((i, at))
            stack.append((at, j))
    return [p for p, k in zip(points, keep) if k]


def bearing_deg(a, b):
    """Compass bearing (0 = north, clockwise) from xy point a to b."""
    return (math.degrees(math.atan2(b[0] - a[0], b[1] - a[1])) + 360.0) % 360.0


def nearest_on_paths(pt, paths):
    """Nearest point on any xy path: (distance_m, bearing_deg)."""
    best = (float('inf'), 0.0)
    px, py = pt
    for path in paths:
        for a, b in zip(path, path[1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            L2 = dx * dx + dy * dy
            t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - a[0]) * dx + (py - a[1]) * dy) / L2))
            d = math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy))
            if d < best[0]:
                best = (d, bearing_deg(a, b) if L2 else best[1])
    return best


class Grid:
    """Spatial hash of xy points (metres) with an integer payload per point."""

    def __init__(self, cell):
        self.cell = cell
        self.cells = collections.defaultdict(list)

    def add(self, x, y, payload):
        self.cells[(int(x // self.cell), int(y // self.cell))].append((x, y, payload))

    def near(self, x, y, radius):
        cx, cy = int(x // self.cell), int(y // self.cell)
        r = int(math.ceil(radius / self.cell))
        best, found = radius, None
        for i in range(cx - r, cx + r + 1):
            for j in range(cy - r, cy + r + 1):
                for (qx, qy, payload) in self.cells.get((i, j), ()):
                    d = math.hypot(qx - x, qy - y)
                    if d <= best:
                        best, found = d, payload
        return found


def coverage_union(shapes, tol=30.0, step=15.0, min_run=60.0, simplify=3.0, count=False):
    """Union of overlapping source paths without drawing any stretch twice.

    shapes: [[(lng, lat)…]…] in priority order (longest first). A densified point
    of a later shape that lies within `tol` metres of an already kept point is
    "covered"; only uncovered runs (plus one covered point at each end so the run
    meets the network) are kept. No connecting segment is invented.
    With count=True every kept point counts how many shapes pass it, and runs are
    returned with that per-point count.
    """
    grid = Grid(tol)
    kept = []        # list of runs: [(x, y)]
    counts = []      # per kept point counters (flat), index = payload
    runs_out = []
    for shape in shapes:
        pts = densify_xy([to_xy(*p) for p in shape], step)
        hits = [grid.near(x, y, tol) for x, y in pts]
        if count:
            seen = set()
            for h in hits:
                if h is not None and h not in seen:
                    counts[h] += 1
                    seen.add(h)
        i, n = 0, len(pts)
        while i < n:
            if hits[i] is not None:
                i += 1
                continue
            j = i
            while j < n and hits[j] is None:
                j += 1
            a, b = max(0, i - 1), min(n, j + 1)
            run = pts[a:b]
            length = sum(math.hypot(q[0] - p[0], q[1] - p[1]) for p, q in zip(run, run[1:]))
            if length >= min_run:
                ids = []
                for k, (x, y) in enumerate(run):
                    if (a + k) < i or (a + k) >= j:  # the joining end points already belong to the network
                        ids.append(hits[a + k] if hits[a + k] is not None else -1)
                        continue
                    payload = len(counts)
                    counts.append(1)
                    grid.add(x, y, payload)
                    ids.append(payload)
                runs_out.append((run, ids))
            i = j
    result = []
    for run, ids in runs_out:
        if count:
            result.append(([to_ll(x, y) for x, y in run], [counts[k] if k >= 0 else None for k in ids]))
        else:
            result.append([to_ll(x, y) for x, y in simplify_xy(run, simplify)])
    return result


def rnd(v, d=5):
    return round(v, d)


def line_coords(coords, d=5):
    out = []
    for lng, lat in coords:
        p = [rnd(lng, d), rnd(lat, d)]
        if not out or out[-1] != p:
            out.append(p)
    return out


# -------------------------------------------------------------------- provinces

def load_province_list():
    with open(os.path.join(REPO, 'js', 'provinces-list.js'), encoding='utf-8') as fh:
        text = fh.read()
    rows = re.findall(r"\['(\d{2})', '([A-Z]{3})', '([^']+)', '([^']+)'\]", text)
    if len(rows) != 77:
        raise SystemExit(f'provinces-list.js: expected 77 provinces, found {len(rows)}')
    return [{'dopa': d, 'code': c, 'th': th, 'en': en} for d, c, th, en in rows]


def province_resolver(plist):
    names = {}
    for p in plist:
        names[p['th']] = p
        names[p['en'].lower()] = p
    names['กรุงเทพฯ'] = names['กทม.'] = names['กรุงเทพ'] = names['กรุงเทพมหานคร']

    def resolve(name):
        n = (name or '').strip()
        n = re.sub(r'^(จังหวัด|จ\.)\s*', '', n)
        return names.get(n) or names.get(n.lower())
    return resolve


def load_frames(path, plist):
    with open(path, encoding='utf-8') as fh:
        g = json.load(fh)
    frames = []
    for f in g['features']:
        geom = f['geometry']
        polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
        frames.append((f['id'], polys))
    return frames


def point_in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def frame_of(lng, lat, frames):
    for code, polys in frames:
        for poly in polys:
            if point_in_ring(lng, lat, poly[0]) and not any(point_in_ring(lng, lat, h) for h in poly[1:]):
                return code
    return ''


# ------------------------------------------------------------- publication guard
FORBIDDEN = re.compile(r'docs\.google\.com|drive\.google\.com|googleusercontent|script\.google\.com|/Users/|\.codex/|chatgpt-projects|file://', re.I)


def public_url(url):
    u = (url or '').strip()
    if not u.startswith('https://') or FORBIDDEN.search(u) or any(c in u for c in ' \n\t"<>'):
        return ''
    return u


def first_public(urls):
    for u in urls:
        p = public_url(u)
        if p:
            return p
    return ''


# ------------------------------------------------------------------ vocabulary
# Display names are presentation of the source names (GTFS route_name / project
# name in the sheet), kept short for the map. sourceName keeps the source text.
SYSTEMS = {
    'BTS_SUKHUMVIT': {'name': 'BTS สายสุขุมวิท', 'short': 'สุขุมวิท', 'nameEn': 'BTS Sukhumvit Line', 'gtfs': '1', 'mode': 'urban_rail', 'colourWord': 'เขียวอ่อน'},
    'BTS_SILOM': {'name': 'BTS สายสีลม', 'short': 'สีลม', 'nameEn': 'BTS Silom Line', 'gtfs': '2', 'mode': 'urban_rail', 'colourWord': 'เขียวแก่'},
    'BTS_GOLD': {'name': 'สายสีทอง', 'short': 'สีทอง', 'nameEn': 'Gold Line', 'gtfs': '2025', 'mode': 'urban_rail', 'colourWord': 'ทอง'},
    'MRT_BLUE': {'name': 'MRT สายสีน้ำเงิน', 'short': 'น้ำเงิน', 'nameEn': 'MRT Blue Line', 'gtfs': '3', 'mode': 'urban_rail', 'colourWord': 'น้ำเงิน'},
    'MRT_PURPLE': {'name': 'MRT สายสีม่วง', 'short': 'ม่วง', 'nameEn': 'MRT Purple Line', 'gtfs': '4', 'mode': 'urban_rail', 'colourWord': 'ม่วง'},
    'MRT_PINK': {'name': 'สายสีชมพู', 'short': 'ชมพู', 'nameEn': 'Pink Line', 'gtfs': '2436', 'mode': 'urban_rail', 'colourWord': 'ชมพู'},
    'MRT_YELLOW': {'name': 'สายสีเหลือง', 'short': 'เหลือง', 'nameEn': 'Yellow Line', 'gtfs': '2224', 'mode': 'urban_rail', 'colourWord': 'เหลือง'},
    'ARL_CITY': {'name': 'แอร์พอร์ต เรล ลิงก์', 'short': 'ARL', 'nameEn': 'Airport Rail Link', 'gtfs': '5', 'mode': 'airport_rail', 'colourWord': ''},
    'SRT_RED_NORTH': {'name': 'สายสีแดงเข้ม', 'short': 'แดงเข้ม', 'nameEn': 'SRT Dark Red Line', 'gtfs': '2026', 'mode': 'commuter_rail', 'colourWord': 'แดงเข้ม'},
    'SRT_RED_WEST': {'name': 'สายสีแดงอ่อน', 'short': 'แดงอ่อน', 'nameEn': 'SRT Light Red Line', 'gtfs': '2027', 'mode': 'commuter_rail', 'colourWord': 'แดงอ่อน'},
}
# Construction projects drawn as lines (24_CONSTRUCTION_PROJECTS include_station_catalog = TRUE).
PROJECTS = {
    'MRT_ORANGE_WEST': {'name': 'สายสีส้ม ช่วงตะวันตก', 'short': 'ส้ม (ตก)', 'nameEn': 'Orange Line (West) — under construction', 'mode': 'urban_rail', 'colourWord': 'ส้ม', 'system': 'MRT_ORANGE'},
    'MRT_ORANGE_EAST': {'name': 'สายสีส้ม ช่วงตะวันออก', 'short': 'ส้ม (ออก)', 'nameEn': 'Orange Line (East) — under construction', 'mode': 'urban_rail', 'colourWord': 'ส้ม', 'system': 'MRT_ORANGE'},
    'MRT_PURPLE_SOUTH': {'name': 'สายสีม่วง ช่วงใต้', 'short': 'ม่วง (ใต้)', 'nameEn': 'Purple Line (South) — under construction', 'mode': 'urban_rail', 'colourWord': 'ม่วง', 'system': 'MRT_PURPLE'},
    'THAI_CHINA_HSR_PHASE1': {'name': 'รถไฟความเร็วสูงไทย–จีน ระยะที่ 1', 'short': 'HSR 1', 'nameEn': 'Thai–Chinese HSR Phase 1 — under construction', 'mode': 'high_speed_rail', 'colourWord': '', 'system': 'THAI_CHINA_HSR'},
    'SRT_DENCHAI_CHIANGRAI_CHIANGKHONG': {'name': 'รถไฟสายใหม่ เด่นชัย–เชียงราย–เชียงของ', 'short': 'เด่นชัย–เชียงของ', 'nameEn': 'Den Chai–Chiang Rai–Chiang Khong new line — under construction', 'mode': 'conventional_rail', 'colourWord': '', 'system': 'SRT_NEW_LINES'},
    'SRT_BANPHAI_NAKHONPHANOM': {'name': 'รถไฟสายใหม่ บ้านไผ่–นครพนม', 'short': 'บ้านไผ่–นครพนม', 'nameEn': 'Ban Phai–Nakhon Phanom new line — under construction', 'mode': 'conventional_rail', 'colourWord': '', 'system': 'SRT_NEW_LINES'},
    'SRT_MAPKABAO_CHIRA': {'name': 'รถไฟทางคู่ มาบกะเบา–ชุมทางถนนจิระ', 'short': 'มาบกะเบา–จิระ', 'nameEn': 'Map Kabao–Thanon Chira double track — under construction', 'mode': 'conventional_rail', 'colourWord': '', 'system': 'SRT_DOUBLE_TRACK'},
}
SYSTEM_GROUPS = {
    'MRT_ORANGE': 'MRT สายสีส้ม (ก่อสร้าง)', 'THAI_CHINA_HSR': 'รถไฟความเร็วสูง (ก่อสร้าง)',
    'SRT_NEW_LINES': 'รถไฟสายใหม่ รฟท. (ก่อสร้าง)', 'SRT_DOUBLE_TRACK': 'รถไฟทางคู่ รฟท. (ก่อสร้าง)',
}
# Lines without a sourced colour use an LDS categorical series token (resolved by
# the page per theme). Lines whose name carries a colour wait for a sourced HEX
# (OpenStreetMap route relation `colour`); until then they also use the token
# nearest to the named colour family, flagged colorBasis = 'lds-series-fallback'.
COLOUR_TOKEN = {
    'เขียวอ่อน': 'series-4', 'เขียวแก่': 'series-10', 'ทอง': 'series-3', 'น้ำเงิน': 'series-8', 'ม่วง': 'series-9',
    'ชมพู': 'series-1', 'เหลือง': 'series-3', 'แดงเข้ม': 'series-1', 'แดงอ่อน': 'series-2', 'ส้ม': 'series-2', '': 'series-7',
}
STATUS_BASIS_TH = {
    'operator_roster_listed': 'อยู่ในรายชื่อสถานีปัจจุบันของผู้ให้บริการ · ตรวจ {d}',
    'government_8station_extent_and_gtfs_scheduled': 'อยู่ในรายชื่อ 8 สถานีของภาครัฐและตาราง GTFS · ตรวจ {d}',
}
COORD_ROLE_TH = {
    'station_reference_point_not_entrance': 'จุดอ้างอิงสถานี (ไม่ใช่ทางเข้า)',
    'source_station_reference_not_entrance': 'จุดอ้างอิงสถานี (ไม่ใช่ทางเข้า)',
    'source_reference_point_not_confirmed_entrance': 'จุดอ้างอิงสถานี (ไม่ใช่ทางเข้า)',
}
STAGE_TH = {
    'civil_works_under_construction': 'งานโยธาระหว่างก่อสร้าง',
    'civil_substantially_completed_systems_production_procurement_installation': 'งานโยธาใกล้เสร็จ อยู่ช่วงจัดหาและติดตั้งระบบ',
    'mixed_under_construction_and_unapproved_contract': 'บางสัญญาก่อสร้าง บางสัญญายังไม่อนุมัติ',
}
STATION_STAGE_TH = {
    'project_under_construction_station_stage_unverified': 'ยืนยันระดับโครงการ ยังไม่ทราบงานรายสถานี',
    'station_work_activities_documented': 'มีบันทึกงานที่สถานีนี้',
    'station_works_verified_under_construction': 'ยืนยันงานก่อสร้างที่สถานีนี้',
    'existing_facility_project_member_station_work_stage_unverified': 'สถานีเดิมที่อยู่ในโครงการ ยังไม่ทราบงานรายสถานี',
    'station_civil_works_documented': 'มีบันทึกงานโยธาที่สถานีนี้',
    'station_civil_works_verified_under_construction': 'ยืนยันงานโยธาที่สถานีนี้',
}
METRIC_TH = {
    'overall_project_construction_progress': 'ความก้าวหน้างานก่อสร้างทั้งโครงการ',
    'east_electrical_systems_progress': 'ความก้าวหน้างานระบบไฟฟ้า ช่วงตะวันออก',
    'west_electrical_systems_progress': 'ความก้าวหน้างานระบบไฟฟ้า ช่วงตะวันตก',
    'civil_works_progress_actual': 'ความก้าวหน้างานโยธา (ผลจริง)',
    'overall_civil_project_progress': 'ความก้าวหน้างานโยธาทั้งโครงการ',
    'contract1_construction_progress': 'ความก้าวหน้าสัญญาที่ 1 (บ้านไผ่–หนองพอก)',
    'contract2_construction_progress': 'ความก้าวหน้าสัญญาที่ 2 (หนองพอก–สะพานมิตรภาพ 3)',
    'contract1_and3_overall_progress': 'ความก้าวหน้าสัญญาที่ 1 และ 3',
    'Saraburi_station_construction_progress': 'ความก้าวหน้าอาคารสถานีสระบุรี',
}
PATHWAY_TH = {
    'network_connection_pathway_not_verified': 'เชื่อมตามผังเครือข่าย ยังไม่ยืนยันทางเดิน',
    'operator_routeplanner_walkway_explicit': 'มีทางเชื่อมระบุในระบบวางแผนการเดินทางของผู้ให้บริการ',
    'walkway_construction_survey20260224_current_completion_unverified': 'มีรายงานงานทางเชื่อม 24 ก.พ. 2569 ยังไม่ยืนยันว่าเปิดครบ',
    'operator_internal_transfer_wayfinding_including_lifts': 'ป้ายบอกทางเปลี่ยนสายในสถานี รวมลิฟต์',
    'operator_ticket2_connection_declared': 'ผู้ให้บริการประกาศจุดเชื่อมต่อ',
    'operator_shared_complex_connection_declared': 'ผู้ให้บริการประกาศว่าเป็นอาคารร่วม',
    'within_station_branch_platform_change': 'เปลี่ยนชานชาลาภายในสถานีสำหรับสายแยก',
    'within_station_mainline_spur_platform_change': 'เปลี่ยนชานชาลาภายในสถานีสำหรับสายแยก',
    'future_project_connection_access_not_open': 'ทางเชื่อมในโครงการอนาคต ยังไม่เปิด',
    'future_to_future_connection_both_unopened': 'ทางเชื่อมระหว่างโครงการอนาคตทั้งสองฝั่ง',
    'future_HSR_shared_building_platform_access_unlocated': 'อาคารร่วมกับรถไฟความเร็วสูงในอนาคต ยังไม่ทราบตำแหน่งชานชาลา',
}
SCOPE_STATUS_TH = {'current': 'เชื่อมตามผังปัจจุบัน', 'branch': 'เปลี่ยนขบวนภายในสาย', 'future': 'อนาคต ยังไม่เปิด'}


def natural_key(code):
    m = re.match(r'([A-Za-z]*)(\d*)', code or '')
    return (m.group(1), int(m.group(2)) if m.group(2) else -1, code)


def order_codes(system_id, rows):
    """Station order along a line from the station codes of the operator roster."""
    def key(r):
        code = r['station_code']
        m = re.match(r'([A-Z]+)(\d*)$', code)
        prefix, number = (m.group(1), int(m.group(2) or 0)) if m else (code, 0)
        if system_id == 'BTS_SUKHUMVIT':
            return ({'N': 0, 'CEN': 1, 'E': 2}.get(prefix, 3), -number if prefix == 'N' else number)
        if system_id == 'BTS_SILOM':
            return ({'W': 0, 'CEN': 1, 'S': 2}.get(prefix, 3), -number if prefix == 'W' else number)
        if system_id == 'MRT_PINK':
            return ({'PK': 0, 'MT': 1}.get(prefix, 2), number)
        return (0, number, prefix)
    return sorted(rows, key=key)


# ----------------------------------------------------------------------- shapes

class Shapes:
    def __init__(self, ex):
        self.geom = {r['geometry_id']: r for r in ex.tab('26_ROUTE_GEOMETRY')}
        self.parts = collections.defaultdict(list)
        for p in ex.tab('27_GEOMETRY_PARTS'):
            self.parts[p['geometry_id']].append(p)
        self.cache = {}

    def coords(self, gid):
        if gid not in self.cache:
            parts = sorted(self.parts.get(gid, []), key=lambda p: int(p['part_index']))
            if not parts:
                self.cache[gid] = []
            else:
                enc = ''.join(p['encoded_polyline_fragment'] for p in parts)
                precision = int(parts[0]['encoded_precision'] or 8)
                coords = decode_polyline(enc, precision)
                # integrity: decoded length within 1.5 % of the sheet's own length (precision rules, not a guess)
                L = path_length_m(coords)
                ref = to_float(self.geom.get(gid, {}).get('length_of_source_shape_m'))
                if ref and abs(L - ref) / ref > 0.015:
                    raise SystemExit(f'{gid}: decoded length {L:.0f} m differs from sheet {ref:.0f} m')
                self.cache[gid] = coords
        return self.cache[gid]


# ------------------------------------------------------------------------ build

def build(ex, frames, resolve_province, report):
    shapes = Shapes(ex)
    entities = {r['canonical_stop_id']: r for r in ex.tab('09_ENTITIES')}
    sources = {r['source_id']: r for r in ex.tab('07_SOURCES')}
    routes = ex.tab('03_ROUTES')
    agencies = {}
    for a in ex.tab('16_GTFS_AGENCIES'):
        agencies.setdefault(a['agency_id'], a)
    used_sources = collections.Counter()

    def province_of(name, lng, lat, basis):
        p = resolve_province(name)
        if p:
            return p['code'], basis
        code = frame_of(lng, lat, frames) if lng is not None else ''
        return code, ('frame_point_in_polygon' if code else '')

    # ---------------- operating lines (17_RAIL_CATALOG)
    catalog = ex.tab('17_RAIL_CATALOG')
    by_system = collections.defaultdict(list)
    for r in catalog:
        by_system[r['system_id']].append(r)
    gtfs_routes = {r['gtfs_route_id']: r for r in routes if r['source_id'] == 'SRC_OTP_NAMTANG_GTFS'}

    systems, lines, stations, line_features = [], [], [], []
    station_by_id = {}
    for sid, cfg in SYSTEMS.items():
        rows = order_codes(sid, by_system[sid])
        route = gtfs_routes.get(cfg['gtfs'])
        if not route:
            raise SystemExit(f'GTFS route {cfg["gtfs"]} for {sid} missing')
        agency = agencies.get(route['agency_id'], {})
        agency_name = (agency.get('agency_name') or '').split(';')[0].strip()
        gids = jload(route['geometry_ids'], [])
        paths = sorted((shapes.coords(g) for g in gids), key=path_length_m, reverse=True)
        union = coverage_union([p for p in paths if len(p) >= 2], tol=30.0)
        length_km = sum(path_length_m(u) for u in union) / 1000.0
        used_sources['SRC_OTP_NAMTANG_GTFS'] += 1
        systems.append({'id': sid, 'name': cfg['name'], 'nameEn': cfg['nameEn'], 'mode': cfg['mode'], 'operator': agency_name, 'operatorId': route['agency_id'], 'status': 'operating'})
        line = {
            'id': sid, 'systemId': sid, 'name': cfg['name'], 'nameEn': cfg['nameEn'], 'short': cfg['short'], 'code': '',
            'sourceName': route['route_name'], 'mode': cfg['mode'], 'status': 'operating',
            'color': None, 'colorToken': COLOUR_TOKEN[cfg['colourWord']], 'colorBasis': 'lds-series-fallback', 'colourWord': cfg['colourWord'],
            'operator': agency_name, 'operatorBasis': 'agency ใน GTFS (ไม่ใช่การยืนยันผู้ประกอบการตามกฎหมาย)',
            'stationIds': [r['station_catalog_id'] for r in rows],
            'lengthKm': round(length_km, 1), 'lengthSource': 'แนวเส้นใน GTFS ของ สนข. (ไม่ใช่ระยะทางที่สำรวจ)',
            'calendar': {'listedOn': iso_date(route['service_date']), 'listed': route['calendar_listed_on_target'] == 'TRUE', 'status': route['current_operating_status']},
            'sources': [{'title': 'GTFS เส้นทางและแนวเส้น (สนข.)', 'url': public_url(sources['SRC_OTP_NAMTANG_GTFS']['source_url'])}],
            'geometryIds': gids,
        }
        roster_src = sources.get(rows[0]['source_id'], {})
        if public_url(rows[0]['source_url']):
            line['sources'].insert(0, {'title': f'รายชื่อสถานี ({roster_src.get("provider", "ผู้ให้บริการ")})', 'url': public_url(rows[0]['source_url'])})
        lines.append(line)
        for k, coords in enumerate(union):
            line_features.append({'type': 'Feature', 'properties': {'lineId': sid, 'status': 'operating', 'elevation': None, 'part': k, 'source': 'SRC_OTP_NAMTANG_GTFS'},
                                  'geometry': {'type': 'LineString', 'coordinates': line_coords(coords)}})
        xy_paths = [[to_xy(*p) for p in u] for u in union]
        for r in rows:
            ent = entities.get(r['canonical_reference_id'], {})
            lat = to_float(ent.get('latitude')) if ent.get('coordinate_status') == 'selected_source_position' else None
            lng = to_float(ent.get('longitude')) if lat is not None else None
            coord_status = 'selected'
            if lat is None:
                lat, lng = to_float(r['latitude']), to_float(r['longitude'])
                coord_status = 'conflict_held' if ent.get('coordinate_status') == 'coordinate_conflict_held' else ('catalog' if lat is not None else 'missing')
            if r['gtfs_coordinate_correspondence_status'] == 'hold_coordinate_conflict':
                coord_status = 'conflict_held' if coord_status != 'selected' else 'selected_gtfs_conflict'
            code, pbasis = province_of(ent.get('reference_province'), lng, lat, 'reference_province')
            dist, bearing = nearest_on_paths(to_xy(lng, lat), xy_paths) if lat is not None else (None, 0.0)
            note = COORD_ROLE_TH.get(ent.get('coordinate_role') or r['coordinate_role'], 'จุดอ้างอิงตามแหล่ง')
            if coord_status == 'conflict_held':
                note = 'พิกัดโดยประมาณ — สองแหล่งยังให้ตำแหน่งไม่ตรงกัน'
            elif coord_status == 'selected_gtfs_conflict':
                note += ' · พิกัดใน GTFS ยังไม่ตรงกับแหล่งนี้'
            checked = iso_date(r['checked_on'])
            st = {
                'id': r['station_catalog_id'], 'name': r['name_th'], 'nameEn': r['name_en'], 'codes': [r['station_code']] if r['station_code'] else [],
                'lineIds': [sid], 'systemIds': [sid], 'lat': round(lat, 6) if lat is not None else None, 'lng': round(lng, 6) if lng is not None else None,
                'status': 'operating', 'statusCode': r['service_status'],
                'statusBasis': STATUS_BASIS_TH.get(r['service_status'], 'ตามรายชื่อผู้ให้บริการ').format(d=thai_short(checked)),
                'provinceCode': code, 'provinceBasis': pbasis, 'district': ent.get('reference_district', ''),
                'elevation': None, 'bearing': round(bearing, 1), 'lineDistanceM': round(dist, 1) if dist is not None else None,
                'interchangeIds': [], 'complexId': '', 'ridership': [],
                'sourceRefs': [x for x in [{'url': public_url(r['source_url']), 'label': 'รายชื่อสถานี'}] if x['url']],
                'checkedOn': checked, 'coordinateNote': note, 'coordStatus': coord_status,
                'canonicalStopId': r['canonical_reference_id'], 'observationId': r['source_observation_id'],
                'gtfsStopId': r['gtfs_stop_id'],
            }
            used_sources[r['source_id']] += 1
            stations.append(st)
            station_by_id[st['id']] = st

    # ---------------- construction projects (23 / 24)
    projects = {r['project_id']: r for r in ex.tab('24_CONSTRUCTION_PROJECTS')}
    cons = ex.tab('23_CONSTRUCTION_STATIONS')
    by_project = collections.defaultdict(list)
    for r in cons:
        by_project[r['project_id']].append(r)
    project_routes = collections.defaultdict(list)
    for g in ex.tab('26_ROUTE_GEOMETRY'):
        m = re.search(r'ProjectID=([A-Z0-9_]+)', g['notes'])
        if m:
            project_routes[m.group(1)].append(g['geometry_id'])
    for r in routes:
        if r['route_scope'] == 'project_alignment_reference_not_service_route':
            report['projectAlignments'].append({'route': r['route_record_id'], 'name': r['route_name'], 'geometries': len(jload(r['geometry_ids'], []))})
    for pid, cfg in PROJECTS.items():
        p = projects[pid]
        rows = sorted(by_project[pid], key=lambda r: natural_key(r['station_code_current'] or r['construction_station_id'].split(':')[-1]))
        measures = jload(p['progress_measurements_json'], [])
        headline = next((m for m in measures if m.get('metric') in ('overall_project_construction_progress', 'overall_civil_project_progress', 'civil_works_progress_actual', 'contract1_and3_overall_progress')), None)
        if headline is None and measures:
            headline = measures[0]
        group = cfg['system']
        if not any(s['id'] == group for s in systems):
            systems.append({'id': group, 'name': SYSTEM_GROUPS.get(group) or cfg['name'], 'nameEn': '', 'mode': cfg['mode'], 'operator': '', 'operatorId': '', 'status': 'construction'})
        gids = project_routes.get(pid, [])
        line = {
            'id': pid, 'systemId': group, 'name': cfg['name'], 'nameEn': cfg['nameEn'], 'short': cfg['short'], 'code': '',
            'sourceName': p['project_name_th'], 'mode': cfg['mode'], 'status': 'construction',
            'color': None, 'colorToken': COLOUR_TOKEN[cfg['colourWord']], 'colorBasis': 'lds-series-fallback', 'colourWord': cfg['colourWord'],
            'operator': '', 'stationIds': [r['construction_station_id'] for r in rows],
            'lengthKm': None, 'lengthSource': '',
            'stage': STAGE_TH.get(p['stage'], p['stage']), 'stageCode': p['stage'],
            'progressPercent': headline.get('value') if headline else None,
            'progressMetric': METRIC_TH.get(headline.get('metric'), headline.get('metric')) if headline else '',
            'progressPeriod': (headline.get('period_end') or '') if headline else '',
            'progressSource': public_url(sources.get(headline.get('source_id'), {}).get('source_url', '')) if headline else '',
            'progressAll': [{'metric': METRIC_TH.get(m.get('metric'), m.get('metric')), 'value': m.get('value'), 'unit': m.get('unit'), 'period': m.get('period_end'), 'scope': m.get('scope', ''),
                             'source': public_url(sources.get(m.get('source_id'), {}).get('source_url', ''))} for m in measures],
            'target': p['source_target_dates'], 'targetNote': 'เป้าหมายตามแหล่ง ไม่ใช่วันเปิดจริง',
            'startSource': p['construction_start_source'],
            'sources': [x for x in [{'title': 'หน้าโครงการ', 'url': public_url(p['source_url'])}, {'title': 'รายชื่อสถานีโครงการ', 'url': public_url(p['roster_url'])}] if x['url']],
            'geometryIds': gids,
        }
        if line['progressPercent'] is None:
            report['holds'].append(f'{pid}: no project-level progress value in the sheet')
        lines.append(line)
        drawn = 0
        for gid in gids:
            coords = shapes.coords(gid)
            if len(coords) >= 2:
                drawn += 1
                line_features.append({'type': 'Feature', 'properties': {'lineId': pid, 'status': 'construction', 'elevation': None, 'part': drawn - 1, 'source': shapes.geom[gid]['source_id'],
                                                                         'quality': shapes.geom[gid]['geometry_quality_status']},
                                      'geometry': {'type': 'LineString', 'coordinates': line_coords([to_ll(*q) for q in simplify_xy([to_xy(*c) for c in coords], 4.0)])}})
        if gids:
            line['lengthKm'] = None  # project alignment components are references, not a route length
            line['alignmentNote'] = 'แนวโครงการอ้างอิงจากแหล่ง (ไม่ใช่แบบก่อสร้างล่าสุดหรือแนวสำรวจ)'
        else:
            line['alignmentNote'] = 'ยังไม่มีแนวเส้นทางจากแหล่งที่ตรวจได้ แสดงเฉพาะตำแหน่งสถานี'
        report['constructionLines'].append({'id': pid, 'stations': len(rows), 'alignmentParts': drawn})
        # stations
        prev = None
        for i, r in enumerate(rows):
            lat, lng = to_float(r['latitude']), to_float(r['longitude'])
            code, pbasis = province_of(r['reference_province'], lng, lat, 'reference_province')
            role = r['construction_scope_role']
            status = 'construction' if role == 'new_station_or_halt_in_construction_project' else 'unverified'
            nxt = rows[i + 1] if i + 1 < len(rows) else None
            a = prev or r
            b = nxt or r
            bearing = 0.0
            if (to_float(a['latitude']) is not None and to_float(b['latitude']) is not None) and a is not b:
                bearing = bearing_deg(to_xy(to_float(a['longitude']), to_float(a['latitude'])), to_xy(to_float(b['longitude']), to_float(b['latitude'])))
            prev = r
            station_percent = to_float(r['station_progress_percent'])
            st = {
                'id': r['construction_station_id'], 'name': r['name_th'], 'nameEn': '', 'codes': [r['station_code_current']] if r['station_code_current'] else [],
                'lineIds': [pid], 'systemIds': [group], 'lat': round(lat, 6) if lat is not None else None, 'lng': round(lng, 6) if lng is not None else None,
                'status': status, 'statusCode': r['passenger_service_status'],
                'statusBasis': ('สมาชิกโครงการก่อสร้าง ยังไม่เปิดให้บริการ' if status == 'construction' else
                                'สถานีเดิมหรือชุมทางอ้างอิงของโครงการ ยังไม่ยืนยันบทบาทรับผู้โดยสาร — ไม่สรุปว่าปิด'),
                'projectRole': role,
                'provinceCode': code, 'provinceBasis': pbasis, 'district': r['reference_district'],
                'elevation': None, 'bearing': round(bearing, 1), 'interchangeIds': [], 'complexId': '', 'ridership': [],
                'construction': {
                    'stage': STATION_STAGE_TH.get(r['station_construction_stage'], r['station_construction_stage']),
                    'projectStage': STAGE_TH.get(r['project_stage'], r['project_stage']),
                    'percent': station_percent, 'percentScope': 'อาคารสถานี' if station_percent is not None else '',
                    'period': iso_date(r['station_progress_period']) if station_percent is not None else iso_date(r['station_stage_evidence_date']) or r['station_stage_evidence_period'],
                    'projectPercent': to_float(r['project_progress_percent']), 'projectMetric': METRIC_TH.get(r['project_progress_metric'], r['project_progress_metric']),
                    'projectPeriod': iso_date(r['project_report_period_end']), 'target': r['source_target_dates'],
                    'evidence': public_url(r['construction_status_source_url']),
                },
                'sourceRefs': [x for x in [{'url': public_url(r['roster_source_url']), 'label': 'รายชื่อสถานีโครงการ'},
                                           {'url': public_url(r['construction_status_source_url']), 'label': 'สถานะงาน'}] if x['url']],
                'checkedOn': iso_date(r['checked_on']),
                'coordinateNote': coordinate_note_construction(r),
                'coordStatus': r['coordinate_status'],
                'canonicalStopId': r['canonical_stop_id'], 'observationId': r['observation_id'],
            }
            used_sources[r['source_id']] += 1
            stations.append(st)
            station_by_id[st['id']] = st

    # ---------------- interchanges (31)
    interchanges = []
    scope_map = {'current_network': 'current', 'within_line_branch': 'branch', 'future_project': 'future'}
    for r in ex.tab('31_INTERCHANGES'):
        ids = [x for x in (r['left_catalog_or_project_id'], r['right_catalog_or_project_id']) if x]
        present = [x for x in dict.fromkeys(ids) if x in station_by_id]
        external = None
        if not r['right_catalog_or_project_id']:
            external = {'name': r['right_name_th'], 'systemId': r['right_system_id'], 'canonicalStopId': r['right_canonical_stop_id']}
        scope = scope_map[r['connection_scope']]
        rec = {
            'id': r['interchange_id'], 'scope': scope, 'name': r['interchange_name_th'], 'stationIds': present,
            'external': external, 'pathwayCode': r['pathway_status'], 'pathwayLabel': PATHWAY_TH.get(r['pathway_status'], ''),
            'statusLabel': SCOPE_STATUS_TH[scope], 'stepFree': r['published_step_free_route'] == 'TRUE',
            'sourceUrl': first_public(jload(r['evidence_urls_json'], [])), 'checkedOn': iso_date(r['checked_on']),
        }
        if len(present) < len(set(ids)):
            report['holds'].append(f'interchange {r["interchange_id"]}: endpoint not in the published records {set(ids) - set(present)}')
        interchanges.append(rec)
        for x in present:
            station_by_id[x]['interchangeIds'].append(rec['id'])
        used_sources[r['source_id']] += 1

    # ---------------- complexes: connected components of current relations between rail records
    parent = {}

    def find(x):
        while parent.setdefault(x, x) != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for ic in interchanges:
        if ic['scope'] == 'current' and len(ic['stationIds']) == 2:
            a, b = (find(x) for x in ic['stationIds'])
            if a != b:
                parent[a] = b
    groups = collections.defaultdict(list)
    for x in parent:
        groups[find(x)].append(x)
    line_size = collections.Counter(l for s in stations if s['status'] == 'operating' for l in s['lineIds'])
    complexes = []
    for members in groups.values():
        members = sorted(members, key=lambda x: (station_by_id[x]['lineIds'][0], x))
        line_ids = sorted({l for x in members for l in station_by_id[x]['lineIds']})
        if len(line_ids) < 2:
            continue
        names = list(dict.fromkeys(re.sub(r'\s*\([^)]*\)\s*$', '', station_by_id[x]['name']).strip() for x in members))
        cid = 'CX-' + hashlib.sha1('|'.join(members).encode()).hexdigest()[:10]
        lat = sum(station_by_id[x]['lat'] for x in members) / len(members)
        lng = sum(station_by_id[x]['lng'] for x in members) / len(members)
        complexes.append({'id': cid, 'name': '–'.join(names), 'stationIds': members, 'lineIds': line_ids,
                          'reach': sum(line_size[l] for l in line_ids), 'lat': round(lat, 6), 'lng': round(lng, 6)})
        for x in members:
            station_by_id[x]['complexId'] = cid
    complexes.sort(key=lambda c: (-len(c['lineIds']), -c['reach'], c['name']))

    # ---------------- ridership (04): same series only
    build_ridership(ex, stations, station_by_id, sources, used_sources, report)

    return systems, lines, stations, interchanges, complexes, line_features, used_sources


def thai_short(iso):
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', iso or '')
    if not m:
        return iso or ''
    months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
    return f'{int(m.group(3))} {months[int(m.group(2)) - 1]} {int(m.group(1)) + 543}'


def coordinate_note_construction(r):
    role = r['coordinate_role'].replace('_', ' ')
    note = {
        'named_station_centerline_reference': 'จุดอ้างอิงแนวศูนย์สถานีจากแบบโครงการ',
        'official_planning_map_station_reference_not_entrance_or_survey_control': 'จุดอ้างอิงจากแผนที่วางแผนทางการ ไม่ใช่ทางเข้าหรือหมุดสำรวจ',
        'project_station_reference_marker_not_entrance_or_survey_control': 'หมุดสถานีจากแผนที่โครงการ ไม่ใช่ทางเข้าหรือหมุดสำรวจ',
        'community_mapped_station_reference': 'จุดอ้างอิงจากแผนที่ชุมชน (OSM)',
        'approximate_official_project_station_map_reference': 'จุดอ้างอิงโดยประมาณจากแผนที่โครงการทางการ',
        'community_construction_station_reference_not_entrance_or_survey_control': 'จุดอ้างอิงงานก่อสร้างจากแผนที่ชุมชน ไม่ใช่ทางเข้า',
    }.get(r['coordinate_role'], 'จุดอ้างอิงสถานีตามแหล่ง')
    acc = r['coordinate_accuracy_note']
    if '500' in acc and 'm' in acc:
        note += ' · ช่วงตีความประมาณ 500 ม.'
    elif '100m' in acc.replace(' ', '') or '100 m' in acc:
        note += ' · ช่วงตีความประมาณ 100 ม.'
    elif '20m' in acc.replace(' ', ''):
        note += ' · ช่วงตีความประมาณ 20 ม.'
    return note


def build_ridership(ex, stations, station_by_id, sources, used_sources, report):
    by_obs = {s['observationId']: s for s in stations if s.get('observationId')}
    rows = ex.tab('04_RIDERSHIP')
    # ARL daily directional counts: calendar year 2024 (complete leap year in the series), holds excluded.
    arl = collections.defaultdict(lambda: {'sum': 0.0, 'days': set(), 'held': 0})
    bts = collections.defaultdict(lambda: {'sum': 0.0, 'months': set(), 'missing': 0})
    siam = {'sum': 0.0, 'months': set()}
    for r in rows:
        if r['source_id'] == 'SRC-TR-RAIL-ARL-DAILY':
            start = iso_date(r['period_start'])
            if not start.startswith('2024-'):
                continue
            key = (r['entity_observation_id'], r['metric'])
            if r['aggregate_status'] != 'same_series_only' or r['value_status'] != 'measured':
                arl[key]['held'] += 1
                continue
            v = to_float(r['value'])
            if v is None:
                arl[key]['held'] += 1
                continue
            arl[key]['sum'] += v
            arl[key]['days'].add(start)
        elif r['source_id'] == 'SRC-TR-RAIL-BTS-RIDERSHIP-2564':
            month = iso_date(r['period_start'])[:7]
            v = to_float(r['value'])
            if r['entity_link_status'].startswith('held_Siam'):
                if v is not None:
                    siam['sum'] += v
                    siam['months'].add(month)
                continue
            key = r['entity_observation_id']
            if v is None or r['value_status'] != 'measured':
                bts[key]['missing'] += 1
                continue
            bts[key]['sum'] += v
            bts[key]['months'].add(month)
    arl_src = public_url(sources['SRC-TR-RAIL-ARL-DAILY']['source_url'])
    bts_src = public_url(sources['SRC-TR-RAIL-BTS-RIDERSHIP-2564']['source_url'])
    label = {'passenger_arrival': 'ผู้โดยสาร arrival', 'passenger_departure': 'ผู้โดยสาร departure'}
    for (obs, metric), v in sorted(arl.items()):
        st = by_obs.get(obs)
        if not st or not v['days']:
            continue
        days = len(v['days'])
        st['ridership'].append({
            'metric': f'arl_{metric}_daily_mean_2024', 'value': round(v['sum'] / days), 'unit': 'ครั้งต่อวัน',
            'label': f'{label[metric]} เฉลี่ยต่อวัน', 'period': f'ปี 2567 · {days} วันที่มีข้อมูล', 'aggregation': 'mean_of_daily_measured',
            'days': days, 'heldDays': v['held'], 'source': arl_src, 'dataset': 'ARL รายสถานี รายวัน (กรมการขนส่งทางราง)',
            'note': 'นับแยกทิศตามแหล่ง ไม่ใช่จำนวนคนไม่ซ้ำ หน่วยต้นทางไม่ระบุ', 'seriesKey': f'ARL:{metric}:{st["codes"][0] if st["codes"] else st["id"]}',
        })
        used_sources['SRC-TR-RAIL-ARL-DAILY'] += 1
    for obs, v in sorted(bts.items()):
        st = by_obs.get(obs)
        if not st:
            continue
        complete = len(v['months']) == 12
        st['ridership'].append({
            'metric': 'bts_outgoing_trips_2564', 'value': round(v['sum']), 'unit': 'เที่ยวคน',
            'label': 'ผู้โดยสารขาออก รวมทั้งปี',
            'period': 'ปี 2564' + ('' if complete else f' · {len(v["months"])} จาก 12 เดือน'), 'aggregation': 'sum_of_monthly_totals' if complete else 'sum_of_available_months',
            'months': len(v['months']), 'source': bts_src, 'dataset': 'สถิติกรุงเทพมหานคร: ผู้โดยสาร BTS ขาออกรายสถานี รายเดือน',
            'note': 'ปี 2564 อยู่ในช่วงมาตรการโควิด-19 ใช้เทียบระหว่างสถานีในปีเดียวกันเท่านั้น', 'seriesKey': f'BTS2564:{obs}',
        })
        used_sources['SRC-TR-RAIL-BTS-RIDERSHIP-2564'] += 1
    if siam['months']:
        for st in stations:
            if st['status'] == 'operating' and st['codes'] == ['CEN'] and st['lineIds'][0] in ('BTS_SUKHUMVIT', 'BTS_SILOM'):
                st['ridership'].append({
                    'metric': 'bts_outgoing_trips_2564', 'value': round(siam['sum']), 'unit': 'เที่ยวคน',
                    'label': 'ผู้โดยสารขาออก รวมทั้งปี · ทั้งสถานีสยาม (สองสายรวมกัน)', 'period': 'ปี 2564',
                    'aggregation': 'sum_of_monthly_totals' if len(siam['months']) == 12 else 'sum_of_available_months', 'months': len(siam['months']),
                    'source': bts_src, 'dataset': 'สถิติกรุงเทพมหานคร: ผู้โดยสาร BTS ขาออกรายสถานี รายเดือน', 'shared': True,
                    'note': 'แหล่งรวมสองสายไว้ด้วยกัน ระเบียนนี้แสดงเหมือนกันทั้งสองสาย และนับครั้งเดียวในกราฟ', 'seriesKey': 'BTS2564:SIAM',
                })
    report['ridership'] = {
        'arlStations': sum(1 for s in stations if any(r['metric'].startswith('arl_') for r in s['ridership'])) ,
        'btsStations': sum(1 for s in stations if any(r['metric'] == 'bts_outgoing_trips_2564' for r in s['ridership'])),
        'arlHeldRows2024': sum(v['held'] for v in arl.values()),
        'btsMissingRows': sum(v['missing'] for v in bts.values()),
        'siamMonths': len(siam['months']),
    }


# ------------------------------------------------------------- optional layers

def encode_polyline(coords, precision=5):
    """[(lng, lat)] → Google encoded polyline of (lat, lng) at `precision` (decoded by js/polyline.js)."""
    factor = 10 ** precision
    out, plat, plng = [], 0, 0
    for lng, lat in coords:
        ilat, ilng = int(round(lat * factor)), int(round(lng * factor))
        for d in (ilat - plat, ilng - plng):
            v = ~(d << 1) if d < 0 else d << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        plat, plng = ilat, ilng
    return ''.join(out)


BUS_CLASSES = [(1, 1), (2, 3), (4, 7), (8, 15), (16, 10 ** 6)]


def bus_class(n):
    for i, (a, b) in enumerate(BUS_CLASSES):
        if a <= n <= b:
            return i
    return 0


def class_runs(coords, counts, min_len=250.0):
    """Split a counted run into stretches of one count class; stretches shorter than min_len join a neighbour."""
    xy = [to_xy(*p) for p in coords]
    cls = [bus_class(c) for c in counts]
    runs = []
    start = 0
    for k in range(1, len(xy) + 1):
        if k == len(xy) or cls[k] != cls[start]:
            seg_len = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(xy[start:k + 1], xy[start + 1:k + 1]))
            runs.append([cls[start], start, min(k, len(xy) - 1), seg_len, counts[start:k]])
            start = k
    merged = []
    for r in runs:
        if merged and (r[3] < min_len or merged[-1][3] < min_len):
            m = merged[-1]
            keep_cls = m[0] if m[3] >= r[3] else r[0]
            merged[-1] = [keep_cls, m[1], r[2], m[3] + r[3], m[4] + r[4]]
        else:
            merged.append(r)
    for c, a, b, _, cs in merged:
        if b > a:
            vals = sorted(cs)
            yield c, vals[len(vals) // 2], [to_ll(*q) for q in simplify_xy(xy[a:b + 1], 8.0)]


def build_bus(ex, shapes):
    routes = [r for r in ex.tab('03_ROUTES') if r['mode_id'] == 'bus' and r['source_id'] == 'SRC_OTP_NAMTANG_GTFS' and r['calendar_listed_on_target'] == 'TRUE']
    picks = []
    for r in routes:
        gids = [g for g in jload(r['geometry_ids'], []) if shapes.coords(g)]
        if not gids:
            continue
        g = max(gids, key=lambda x: path_length_m(shapes.coords(x)))
        coords = shapes.coords(g)
        b = (min(c[0] for c in coords), min(c[1] for c in coords), max(c[0] for c in coords), max(c[1] for c in coords))
        if b[0] < 99.9 or b[2] > 101.2 or b[1] < 13.2 or b[3] > 14.4:  # Bangkok Metropolitan Region frame of this layer
            continue
        picks.append(coords)
    picks.sort(key=path_length_m, reverse=True)
    runs = coverage_union(picks, tol=25.0, step=20.0, min_run=80.0, count=True)
    lines = []
    for coords, counts in runs:
        filled = [c for c in counts if c is not None]
        if len(coords) < 2 or not filled:
            continue
        counts = [c if c is not None else filled[0] for c in counts]
        for c, n, seg in class_runs(coords, counts):
            if len(seg) >= 2:
                lines.append({'c': c, 'n': n, 'p': encode_polyline(seg)})
    stops = []
    brt_stations = []
    for e in ex.tab('09_ENTITIES'):
        if e['mode_id'] in ('bus', 'bus_rapid_transit') and e['entity_grain'] == 'provider_stop_reference' and e['current_operating_status'].startswith('calendar_listed'):
            lat, lng = to_float(e['latitude']), to_float(e['longitude'])
            if lat is None or not (13.2 <= lat <= 14.4 and 99.9 <= lng <= 101.2):
                continue
            if e['mode_id'] == 'bus_rapid_transit':
                brt_stations.append({'name': e['name_th'], 'lng': rnd(lng), 'lat': rnd(lat)})
            else:
                stops.append((lng, lat))
    stops.sort(key=lambda p: (round(p[1], 2), p[0]))
    brt = []
    for r in ex.tab('03_ROUTES'):
        if r['mode_id'] == 'bus_rapid_transit':
            gids = jload(r['geometry_ids'], [])
            if gids:
                g = max(gids, key=lambda x: path_length_m(shapes.coords(x)))
                brt.append({'name': r['route_name'], 'p': encode_polyline(shapes.coords(g))})
    return {
        'meta': {'source': 'GTFS ของ สนข. (OTP Namtang) รุ่น 20261029 · CC BY 4.0', 'calendarDate': '2026-10-30', 'routesUsed': len(picks), 'stops': len(stops),
                 'frame': 'กรุงเทพฯ และปริมณฑล (กรอบสี่เหลี่ยม 99.9–101.2°E, 13.2–14.4°N)',
                 'reading': 'เส้นคือช่วงถนนที่มีแนวเส้นทางรถเมล์ตาม GTFS ผ่าน ตัวเลขคือจำนวนระเบียนเส้นทางที่ผ่านช่วงนั้น ไม่ใช่ความถี่หรือจำนวนรถจริง',
                 'classes': [list(c) for c in BUS_CLASSES], 'encoding': 'polyline5 (lat,lng)'},
        'routes': lines,
        'stops': encode_polyline(stops),
        'brt': {'routes': brt, 'stations': brt_stations},
    }


def build_boat(ex, shapes):
    feats, names = [], {}
    for r in ex.tab('03_ROUTES'):
        if r['mode_id'] not in ('river_boat', 'canal_boat', 'cross_river_ferry') or r['source_id'] != 'SRC_OTP_NAMTANG_GTFS':
            continue
        gids = [g for g in jload(r['geometry_ids'], []) if shapes.coords(g)]
        if not gids:
            continue
        g = max(gids, key=lambda x: path_length_m(shapes.coords(x)))
        coords = shapes.coords(g)
        if not all(13.4 <= c[1] <= 14.2 and 100.2 <= c[0] <= 100.9 for c in coords):
            continue
        feats.append({'type': 'Feature', 'properties': {'mode': r['mode_id'], 'name': r['route_name'], 'status': r['current_operating_status']},
                      'geometry': {'type': 'LineString', 'coordinates': line_coords([to_ll(*q) for q in simplify_xy([to_xy(*c) for c in coords], 4.0)])}})
    stops = []
    for e in ex.tab('09_ENTITIES'):
        if e['mode_id'] in ('river_boat', 'canal_boat', 'cross_river_ferry') and (e['current_operating_status'].startswith('calendar_listed') or e['entity_grain'] == 'operator_listed_pier'):
            lat, lng = to_float(e['latitude']), to_float(e['longitude'])
            if lat is None or not (13.4 <= lat <= 14.2 and 100.2 <= lng <= 100.9):
                continue
            stops.append({'type': 'Feature', 'properties': {'name': e['name_th'], 'mode': e['mode_id']}, 'geometry': {'type': 'Point', 'coordinates': [rnd(lng), rnd(lat)]}})
    return {
        'meta': {'source': 'GTFS ของ สนข. (OTP Namtang) รุ่น 20261029 · CC BY 4.0 และรายชื่อท่าเรือของผู้ให้บริการ', 'calendarDate': '2026-10-30',
                 'reading': 'แนวเรือตาม GTFS เป็นแนวเส้นของแหล่ง ไม่ใช่ร่องน้ำที่สำรวจ ท่าเรือคือท่าที่อยู่ในตาราง GTFS หรือรายชื่อผู้ให้บริการ ไม่ยืนยันการเดินเรือสด'},
        'routes': {'type': 'FeatureCollection', 'features': feats},
        'stops': {'type': 'FeatureCollection', 'features': stops},
    }


# ---------------------------------------------------------------------- sources

def build_sources(ex, used):
    out = []
    for r in ex.tab('07_SOURCES'):
        if r['source_id'] not in used:
            continue
        url = public_url(r['source_url'])
        out.append({'id': r['source_id'], 'title': r['title'], 'provider': r['provider'], 'url': url, 'licence': r['license'],
                    'period': r['source_period'], 'checkedOn': iso_date(r['checked_on']), 'limitations': r['limitations'], 'records': used[r['source_id']]})
    out.sort(key=lambda s: (-s['records'], s['id']))
    return out


def registry_meta(ex):
    reg = next((r for r in ex.tab('R01_DATASETS', 'dataset-registry') if r['registry_dataset_id'] == 'research.TH.transit'), {})
    ds = next((r for r in ex.tab('Datasets', 'dataset-registry') if r['dataset_id'] == 'transit'), {})
    statement = [r for r in ex.tab('Statements', 'dataset-registry') if r['dataset_id'] == 'transit']
    return {
        'registryDatasetId': reg.get('registry_dataset_id', ''), 'productDatasetId': reg.get('product_dataset_id', ''),
        'nameTh': ds.get('name_th', ''), 'nameEn': ds.get('name_en', ''), 'pillar': ds.get('primary_pillar', ''),
        'liveState': ds.get('live_state', ''), 'copyStatus': ds.get('copy_status', ''),
        'registryCheckedOn': iso_date(reg.get('registry_checked_on', '')), 'statementInRegistry': bool(statement),
    }


# ------------------------------------------------------------------------- main

def guard(obj, path='$'):
    """Fail on any private link or local path anywhere in an output."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            guard(v, f'{path}.{k}')
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            guard(v, f'{path}[{i}]')
    elif isinstance(obj, str) and FORBIDDEN.search(obj):
        raise SystemExit(f'publication guard: private link or local path at {path}: {obj[:120]}')


def write_json(path, obj, pretty=False):
    guard(obj)
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        if pretty:
            json.dump(obj, fh, ensure_ascii=False, indent=1)
        else:
            json.dump(obj, fh, ensure_ascii=False, separators=(',', ':'))
        fh.write('\n')
    with open(path, 'rb') as fh:
        data = fh.read()
    return {'path': os.path.relpath(path, REPO), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--export', required=True)
    ap.add_argument('--osm', default='')
    ap.add_argument('--out', default=os.path.join(REPO, 'data'))
    args = ap.parse_args()
    ex = Export(args.export)
    plist = load_province_list()
    resolve = province_resolver(plist)
    frames = load_frames(os.path.join(REPO, 'data', 'provinces.geojson'), plist)
    report = collections.defaultdict(list)
    systems, lines, stations, interchanges, complexes, line_features, used = build(ex, frames, resolve, report)
    shapes = Shapes(ex)
    buildings = {'type': 'FeatureCollection', 'features': [], 'metadata': {'status': 'not_built', 'reason': 'ยังไม่มีไฟล์ OpenStreetMap ในรอบนี้'}}
    osm_meta = None
    if args.osm:
        import importlib.util
        spec = importlib.util.spec_from_file_location('osm_enrich', os.path.join(HERE, 'osm_enrich.py'))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        buildings, osm_meta = mod.enrich(args.osm, lines, stations, line_features, report)
    # resolve every line's display colour key for the page
    for l in lines:
        l.pop('geometryIds', None)
    meta = {
        'product': 'CityMETER · Transit', 'release': RELEASE, 'asOf': AS_OF, 'generatedBy': 'scripts/build-data.py',
        'sourceExport': {'exportedAt': ex.manifest.get('exportedAt'), 'files': len(ex.manifest.get('files', [])),
                         'researchMaster': 'CityMETER Transit Thailand — Research Master 2026-10-30', 'registry': 'CityMETER Dataset Registry — Product, Evidence, Usage & SEO'},
        'registry': registry_meta(ex),
        'boundary': 'ระบบรางในเมืองที่เปิดให้บริการในกรุงเทพฯ และปริมณฑล (10 สาย) และโครงการรางที่กำลังก่อสร้างที่มีรายชื่อสถานี (7 โครงการ)',
        'grain': 'หนึ่งระเบียน = สถานีของหนึ่งสาย (สถานี–สาย) หรือสถานีของหนึ่งโครงการ ไม่รวมสถานีข้ามสายเป็นตัวตนเดียว',
        'statusRule': 'เปิดให้บริการ = อยู่ในรายชื่อสถานีปัจจุบันของผู้ให้บริการ (ไม่ใช่สถานะสด) · กำลังก่อสร้าง = สมาชิกโครงการ ยังไม่เปิด · ยังยืนยันไม่ได้ = สถานีเดิม/ชุมทางอ้างอิงของโครงการ',
        'complexRule': 'จุดเปลี่ยนสาย = กลุ่มระเบียนที่เชื่อมกันด้วยความสัมพันธ์การเชื่อมต่อปัจจุบันใน 31_INTERCHANGES (ตามผังเครือข่ายผู้ให้บริการ) ไม่ใช่การรวมอาคารหรือตัวตน',
        'osm': osm_meta,
        'sources': build_sources(ex, used),
        'limitations': [
            'ไม่มีหลักฐานการเดินรถแบบสด (live_verified = false ทุกรายการ)',
            'สีของสายเป็นสีตัวแทนจากชุดสี LDS ตามชื่อสาย จนกว่าจะได้รหัสสีที่มีแหล่งอ้างอิง' if not osm_meta or not osm_meta.get('colours') else 'สีของสายมาจากแท็ก colour ของ OpenStreetMap (สีอัตลักษณ์ของผู้ให้บริการตามที่ชุมชนบันทึก ไม่ใช่ไฟล์แบรนด์ทางการ)',
            'แนวเส้นจาก GTFS เป็นแนวของแหล่ง ไม่ใช่แนวที่สำรวจ ความยาวไม่ใช่ระยะเดินรถที่ตรวจแล้ว',
            'วันเปิดและวันครบสัญญาของโครงการเป็นเป้าหมายตามแหล่ง ไม่ใช่วันเปิดจริง',
            'ผู้โดยสาร: ARL ปี 2567 นับแยกทิศ หน่วยต้นทางไม่ระบุ · BTS ปี 2564 เป็นยอดขาออกรายเดือนในช่วงโควิด-19 ห้ามเทียบข้ามชุด',
        ],
    }
    data = {'meta': meta, 'systems': systems, 'lines': lines, 'stations': stations, 'interchanges': interchanges, 'complexes': complexes}
    os.makedirs(args.out, exist_ok=True)
    files = [
        write_json(os.path.join(args.out, 'transit.json'), data),
        write_json(os.path.join(args.out, 'rail-lines.geojson'), {'type': 'FeatureCollection', 'metadata': {'release': RELEASE, 'source': 'GTFS ของ สนข. (OTP Namtang) รุ่น 20261029 · CC BY 4.0 และแนวโครงการอ้างอิงตาม 26_ROUTE_GEOMETRY', 'osm': bool(osm_meta)}, 'features': line_features}),
        write_json(os.path.join(args.out, 'station-buildings.geojson'), buildings),
        write_json(os.path.join(args.out, 'bus.json'), build_bus(ex, shapes)),
        write_json(os.path.join(args.out, 'boat.json'), build_boat(ex, shapes)),
    ]
    counts = collections.Counter(s['status'] for s in stations)
    rep = {
        'release': RELEASE, 'files': files,
        'stations': dict(counts), 'lines': collections.Counter(l['status'] for l in lines),
        'interchanges': collections.Counter(i['scope'] for i in interchanges), 'complexes': len(complexes),
        'coordStatus': collections.Counter(s['coordStatus'] for s in stations),
        'provinceBasis': collections.Counter(s['provinceBasis'] for s in stations),
        'unmappedStations': [s['id'] for s in stations if s['lat'] is None],
        **report,
    }
    write_json(os.path.join(args.out, 'build-report.json'), rep, pretty=True)
    print(json.dumps(rep, ensure_ascii=False, indent=1, default=list)[:6000])


if __name__ == '__main__':
    main()
