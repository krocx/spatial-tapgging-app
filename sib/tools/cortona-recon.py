#!/usr/bin/env python3
"""
cortona-recon.py - structural reconnaissance of a Cortona3D RapidManual export
(.vmp project and/or published .htm folder) WITHOUT exposing its content.

Produces a shareable JSON + Markdown report describing the *shape* of the data:
container type, file inventory, XML element/attribute vocabulary with counts,
VRML/X3D node types and DEF-name patterns, step/animation structure, units and
axis hints. All free text, part numbers, labels and numeric values are redacted
or replaced by shape descriptors (e.g. "text(37 chars)", "float", "id-like").

Usage:
    python3 cortona-recon.py <path-to-.vmp-or-.htm-or-folder> [--out report-dir]

Python 3.8+, standard library only. Nothing is uploaded; nothing is modified.
"""
import sys, os, re, json, zipfile, hashlib, collections, argparse
import xml.etree.ElementTree as ET

RE_ID = re.compile(r'^[A-Za-z0-9_\-\.:/]{2,64}$')
RE_FLOAT = re.compile(r'^-?\d+(\.\d+)?([eE][-+]?\d+)?$')
RE_VEC = re.compile(r'^(-?\d+(\.\d+)?([eE][-+]?\d+)?\s+){2,15}-?\d+(\.\d+)?([eE][-+]?\d+)?$')

def shape(v: str) -> str:
    """Describe a value's shape without revealing it."""
    s = v.strip()
    if s == '': return 'empty'
    if RE_FLOAT.match(s): return 'float' if '.' in s or 'e' in s.lower() else 'int'
    if RE_VEC.match(s): return 'vec%d' % len(s.split())
    if s.lower() in ('true', 'false'): return 'bool'
    if RE_ID.match(s) and not ' ' in s: return 'id-like(%d)' % len(s)
    return 'text(%d chars, %d words)' % (len(s), len(s.split()))

def name_pattern(name: str) -> str:
    """Generalise an identifier: letters→A, digits→9, keep separators. 'PN_0190-12345_v2' → 'AA_9999-99999_A9'."""
    out = []
    for ch in name:
        if ch.isalpha(): out.append('A')
        elif ch.isdigit(): out.append('9')
        else: out.append(ch)
    p = ''.join(out)
    p = re.sub(r'A{4,}', 'A+', p); p = re.sub(r'9{4,}', '9+', p)
    return p

# ----------------------------------------------------------------------------- XML
def xml_report(data: bytes, label: str):
    rep = {'file': label, 'kind': 'xml', 'root': None, 'elements': {}, 'attributes': {}, 'value_shapes': {}, 'tree_sample': None, 'namespaces': []}
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        rep['kind'] = 'xml-unparseable'; rep['error'] = str(e)[:120]; return rep
    ns = set()
    elem_counts = collections.Counter(); attr_counts = collections.Counter(); shapes = collections.defaultdict(collections.Counter)
    def tag(t):
        if t.startswith('{'):
            uri, local = t[1:].split('}'); ns.add(uri); return local
        return t
    def walk(e, depth):
        t = tag(e.tag); elem_counts[t] += 1
        for k, v in e.attrib.items():
            attr_counts['%s@%s' % (t, tag(k))] += 1
            shapes['%s@%s' % (t, tag(k))][shape(v)] += 1
        if e.text and e.text.strip():
            shapes['%s#text' % t][shape(e.text)] += 1
        for c in e: walk(c, depth + 1)
    walk(root, 0)
    rep['root'] = tag(root.tag); rep['namespaces'] = sorted(ns)
    rep['elements'] = dict(elem_counts.most_common()); rep['attributes'] = dict(attr_counts.most_common())
    rep['value_shapes'] = {k: dict(v.most_common(4)) for k, v in shapes.items()}
    # skeleton: first occurrence of each element path, depth ≤ 6, no values
    seen = set(); lines = []
    def skel(e, path, depth):
        t = tag(e.tag); p = path + '/' + t
        if p not in seen and depth <= 6:
            seen.add(p); lines.append('  ' * depth + t + (' [' + ','.join(sorted(tag(k) for k in e.attrib)) + ']' if e.attrib else ''))
        for c in e: skel(c, p, depth + 1)
    skel(root, '', 0); rep['tree_sample'] = lines[:400]
    return rep

