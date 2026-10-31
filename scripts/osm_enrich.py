"""OpenStreetMap enrichment for scripts/build-data.py (imported, not run on its own).

Input: one Overpass API JSON response (OpenStreetMap contributors, ODbL 1.0),
saved by the owner-approved download `osm-rail-stations-2026-10-31.json` (query
in DATA_METHOD.md). The raw file is not published; its sha256, the Overpass
`timestamp_osm_base` and the query are recorded in data/transit.json meta.osm.

What it adds — each value says where it came from, nothing is guessed:
  1. elevation of every drawn alignment stretch: the nearest OSM railway way
     (≤ 30 m) and its tags: tunnel=yes → underground; bridge=yes|viaduct or
     layer > 0 → elevated; otherwise surface. Stretches shorter than 100 m
     join their neighbours (a culvert bridge is not a viaduct). No match → the
     stretch keeps elevation = null (unknown), never a default.
  2. elevation of every station: the class of its own line at the station.
  3. line colours: the `colour` tag of OSM route relations, mapped to the
     lines by an explicit, reviewed keyword table (ROUTE_KEYS below).
  4. station buildings: an OSM station feature matched to a station by its
     operator code (`ref`) or by its Thai/English name within 400 m, then the
     OSM building polygon that contains it (or a building=train_station within
     80 m). Height from height / building:levels tags; when absent the height
     is a declared display value (height_basis = 'display_default').
  5. construction alignments missing from the research master: OSM
     railway=construction ways whose name says สีส้ม / สีม่วง, assigned to the
     nearest project by its stations.
"""
import collections
import hashlib
import json
import math
import re

LEVEL_ORDER = ('underground', 'surface', 'elevated')
ROUTE_KEYS = {
    'BTS_SUKHUMVIT': [r'sukhumvit', r'สุขุมวิท'],
    'BTS_SILOM': [r'silom', r'สีลม'],
    'BTS_GOLD': [r'gold line', r'สีทอง'],
    'MRT_BLUE': [r'blue line', r'สีน้ำเงิน', r'เฉลิมรัชมงคล'],
    'MRT_PURPLE': [r'purple line', r'สีม่วง', r'ฉลองรัชธรรม'],
    'MRT_PINK': [r'pink line', r'สีชมพู'],
    'MRT_YELLOW': [r'yellow line', r'สีเหลือง'],
    'ARL_CITY': [r'airport rail link', r'แอร์พอร์ต', r'city line'],
    'SRT_RED_NORTH': [r'dark red', r'แดงเข้ม'],
    'SRT_RED_WEST': [r'light red', r'แดงอ่อน'],
    'MRT_ORANGE_WEST': [r'orange line', r'สีส้ม'],
    'MRT_ORANGE_EAST': [r'orange line', r'สีส้ม'],
}
BBOX = (13.50, 100.30, 14.10, 100.85)  # south, west, north, east — the query frame
KX = 111320.0 * math.cos(math.radians(13.75))
KY = 110574.0


def xy(lng, lat):
    return ((lng - 100.5) * KX, (lat - 13.75) * KY)


def ll(x, y):
    return (100.5 + x / KX, 13.75 + y / KY)


def num(v):
    m = re.match(r'\s*(-?\d+(?:\.\d+)?)', str(v or ''))
    return float(m.group(1)) if m else None


def way_level(tags):
    layer = num(tags.get('layer'))
    if tags.get('tunnel') in ('yes', 'culvert') or tags.get('location') == 'underground' or (layer is not None and layer < 0 and tags.get('bridge') in (None, 'no')):
        return 'underground'
    if tags.get('bridge') in ('yes', 'viaduct', 'aqueduct') or tags.get('location') == 'overground' or (layer is not None and layer > 0):
        return 'elevated'
    return 'surface'


