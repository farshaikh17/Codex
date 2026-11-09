"""Light daily search of job sites (Indeed, LinkedIn, Naukri, and Glassdoor / Google Jobs when they answer) through the
open-source JobSpy library (MIT). Owner decision 2026-11-06: a handful of targeted searches per candidate per day, never
bulk scraping. Results are job-board reports, so the screen treats eligibility as unknown until verified.

Runs WITHOUT database credentials: it reads the search profiles the dataset step wrote (work/profiles.json) and writes
work/jobsite_raw.json; duplicates against D1 are removed afterwards by `dataset_discovery.py --dedupe` in a separate step.
Usage: python engine/jobsite_discovery.py --profiles work/profiles.json --out work/ [--results 20] [--hours 48]
"""
import argparse
import hashlib
import json
import logging
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from engine.dataset_discovery import clean  # noqa: E402

SITES = ['indeed', 'linkedin', 'naukri', 'glassdoor', 'google', 'bayt']
INDIA_SITES = ['indeed', 'linkedin', 'naukri', 'glassdoor', 'google']
GULF_SITES = ['bayt', 'indeed', 'linkedin']   # Bayt is the largest Gulf job board; Indeed searched in that country
# A few searches per built-in candidate: (search term, location, Indeed country, sites). The title filter below (the
# Worker's own role rule) removes loose matches. Owner rules 2026-11-07: Farhan remote only, from any country;
# Sana anywhere, so her searches cover India and the Gulf job boards.
QUERIES = {
    'farhan_shaikh': [('implementation manager remote', 'India', 'India', INDIA_SITES), ('solutions engineer remote', 'India', 'India', INDIA_SITES),
                      ('technical operations remote', 'India', 'India', INDIA_SITES), ('CRM automation remote', 'India', 'India', INDIA_SITES),
                      ('chief of staff remote', 'India', 'India', INDIA_SITES)],
    'sana_ansari': [('electrical maintenance engineer', 'India', 'India', INDIA_SITES), ('reliability engineer', 'India', 'India', INDIA_SITES),
                    ('energy efficiency engineer', 'India', 'India', INDIA_SITES),
                    ('power plant engineer', 'Dubai', 'United Arab Emirates', GULF_SITES), ('maintenance engineer power plant', 'Riyadh', 'Saudi Arabia', GULF_SITES),
                    ('electrical maintenance engineer', 'Doha', 'Qatar', GULF_SITES), ('power plant engineer', 'Muscat', 'Oman', GULF_SITES)],
}
MAX_QUERIES = 7


BLOCK_WORDS = re.compile(r'\b(403|429)\b|forbidden|too many requests|rate.?limit|captcha|access denied|blocked', re.I)


class BlockWatch(logging.Handler):
    """JobSpy does not raise when a site refuses it (403/429): it logs the refusal and returns an empty result, so a blocked search
    looked like 'nothing found' and the report said blocked: 0. This remembers JobSpy's own refusal messages so the search can
    be counted as blocked."""

    def __init__(self):
        super().__init__(level=logging.WARNING)
        self.messages = []

    def emit(self, record):
        if record.name.lower().split('.', 1)[0] == 'jobspy':
            text = record.getMessage()
            if BLOCK_WORDS.search(text):
                self.messages.append(text[:120])

    def take(self):
        out, self.messages = self.messages, []
        return out


def blocked_note(rows, messages):
    """The refusal message when a search returned nothing AND JobSpy logged a refusal; None otherwise."""
    return messages[0] if (not rows and messages) else None


def run_search(site, term, location, results, hours, country='India'):
    from jobspy import scrape_jobs
    kw = {'country_indeed': country}
    if site == 'google':
        kw = {'google_search_term': f'{term} jobs in {location} since yesterday'}
    if site in ('bayt', 'linkedin', 'naukri'):
        kw = {}
    df = scrape_jobs(site_name=[site], search_term=term, location=location, results_wanted=results, hours_old=hours, verbose=0, **kw)
    return [] if df is None else df.to_dict('records')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--profiles', required=True)
    ap.add_argument('--results', type=int, default=20)
    ap.add_argument('--hours', type=int, default=48)
    a = ap.parse_args()
    profs = json.loads(Path(a.profiles).read_text())
    found, log = {}, []
    watch = BlockWatch(); logging.getLogger().addHandler(watch)
    for cid, p in profs.items():
        # built-in candidates: the fixed searches above; a resold client: its own role keywords, in its home country
        home = p['home'].title()
        queries = QUERIES.get(cid) or [(w, home, home, INDIA_SITES if home == 'India' else ['indeed', 'linkedin']) for w in p.get('keywords', [])]
        role = re.compile(p['role'], re.I); exclude = re.compile(p['exclude'], re.I) if p.get('exclude') else None
        for term, loc, country, sites in queries[:MAX_QUERIES]:
            for site in sites:
                watch.take()
                try:
                    rows = run_search(site, term, loc, a.results, a.hours, country)
                except Exception as e:   # a blocked site is skipped, never fatal
                    watch.take(); log.append({'site': site, 'term': term, 'error': str(e)[:120]}); continue
                note = blocked_note(rows, watch.take())
                if note:   # an empty answer plus a refusal in JobSpy's own log is a blocked search, not 'nothing found'
                    log.append({'site': site, 'term': term, 'error': note}); continue
                kept = 0
                for r in rows:
                    title, url, company = str(r.get('title') or ''), str(r.get('job_url') or ''), str(r.get('company') or '')
                    if not title or not url.startswith('https://') or not company or company == 'nan':
                        continue
                    if not role.search(title.lower()) or (exclude and exclude.search(title.lower())):
                        continue
                    jid = f"js:{site}:{hashlib.sha1(url.encode()).hexdigest()[:20]}"
                    desc = r.get('description')
                    j = found.setdefault(jid, {
                        'id': jid, 'url': url, 'apply_url': str(r.get('job_url_direct') or '') or None, 'title': title, 'company': company,
                        'ats_type': site, 'location': str(r.get('location') or ''), 'country_iso': None,
                        'is_remote': bool(r.get('is_remote')) if r.get('is_remote') is not None else None,
                        'description': (str(desc)[:8000] if desc and str(desc) != 'nan' else ''), 'posted_at': str(r.get('date_posted') or ''),
                        'salary_min': r.get('min_amount') if str(r.get('min_amount')) != 'nan' else None,
                        'salary_max': r.get('max_amount') if str(r.get('max_amount')) != 'nan' else None,
                        'salary_currency': r.get('currency') if str(r.get('currency')) != 'nan' else None, 'salary_period': r.get('interval') if str(r.get('interval')) != 'nan' else None,
                        'board': True, 'candidates': []})
                    if cid not in j['candidates']:
                        j['candidates'].append(cid)
                    kept += 1
                log.append({'site': site, 'term': term, 'returned': len(rows), 'kept': kept})
    jobs = [clean(j) for j in found.values()]
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    report = {'searches': len(log), 'blocked': sum(1 for x in log if 'error' in x), 'selected': len(jobs),
              'by_site': {s: sum(x.get('kept', 0) for x in log if x['site'] == s) for s in SITES}}
    (out / 'jobsite_raw.json').write_text(json.dumps({'source': 'job_sites', 'jobs': jobs}, default=str))
    (out / 'jobsite_report.json').write_text(json.dumps({**report, 'log': log}, indent=1, default=str))
    print(json.dumps(report))


if __name__ == '__main__':
    sys.exit(main())

