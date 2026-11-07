"""Employers recorded publicly as hiring worldwide, for the daily discovery (owner decision 2026-11-07).

Sources (read at run time, never copied into this repository):
  * remoteintech/remote-jobs (ISC licence): company files with `region` and `remote_policy`. Kept: region worldwide or
    asia-pacific, and policy fully-remote or remote-first.
  * yanirs/established-remote: a list of established remote companies hiring globally (the README table).
  * yc-oss/api (companies/hiring.json): Y Combinator companies marked as hiring, with their batch. Used for a separate,
    smaller signal for Farhan's builder roles (funded, early-stage founders), not for the worldwide-hiring signal.
A listed employer is a hint, not proof: the screen raises the score a little and says "confirm India is included"; it never
changes eligibility.

Runs WITHOUT database credentials. Usage:
  python engine/global_hirers.py --remoteintech PATH/TO/remote-jobs --established PATH/TO/README.md [--yc hiring.json] --out work/
Either source may be missing (a failed download): the file is still written, with whatever was read.
"""
import argparse
import json
import re
import sys
from pathlib import Path

SUFFIX = re.compile(r'(incorporated|inc|llc|ltd|limited|gmbh|corp|corporation|company|co|hq|io|ai|labs|technologies|technology|software|group|pvt|plc|sa|ag|bv)$')
KEEP_REGION = {'worldwide', 'asia-pacific'}
KEEP_POLICY = {'fully-remote', 'remote-first'}


def company_key(name):
    """Same rule as companyKey() in worker/discovery.ts: 'Perion Network Ltd.' and 'perionnetworkltd' give 'perionnetwork'."""
    k = re.sub(r'[^a-z0-9]+', '', str(name or '').lower().replace('&', 'and'))
    for _ in range(2):
        t = SUFFIX.sub('', k)
        if len(t) >= 3:
            k = t
    return k if len(k) >= 3 else ''


def front_matter(text):
    m = re.match(r'^---\n(.*?)\n---', text, re.S)
    out = {}
    for line in (m.group(1).splitlines() if m else []):
        kv = re.match(r'^([a-z_]+):\s*"?([^"\n]*)"?\s*$', line)
        if kv:
            out[kv.group(1)] = kv.group(2).strip()
    return out


def from_remoteintech(root):
    names = set()
    for f in sorted(Path(root, 'src', 'companies').glob('*.md')):
        fm = front_matter(f.read_text(encoding='utf-8', errors='replace'))
        if fm.get('region') in KEEP_REGION and fm.get('remote_policy') in KEEP_POLICY:
            for v in (fm.get('title'), fm.get('slug')):
                k = company_key(v)
                if k:
                    names.add(k)
    return names


def from_established(readme):
    names = set()
    for line in Path(readme).read_text(encoding='utf-8', errors='replace').splitlines():
        m = re.match(r'^\|?\s*\[([^\]]+)\]\(https?://', line)   # [Company](https://...) | ... (leading pipe optional)
        if m:
            k = company_key(m.group(1))
            if k:
                names.add(k)
    return names


def from_yc(path):
    out = {}
    for c in json.loads(Path(path).read_text(encoding='utf-8')):
        if not c.get('isHiring') or c.get('status') not in (None, 'Active'):
            continue
        batch = str(c.get('batch') or '')[:20]
        for v in (c.get('name'), c.get('slug')):
            k = company_key(v)
            if k and k not in out:
                out[k] = batch
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--remoteintech')
    ap.add_argument('--established')
    ap.add_argument('--yc')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    counts, keys = {}, set()
    for label, path, fn in (('remoteintech', a.remoteintech, from_remoteintech), ('established_remote', a.established, from_established)):
        try:
            got = fn(path) if path and Path(path).exists() else set()
        except Exception as e:   # one unreadable source never stops the run
            print(f'{label}: {e}', file=sys.stderr)
            got = set()
        counts[label] = len(got)
        keys |= got
    yc = {}
    try:
        yc = from_yc(a.yc) if a.yc and Path(a.yc).exists() else {}
    except Exception as e:
        print(f'yc: {e}', file=sys.stderr)
    counts['yc_hiring'] = len(yc)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'global_hirers.json').write_text(json.dumps({'keys': sorted(keys), 'yc': yc, 'counts': counts}))
    print(json.dumps({'employers': len(keys), **counts}))


if __name__ == '__main__':
    sys.exit(main())
