"""More free job sources (owner decision 2026-11-07: "if we need more sources, just get it done").

Each source is read through a public endpoint its own site uses (no login, no key). The reads are polite: one run a day,
a pause between requests, and bounded pages. Postings are kept only when the title matches a candidate's own role rule.
Results merge into work/jobsite_raw.json as job-board reports (the screen never takes eligibility from them).

  * Workable job search      jobs.workable.com/api/v1/jobs: every Workable employer (not in the open dataset)
  * Eightfold career sites   Fluor, NEOM, TAQA (energy and Gulf employers not in the open dataset)
  * Siemens Energy (Avature) the public jobs RSS feed
  * SuccessFactors RSS       ENGIE, ACWA Power, Tata Power (employer-branded sites)
  * Arbeitnow                the public job-board API, visa-sponsorship jobs (terms: link back; every job links to Arbeitnow)
  * Getro VC networks        public collection search (startup and climate-fund portfolio jobs)
  * UN Careers               the public openings list (consultancies are often home-based)

Runs WITHOUT database credentials. One failing source is skipped, never fatal.
Usage: python engine/more_sources.py --profiles work/profiles.json --out work/ [--days 30]
"""
import argparse
import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from engine.dataset_discovery import clean  # noqa: E402
from engine.remote_boards import UA, job, text, when  # noqa: E402

PAUSE = 0.6
QUERIES = {
    'farhan_shaikh': ['gohighlevel', 'revops', 'revenue operations', 'implementation manager', 'automation specialist', 'crm manager',
                      'chief of staff', 'founder office', 'solutions engineer', 'technical operations', 'gtm engineer'],
    'sana_ansari': ['power plant', 'reliability engineer', 'maintenance engineer', 'electrical engineer', 'energy efficiency',
                    'commissioning engineer', 'operations engineer', 'decarbonization'],
}
EIGHTFOLD = [('Fluor', 'careers.fluor.com', 'fluor.com'), ('NEOM', 'careers.neom.com', 'neom.com'), ('TAQA', 'careers.taqa.com', 'taqa.com')]
SUCCESSFACTORS = [('ENGIE', 'jobs.engie.com'), ('ACWA Power', 'careers.acwapower.com'), ('Tata Power', 'careers.tatapower.com')]
SF_TERMS = ['maintenance', 'reliability', 'operations', 'power plant', 'electrical', 'energy efficiency']
GETRO = [628, 1198]


