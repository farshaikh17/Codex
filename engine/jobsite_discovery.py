"""Light daily search of job sites (Indeed, LinkedIn, and Glassdoor / Google Jobs when they answer; Naukri dropped 14 Nov for its terms) through the
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
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from engine import robots  # noqa: E402
from engine.dataset_discovery import clean  # noqa: E402

# Naukri dropped 14 Nov (compliance): its terms forbid automated access and its robots.txt blocks AI agents.
SITES = ['indeed', 'linkedin', 'glassdoor', 'google', 'bayt']
INDIA_SITES = ['indeed', 'linkedin', 'glassdoor', 'google']
# The address JobSpy requests for each site, checked against that host's robots.txt at run time (engine/robots.py).
SITE_ENDPOINT = {'indeed': 'https://apis.indeed.com/graphql', 'linkedin': 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search',
                 'glassdoor': 'https://www.glassdoor.co.in/graph', 'google': 'https://www.google.com/search?q=jobs&udm=8',
                 'bayt': 'https://www.bayt.com/en/international/jobs/'}
# False: a site whose robots.txt disallows the address is still searched and the report says "robots: disallowed" (the owner decides;
# see the PR that turns this on). True: such a site is skipped and reported as blocked by robots.txt.
ENFORCE_ROBOTS = False
GULF_SITES = ['bayt', 'indeed', 'linkedin']   # Bayt is the largest Gulf job board; Indeed searched in that country
# Searches per built-in candidate: (search term, location, Indeed country, sites). The title filter below (the Worker's own role rule, the
# profile's wide_role) removes loose matches, and engine/prescreen.py then keeps only rows the Worker's screen scores near the person's threshold,
# so a wider search costs runner time, not database reads or writes. Owner rules 2026-11-07: Farhan remote only, from India;
# Sana India, the Gulf, or abroad with a visa route.
# 20 Nov (max discovery): Indeed answers every search from the runner (LinkedIn answers about ten rows before 429; Glassdoor and Bayt answer 403;
# Google returns nothing), so the extra searches are Indeed's, in India and in each of the six Gulf countries; the original searches keep their
# other sites. Measured live in DISCOVERY_PIPELINE.md ("Maximum discovery, 20 Nov 2026").
ORIGINAL = {
    'farhan_shaikh': [('implementation manager remote', 'India', 'India', INDIA_SITES), ('solutions engineer remote', 'India', 'India', INDIA_SITES),
                      ('technical operations remote', 'India', 'India', INDIA_SITES), ('CRM automation remote', 'India', 'India', INDIA_SITES),
                      ('chief of staff remote', 'India', 'India', INDIA_SITES)],
    'sana_ansari': [('electrical maintenance engineer', 'India', 'India', INDIA_SITES), ('reliability engineer', 'India', 'India', INDIA_SITES),
                    ('energy efficiency engineer', 'India', 'India', INDIA_SITES),
                    ('power plant engineer', 'Dubai', 'United Arab Emirates', GULF_SITES), ('maintenance engineer power plant', 'Riyadh', 'Saudi Arabia', GULF_SITES),
                    ('electrical maintenance engineer', 'Doha', 'Qatar', GULF_SITES), ('power plant engineer', 'Muscat', 'Oman', GULF_SITES),
                    # 19 Nov: kept where a live read (Indeed and LinkedIn, last 48 hours) found rows the searches above missed that score at or above
                    # her threshold: thermal power plant 4 (boiler maintenance at power stations), mechanical maintenance 3, O&M power plant 1, Abu Dhabi 1.
                    ('maintenance engineer thermal power plant', 'India', 'India', INDIA_SITES), ('mechanical maintenance engineer', 'India', 'India', INDIA_SITES),
                    ('O&M engineer power plant', 'India', 'India', INDIA_SITES), ('maintenance engineer', 'Abu Dhabi', 'United Arab Emirates', GULF_SITES)],
}
# Indeed-only searches added 20 Nov. Farhan's are run with Indeed's remote filter (is_remote) in India. Every term is itself a title the person's
# role rule (wide_role) accepts, except the product names (HubSpot, GoHighLevel, Zapier, n8n, Workato), whose results carry titles that do.
FARHAN_TERMS = ['implementation consultant', 'implementation specialist', 'onboarding specialist', 'customer onboarding manager', 'solutions consultant',
                'technical project manager', 'technical program manager', 'professional services consultant', 'delivery manager', 'CRM specialist',
                'CRM manager', 'HubSpot', 'GoHighLevel', 'Zapier', 'n8n', 'workflow automation', 'AI automation',
                'marketing operations', 'revenue operations', 'sales operations', 'business operations manager', 'integration specialist',
                'integration engineer', 'technical account manager', 'Workato', 'business systems analyst',
                'automation specialist', 'customer success operations']
SANA_INDIA_TERMS = ['maintenance engineer', 'maintenance manager', 'plant maintenance', 'power plant engineer', 'boiler engineer', 'turbine engineer',
                    'O&M engineer', 'utilities engineer', 'plant engineer', 'energy engineer', 'energy manager', 'commissioning engineer',
                    'water treatment plant engineer', 'substation engineer', 'solar O&M', 'wind O&M', 'shift engineer', 'shift in charge',
                    'HVAC maintenance engineer', 'instrumentation maintenance engineer', 'rotating equipment engineer',
                    'gas turbine', 'electrical engineer power plant', 'reliability manager', 'operations engineer power plant']
SANA_GULF_TERMS = ['maintenance engineer', 'electrical maintenance engineer', 'mechanical maintenance engineer', 'power plant engineer', 'O&M engineer',
                   'reliability engineer', 'commissioning engineer', 'utilities engineer', 'water treatment plant engineer', 'energy engineer',
                   'substation engineer', 'shift engineer', 'HVAC maintenance engineer', 'rotating equipment engineer', 'maintenance manager',
                   'plant engineer']
GULF_COUNTRIES = ['United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Oman', 'Kuwait', 'Bahrain']


def build_queries():
    """The original searches, then Indeed-only searches for each term not already searched in that country."""
    out = {cid: list(q) for cid, q in ORIGINAL.items()}
    def add(cid, term, loc, country):
        if not any(t.lower() == term.lower() and c == country for t, _, c, _ in out[cid]):
            out[cid].append((term, loc, country, ['indeed']))
    for t in FARHAN_TERMS:
        add('farhan_shaikh', t, 'India', 'India')
    for t in SANA_INDIA_TERMS:
        add('sana_ansari', t, 'India', 'India')
    for country in GULF_COUNTRIES:
        for t in SANA_GULF_TERMS:
            add('sana_ansari', t, country, country)
    return out


QUERIES = build_queries()
MAX_QUERIES = 11   # a resold client's own role keywords: at most this many searches
# Parallel jobs (discovery.yml matrix): each runs one shard of the searches, so the step's time limit no longer caps how many run.
SHARDS = ('farhan', 'sana_india', 'sana_gulf', 'clients')
BLOCK_LIMIT = 2    # a site that refused this many searches in a run is not asked again in that run (it would only refuse again)


def shard_of(cid, country):
    if cid == 'farhan_shaikh':
        return 'farhan'
    if cid == 'sana_ansari':
        return 'sana_india' if country == 'India' else 'sana_gulf'
    return 'clients'


BLOCK_WORDS = re.compile(r'\b(403|429)\b|forbidden|too many requests|rate.?limit|captcha|access denied|blocked', re.I)


class BlockWatch(logging.Handler):
    """JobSpy does not raise when a site refuses it (403/429): it logs the refusal and returns an empty result, so a blocked search
    looked like 'nothing found' and the report said blocked: 0. This remembers JobSpy's own refusal messages so the search can
    be counted as blocked."""

    def __init__(self):
        super().__init__(level=logging.WARNING)
        self.messages = []

    def emit(self, record):
        if re.match(r'^jobspy(?:[.:]|$)', record.name, re.I):
            text = record.getMessage()
            if BLOCK_WORDS.search(text):
                self.messages.append(text[:120])

    def take(self):
        out, self.messages = self.messages, []
        return out


def blocked_note(rows, messages):
    """The refusal message when a search returned nothing AND JobSpy logged a refusal; None otherwise."""
    return messages[0] if (not rows and messages) else None


LINKEDIN_RESULTS = 25   # LinkedIn's guest search answers 429 after a few pages: asking for more only adds refusals


def run_search(site, term, location, results, hours, country='India', remote=False):
    from jobspy import scrape_jobs
    kw = {'country_indeed': country}
    if site == 'google':
        kw = {'google_search_term': f'{term} jobs in {location} since yesterday'}
    if site in ('bayt', 'linkedin'):
        kw = {}
    if remote and site in ('indeed', 'linkedin'):
        kw['is_remote'] = True
    if site == 'linkedin':
        results = min(results, LINKEDIN_RESULTS)
    df = scrape_jobs(site_name=[site], search_term=term, location=location, results_wanted=results, hours_old=hours, verbose=0, **kw)
    return [] if df is None else df.to_dict('records')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--profiles', required=True)
    ap.add_argument('--results', type=int, default=20)
    ap.add_argument('--hours', type=int, default=48)
    ap.add_argument('--shard', default='all', choices=('all',) + SHARDS, help='run only this part of the searches (a parallel job of discovery.yml)')
    ap.add_argument('--raw-name', default='jobsite_raw.json', help='output file name (parallel jobs write their own and the run merges them)')
    ap.add_argument('--budget-seconds', type=int, default=0, help='no search starts after this many seconds (what was found is written)')
    a = ap.parse_args()
    started = time.monotonic()
    profs = json.loads(Path(a.profiles).read_text())
    found, log = {}, []
    robots_status = {}
    for site in SITES:
        try:
            robots_status[site] = 'allowed' if robots.allowed(SITE_ENDPOINT[site]) else 'disallowed'
        except Exception as e:   # noqa: BLE001 - reported, never fatal
            robots_status[site] = f'unknown ({type(e).__name__})'
    watch = BlockWatch(); logging.getLogger().addHandler(watch)
    refused = {}   # site -> searches it refused this run
    for cid, p in profs.items():
        # built-in candidates: the fixed searches above; a resold client: its own role keywords, in its home country
        home = p['home'].title()
        queries = QUERIES.get(cid) or [(w, home, home, INDIA_SITES if home == 'India' else ['indeed', 'linkedin']) for w in p.get('keywords', [])]
        if cid not in QUERIES:
            queries = queries[:MAX_QUERIES]
        # the Worker's own role rule (wide_role, as the dataset intake uses) when the profile carries it; the search's own role rule otherwise
        role = re.compile(p.get('wide_role') or p['role'], re.I); exclude = re.compile(p['exclude'], re.I) if p.get('exclude') else None
        remote = p.get('mode') == 'REMOTE_FROM_HOME'
        for term, loc, country, sites in queries:
            if a.shard != 'all' and shard_of(cid, country) != a.shard:
                continue
            if a.budget_seconds and time.monotonic() - started > a.budget_seconds:
                log.append({'site': ','.join(sites), 'term': term, 'skipped': 'time budget'}); continue
            for site in sites:
                if site not in SITES:   # a site dropped for compliance (Naukri) is never searched, even from an old profile
                    continue
                if refused.get(site, 0) >= BLOCK_LIMIT:
                    log.append({'site': site, 'term': term, 'skipped': 'site refused earlier searches this run'}); continue
                if ENFORCE_ROBOTS and robots_status.get(site) != 'allowed':
                    log.append({'site': site, 'term': term, 'error': f'robots.txt: {robots_status.get(site)}'}); continue
                watch.take()
                try:
                    rows = run_search(site, term, loc, a.results, a.hours, country, **({'remote': True} if remote else {}))
                except Exception as e:   # a blocked site is skipped, never fatal
                    watch.take(); refused[site] = refused.get(site, 0) + 1
                    log.append({'site': site, 'term': term, 'error': str(e)[:120]}); continue
                note = blocked_note(rows, watch.take())
                if note:   # an empty answer plus a refusal in JobSpy's own log is a blocked search, not 'nothing found'
                    refused[site] = refused.get(site, 0) + 1
                    log.append({'site': site, 'term': term, 'error': note}); continue
                refused[site] = 0   # an answer: the refusals before it were not a block
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
                log.append({'site': site, 'term': term, 'country': country, 'returned': len(rows), 'kept': kept})
    jobs = [clean(j) for j in found.values()]
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    report = {'shard': a.shard, 'searches': sum(1 for x in log if 'skipped' not in x), 'blocked': sum(1 for x in log if 'error' in x),
              'skipped_after_refusals': sum(1 for x in log if x.get('skipped', '').startswith('site refused')),
              'skipped_for_time': sum(1 for x in log if x.get('skipped') == 'time budget'), 'returned': sum(x.get('returned', 0) for x in log), 'selected': len(jobs),
              'by_site': {s: sum(x.get('kept', 0) for x in log if x['site'] == s) for s in SITES}, 'robots': robots_status}
    (out / a.raw_name).write_text(json.dumps({'source': 'job_sites', 'jobs': jobs}, default=str))
    (out / 'jobsite_report.json').write_text(json.dumps({**report, 'log': log}, indent=1, default=str))
    print(json.dumps(report))


if __name__ == '__main__':
    sys.exit(main())

