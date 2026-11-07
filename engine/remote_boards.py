"""Official public feeds of remote job boards (owner decision 2026-11-07), next to the light job-site search.

Sources, each read through its own public feed (no scraping, no login):
  * Remote OK      https://remoteok.com/api  (terms: link back and name Remote OK as the source; every stored job links to
                   its Remote OK page and is labelled "remoteok")
  * We Work Remotely  category RSS feeds
  * Himalayas      https://himalayas.app/jobs/api  (newest pages)
  * Working Nomads https://www.workingnomads.com/api/exposed_jobs/
  * Hacker News "Ask HN: Who is hiring?" (the current monthly thread, through the official Algolia HN API): one posting per
    role named in each top-level post ("Company | Role | Location | REMOTE | ..."); linked to the post on news.ycombinator.com
Postings are kept only when the title matches a candidate's own role rule (profiles.json, written by dataset_discovery.py).
Results are job-board reports: the screen never takes eligibility from them.

Runs WITHOUT database credentials and merges into work/jobsite_raw.json (created if the job-site step did not run), so the
existing duplicate check (dataset_discovery.py --dedupe) covers these too. One failing feed is skipped, never fatal.
Usage: python engine/remote_boards.py --profiles work/profiles.json --out work/ [--days 7]
"""
import argparse
import hashlib
import html
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from engine.dataset_discovery import clean  # noqa: E402