def densify(points, step):
    out = [points[0]]
    for a, b in zip(points, points[1:]):
        d = math.hypot(b[0] - a[0], b[1] - a[1])
        n = int(d // step)
        for i in range(1, n + 1):
            t = i * step / d
            if t < 1:
                out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        out.append(b)
    return out


class Grid:
    def __init__(self, cell):
        self.cell = cell
        self.cells = collections.defaultdict(list)

    def add(self, p, payload):
        self.cells[(int(p[0] // self.cell), int(p[1] // self.cell))].append((p, payload))

    def nearest(self, p, radius):
        cx, cy = int(p[0] // self.cell), int(p[1] // self.cell)
        r = int(math.ceil(radius / self.cell))
        best, found = radius, None
        for i in range(cx - r, cx + r + 1):
            for j in range(cy - r, cy + r + 1):
                for q, payload in self.cells.get((i, j), ()):
                    d = math.hypot(q[0] - p[0], q[1] - p[1])
                    if d <= best:
                        best, found = d, payload
        return found, best


def simplify(points, tol):
    if len(points) <= 2:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        a, b = points[i], points[j]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L2 = dx * dx + dy * dy
        best, at = -1, -1
        for k in range(i + 1, j):
            p = points[k]
            t = 0 if L2 == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
            d = math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
            if d > best:
                best, at = d, k
        if best > tol:
            keep[at] = True
            stack += [(i, at), (at, j)]
    return [p for p, k in zip(points, keep) if k]


def ring_contains(ring, p):
    inside, j = False, len(ring) - 1
    for i in range(len(ring)):
        (xi, yi), (xj, yj) = ring[i], ring[j]
        if (yi > p[1]) != (yj > p[1]) and p[0] < (xj - xi) * (p[1] - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def norm_name(v):
    v = (v or '').lower()
    v = re.sub(r'\(.*?\)|สถานี|station|bts|mrt|arl|srt|รถไฟฟ้า', '', v)
    return re.sub(r'[\s\-–·.]+', '', v)


def element_point(e):
    if e['type'] == 'node':
        return (e['lon'], e['lat'])
    pts = element_rings(e)
    if pts:
        ring = pts[0]
        return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
    b = e.get('bounds')
    if b:
        return ((b['minlon'] + b['maxlon']) / 2, (b['minlat'] + b['maxlat']) / 2)
    return None


def element_rings(e):
    """Outer rings (lon/lat) of a closed way or a multipolygon relation (members with geometry)."""
    if e['type'] == 'way' and e.get('geometry'):
        ring = [(g['lon'], g['lat']) for g in e['geometry'] if g]
        return [ring] if len(ring) >= 4 and ring[0] == ring[-1] else []
    if e['type'] == 'relation':
        rings = []
        for m in e.get('members', []):
            if m.get('role') in ('outer', '') and m.get('geometry'):
                ring = [(g['lon'], g['lat']) for g in m['geometry'] if g]
                if len(ring) >= 4 and ring[0] == ring[-1]:
                    rings.append(ring)
        return rings
    return []


def classify_line_features(line_features, grid_for, report):
    """Split each drawn stretch by the elevation class of the nearest OSM railway way of the same line
    (members of its OSM route relations) — or of any railway way when the line has no route relation."""
    out = []
    for f in line_features:
        coords = f['geometry']['coordinates']
        pts = densify([xy(*c) for c in coords], 10.0)
        grid, radius = grid_for(f['properties']['lineId'])
        classes = []
        for p in pts:
            hit, d = grid.nearest(p, radius)
            classes.append(hit)
        known = [i for i, c in enumerate(classes) if c]
        if not known:
            out.append(f)
            report['osmUnmatchedParts'].append(f['properties']['lineId'])
            continue
        for i, c in enumerate(classes):  # fill gaps from the nearest known neighbour along the path
            if c is None:
                k = min(known, key=lambda j: abs(j - i))
                classes[i] = classes[k]
        runs = []
        for i, c in enumerate(classes):
            if runs and runs[-1][0] == c:
                runs[-1][2] = i
            else:
                runs.append([c, i, i])
        changed = True
        while changed and len(runs) > 1:  # merge stretches shorter than 100 m into the longer neighbour
            changed = False
            for k, r in enumerate(runs):
                if (r[2] - r[1] + 1) * 10.0 < 100.0:
                    left = runs[k - 1] if k > 0 else None
                    right = runs[k + 1] if k + 1 < len(runs) else None
                    target = left if (left and (not right or (left[2] - left[1]) >= (right[2] - right[1]))) else right
                    if target is left:
                        left[2] = r[2]
                    else:
                        right[1] = r[1]
                    runs.pop(k)
                    changed = True
                    break
            merged = []
            for r in runs:
                if merged and merged[-1][0] == r[0]:
                    merged[-1][2] = r[2]
                else:
                    merged.append(r)
            runs = merged
        for c, a, b in runs:
            seg = pts[a:b + 2] if b + 1 < len(pts) else pts[a:b + 1]
            seg = simplify(seg, 2.0)
            if len(seg) < 2:
                continue
            g = {'type': 'Feature', 'properties': {**f['properties'], 'elevation': c, 'elevationSource': 'osm_nearest_railway_way'},
                 'geometry': {'type': 'LineString', 'coordinates': [[round(v, 5) for v in ll(*q)] for q in seg]}}
            out.append(g)
    return out


def enrich(osm_path, lines, stations, line_features, report):
    with open(osm_path, 'rb') as fh:
        raw = fh.read()
    data = json.loads(raw)
    elements = data.get('elements', [])
    meta = {
        'file': 'osm-rail-stations-2026-10-31.json', 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
        'timestampOsmBase': (data.get('osm3s') or {}).get('timestamp_osm_base', ''), 'elements': len(elements),
        'licence': 'ODbL 1.0 — © OpenStreetMap contributors', 'frame': {'south': BBOX[0], 'west': BBOX[1], 'north': BBOX[2], 'east': BBOX[3]},
        'colours': {}, 'buildings': 0, 'elevatedShare': {},
    }
    # ---- route relations → which OSM ways belong to which line (explicit keyword table, reviewed)
    def line_of_relation(t):
        label = ' '.join(t.get(k, '') for k in ('name', 'name:en', 'name:th', 'ref')).lower()
        return [lid for lid, keys in ROUTE_KEYS.items() if any(re.search(k, label) for k in keys)]
    members = collections.defaultdict(set)
    for e in elements:
        t = e.get('tags', {})
        if e['type'] == 'relation' and t.get('route') in ('subway', 'light_rail', 'monorail', 'train'):
            for lid in line_of_relation(t):
                for m in e.get('members', []):
                    if m.get('type') == 'way' and m.get('role', '') in ('', 'forward', 'backward', 'main'):
                        members[lid].add(m['ref'])
    # ---- railway ways → elevation grids (one per line from its route members, one for all ways)
    rail_grid = Grid(30.0)
    line_grids = collections.defaultdict(lambda: Grid(40.0))
    construction = []
    for e in elements:
        t = e.get('tags', {})
        if e['type'] != 'way' or not e.get('geometry'):
            continue
        pts = [xy(g['lon'], g['lat']) for g in e['geometry'] if g]
        if len(pts) < 2:
            continue
        if t.get('railway') in ('subway', 'light_rail', 'monorail', 'rail'):
            level = way_level(t)
            dense = densify(pts, 10.0)
            for p in dense:
                rail_grid.add(p, level)
            for lid, ids in members.items():
                if e['id'] in ids:
                    for p in dense:
                        line_grids[lid].add(p, level)
        elif t.get('railway') == 'construction':
            construction.append((e, pts, way_level(t)))
    meta['routeMembership'] = {lid: len(ids) for lid, ids in sorted(members.items())}

    def grid_for(line_id):
        return (line_grids[line_id], 40.0) if line_id in line_grids else (rail_grid, 30.0)
    # ---- 1. alignments
    operating = [f for f in line_features if f['properties']['status'] == 'operating']
    others = [f for f in line_features if f['properties']['status'] != 'operating']
    classified = classify_line_features(operating, grid_for, report)
    # ---- 5. OSM construction alignments for urban projects without one
    by_line = collections.defaultdict(list)
    for s in stations:
        if s['status'] in ('construction', 'unverified') and s['lat'] is not None:
            by_line[s['lineIds'][0]].append(xy(s['lng'], s['lat']))
    have = {f['properties']['lineId'] for f in others}
    added = collections.Counter()
    for e, pts, level in construction:
        t = e.get('tags', {})
        label = ' '.join(t.get(k, '') for k in ('name', 'name:th', 'name:en', 'ref')).lower()
        family = 'orange' if re.search(r'สีส้ม|orange', label) else 'purple' if re.search(r'สีม่วง|purple', label) else ''
        if not family:
            continue
        candidates = [lid for lid in by_line if lid.startswith('MRT_ORANGE' if family == 'orange' else 'MRT_PURPLE') and lid not in have]
        if not candidates:
            continue
        mid = pts[len(pts) // 2]
        best = min(candidates, key=lambda lid: min(math.hypot(mid[0] - q[0], mid[1] - q[1]) for q in by_line[lid]))
        if min(math.hypot(mid[0] - q[0], mid[1] - q[1]) for q in by_line[best]) > 2500:
            continue
        others.append({'type': 'Feature', 'properties': {'lineId': best, 'status': 'construction', 'elevation': level, 'part': added[best], 'source': 'OSM',
                                                         'osm_ref': f'way/{e["id"]}', 'quality': 'osm_railway_construction_way_not_design_alignment'},
                       'geometry': {'type': 'LineString', 'coordinates': [[round(v, 5) for v in ll(*q)] for q in simplify(pts, 2.0)]}})
        added[best] += 1
    for lid, n in added.items():
        line = next(l for l in lines if l['id'] == lid)
        line['alignmentNote'] = 'แนวจาก OpenStreetMap (railway=construction) ไม่ใช่แบบก่อสร้างทางการ'
        line['sources'].append({'title': 'แนวก่อสร้างจาก OpenStreetMap (ODbL)', 'url': 'https://www.openstreetmap.org/copyright'})
    report['osmConstructionWays'] = dict(added)
    line_features[:] = classified + others
    # dominant elevation per line
    length = collections.defaultdict(collections.Counter)
    for f in line_features:
        c = f['geometry']['coordinates']
        L = sum(math.hypot(*(a - b for a, b in zip(xy(*p), xy(*q)))) for p, q in zip(c, c[1:]))
        if f['properties'].get('elevation'):
            length[f['properties']['lineId']][f['properties']['elevation']] += L
    for l in lines:
        cnt = length.get(l['id'])
        if cnt:
            total = sum(cnt.values())
            top, v = cnt.most_common(1)[0]
            l['elevation'] = top if v / total >= 0.8 else 'mixed'
            l['elevationShare'] = {k: round(x / total, 3) for k, x in cnt.items()}
            meta['elevatedShare'][l['id']] = l['elevationShare']
    # ---- 2. station elevation from its own line
    grids = collections.defaultdict(lambda: Grid(40.0))
    for f in line_features:
        lvl = f['properties'].get('elevation')
        if not lvl:
            continue
        for p in densify([xy(*c) for c in f['geometry']['coordinates']], 10.0):
            grids[f['properties']['lineId']].add(p, lvl)
    for s in stations:
        if s['lat'] is None:
            continue
        hit, d = grids[s['lineIds'][0]].nearest(xy(s['lng'], s['lat']), 150.0) if s['lineIds'][0] in grids else (None, None)
        if hit:
            s['elevation'] = hit
            s['elevationSource'] = 'osm_line_at_station'
    # ---- 3. colours from route relations
    seen = collections.defaultdict(collections.Counter)
    refs = collections.defaultdict(list)
    for e in elements:
        t = e.get('tags', {})
        if e['type'] != 'relation' or t.get('route') not in ('subway', 'light_rail', 'monorail', 'train') or not re.fullmatch(r'#[0-9A-Fa-f]{6}', t.get('colour', '')):
            continue
        label = ' '.join(t.get(k, '') for k in ('name', 'name:en', 'name:th', 'ref')).lower()
        for lid, keys in ROUTE_KEYS.items():
            if any(re.search(k, label) for k in keys):
                seen[lid][t['colour'].upper()] += 1
                refs[lid].append(f'relation/{e["id"]}')
    for l in lines:
        if seen.get(l['id']):
            colour, n = seen[l['id']].most_common(1)[0]
            l['color'] = colour
            l['colorBasis'] = 'osm_route_colour'
            l['colorSource'] = {'osm': refs[l['id']][:6], 'agreeing': n, 'variants': dict(seen[l['id']])}
            meta['colours'][l['id']] = colour
            if len(seen[l['id']]) > 1:
                report['holds'].append(f'{l["id"]}: OSM route colours disagree {dict(seen[l["id"]])}; used the most frequent')
    # ---- 4. buildings
    osm_stations, buildings = [], []
    for e in elements:
        t = e.get('tags', {})
        if t.get('railway') in ('station', 'halt') or t.get('public_transport') == 'station' or t.get('construction:railway') == 'station':
            p = element_point(e)
            if p:
                osm_stations.append((e, xy(*p)))
        if t.get('building') and element_rings(e):
            rings = element_rings(e)
            buildings.append((e, [[xy(*q) for q in r] for r in rings]))
    features, used = [], set()
    for s in stations:
        if s['lat'] is None or not (BBOX[0] <= s['lat'] <= BBOX[2] and BBOX[1] <= s['lng'] <= BBOX[3]):
            continue
        p = xy(s['lng'], s['lat'])
        codes = {c.upper() for c in s.get('codes', [])}
        names = {norm_name(s['name']), norm_name(s.get('nameEn'))} - {''}
        best = None
        for e, q in osm_stations:
            d = math.hypot(p[0] - q[0], p[1] - q[1])
            if d > 400:
                continue
            t = e.get('tags', {})
            ref_hit = bool(codes & {x.strip().upper() for x in re.split(r'[;,]', t.get('ref', '')) if x.strip()})
            nm = {norm_name(t.get(k)) for k in ('name', 'name:th', 'name:en')} - {''}
            name_hit = bool(names & nm)
            if not (ref_hit or name_hit):
                continue
            score = (0 if ref_hit else 1, d)
            if best is None or score < best[0]:
                best = (score, e, q, 'osm_ref' if ref_hit else 'osm_name')
        anchor = best[2] if best else p
        chosen = None
        for e, rings in buildings:
            if e['id'] in used:
                continue
            t = e.get('tags', {})
            inside = any(ring_contains(r, anchor) for r in rings)
            near = min(math.hypot(anchor[0] - v[0], anchor[1] - v[1]) for r in rings for v in r)
            station_tagged = t.get('building') in ('train_station', 'transportation') or t.get('railway') == 'station' or t.get('public_transport') == 'station'
            if inside and (station_tagged or best):
                rank = (0, near)
            elif station_tagged and near <= 80:
                rank = (1, near)
            else:
                continue
            if chosen is None or rank < chosen[0]:
                chosen = (rank, e, rings)
        if not chosen:
            continue
        rank, e, rings = chosen
        used.add(e['id'])
        t = e.get('tags', {})
        height = num(t.get('height'))
        levels = num(t.get('building:levels'))
        base = num(t.get('min_height'))
        min_level = num(t.get('building:min_level'))
        basis = 'osm_height' if height else 'osm_levels' if levels else 'display_default'
        if not height:
            height = levels * 3.5 if levels else (22.0 if s.get('elevation') == 'elevated' else 8.0)
        if base is None:
            base = min_level * 3.5 if min_level else 0.0
        ref = f'{e["type"]}/{e["id"]}'
        features.append({
            'type': 'Feature', 'id': ref,
            'properties': {
                'stationId': s['id'], 'name': t.get('name:th') or t.get('name') or '', 'osm_ref': ref, 'osm_url': f'https://www.openstreetmap.org/{ref}',
                'height': round(height, 1), 'base': round(base, 1), 'height_basis': basis,
                'height_note': {'osm_height': 'ความสูงจากแท็ก height ใน OSM', 'osm_levels': 'ความสูงประมาณจากจำนวนชั้นใน OSM × 3.5 ม.',
                                'display_default': 'ไม่มีความสูงใน OSM ใช้ค่าตั้งต้นเพื่อการแสดงผลเท่านั้น'}[basis],
                'match': best[3] if best else 'station_tagged_building_near_point', 'match_distance_m': round(rank[1], 1),
                'osm_station': f'{best[1]["type"]}/{best[1]["id"]}' if best else '',
            },
            'geometry': {'type': 'Polygon', 'coordinates': [[[round(v, 6) for v in ll(*q)] for q in simplify(r, 1.0)] for r in rings[:1]]},
        })
        s.setdefault('buildingIds', []).append(ref)
    meta['buildings'] = len(features)
    report['osm'] = {'buildings': len(features), 'colours': meta['colours'], 'unmatchedParts': len(report.get('osmUnmatchedParts', []))}
    fc = {'type': 'FeatureCollection', 'metadata': {'source': 'OpenStreetMap (Overpass API)', 'licence': meta['licence'], 'sha256': meta['sha256'],
                                                    'timestampOsmBase': meta['timestampOsmBase'], 'matching': 'operator code (ref) or name within 400 m, then the containing building polygon'},
          'features': features}
    return fc, meta