def http(url, data=None, headers=None, timeout=40):
    h = {'User-Agent': UA, 'Accept': 'application/json, application/rss+xml, */*'}
    h.update(headers or {})
    body = json.dumps(data).encode() if data is not None else None
    if body is not None:
        h['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=body, headers=h, method='POST' if body is not None else 'GET')
    with urllib.request.urlopen(req, timeout=timeout) as r:   # noqa: S310 (fixed https hosts above)
        out = r.read(12_000_000)
    time.sleep(PAUSE)
    return out


def workable(queries):
    seen = set()
    for q, remote_only in queries:
        token = None
        for _ in range(2):   # two pages a query
            url = 'https://jobs.workable.com/api/v1/jobs?' + urllib.parse.urlencode({'query': q, **({'workplace': 'remote'} if remote_only else {}), **({'pageToken': token} if token else {})})
            d = json.loads(http(url))
            for r in d.get('jobs') or []:
                if r.get('id') in seen:
                    continue
                seen.add(r.get('id'))
                loc = r.get('location') or {}
                place = ', '.join(x for x in (loc.get('city'), loc.get('countryName')) if x) or 'See posting'
                remote = r.get('workplace') == 'remote'
                yield job('workable', r.get('url') or '', text(r.get('title')), text((r.get('company') or {}).get('title')),
                          f'Remote ({place})' if remote else place, text((r.get('description') or '') + ' ' + (r.get('requirementsSection') or '')),
                          when(r.get('created')))
            token = d.get('nextPageToken')
            if not token:
                break


def eightfold():
    for company, host, domain in EIGHTFOLD:
        for start in range(0, 1000, 100):
            d = json.loads(http(f'https://{host}/api/apply/v2/jobs?domain={domain}&num=100&start={start}'))
            rows = d.get('positions') or []
            for r in rows:
                remote = str(r.get('work_location_option') or '').lower() == 'remote'
                place = r.get('location') or ', '.join(r.get('locations') or [])
                j = job('eightfold', r.get('canonicalPositionUrl') or f"https://{host}/careers/job/{r.get('id')}", text(r.get('name')), company,
                        f'Remote ({place})' if remote else place, text(r.get('job_description') or ', '.join(r.get('department') or [])),
                        when(r.get('t_create')))
                j['is_remote'] = remote
                yield j
            if len(rows) < 100:
                break


def rss_items(raw):
    for it in ET.fromstring(raw).iter('item'):
        yield it


def siemens_energy(pages=60):
    for page in range(pages):
        raw = http(f'https://jobs.siemens-energy.com/en_US/jobs/Jobs/feed/?folderRecordsPerPage=20&folderOffset={page * 20}')
        items = list(rss_items(raw))
        for it in items:
            j = job('avature', (it.findtext('link') or '').strip(), text(it.findtext('title')), 'Siemens Energy', text(it.findtext('description')),
                    '', when(it.findtext('pubDate')))
            j['is_remote'] = False
            yield j
        if len(items) < 20:
            break


def successfactors():
    for company, host in SUCCESSFACTORS:
        for term in SF_TERMS:
            raw = http(f'https://{host}/services/rss/job/?locale=en_US&keywords={urllib.parse.quote(term)}')
            for it in rss_items(raw):
                title = text(it.findtext('title'))
                m = re.match(r'^(.*?)\s*\(([^()]*)\)\s*$', title)   # "Role (City, CC, zip)"
                j = job('successfactors', (it.findtext('link') or '').strip(), m.group(1) if m else title, company, m.group(2) if m else '',
                        text(it.findtext('description')), when(it.findtext('pubDate')))
                j['is_remote'] = False
                yield j


def arbeitnow(pages=3):
    for page in range(1, pages + 1):
        d = json.loads(http(f'https://www.arbeitnow.com/api/job-board-api?page={page}&visa_sponsorship=true'))
        for r in d.get('data') or []:
            desc = ('Visa sponsorship available. ' if r.get('visa_sponsorship', True) else '') + text(r.get('description'))
            j = job('arbeitnow', r.get('url') or '', text(r.get('title')), text(r.get('company_name')), text(r.get('location')) or 'Germany', desc,
                    when(r.get('created_at')))
            j['is_remote'] = bool(r.get('remote'))
            yield j


def getro(pages=5):
    for cid in GETRO:
        for page in range(pages):
            d = json.loads(http(f'https://api.getro.com/api/v2/collections/{cid}/search/jobs', {'page': page, 'per_page': 100, 'sort': '-created_at'},
                                {'Accept': 'application/json'}))
            rows = (d.get('results') or {}).get('jobs') or []
            for r in rows:
                remote = r.get('work_mode') == 'remote'
                place = '; '.join(r.get('locations') or []) or 'See posting'
                j = job('getro', r.get('url') or '', text(r.get('title')), text((r.get('organization') or {}).get('name')),
                        f'Remote ({place})' if remote else place, '', when(r.get('created_at')))
                j['is_remote'] = remote
                yield j
            if len(rows) < 100:
                break


def un_careers(pages=5):
    for page in range(pages):
        d = json.loads(http('https://careers.un.org/api/public/opening/jo/list/filteredV2/en',
                            {'filterConfig': {'keyword': ''}, 'pagination': {'page': page, 'itemPerPage': 100, 'sortBy': 'startDate', 'sortDirection': -1}}))
        rows = ((d.get('data') or {}).get('list')) or []
        for r in rows:
            desc = text(r.get('jobDescription'))
            duty = r.get('dutyStation') or []
            place = ', '.join(x.get('description') or x.get('code') or '' for x in duty if isinstance(x, dict)) if isinstance(duty, list) else str(duty)
            home = bool(re.search(r'home[- ]based|remote', desc + ' ' + place, re.I))
            j = job('uncareers', f"https://careers.un.org/jobSearchDescription/{r.get('jobId')}?language=en", text(r.get('postingTitle') or r.get('jobTitle')),
                    'United Nations', ('Remote (home-based)' if home else place) or 'See posting', desc, when(r.get('startDate')))
            j['is_remote'] = home
            yield j
        if len(rows) < 100:
            break


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--profiles', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--days', type=int, default=30)
    a = ap.parse_args()
    profs = json.loads(Path(a.profiles).read_text())
    rules = {cid: (re.compile(p['role'], re.I), re.compile(p['exclude'], re.I) if p.get('exclude') else None) for cid, p in profs.items()}
    wq = [(q, cid == 'farhan_shaikh') for cid in profs for q in QUERIES.get(cid, [])]
    sources = {'workable': lambda: workable(wq), 'eightfold': eightfold, 'siemens_energy': siemens_energy, 'successfactors': successfactors,
               'arbeitnow': arbeitnow, 'getro': getro, 'uncareers': un_careers}
    since = datetime.now(timezone.utc) - timedelta(days=a.days)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    raw_path = out / 'jobsite_raw.json'
    merged = json.loads(raw_path.read_text()) if raw_path.exists() else {'source': 'job_sites', 'jobs': []}
    have = {j['id'] for j in merged['jobs']}
    report = {}
    for name, fn in sources.items():
        seen = kept = 0
        try:
            for j in fn():
                seen += 1
                if not j['title'] or not j['company'] or not str(j['url']).startswith('https://'):
                    continue
                if j['posted_at'] and when(j['posted_at']) and when(j['posted_at']) < since:
                    continue
                t = j['title'].lower()
                cands = [cid for cid, (role, excl) in rules.items() if role.search(t) and not (excl and excl.search(t))]
                if not cands:
                    continue
                j['id'] = f"js:{name}:{hashlib.sha1(j['url'].encode()).hexdigest()[:20]}"
                if j['id'] in have:
                    continue
                j['candidates'] = cands
                merged['jobs'].append(clean(j)); have.add(j['id']); kept += 1
            report[name] = {'read': seen, 'kept': kept}
        except Exception as e:   # one failing source is skipped
            report[name] = {'error': str(e)[:160], 'read': seen, 'kept': kept}
    raw_path.write_text(json.dumps(merged, default=str))
    (out / 'more_sources_report.json').write_text(json.dumps(report, indent=1))
    print(json.dumps(report))


if __name__ == '__main__':
    sys.exit(main())