UA = 'career-job-engine/1.0 (+private job search)'
WWR = ['remote-management-and-finance-jobs', 'remote-product-jobs', 'remote-sales-and-marketing-jobs', 'all-other-remote-jobs']
HIMALAYAS_PAGES = 10   # 20 newest jobs a page
TAG = re.compile(r'<[^>]+>')


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json, application/rss+xml, */*'})
    with urllib.request.urlopen(req, timeout=timeout) as r:   # noqa: S310 (fixed https URLs above)
        return r.read(8_000_000)


def text(s):
    return re.sub(r'\s+', ' ', html.unescape(TAG.sub(' ', str(s or '')))).strip()


def when(value):
    if value in (None, ''):
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value / 1000 if value > 1e11 else value, timezone.utc)
        v = str(value)
        try:
            return datetime.fromisoformat(v.replace('Z', '+00:00')).astimezone(timezone.utc)
        except ValueError:
            return parsedate_to_datetime(v).astimezone(timezone.utc)
    except Exception:
        return None


def job(source, url, title, company, location, description, posted, smin=None, smax=None, currency=None, period=None):
    return {'url': url, 'apply_url': None, 'title': title, 'company': company, 'ats_type': source, 'location': location or 'Remote',
            'country_iso': None, 'is_remote': True, 'description': description[:8000], 'posted_at': posted.isoformat() if posted else '',
            'salary_min': smin, 'salary_max': smax, 'salary_currency': currency, 'salary_period': period, 'board': True}


def remoteok():
    rows = json.loads(get('https://remoteok.com/api'))
    for r in rows[1:] if rows and 'legal' in rows[0] else rows:   # the first element is Remote OK's terms
        yield job('remoteok', r.get('url') or '', text(r.get('position')), text(r.get('company')), text(r.get('location')) or 'Worldwide',
                  text(r.get('description')), when(r.get('date')), r.get('salary_min') or None, r.get('salary_max') or None,
                  'USD' if r.get('salary_min') or r.get('salary_max') else None, 'year' if r.get('salary_min') or r.get('salary_max') else None)


def wwr():
    for cat in WWR:
        root = ET.fromstring(get(f'https://weworkremotely.com/categories/{cat}.rss'))
        for it in root.iter('item'):
            raw = text(it.findtext('title'))
            company, _, title = raw.partition(': ')
            yield job('weworkremotely', (it.findtext('link') or '').strip(), title or raw, company if title else '',
                      text(it.findtext('region')) or 'Remote', text(it.findtext('description')), when(it.findtext('pubDate')))


def himalayas():
    for page in range(HIMALAYAS_PAGES):
        d = json.loads(get(f'https://himalayas.app/jobs/api?limit=20&offset={page * 20}'))
        for r in d.get('jobs') or []:
            where = ', '.join(r.get('locationRestrictions') or []) or 'Worldwide'
            yield job('himalayas', r.get('applicationLink') or r.get('guid') or '', text(r.get('title')), text(r.get('companyName')), f'Remote ({where})',
                      text(r.get('description') or r.get('excerpt')), when(r.get('pubDate')), r.get('minSalary') or None, r.get('maxSalary') or None,
                      r.get('currency') or ('USD' if r.get('minSalary') else None), 'year' if r.get('minSalary') or r.get('maxSalary') else None)
        if len(d.get('jobs') or []) < 20:
            break


def workingnomads():
    for r in json.loads(get('https://www.workingnomads.com/api/exposed_jobs/')):
        yield job('workingnomads', r.get('url') or '', text(r.get('title')), text(r.get('company_name')), text(r.get('location')) or 'Remote',
                  text(r.get('description')), when(r.get('pub_date')))


HN_API = 'https://hn.algolia.com/api/v1'
LOCATION_WORD = re.compile(r'remote|onsite|on-site|hybrid|anywhere|worldwide|\b[A-Z][a-z]+,\s*[A-Z]{2}\b|europe|india|usa|\bus\b|uk|canada|germany|london|berlin|bangalore|bengaluru', re.I)


def hn():
    """The current month's 'Ask HN: Who is hiring?' thread. Posts follow 'Company | Role(s) | Location | ...' on their first line."""
    hits = json.loads(get(f'{HN_API}/search_by_date?tags=story,author_whoishiring&hitsPerPage=5')).get('hits') or []
    story = next((h for h in hits if str(h.get('title', '')).startswith('Ask HN: Who is hiring?')), None)
    if not story:
        return
    thread = json.loads(get(f"{HN_API}/items/{story['objectID']}", timeout=60))
    for c in thread.get('children') or []:
        body = c.get('text') or ''
        first = text(re.split(r'<p>|\n', body, maxsplit=1)[0])
        parts = [x.strip() for x in first.split('|') if x.strip()]
        if len(parts) < 2 or not c.get('id'):
            continue
        company, rest = parts[0][:120], parts[1:]
        roles = [r.strip() for r in re.split(r',|;| / ', rest[0]) if len(r.strip()) >= 3] if not LOCATION_WORD.fullmatch(rest[0].strip()) else []
        where = ' | '.join(x for x in rest[1:] if LOCATION_WORD.search(x) and not x.lower().startswith('http'))[:200] or 'See post'
        remote = bool(re.search(r'\bremote\b', first, re.I))
        for i, role in enumerate(roles[:6]):
            j = job('hnhiring', f"https://news.ycombinator.com/item?id={c['id']}", role[:200], company, where, text(body), when(c.get('created_at')))
            j['is_remote'] = remote
            j['_key'] = f"{c['id']}:{i}"
            yield j


SOURCES = {'remoteok': remoteok, 'weworkremotely': wwr, 'himalayas': himalayas, 'workingnomads': workingnomads, 'hnhiring': hn}
MAX_DAYS = {'hnhiring': 35}   # the thread is monthly: its posts stay current all month


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--profiles', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--days', type=int, default=7)
    a = ap.parse_args()
    profs = json.loads(Path(a.profiles).read_text())
    rules = {cid: (re.compile(p['role'], re.I), re.compile(p['exclude'], re.I) if p.get('exclude') else None) for cid, p in profs.items()}
    since = datetime.now(timezone.utc) - timedelta(days=a.days)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    raw_path = out / 'jobsite_raw.json'
    merged = json.loads(raw_path.read_text()) if raw_path.exists() else {'source': 'job_sites', 'jobs': []}
    have = {j['id'] for j in merged['jobs']}
    report = {}
    for name, fn in SOURCES.items():
        seen = kept = 0
        try:
            for j in fn():
                seen += 1
                if not j['title'] or not j['company'] or not str(j['url']).startswith('https://'):
                    continue
                cutoff = datetime.now(timezone.utc) - timedelta(days=MAX_DAYS[name]) if name in MAX_DAYS else since
                if j['posted_at'] and when(j['posted_at']) and when(j['posted_at']) < cutoff:
                    continue
                t = j['title'].lower()
                cands = [cid for cid, (role, excl) in rules.items() if role.search(t) and not (excl and excl.search(t))]
                if not cands:
                    continue
                j['id'] = f"js:{name}:{hashlib.sha1(j.pop('_key', j['url']).encode()).hexdigest()[:20]}"
                if j['id'] in have:
                    continue
                j['candidates'] = cands
                merged['jobs'].append(clean(j)); have.add(j['id']); kept += 1
            report[name] = {'read': seen, 'kept': kept}
        except Exception as e:   # one failing feed is skipped
            report[name] = {'error': str(e)[:160], 'read': seen, 'kept': kept}
    raw_path.write_text(json.dumps(merged, default=str))
    (out / 'boards_report.json').write_text(json.dumps(report, indent=1))
    print(json.dumps(report))


if __name__ == '__main__':
    sys.exit(main())
