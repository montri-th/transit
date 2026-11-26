#!/usr/bin/env python3
"""CityMETER · Transit — the rail agencies' logos from the research team's transit logo library.

    python3 -I scripts/add-operator-logos.py --manifest <transit-priority-logo-review-YYYY-MM-DD.json>
        --files <folder of the library files> [--render <folder of Chromium renders, <sha256 20>.png>] --checked-on <date>

The manifest and files stay outside the repository (Transit_Operator_Logos_Web on Drive); only the SHA-256 of the
manifest and public facts are published. Rules (DATA_METHOD.md §12):
  * a mapping is used when its result is collected and its role brand_primary, and its file's bytes equal the
    manifest's SHA-256 (found by SHA-256 only, never by file name);
  * the agency is the GTFS agency id the research team wrote in the mapping (“GTFS agency BTSC”, “under agency SRTET”);
    only the agencies of the demo's own systems (`systems[].operatorId`) are kept — never by name;
  * the registry role decides where a logo stands: service_system → the brand of the agency's lines;
    operator / authority / brand_primary → the agency named as the lines' GTFS operator;
  * display: SVG up to 64 KB and rasters up to 512 px and 64 KB keep their bytes; anything larger is drawn once (an SVG
    by Chromium, `--render`) and scaled uniformly to 384 px on its longest side as WebP — the original SHA-256 is kept;
    no recolouring, cropping or tracing;
  * plate: the library's recommended surface — dark → #182327, any other → #FFFFFF; the same on both themes.
"""
import argparse, hashlib, io, json, os, re, shutil, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEEP_BYTES, KEEP_PX, LONG_SIDE = 64 * 1024, 512, 384
PLATES = {'dark': '#182327'}
AGENCY = re.compile(r'(?:GTFS agency|under agency)\s+([A-Z0-9]+)')
SYSTEM_ROLES, OPERATOR_ROLES = {'service_system'}, {'operator', 'authority', 'brand_primary'}


def sha(data): return hashlib.sha256(data).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--manifest', required=True)
    ap.add_argument('--files', required=True)
    ap.add_argument('--render', default='')
    ap.add_argument('--checked-on', required=True)
    a = ap.parse_args()
    raw_manifest = open(a.manifest, 'rb').read()
    m = json.loads(raw_manifest)
    if m.get('dataset') != 'transit': sys.exit('not a transit logo library manifest')
    data = json.load(open(os.path.join(ROOT, 'data/transit.json'), encoding='utf-8'))
    wanted = {s['operatorId'] for s in data['systems'] if s.get('operatorId')}
    by_sha = {}
    for name in os.listdir(a.files):
        p = os.path.join(a.files, name)
        if os.path.isfile(p): by_sha[sha(open(p, 'rb').read())] = p
    assets = {x['asset_id']: x for x in m['assets']}
    out_dir = os.path.join(ROOT, 'assets/operator-logos')
    shutil.rmtree(out_dir, ignore_errors=True); os.makedirs(out_dir)
    logos, agencies, counts = {}, {}, {'mappings': len(m['mappings']), 'collected': 0, 'outsideDemo': 0, 'used': 0, 'derived': 0}
    for x in m['mappings']:
        if x.get('result') != 'collected' or x.get('logo_role') != 'brand_primary': continue
        counts['collected'] += 1
        found = AGENCY.search(x.get('notes') or '')
        agency = found.group(1) if found else None
        if agency not in wanted: counts['outsideDemo'] += 1; continue
        asset = assets[x['asset_id']]
        path = by_sha.get(asset['sha256'])
        if not path: sys.exit(f'no file with the SHA-256 of {asset["filename"]}')
        raw = open(path, 'rb').read()
        mime, w, h = asset['mime_type'], asset.get('width'), asset.get('height')
        keep = len(raw) <= KEEP_BYTES and (mime == 'image/svg+xml' or (max(w or 0, h or 0) <= KEEP_PX))
        original = None
        if keep:
            out, ext = raw, {'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'}[mime]
            transformation = 'none'
        else:
            src = raw
            if mime == 'image/svg+xml':
                render = os.path.join(a.render, asset['sha256'][:20] + '.png')
                if not os.path.exists(render): sys.exit(f'{asset["filename"]} needs a Chromium render: {render}')
                src = open(render, 'rb').read()
            im = Image.open(io.BytesIO(src)); im.load()
            im = im.convert('RGBA')
            scale = LONG_SIDE / max(im.size)
            if scale < 1: im = im.resize((max(1, round(im.size[0] * scale)), max(1, round(im.size[1] * scale))), Image.LANCZOS)
            buf = io.BytesIO(); im.save(buf, 'WEBP', quality=90, method=6); out, ext, mime = buf.getvalue(), 'webp', 'image/webp'
            w, h = im.size
            original = {'sha256': asset['sha256'], 'mime': asset['mime_type'], 'bytes': len(raw), 'width': asset.get('width'), 'height': asset.get('height')}
            transformation = ('Chromium render of the SVG, then ' if asset['mime_type'] == 'image/svg+xml' else '') + f'uniform scale to {LONG_SIDE} px longest side, WebP'
            counts['derived'] += 1
        digest = sha(out)
        key = 'OL-' + digest[:16]
        name = f'{digest[:20]}.{ext}'
        open(os.path.join(out_dir, name), 'wb').write(out)
        surface = asset.get('recommended_surface') or ''
        logos[key] = {'file': f'assets/operator-logos/{name}', 'sha256': digest, 'mime': mime, 'bytes': len(out), 'width': w, 'height': h,
                      'plate': PLATES.get(surface, '#FFFFFF'), 'surface': surface, 'label': x.get('canonical_name') or x.get('raw_label'),
                      'role': x.get('registry_logo_role') or x.get('logo_role'), 'sourcePage': asset.get('source_page_url') or '',
                      'transformation': transformation, 'original': original}
        slot = 'system' if (x.get('registry_logo_role') in SYSTEM_ROLES) else 'operator'
        if slot in agencies.get(agency, {}): sys.exit(f'two {slot} logos for agency {agency}')
        agencies.setdefault(agency, {})[slot] = key
        counts['used'] += 1
    meta = {'schemaVersion': 1, 'checkedOn': a.checked_on,
            'source': f'CityMETER Transit Thailand — Research Master, transit logo library (priority review {m.get("checked_on")})',
            'manifestSha256': sha(raw_manifest), 'libraryCheckedOn': m.get('checked_on'), 'counts': counts,
            'agenciesInDemo': sorted(wanted), 'agenciesWithLogo': sorted(agencies),
            'rule': 'collected brand_primary mappings whose file bytes equal the manifest SHA-256; the GTFS agency the research team wrote; only agencies of the demo systems',
            'display': f'SVG ≤ 64 KB and rasters ≤ {KEEP_PX} px and ≤ 64 KB keep their bytes; larger files are drawn once and scaled to {LONG_SIDE} px (WebP), original SHA-256 kept',
            'rights': 'เครื่องหมายเป็นของเจ้าของแต่ละราย การแสดงเพื่อระบุผู้ให้บริการไม่ใช่ใบอนุญาตเครื่องหมายการค้า'}
    json.dump({'meta': meta, 'logos': dict(sorted(logos.items())), 'agencies': dict(sorted(agencies.items()))},
              open(os.path.join(ROOT, 'data/operator-logos.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    open(os.path.join(ROOT, 'data/operator-logos.json'), 'a').write('\n')
    print(json.dumps(counts), sorted(agencies.items()))


if __name__ == '__main__':
    main()