# ----------------------------------------------------------------------------- VRML / X3D
RE_VRML_NODE = re.compile(r'(?:DEF\s+(\S+)\s+)?([A-Z][A-Za-z0-9]*)\s*\{')
RE_ROUTE = re.compile(r'ROUTE\s+(\S+)\.(\S+)\s+TO\s+(\S+)\.(\S+)')
def vrml_report(text: str, label: str):
    rep = {'file': label, 'kind': 'vrml', 'header': text[:40].split('\n')[0].strip(), 'node_types': {}, 'def_count': 0, 'def_name_patterns': {}, 'routes': 0, 'route_field_pairs': {}, 'interpolators': {}, 'has_metadata': False, 'units_hint': None, 'bbox_hint': None}
    nodes = collections.Counter(); pats = collections.Counter(); defs = 0
    for m in RE_VRML_NODE.finditer(text):
        d, t = m.group(1), m.group(2); nodes[t] += 1
        if d: defs += 1; pats[name_pattern(d)] += 1
    rep['node_types'] = dict(nodes.most_common(60)); rep['def_count'] = defs
    rep['def_name_patterns'] = dict(pats.most_common(25))
    routes = RE_ROUTE.findall(text); rep['routes'] = len(routes)
    rep['route_field_pairs'] = dict(collections.Counter('%s→%s' % (a, b) for _, a, _, b in routes).most_common(15))
    rep['interpolators'] = {k: v for k, v in nodes.items() if 'Interpolator' in k or k in ('TimeSensor',)}
    rep['has_metadata'] = 'MetadataString' in nodes or 'MetadataSet' in nodes
    # rough scale hint from translation magnitudes (shape only)
    mags = [abs(float(x)) for x in re.findall(r'translation\s+(-?\d+\.?\d*)', text)[:2000]]
    if mags:
        mags.sort(); med = mags[len(mags)//2]
        rep['units_hint'] = 'median |translation.x| ≈ %.3g → %s' % (med, 'millimetres likely' if med > 5 else 'metres likely')
    return rep

# ----------------------------------------------------------------------------- HTML / JS
def html_report(text: str, label: str):
    rep = {'file': label, 'kind': 'html', 'title_shape': None, 'scripts': [], 'links': [], 'embeds': [], 'iframes': 0, 'ids_patterns': {}, 'data_attrs': {}, 'step_like_markers': {}, 'inline_json_keys': {}}
    m = re.search(r'<title>(.*?)</title>', text, re.S | re.I)
    if m: rep['title_shape'] = shape(m.group(1))
    rep['scripts'] = sorted(set(os.path.basename(s) for s in re.findall(r'<script[^>]+src=["\']([^"\']+)', text, re.I)))[:40]
    rep['links'] = sorted(set(os.path.basename(s) for s in re.findall(r'<link[^>]+href=["\']([^"\']+)', text, re.I)))[:40]
    rep['embeds'] = sorted(set(os.path.splitext(s)[1].lower() for s in re.findall(r'(?:src|data|href)=["\']([^"\']+\.(?:wrl|x3d|x3dv|vmp|xml|json|glb|gltf|usdz|obj|js))["\']', text, re.I)))
    rep['iframes'] = len(re.findall(r'<iframe', text, re.I))
    rep['ids_patterns'] = dict(collections.Counter(name_pattern(i) for i in re.findall(r'\sid=["\']([^"\']+)', text)).most_common(20))
    rep['data_attrs'] = dict(collections.Counter(re.findall(r'\s(data-[a-z0-9\-]+)=', text, re.I)).most_common(30))
    rep['step_like_markers'] = dict(collections.Counter(w.lower() for w in re.findall(r'\b(step|procedure|task|callout|poi|hotspot|animation|viewpoint|tracking)\w*', text, re.I)).most_common(20))
    keys = collections.Counter(re.findall(r'["\']([A-Za-z_][A-Za-z0-9_]{1,40})["\']\s*:', text))
    rep['inline_json_keys'] = dict(keys.most_common(60))
    return rep

# ----------------------------------------------------------------------------- dispatcher
def sniff(data: bytes) -> str:
    h = data[:16]
    if h.startswith(b'PK\x03\x04'): return 'zip'
    if h.startswith(b'#VRML'): return 'vrml'
    if h.startswith(b'#X3D') : return 'x3dv'
    if h.lstrip().startswith(b'<?xml') or h.lstrip().startswith(b'<'): return 'xml-or-html'
    if h.startswith(b'\x1f\x8b'): return 'gzip'
    if h.startswith(b'glTF'): return 'glb'
    return 'binary'

def analyse_bytes(name: str, data: bytes, reports: list):
    kind = sniff(data); ext = os.path.splitext(name)[1].lower()
    entry = {'file': os.path.basename(name), 'ext': ext, 'bytes': len(data), 'sniff': kind, 'sha256_8': hashlib.sha256(data).hexdigest()[:8]}
    reports.append(entry)
    if kind == 'zip':
        try:
            with zipfile.ZipFile(io_bytes(data)) as z:
                entry['zip_entries'] = [{'name': redact_path(i.filename), 'bytes': i.file_size} for i in z.infolist()][:500]
                for i in z.infolist():
                    if i.file_size > 60_000_000: continue
                    analyse_bytes(name + '::' + i.filename, z.read(i), reports)
        except zipfile.BadZipFile:
            entry['note'] = 'zip signature but unreadable'
    elif kind in ('vrml', 'x3dv'):
        reports.append(vrml_report(data.decode('utf-8', 'replace'), entry['file']))
    elif kind == 'xml-or-html' or ext in ('.xml', '.htm', '.html', '.x3d'):
        text = data.decode('utf-8', 'replace')
        if ext in ('.htm', '.html') or re.search(r'<html', text[:2000], re.I):
            reports.append(html_report(text, entry['file']))
        else:
            reports.append(xml_report(data, entry['file']))
    elif ext in ('.js', '.json'):
        text = data.decode('utf-8', 'replace')
        keys = collections.Counter(re.findall(r'["\']([A-Za-z_][A-Za-z0-9_]{1,40})["\']\s*:', text))
        reports.append({'file': entry['file'], 'kind': 'script-or-json', 'top_keys': dict(keys.most_common(60)), 'has_vrml_inline': '#VRML' in text, 'step_like_markers': dict(collections.Counter(w.lower() for w in re.findall(r'\b(step|procedure|callout|poi|animation|viewpoint|tracking)\w*', text, re.I)).most_common(15))})

def redact_path(p: str) -> str:
    parts = p.split('/'); return '/'.join(name_pattern(os.path.splitext(x)[0]) + os.path.splitext(x)[1] for x in parts)

import io
def io_bytes(b): return io.BytesIO(b)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('path'); ap.add_argument('--out', default='cortona-recon-report')
    a = ap.parse_args(); reports = []
    if os.path.isdir(a.path):
        for root, _, files in os.walk(a.path):
            for f in files:
                p = os.path.join(root, f)
                if os.path.getsize(p) > 200_000_000: continue
                with open(p, 'rb') as fh: analyse_bytes(os.path.relpath(p, a.path), fh.read(), reports)
    else:
        with open(a.path, 'rb') as fh: analyse_bytes(os.path.basename(a.path), fh.read(), reports)
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, 'report.json'), 'w') as f: json.dump(reports, f, indent=1)
    md = ['# Cortona3D export - structural report', '', '_No content values included; names generalised (A=letter, 9=digit)._', '']
    for r in reports:
        md.append('## %s  (%s)' % (r.get('file'), r.get('kind', r.get('sniff'))))
        for k, v in r.items():
            if k in ('file', 'kind'): continue
            if isinstance(v, (dict, list)) and len(json.dumps(v)) > 1500: v = json.dumps(v)[:1500] + ' …'
            md.append('- **%s**: `%s`' % (k, v if not isinstance(v, (dict, list)) else json.dumps(v)))
        md.append('')
    with open(os.path.join(a.out, 'report.md'), 'w') as f: f.write('\n'.join(md))
    print('wrote', os.path.join(a.out, 'report.md'), 'and report.json -', len(reports), 'entries')

if __name__ == '__main__':
    main()
