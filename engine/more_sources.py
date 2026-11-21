"""More free job sources (owner decision 2026-11-07: "if we need more sources, just get it done").

Each source is read through a public endpoint its own site uses (no login, no key). The reads are polite: one run a day,
a pause between requests, and bounded pages. Postings are kept only when the title matches a candidate's own role rule.
Results merge into work/jobsite_raw.json. Aggregators (Workable, Arbeitnow, UN Careers, EURES, Adzuna) are job-board reports
(the screen never takes eligibility from them). Employer career sites (EMPLOYER_SITES: Workday, Oracle, SuccessFactors, SmartRecruiters,
Siemens Energy, Eightfold) carry board=False: stored verified, with normal eligibility and provenance LIVE_PUBLIC.

  * Workable job search      jobs.workable.com/api/v1/jobs: every Workable employer (not in the open dataset); workable_places searches
                             the same API by place (Sana: India and the Gulf, on site)
  * Eightfold career sites   Fluor, NEOM, TAQA (energy and Gulf employers not in the open dataset)
  * Siemens Energy (Avature) the public jobs RSS feed
  * SuccessFactors           ENGIE, ACWA Power, Tata Power, ReNew and others: the /search/ result pages or the sitemap plus job pages
                             (robots.txt disallows the /services/ RSS feed read before 14 Nov)
  * Arbeitnow                the public job-board API, visa-sponsorship jobs (terms: link back; every job links to Arbeitnow)
  * UN Careers               the public openings list (consultancies are often home-based)
  * EURES                    the EU job-mobility portal's public search (about 2 million EU vacancies), English titles where given
  * Adzuna                   only when the free ADZUNA_APP_ID / ADZUNA_APP_KEY secrets are set AND the owner accepted the API terms
                             (ADZUNA_API_TERMS_ACCEPTED=true), because api.adzuna.com's robots.txt disallows every agent

Every request first passes engine/robots.py: the host's robots.txt (read once a run) must allow the path, and requests to one host
are spaced by PAUSE or the host's Crawl-delay. A refused source is reported with the reason; it never fails the run.
Not read for compliance (14 Nov): the SuccessFactors RSS (/services/ disallowed), Getro (api.getro.com disallows everything) and the
SmartRecruiters postings API (api.smartrecruiters.com disallows every agent but LinkedIn's; the public career pages are read instead).

Runs WITHOUT database credentials. One failing source is skipped, never fatal.
Usage: python engine/more_sources.py --profiles work/profiles.json --out work/ [--days 30]
"""
import argparse
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from adapters import ashby_workplace  # noqa: E402
from engine.dataset_discovery import clean  # noqa: E402
from engine.multi_place import from_count, places_text  # noqa: E402
from engine import reposters, robots  # noqa: E402
from engine.remote_boards import UA, all_errored, job, over_budget, text, when, write_json  # noqa: E402

PAUSE = 0.6
# Sources that read an employer's own career site (not a job board): their rows are stored as the employer's posting.
EMPLOYER_SITES = ('workday', 'oracle_hcm', 'successfactors', 'smartrecruiters', 'siemens_energy', 'eightfold', 'jibe', 'watch_boards')
QUERIES = {
    'farhan_shaikh': ['gohighlevel', 'revops', 'revenue operations', 'implementation manager', 'automation specialist', 'crm manager',
                      'chief of staff', 'founder office', 'solutions engineer', 'technical operations', 'gtm engineer',
                      # plan D1 (13 Nov): kept only where a live Workable read returned mostly his roles (implementation 20 of 20, solutions consultant
                      # 16 of 20); onboarding (HR onboarding), technical account manager, customer engineer and business systems returned few and were left out
                      'implementation', 'solutions consultant',
                      # 19 Nov: a live read returned 14 of his titles in 39 postings and 3 new rows at or above his threshold
                      'marketing operations'],
    'sana_ansari': ['power plant', 'reliability engineer', 'maintenance engineer', 'electrical engineer', 'energy efficiency',
                    'commissioning engineer', 'operations engineer', 'decarbonization',
                    # plan D1 (13 Nov): her non-maintenance roles, kept where a live Workable read returned mostly her field (utilities engineer 17 of 20,
                    # energy manager 18, plant engineer 13, O&M engineer 8); asset performance returned finance roles only and was left out
                    'utilities engineer', 'energy manager', 'plant engineer', 'O&M engineer',
                    # 19 Nov: 11 of her titles in 39 postings, 2 new rows at or above her threshold
                    'boiler'],
}
# 19 Nov: Workable's search also takes a place (location=...). The worldwide reads above mostly land in the US and Europe, so Sana's
# on-site places are searched on their own (Qatar, Oman, Kuwait and Bahrain list few Workable jobs: one broad term each). A place search
# is ordered by relevance, not date, so many rows are older than the run's --days cutoff. A live read that day (about 60 requests, under
# 2 minutes) found 22 different jobs at or above her threshold, 9 of them posted in the last 30 days (7 that the worldwide terms did not
# find). Farhan's remote jobs placed in India found none in 30 days that the worldwide terms missed, so he has no place searches.
# (search term, remote only, place).
WORKABLE_PLACE_TERMS = ['maintenance', 'reliability', 'energy', 'electrical engineer', 'mechanical engineer', 'commissioning', 'utilities']
WORKABLE_PLACES = {
    'sana_ansari': [(q, False, place) for place in ('India', 'Saudi Arabia', 'United Arab Emirates') for q in WORKABLE_PLACE_TERMS]
                   + [('engineer', False, place) for place in ('Qatar', 'Oman', 'Kuwait', 'Bahrain')],
}
# Seconds between two requests to one host when longer than PAUSE: jobs.workable.com answered 429 (too many requests) to about one request
# in fifteen at PAUSE in a live read on 19 Nov.
HOST_PAUSE = {'jobs.workable.com': 1.2}
# Owner default 14 Nov: engineering facilities roles (plant-room and utilities work in buildings and campuses) are searched on JLL's
# Workday board (FM_TERMS) and accepted at the source by FM_ROLE below. They are not Workable search terms yet: the Worker's role rule
# (dashboard/worker/discovery.ts, test S2) does not name "chief engineer" or "technical supervisor", so that rule must learn them first.
FM_TERMS = ['shift engineer', 'chief engineer', 'facility manager engineering', 'technical supervisor', 'MEP engineer']
# Owner default 14 Nov (Sana): engineering facilities titles count as her field at the source, next to her profile's role rule (which
# lives in dataset_discovery.py and does not name them). Office, admin and soft-services facilities roles stay out.
FM_ROLE = re.compile(r'shift (?:engineer|in.?charge|charge engineer)|chief engineer|facilit(?:y|ies) manager\W{0,5}(?:technical|engineering)|'
                     r'(?:technical|engineering) facilit(?:y|ies) manager|facilities engineer|technical supervisor|\bmep (?:engineer|manager|lead|supervisor|in.?charge)', re.I)
FM_EXCLUDE = re.compile(r'admin|office|front desk|reception|housekeeping|soft services|hospitality|workplace|mailroom|cleaning|security|catering|'
                        r'coordinator|software|cloud|\bdata\b|\bai\b|platform|sales|estimat|design|draft', re.I)
FM_CANDIDATES = ('sana_ansari',)


def title_candidates(title, rules):
    """The candidates whose role rule this title matches (plus Sana's engineering facilities titles)."""
    t = (title or '').lower()
    out = []
    for cid, (role, excl) in rules.items():
        if excl and excl.search(t):
            continue
        if role.search(t) or (cid in FM_CANDIDATES and FM_ROLE.search(t) and not FM_EXCLUDE.search(t)):
            out.append(cid)
    return out
EIGHTFOLD = [('Fluor', 'careers.fluor.com', 'fluor.com'), ('NEOM', 'careers.neom.com', 'neom.com'), ('TAQA', 'careers.taqa.com', 'taqa.com')]
# (display name, host, options): iso=True maps a trailing two-letter country ("Riyadh, SA") to its name on sites outside the US.
# 19 Nov: read in this order, smallest and India / Gulf first. The source stops at its time cap, and ENGIE (about 1,700 postings worldwide)
# used to be read first and fill it, so ReNew, last in the list, was never read (14 rows at or above Sana's threshold in a live read on
# 19 Nov). ReNew and Tata Power are not in the open ATS dataset; the six after them are (the daily run reads them there too).
SUCCESSFACTORS = [# 14 Nov: ReNew (wind and solar O&M in India); its /search/ page has another template, so it is read from its sitemap
                  ('ReNew', 'careers.renew.com', {'iso': True}),
                  ('Tata Power', 'careers.tatapower.com', {'iso': True}), ('ACWA Power', 'careers.acwapower.com', {'iso': True}),
                  ('Emirates Global Aluminium', 'careers.ega.ae', {'iso': True}),
                  ('Tata Motors', 'careers.tatamotors.com', {'iso': True}),   # added 2026-11-12, live that day (India plants)
                  # jobs.doosan.com serves the whole Doosan group; Bobcat (vehicles) postings are skipped, Enerbility / Skoda Power / Fuel Cell are kept
                  ('Doosan', 'jobs.doosan.com', {'skip': ('/bobcat/', 'Bobcat')}),
                  ('Black & Veatch', 'careers.bv.com', {}), ('ENGIE', 'jobs.engie.com', {})]
# Workday public career-site JSON (no key). (display name, tenant, data-centre prefix, site id); all three answered on a live read.
WORKDAY = [('KBR', 'kbr', 'wd5', 'KBR_Careers'), ('GE Vernova', 'gevernova', 'wd5', 'Vernova_ExternalSite'), ('Hitachi', 'hitachi', 'wd1', 'hitachi'),
           # Added 2026-11-12 (Sana: plant, utilities and energy employers with large India and Gulf operations); each answered a live read that day.
           ('Johnson Controls', 'jci', 'wd5', 'JCI'), ('Baker Hughes', 'bakerhughes', 'wd5', 'BakerHughes'), ('Shell', 'shell', 'wd3', 'ShellCareers'),
           ('Unilever', 'unilever', 'wd3', 'Unilever_Experienced_Professionals'), ('Dow', 'dow', 'wd1', 'ExternalCareers'), ('3M', '3m', 'wd1', 'Search'),
           # 14 Nov (Sana): KBR's Gulf postings by place (the newest-first term reads above rarely reach them), and JLL's engineering
           # facilities roles (shift engineer, chief engineer, technical facility manager) in India and the Gulf
           ('KBR', 'kbr', 'wd5', 'KBR_Careers', {'terms': ['Abu Dhabi', 'Jubail', 'Dhahran', 'Riyadh', 'Doha', 'Kuwait', 'Muscat'], 'gulf': True, 'pages': 2}),
           ('JLL', 'jll', 'wd1', 'jllcareers', {'terms': ['shift engineer', 'chief engineer', 'facility manager engineering', 'technical supervisor', 'MEP engineer',
                                                         'maintenance engineer'], 'pages': 3})]   # the first five are FM_TERMS
# SmartRecruiters public postings API (no key). (display name, company identifier). Statkraft's identifier is 'Statkraft1'.
# 14 Nov: Bosch and Vattenfall left the list: their SmartRecruiters career pages now forward to their own sites (jobs.bosch.com,
# careers.vattenfall.com), and the SmartRecruiters API that still served them is disallowed by robots.txt.
SMARTRECRUITERS = [('Masdar', 'Masdar'), ('AFRY', 'AFRY'), ('Statkraft', 'Statkraft1'),
                   ('Continental', 'Continental')]   # added 2026-11-12, live that day (large India plants)
# Oracle Recruiting Cloud public candidate-experience REST (no key). (display name, host, site number); answered on a live read.
# Options: terms (keywords searched, '' = the whole list), facet (an extra finder filter such as a location id), pages (25 rows each),
# gulf (keep only postings placed in the Gulf).
GULF_TERMS = ['Abu Dhabi', 'Dubai', 'Saudi Arabia', 'Qatar', 'Oman', 'Kuwait']
ORACLE = [('Wood', 'ehif.fa.em2.oraclecloud.com', 'CX_1', {}),
          # 14 Nov: Wood's Gulf postings (Sana) by place, since the newest-first term reads above rarely reach them
          ('Wood', 'ehif.fa.em2.oraclecloud.com', 'CX_1', {'terms': GULF_TERMS, 'pages': 2, 'gulf': True}),
          # 14 Nov (Sana, India): Cummins India (location filter "India"), Apraava Energy (CLP India, every posting is in India),
          # Transguard Group (UAE facilities management)
          ('Cummins', 'fa-espx-saasfaprod1.fa.ocs.oraclecloud.com', 'CX_1007', {'terms': [''], 'facet': 'locationId=300000000440677', 'pages': 7}),
          ('Apraava Energy', 'iaarcp.fa.ocs.oraclecloud.com', 'CX_1', {'terms': [''], 'pages': 2}),
          ('Transguard Group', 'iaboey.fa.ocs.oraclecloud.com', 'CX_2', {'terms': [''], 'pages': 4})]
SF_TERMS = ['maintenance', 'reliability', 'operations', 'power plant', 'electrical', 'energy efficiency']
GETRO = [628, 1198]
EURES_TERMS = {'sana_ansari': ['maintenance engineer', 'power plant', 'reliability engineer', 'electrical engineer', 'energy efficiency', 'Instandhaltungsingenieur',
                               'Kraftwerk', 'ingénieur maintenance', 'onderhoudsingenieur'],
               'farhan_shaikh': ['revenue operations', 'implementation manager', 'crm automation']}
EURES_BODY = {'resultsPerPage': 50, 'page': 1, 'sortSearch': 'MOST_RECENT', 'publicationPeriod': None, 'occupationUris': [], 'skillUris': [],
              'requiredExperienceCodes': [], 'positionScheduleCodes': [], 'sectorCodes': [], 'educationAndQualificationLevelCodes': [],
              'positionOfferingCodes': [], 'locationCodes': [], 'euresFlagCodes': [], 'otherBenefitsCodes': [], 'requiredLanguages': [], 'sessionId': 'x'}
ADZUNA = {'sana_ansari': [('in', 'maintenance engineer'), ('in', 'power plant'), ('gb', 'power plant engineer'), ('gb', 'reliability engineer'),
                          ('de', 'Instandhaltungsingenieur'), ('nl', 'maintenance engineer'), ('gb', 'energy efficiency engineer')],
          'farhan_shaikh': [('in', 'revenue operations'), ('gb', 'remote implementation manager'), ('in', 'crm automation')]}


REQUESTS = [0]   # requests sent this run (robots.txt reads not counted); the report gives each source its share
_LAST = {}       # host -> monotonic time of its last request


def http(url, data=None, headers=None, timeout=40, robots_ok=False):
    """One polite request: robots.txt must allow the URL (engine/robots.py, read once per host per run), and requests to one host
    are at least PAUSE seconds apart, or the host's Crawl-delay when robots.txt sets a longer one. robots_ok=True only for a keyed API
    whose own terms the owner accepted in writing (Adzuna)."""
    if not robots_ok:
        robots.check(url)
    host = urlsplit(url).netloc
    wait = max(PAUSE, HOST_PAUSE.get(host, 0), robots.crawl_delay(url)) - (time.monotonic() - _LAST.get(host, -1e9))
    if wait > 0:
        time.sleep(wait)
    h = {'User-Agent': UA, 'Accept': 'application/json, application/rss+xml, */*'}
    h.update(headers or {})
    body = json.dumps(data).encode() if data is not None else None
    if body is not None:
        h['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=body, headers=h, method='POST' if body is not None else 'GET')
    try:
        with robots.urlopen(req, timeout=timeout) as r:   # noqa: S310 (fixed https hosts above; redirects checked against robots.txt)
            return r.read(12_000_000)
    finally:
        _LAST[host] = time.monotonic()
        REQUESTS[0] += 1


def workable(queries, pages=2):
    """Workable's job search. queries: (term, remote only) or (term, remote only, place); `pages` pages of 20 a query."""
    seen = set()
    failed, last_error = 0, None
    for q, remote_only, *where in queries:
        token = None
        for _ in range(pages):
            url = 'https://jobs.workable.com/api/v1/jobs?' + urllib.parse.urlencode({'query': q, **({'location': where[0]} if where else {}),
                                                                                    **({'workplace': 'remote'} if remote_only else {}), **({'pageToken': token} if token else {})})
            # Phase 6 tenth man: one refused page (a 429, a timeout) used to end the whole source, losing every later search term. Now that
            # term is skipped after one retry, and the source fails only when every term failed.
            d = None
            for attempt in range(2):
                try:
                    d = json.loads(http(url))
                    break
                except Exception as e:   # noqa: BLE001 - network, HTTP or JSON error: retried once, then this term is skipped
                    last_error = e
                    if attempt == 0:
                        time.sleep(PAUSE * 5)
            if d is None:
                failed += 1
                print(f'workable: search term skipped after an error ({type(last_error).__name__})', file=sys.stderr)
                break
            for r in d.get('jobs') or []:
                if r.get('id') in seen:
                    continue
                seen.add(r.get('id'))
                loc = r.get('location') or {}
                place = ', '.join(x for x in (loc.get('city'), loc.get('countryName')) if x) or 'See posting'
                remote = r.get('workplace') == 'remote'
                j = job('workable', r.get('url') or '', text(r.get('title')), text((r.get('company') or {}).get('title')),
                        f'Remote ({place})' if remote else place, text((r.get('description') or '') + ' ' + (r.get('requirementsSection') or '')),
                        when(r.get('created')))
                j['is_remote'] = remote   # job() defaults to remote (it was written for the remote boards): an on-site Workable job was stored as remote
                yield j
            token = d.get('nextPageToken')
            if not token:
                break
    if queries and failed == len(queries):
        raise last_error


class AllEmployersFailed(RuntimeError):
    """Every employer of one source failed: reported as that source's error (one employer down is only logged)."""


def _all_failed(name, failed, total):
    if total and failed == total:
        raise AllEmployersFailed(f'{name}: all {total} employer sites failed')


def eightfold():
    failed = 0
    for company, host, domain in EIGHTFOLD:
        try:
            yield from eightfold_site(company, host, domain)
        except Exception as e:   # one employer's site down never loses the others
            failed += 1
            print(f'eightfold {company}: {type(e).__name__}', file=sys.stderr)
    _all_failed('eightfold', failed, len(EIGHTFOLD))


def eightfold_site(company, host, domain):
    if True:
        for start in range(0, 1000, 100):
            d = json.loads(http(f'https://{host}/api/apply/v2/jobs?domain={domain}&num=100&start={start}'))
            rows = d.get('positions') or []
            for r in rows:
                remote = str(r.get('work_location_option') or '').lower() == 'remote'
                place = r.get('location') or ', '.join(r.get('locations') or [])
                j = job('eightfold', r.get('canonicalPositionUrl') or f"https://{host}/careers/job/{r.get('id')}", text(r.get('name')), company,
                        f'Remote ({place})' if remote else place, text(r.get('job_description') or ', '.join(r.get('department') or [])),
                        when(r.get('t_create')), board=False)
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
                    '', when(it.findtext('pubDate')), board=False)
            j['is_remote'] = False
            yield j
        if len(items) < 20:
            break


# Compliance (14 Nov): SuccessFactors career sites disallow /services/ (the RSS feed this reader used) in robots.txt. They allow the
# /search/ result pages and the /job/ pages, so the list is read from /search/ (newest first, about 10-25 rows a page) and, where a site's
# search page has another template, from /sitemap.xml plus the job pages whose address matches a role rule (ReNew).
SF_SEARCH_PAGES = 12          # at most 12 result pages a site (120-300 newest postings)
SF_SITEMAP_PAGES = 40         # at most 40 job pages a site from its sitemap (only those whose address names a role)
SF_ROLE_FILTER = []           # (role, exclude) regexes from the profiles, set by main(); empty: every sitemap job page is read
SF_ISO = {'SA': 'Saudi Arabia', 'AE': 'United Arab Emirates', 'QA': 'Qatar', 'OM': 'Oman', 'KW': 'Kuwait', 'BH': 'Bahrain', 'IN': 'India',
          'EG': 'Egypt', 'MA': 'Morocco', 'ZA': 'South Africa', 'UZ': 'Uzbekistan', 'AZ': 'Azerbaijan', 'CN': 'China', 'ID': 'Indonesia'}
_ROW = re.compile(r'<tr class="data-row.*?</tr>', re.S)
_SPAN = lambda cls: re.compile(r'<span class="' + cls + r'">(.*?)</span>', re.S)   # noqa: E731
_TITLE_LINK = re.compile(r'<a href="(/job/[^"]+)" class="jobTitle-link">(.*?)</a>', re.S)


def sf_place(loc, iso):
    """'Riyadh, SA' -> 'Riyadh, Saudi Arabia' on sites outside the US (iso=True), so a two-letter country is not read as a US state."""
    loc = text(loc)
    m = re.match(r'^(.*?)(?:,\s*)?\b([A-Z]{2})(?:,\s*\d{4,6})?$', loc) if iso else None
    if m and m.group(2) in SF_ISO:
        return ', '.join(x for x in (m.group(1).strip(' ,'), SF_ISO[m.group(2)]) if x)
    return loc


def sf_search_rows(html_text):
    """(path, title, location, date) for each result row of a SuccessFactors /search/ page."""
    for row in _ROW.findall(html_text):
        m = _TITLE_LINK.search(row)
        if not m:
            continue
        loc = _SPAN('jobLocation').findall(row)
        date = _SPAN('jobDate').findall(row)
        yield m.group(1), text(m.group(2)), text(loc[-1]) if loc else '', text(date[-1]) if date else ''


def sf_date(value):
    v = text(value)
    for fmt in ('%b %d, %Y', '%a %b %d %H:%M:%S UTC %Y', '%d %b %Y', '%Y-%m-%d'):
        try:
            return datetime.strptime(v, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return when(v)


def sf_job_page(html_text):
    """Title, location, description and posting date from a SuccessFactors /job/ page (schema.org JobPosting microdata)."""
    def meta(prop):
        m = re.search(r'<meta itemprop="' + prop + r'" content="([^"]*)"', html_text)
        return text(m.group(1)) if m else ''
    t = re.search(r'itemprop="title"[^>]*>(.*?)</', html_text, re.S)
    d = re.search(r'itemprop="description"[^>]*>(.*?)(?:<div class="clear|<footer|<script|$)', html_text, re.S)
    country = meta('addressCountry')
    place = ', '.join(x for x in (meta('addressLocality'), SF_ISO.get(country, country)) if x)
    return {'title': text(t.group(1)) if t else '', 'location': place, 'description': text(d.group(1))[:8000] if d else '',
            'posted': sf_date(meta('datePosted'))}


def sf_slug_wanted(url):
    """A sitemap job address names the role ("/job/Kolind-ka-Bas-Senior-Engineer-Wind-O-&-M-KA/61209744/"): only those matching a role rule are read."""
    m = re.search(r'/job/([^/]+)/', url)
    slug = urllib.parse.unquote(m.group(1) if m else url).replace('-', ' ').replace('_', ' ').lower()
    return not SF_ROLE_FILTER or any(role.search(slug) and not (excl and excl.search(slug)) for role, excl in SF_ROLE_FILTER)


def sf_site(company, host, skip=(), iso=False):
    seen, step = set(), None
    for page in range(SF_SEARCH_PAGES):
        raw = http(f'https://{host}/search/?q=&sortColumn=referencedate&sortDirection=desc&startrow={page * (step or 0)}',
                   headers={'Accept': 'text/html'}).decode('utf-8', 'replace')
        rows = list(sf_search_rows(raw))
        if page == 0 and not rows:   # another page template: read the sitemap instead
            yield from sf_sitemap(company, host, skip, iso)
            return
        step = step or len(rows)
        fresh = 0
        for path, title, loc, date in rows:
            url = f'https://{host}{path}'
            if url in seen or any(x in path for x in skip):
                continue
            seen.add(url)
            fresh += 1
            m = re.match(r'^(.*?)\s*\(([^()]*)\)\s*$', title)   # "Role (SA)": the place is in the title on some sites
            if m and not loc:
                title, loc = m.group(1), m.group(2)
            j = job('successfactors', url, title, company, sf_place(loc, iso) or 'See posting', '', sf_date(date), board=False)
            j['is_remote'] = 'remote' in (loc or '').lower()
            yield j
        if not fresh or len(rows) < step:
            break


def sf_sitemap(company, host, skip=(), iso=False):
    raw = http(f'https://{host}/sitemap.xml', headers={'Accept': 'application/xml'}).decode('utf-8', 'replace')
    urls = [html.unescape(u).strip() for u in re.findall(r'<loc>([^<]+)</loc>', raw)]
    urls = [u for u in dict.fromkeys(urls) if '/job/' in u and not any(x in u for x in skip) and sf_slug_wanted(u)]
    for url in urls[:SF_SITEMAP_PAGES]:
        try:
            p = sf_job_page(http(url, headers={'Accept': 'text/html'}).decode('utf-8', 'replace'))
        except robots.RobotsDisallowed:
            raise
        except Exception as e:   # one job page down never loses the others
            print(f'successfactors {company}: a job page failed ({type(e).__name__})', file=sys.stderr)
            continue
        if not p['title']:
            continue
        j = job('successfactors', url, p['title'], company, p['location'] or 'See posting', p['description'], p['posted'], board=False)
        j['is_remote'] = False
        j['_full_text'] = True
        yield j


def successfactors():
    failed = 0
    for company, host, *opts in SUCCESSFACTORS:
        o = opts[0] if opts else {}
        try:
            yield from sf_site(company, host, o.get('skip', ()), o.get('iso', False))
        except Exception as e:   # one employer's site down (or its robots.txt refusing) never loses the others
            failed += 1
            print(f'successfactors {company}: {type(e).__name__}: {str(e)[:100]}', file=sys.stderr)
    _all_failed('successfactors', failed, len(SUCCESSFACTORS))


def workday(pages=3):
    """Open postings of a few energy employers from Workday's public career-site JSON, searched with the same energy terms as SuccessFactors.
    The list answer carries no job text and only a relative "Posted N Days Ago", so the description is the location text and the posted date is unknown."""
    failed = 0
    seen_by_site = {}   # a tenant read by two entries (KBR worldwide terms, KBR Gulf places) gives each posting once
    for company, tenant, dc, site, *opts in WORKDAY:
        o = opts[0] if opts else {}
        base = f'https://{tenant}.{dc}.myworkdayjobs.com'
        seen = seen_by_site.setdefault(base + site, set())
        try:
            for term in o.get('terms', SF_TERMS):
                for page in range(o.get('pages', pages)):
                    d = json.loads(http(f'{base}/wday/cxs/{tenant}/{site}/jobs', {'appliedFacets': {}, 'limit': 20, 'offset': page * 20, 'searchText': term}))
                    rows = d.get('jobPostings') or []
                    for r in rows:
                        path = r.get('externalPath') or ''
                        if not path or path in seen:
                            continue
                        seen.add(path)
                        url = f'{base}/en-US/{site}{path}'
                        place = from_count(text(r.get('locationsText')), url) or 'See posting'   # plan B2: '5 Locations' -> 'Assen; +4 more'
                        if o.get('gulf') and not GULF_PLACE.search(place + ' ' + path):
                            continue
                        remote = 'remote' in place.lower()
                        j = job('workday', url, text(r.get('title')), company, place, place, None, board=False)
                        j['is_remote'] = remote
                        yield j
                    if len(rows) < 20:
                        break
        except Exception as e:   # one employer down never loses the others
            failed += 1
            print(f'workday {company}: {type(e).__name__}', file=sys.stderr)
    _all_failed('workday', failed, len(WORKDAY))


# Compliance (14 Nov): api.smartrecruiters.com disallows every agent but LinkedIn's in robots.txt, so the postings API is no longer read.
# The employer's public career page (careers.smartrecruiters.com/<company>, whose robots.txt allows it) lists the same postings grouped by
# place; a group's further postings and further groups come from the page's own "more" links. The posting page (jobs.smartrecruiters.com,
# no robots.txt) gives the description.
SR_PAGES = 15         # group pages and "more" pages per employer (10 postings a "more" page)
_SR_GROUP = re.compile(r'<section data-qty="(\d+)"(.*?)</section>', re.S)
_SR_JOB = re.compile(r'<a href="(https://jobs\.smartrecruiters\.com/[^"/]+/(\d+)[^"]*)"[^>]*class="[^"]*js-job-ad-link[^"]*">\s*<h4[^>]*>(.*?)</h4>', re.S)
_SR_MORE = re.compile(r'<a data-page="(\d+)" data-value="([^"]*)" data-type="([^"]*)" data-more="([^"]*)"')


def sr_groups(page_html):
    """(place, posting count, [(url, id, title)], more-link or None) for each place group of a SmartRecruiters career page."""
    for m in _SR_GROUP.finditer(page_html):
        body = m.group(2)
        place = re.search(r'opening-title[^>]*>([^<]*)<', body)
        more = _SR_MORE.search(body)
        yield (text(place.group(1)) if place else '', int(m.group(1)), [(u, i, text(t)) for u, i, t in _SR_JOB.findall(body)],
               (more.group(4), more.group(3), more.group(2)) if more else None)


def smartrecruiters():
    failed = 0
    for company, ident in SMARTRECRUITERS:
        try:
            yield from smartrecruiters_site(company, ident)
        except Exception as e:   # one employer down never loses the others
            failed += 1
            print(f'smartrecruiters {company}: {type(e).__name__}', file=sys.stderr)
    _all_failed('smartrecruiters', failed, len(SMARTRECRUITERS))


def smartrecruiters_site(company, ident):
    base = f'https://careers.smartrecruiters.com/{urllib.parse.quote(ident)}'
    get = lambda url: http(url, headers={'Accept': 'text/html'}).decode('utf-8', 'replace')   # noqa: E731
    first = get(base)
    if 'js-openings' not in first:
        raise RuntimeError(f'{ident}: no SmartRecruiters career page (it forwards to the employer\'s own site)')
    m = re.search(r'data-groups-pages="(\d+)"', first)
    pages = [first] + [get(f'{base}/api/groups?page={n}') for n in range(1, min(int(m.group(1)) if m else 1, SR_PAGES))]
    seen, budget = set(), SR_PAGES
    for page in pages:
        for place, qty, jobs, more in sr_groups(page):
            n = 1
            while more and len(jobs) < qty and budget > 0:   # the group shows its first postings; the rest come from its "more" link
                budget -= 1
                extra = _SR_JOB.findall(get(f"https://careers.smartrecruiters.com{more[0]}?type={more[1]}&value={more[2]}&page={n}"))
                if not extra:
                    break
                jobs += [(u, i, text(t)) for u, i, t in extra]
                n += 1
            for url, pid, title in jobs:
                if pid in seen:
                    continue
                seen.add(pid)
                remote = 'remote' in place.lower()
                j = job('smartrecruiters', url.split('?')[0], title, company, f'Remote ({place})' if remote else (place or 'See posting'), place, None, board=False)
                j['is_remote'] = remote
                yield j


GULF_PLACE = re.compile(r'united arab emirates|\buae\b|abu dhabi|dubai|sharjah|ruwais|saudi|riyadh|jeddah|jubail|dammam|dhahran|yanbu|rabigh|'
                        r'qatar|doha|ras laffan|oman|muscat|sohar|duqm|kuwait|bahrain|manama', re.I)


def oracle_hcm(pages=3):
    """Open postings of Oracle Recruiting Cloud career sites, searched with the energy terms (or an entry's own terms or filter).
    The list answer carries no job text, so the description is the location text and the workplace type."""
    failed = 0
    seen_by_site = {}   # a site read by two entries (Wood worldwide terms, Wood Gulf places) gives each posting once
    for company, host, site, *opts in ORACLE:
        o = opts[0] if opts else {}
        seen = seen_by_site.setdefault(host + site, set())
        try:
            for term in o.get('terms', SF_TERMS):
                for page in range(o.get('pages', pages)):
                    finder = (f'findReqs;siteNumber={site},limit=25,offset={page * 25},' + (f'keyword={urllib.parse.quote(term)},' if term else '')
                              + (f"{o['facet']}," if o.get('facet') else '') + 'sortBy=POSTING_DATES_DESC')
                    d = json.loads(http(f'https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder={finder}',
                                        headers={'Accept': 'application/json'}))
                    rows = ((d.get('items') or [{}])[0].get('requisitionList')) or []
                    for r in rows:
                        rid = str(r.get('Id') or '')
                        if not rid or rid in seen:
                            continue
                        seen.add(rid)
                        place = text(r.get('PrimaryLocation')) or 'See posting'
                        if o.get('gulf') and not GULF_PLACE.search(place):
                            continue
                        kind = text(r.get('WorkplaceType'))
                        remote = kind.lower() == 'remote'
                        j = job('oracle_hcm', f'https://{host}/hcmUI/CandidateExperience/en/sites/{site}/job/{rid}', text(r.get('Title')), company,
                                f'Remote ({place})' if remote else place, f'{place} {kind}'.strip(), when(r.get('PostedDate')), board=False)
                        j['is_remote'] = remote
                        yield j
                    if len(rows) < 25:
                        break
        except Exception as e:   # one employer down never loses the others
            failed += 1
            print(f'oracle_hcm {company}: {type(e).__name__}', file=sys.stderr)
    _all_failed('oracle_hcm', failed, len(ORACLE))


# Jibe (iCIMS career-site search) public JSON: (display name, host, places searched). careers.se.com's robots.txt allows /api and asks
# for a 5-second Crawl-delay, which http() keeps. The list answer carries the full description and qualifications.
JIBE = [('Schneider Electric', 'careers.se.com', ['India', 'United Arab Emirates', 'Saudi Arabia'])]
JIBE_PAGES = 8   # 100 postings a page


def jibe():
    failed = 0
    for company, host, places in JIBE:
        seen = set()
        try:
            for place in places:
                for page in range(1, JIBE_PAGES + 1):
                    d = json.loads(http(f'https://{host}/api/jobs?' + urllib.parse.urlencode({'location': place, 'limit': 100, 'page': page})))
                    rows = d.get('jobs') or []
                    for x in rows:
                        r = x.get('data') or {}
                        slug = str(r.get('slug') or r.get('req_id') or '')
                        if not slug or slug in seen:
                            continue
                        seen.add(slug)
                        where = text(r.get('full_location') or r.get('location_name') or r.get('country')) or place
                        kinds = ' '.join(r.get('tags7') or []) if isinstance(r.get('tags7'), list) else text(r.get('tags7'))
                        remote = 'remote' in kinds.lower()
                        desc = ' '.join(text(r.get(k)) for k in ('description', 'qualifications') if r.get(k))
                        j = job('jibe', f'https://{host}/jobs/{slug}?lang=en-us', text(r.get('title')), text(r.get('hiring_organization')) or company,
                                f'Remote ({where})' if remote else where, f'{desc} {kinds}'.strip(), when(r.get('create_date') or r.get('posted_date')), board=False)
                        j['is_remote'] = remote
                        yield j
                    if len(rows) < 100:
                        break
        except Exception as e:   # one employer down never loses the others
            failed += 1
            print(f'jibe {company}: {type(e).__name__}', file=sys.stderr)
    _all_failed('jibe', failed, len(JIBE))


# Watchlist employers (14 Nov): employers whose own boards already post the right jobs, read three times a day by the watchlist run.
# Farhan: employers seen hiring his roles remote from India or worldwide. (display name, system, board id).
WATCH = [('MonetizeMore', 'jazzhr', 'monetizem'), ('Massive Rocket', 'lever', 'massive-rocket'), ('Sprinto', 'lever', 'Sprinto'),
         ('UptimeAI', 'ashby', 'uptimeai'), ('Canvas Medical', 'ashby', 'canvas-medical'), ('Fingerprint', 'greenhouse', 'fingerprint'),
         ('Paired', 'workable', 'paired'), ('Firework', 'lever', 'fireworkhq')]
JAZZ_PLACES = re.compile(r'india|anywhere|worldwide|global|apac|asia|^$', re.I)
_JAZZ_ROW = re.compile(r'<div id="row_job_(\d{8})\d*_\w+" class="jobs_row">\s*<div>\s*<a class="job_title_link" href="(/apply/jobs/details/\w+)[^"]*">(.*?)</a>'
                       r'.*?<strong>Location:</strong>\s*([^<]*)</span>', re.S)


def _remote_place(place, flag):
    place = text(place) or 'See posting'
    return place if not flag or 'remote' in place.lower() else f'Remote ({place})'


def watch_board(company, kind, board):
    """One employer's public job board: Lever, Greenhouse and Ashby posting APIs, Workable's account widget, JazzHR's list page."""
    if kind == 'lever':
        for r in json.loads(http(f'https://api.lever.co/v0/postings/{urllib.parse.quote(board)}?mode=json')):
            cat = r.get('categories') or {}
            remote = r.get('workplaceType') == 'remote'
            place = ', '.join(cat.get('allLocations') or []) or cat.get('location') or ''
            desc = ' '.join([text(r.get('descriptionBody') or r.get('description'))] + [text(x.get('text')) + ' ' + text(x.get('content')) for x in r.get('lists') or []]
                            + [text(r.get('additional'))])
            yield job('watch_boards', r.get('hostedUrl') or '', text(r.get('text')), company, _remote_place(place, remote), desc, when(r.get('createdAt')), board=False), remote
    elif kind == 'greenhouse':
        for r in json.loads(http(f'https://boards-api.greenhouse.io/v1/boards/{urllib.parse.quote(board)}/jobs?content=true')).get('jobs') or []:
            place = text((r.get('location') or {}).get('name'))
            remote = 'remote' in place.lower()
            yield job('watch_boards', r.get('absolute_url') or '', text(r.get('title')), company, place or 'See posting', text(html.unescape(r.get('content') or '')),
                      when(r.get('first_published') or r.get('updated_at')), board=False), remote
    elif kind == 'ashby':
        for r in json.loads(http(f'https://api.ashbyhq.com/posting-api/job-board/{urllib.parse.quote(board)}')).get('jobs') or []:
            if r.get('isListed') is False:
                continue
            remote_flag, _ = ashby_workplace(r)
            remote = remote_flag is True
            places = [text(r.get('location'))] + [text(x.get('location')) for x in r.get('secondaryLocations') or [] if isinstance(x, dict)]
            yield job('watch_boards', r.get('jobUrl') or '', text(r.get('title')), company, _remote_place('; '.join(x for x in places if x), remote),
                      text(r.get('descriptionPlain') or r.get('descriptionHtml')), when(r.get('publishedAt')), board=False), remote
    elif kind == 'workable':
        d = json.loads(http(f'https://apply.workable.com/api/v1/widget/accounts/{urllib.parse.quote(board)}?details=true'))
        for r in d.get('jobs') or []:
            remote = bool(r.get('telecommuting'))
            place = ', '.join(x for x in (r.get('city'), r.get('country')) if x)
            yield job('watch_boards', r.get('url') or r.get('shortlink') or '', text(r.get('title')), company, _remote_place(place, remote),
                      text(r.get('description')), when(r.get('published_on') or r.get('created_at')), board=False), remote
    elif kind == 'jazzhr':
        page = http(f'https://{board}.applytojob.com/apply/jobs/', headers={'Accept': 'text/html'}).decode('utf-8', 'replace')
        for day, path, title, place in _JAZZ_ROW.findall(page):
            title, place = text(title), text(place)
            if not JAZZ_PLACES.search(place):   # one posting is listed once per country: only India and anywhere are read (Farhan's watchlist)
                continue
            remote = 'remote' in title.lower()
            yield job('watch_boards', f'https://{board}.applytojob.com{path}', title, company, _remote_place(place, remote), '',
                      datetime.strptime(day, '%Y%m%d').replace(tzinfo=timezone.utc), board=False), remote


def watch_boards():
    failed = 0
    for company, kind, board in WATCH:
        try:
            for j, remote in watch_board(company, kind, board):
                j['is_remote'] = remote
                yield j
        except Exception as e:   # one employer down (or its robots.txt refusing) never loses the others
            failed += 1
            print(f'watch_boards {company}: {type(e).__name__}: {str(e)[:100]}', file=sys.stderr)
    _all_failed('watch_boards', failed, len(WATCH))


def arbeitnow(pages=3):
    for page in range(1, pages + 1):
        d = json.loads(http(f'https://www.arbeitnow.com/api/job-board-api?page={page}&visa_sponsorship=true'))
        for r in d.get('data') or []:
            desc = ('Visa sponsorship available. ' if r.get('visa_sponsorship', True) else '') + text(r.get('description'))
            j = job('arbeitnow', r.get('url') or '', text(r.get('title')), text(r.get('company_name')), text(r.get('location')) or 'Germany', desc,
                    when(r.get('created_at')))
            j['is_remote'] = bool(r.get('remote'))
            yield j


# Getro: not read since 14 Nov (api.getro.com's robots.txt disallows every path). Kept for reference; not in main()'s sources.
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


def eures(terms):
    seen = set()
    for cid, words in terms.items():
        for w in words:
            for page in (1, 2):
                d = json.loads(http('https://europa.eu/eures/api/jv-searchengine/public/jv-search/search',
                                    {**EURES_BODY, 'page': page, 'keywords': [{'keyword': w, 'specificSearchCode': 'EVERYWHERE'}]}))
                rows = d.get('jvs') or []
                for r in rows:
                    if r.get('id') in seen:
                        continue
                    seen.add(r.get('id'))
                    en = ((r.get('translations') or {}).get('en')) or {}
                    title = text(en.get('title') or r.get('title'))
                    countries = ', '.join(sorted((r.get('locationMap') or {}).keys())) or 'EU'
                    j = job('eures', f"https://europa.eu/eures/portal/jv-se/jv-details/{r.get('id')}?lang=en", title, text((r.get('employer') or {}).get('name')),
                            countries, text(en.get('description') or r.get('description')), when(int(r.get('creationDate')) / 1000 if str(r.get('creationDate') or '').isdigit() else None))
                    j['is_remote'] = False
                    yield j
                if len(rows) < 50:
                    break


def adzuna(queries):
    """Adzuna's free keyed API (developer.adzuna.com). Read only when the free ADZUNA_APP_ID / ADZUNA_APP_KEY secrets are set.
    api.adzuna.com's robots.txt says "Disallow: /" for every agent, so even with keys nothing is read unless the owner records that the
    API's own terms (which the free key accepts) govern this use: repository variable ADZUNA_API_TERMS_ACCEPTED=true."""
    app_id, key = os.environ.get('ADZUNA_APP_ID', ''), os.environ.get('ADZUNA_APP_KEY', '')
    if not app_id or not key:
        return
    api_terms = os.environ.get('ADZUNA_API_TERMS_ACCEPTED', '').strip().lower() == 'true'
    for cid, pairs in queries.items():
        for country, what in pairs:
            url = f'https://api.adzuna.com/v1/api/jobs/{country}/search/1?' + urllib.parse.urlencode(
                {'app_id': app_id, 'app_key': key, 'results_per_page': 50, 'what': what, 'max_days_old': 14, 'content-type': 'application/json'})
            d = json.loads(http(url, robots_ok=api_terms))
            for r in d.get('results') or []:
                loc = r.get('location') or {}
                place = loc.get('display_name') or ', '.join(loc.get('area') or []) or country.upper()
                j = job('adzuna', r.get('redirect_url') or '', text(r.get('title')), text((r.get('company') or {}).get('display_name')), place,
                        text(r.get('description')), when(r.get('created')), r.get('salary_min') or None, r.get('salary_max') or None,
                        {'in': 'INR', 'gb': 'GBP', 'de': 'EUR', 'nl': 'EUR'}.get(country), 'year' if r.get('salary_min') or r.get('salary_max') else None)
                j['is_remote'] = bool(re.search(r'\bremote\b', (r.get('title') or '') + ' ' + place, re.I))
                yield j


ENRICH_CAP = 150          # full-text fetches per source per run; the rest keep their title-and-location description
ENRICH_BUDGET_SECONDS = 240   # time spent in full-text fetches, all sources of one run together (not wall-clock: the list reads before them are slow)


def _detail_smartrecruiters(j):
    if not re.match(r'^https://jobs\.smartrecruiters\.com/[^/]+/\d+', j['url']):
        return None
    page = http(j['url'], headers={'Accept': 'text/html'}).decode('utf-8', 'replace')
    d = re.search(r'<div itemprop="description">(.*?)</main>', page, re.S) or re.search(r'<div itemprop="description">(.*)', page, re.S)
    posted = re.search(r'<meta itemprop="datePosted" content="([^"]+)"', page)
    if posted and when(posted.group(1)):
        j['posted_at'] = when(posted.group(1)).isoformat()
    return text(d.group(1))[:8000] if d else None


MORE = re.compile(r'; \+\d+ more')


def _detail_workday(j):
    m = re.match(r'^(https://([\w-]+)\.(wd\d+)\.myworkdayjobs\.com)/en-US/([^/]+)(/.+)$', j['url'])
    if not m:
        return None
    base, tenant, _dc, site, path = m.groups()
    info = (json.loads(http(f'{base}/wday/cxs/{tenant}/{site}{path}')).get('jobPostingInfo')) or {}
    extra = [text(x) for x in (info.get('additionalLocations') or []) if text(x)]
    if extra and MORE.search(j.get('location') or ''):   # plan B2: a posting listed as "N Locations" gets up to three of its places
        country = text(((info.get('jobRequisitionLocation') or {}).get('country') or {}).get('descriptor') or (info.get('country') or {}).get('descriptor'))
        j['location'] = places_text([text(info.get('location'))] + extra, None, country) or j['location']
    if info.get('startDate'):
        j['posted_at'] = when(info['startDate']).isoformat() if when(info['startDate']) else j['posted_at']
    return text(info.get('jobDescription'))


def _detail_successfactors(j):
    if not re.match(r'^https://[^/]+/job/', j['url']):
        return None
    p = sf_job_page(http(j['url'], headers={'Accept': 'text/html'}).decode('utf-8', 'replace'))
    if p['location'] and j.get('location') in ('', 'See posting'):
        j['location'] = p['location']
    return p['description']


def _detail_jazzhr(j):
    if not re.match(r'^https://[\w-]+\.applytojob\.com/apply/jobs/details/\w+$', j['url']):
        return None
    page = http(j['url'], headers={'Accept': 'text/html'}).decode('utf-8', 'replace')
    d = re.search(r'<div class="job_description">(.*?)(?:<div id="resumator|<form|$)', page, re.S)
    return text(d.group(1))[:8000] if d else None


def _detail_oracle(j):
    m = re.match(r'^https://([^/]+)/hcmUI/CandidateExperience/en/sites/([^/]+)/job/(\d+)$', j['url'])
    if not m:
        return None
    host, site, rid = m.groups()
    d = json.loads(http(f'https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id="{rid}",siteNumber={site}',
                        headers={'Accept': 'application/json'}))
    it = (d.get('items') or [{}])[0]
    return ' '.join(text(it.get(k)) for k in ('ExternalDescriptionStr', 'ExternalQualificationsStr'))


ENRICH = {'smartrecruiters': _detail_smartrecruiters, 'workday': _detail_workday, 'oracle_hcm': _detail_oracle, 'successfactors': _detail_successfactors, 'watch_boards': _detail_jazzhr}


def enrich_full_text(j, name, used, spent):
    """Replace the thin list description of a kept posting by the posting's own text, so the screen can read sponsorship, years, pay and remote wording.
    Bounded per source and by time; any failure keeps the posting with its list description."""
    if j.pop('_full_text', False):   # read from the posting's own page already
        return False
    fn = ENRICH.get(name)
    if not fn or used.get(name, 0) >= ENRICH_CAP or spent[0] > ENRICH_BUDGET_SECONDS:
        return False
    used[name] = used.get(name, 0) + 1
    t0 = time.monotonic()
    try:
        body = (fn(j) or '').strip()
    except Exception:   # never loses the posting
        return False
    finally:
        spent[0] += time.monotonic() - t0
    if len(body) < 40:
        return False
    j['description'] = (body + ' ' + (j.get('location') or ''))[:8000]
    return True


# QA 3 F2: the order sources run in, small and high-priority first. The watchlist employers' own boards come first, then the cheap aggregators and
# single-employer sites; the big multi-employer readers (SmartRecruiters, SuccessFactors, Workday) run last, so a slow one can no longer leave the
# others without time. A source not named here runs after these, in the order main() lists it.
# 19 Nov: the sources whose postings are not in the open ATS dataset run first (Workable search, Schneider's Jibe site, Eightfold, Siemens
# Energy, ReNew / Tata Power on SuccessFactors); EURES and the Oracle, SmartRecruiters and Workday employers are all in that dataset, which
# the daily run reads in full, so they take the time left. Before, EURES and Oracle ran early and stopped at their caps, and SuccessFactors
# and Siemens Energy were stopped at theirs.
ORDER = ('watch_boards', 'arbeitnow', 'uncareers', 'jibe', 'workable', 'workable_places', 'eightfold', 'siemens_energy', 'successfactors',
         'adzuna', 'eures', 'oracle_hcm', 'smartrecruiters', 'workday')
# Each source's share of the time still left (weights): the big readers get a larger share, but none can take the whole step.
# workable and workable_places: 33 + about 60 requests at HOST_PAUSE (19 Nov); at weight 1 a watchlist run stopped both at their caps.
WEIGHT = {'smartrecruiters': 2, 'successfactors': 3, 'workday': 3, 'workable': 2, 'workable_places': 2}
ID_NAME = {'workable_places': 'workable'}   # one Workable posting found by both searches gets one id (the second is skipped as already had)
START_SHARE = 0.8   # as remote_boards.over_budget(): nothing starts, and every source stops, once 80% of --budget-seconds has passed


def ordered(sources):
    """The sources dict in ORDER (unknown names keep their place after the known ones)."""
    rank = {n: i for i, n in enumerate(ORDER)}
    return dict(sorted(sources.items(), key=lambda kv: rank.get(kv[0], len(ORDER))))


def source_cap(name, remaining, now, started, budget_seconds):
    """Seconds `name` may run: its weighted share of the time left before START_SHARE of the budget, split over itself and the sources still to
    run (`remaining`, including `name`). Time a source leaves unused passes to the ones after it. None when there is no budget."""
    if not budget_seconds:
        return None
    left = started + START_SHARE * budget_seconds - now
    total = sum(WEIGHT.get(n, 1) for n in remaining) or 1
    return max(0.0, left * WEIGHT.get(name, 1) / total)


def time_warnings(report):
    """One warning line per source that was skipped or stopped for time (printed as a workflow warning and kept in the report)."""
    out = []
    for name, r in report.items():
        if isinstance(r, dict) and r.get('skipped') == 'time budget':
            out.append(f'more_sources: {name} was skipped for time (no time left in the step budget)')
        elif isinstance(r, dict) and r.get('stopped') == 'time cap':
            out.append(f"more_sources: {name} was stopped at its time cap ({r.get('cap_seconds')} s) after reading {r.get('read', 0)}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--profiles', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--days', type=int, default=30)
    ap.add_argument('--fast', action='store_true')
    ap.add_argument('--budget-seconds', type=int, default=0, help="the step's time limit: no source starts after 80%% of it, and each source has its own share of it")
    ap.add_argument('--only', default='', help='comma-separated source names: run only these (a parallel job of discovery.yml runs one group)')
    a = ap.parse_args()
    started = time.monotonic()
    profs = json.loads(Path(a.profiles).read_text())
    rules = {cid: (re.compile(p['role'], re.I), re.compile(p['exclude'], re.I) if p.get('exclude') else None) for cid, p in profs.items()}
    SF_ROLE_FILTER[:] = list(rules.values()) + ([(FM_ROLE, FM_EXCLUDE)] if any(c in rules for c in FM_CANDIDATES) else [])
    wq = [(q, cid == 'farhan_shaikh') for cid in profs for q in QUERIES.get(cid, [])]
    pq = [q for cid in profs for q in WORKABLE_PLACES.get(cid, [])]
    sources = {'workable': lambda: workable(wq), 'workable_places': lambda: workable(pq, pages=3), 'eightfold': eightfold, 'siemens_energy': siemens_energy, 'successfactors': successfactors, 'smartrecruiters': smartrecruiters, 'workday': workday, 'oracle_hcm': oracle_hcm, 'jibe': jibe, 'watch_boards': watch_boards,
               'arbeitnow': arbeitnow, 'uncareers': un_careers,
               'eures': lambda: eures({c: t for c, t in EURES_TERMS.items() if c in profs}), 'adzuna': lambda: adzuna({c: t for c, t in ADZUNA.items() if c in profs})}
    if not pq:   # no profile has place searches (Farhan alone): the source is not listed, rather than reported as an empty read
        del sources['workable_places']
    if a.fast:   # watchlist runs: the employer sites and the big aggregator only
        sources = {k: v for k, v in sources.items() if k in ('workable', 'workable_places', 'eightfold', 'siemens_energy', 'successfactors', 'smartrecruiters', 'workday', 'oracle_hcm', 'jibe', 'watch_boards')}
    if a.only:   # max discovery (20 Nov): the daily run reads the sources in parallel groups, each with its own time budget
        wanted = {x.strip() for x in a.only.split(',') if x.strip()}
        unknown = wanted - set(sources) - {'workable_places'}
        if unknown:
            print(f'::warning::more_sources: unknown source names {sorted(unknown)}', file=sys.stderr)
        sources = {k: v for k, v in sources.items() if k in wanted}
    sources = ordered(sources)
    since = datetime.now(timezone.utc) - timedelta(days=a.days)
    no_cutoff = {'siemens_energy', 'successfactors', 'eightfold', 'smartrecruiters', 'workday', 'oracle_hcm', 'jibe', 'watch_boards'}   # employer sites: the date is the original posting date; the still-open check guards staleness
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    raw_path = out / 'jobsite_raw.json'
    merged = json.loads(raw_path.read_text()) if raw_path.exists() else {'source': 'job_sites', 'jobs': []}
    have = {j['id'] for j in merged['jobs']}
    held = reposters.counts_in(merged['jobs'])   # reposting sites and VA staffing firms: at most REPOSTER_CAP each per run, every source together
    report = {}
    used, enriched, spent = {}, {}, [0.0]
    names = list(sources)
    for i, (name, fn) in enumerate(sources.items()):
        if over_budget(started, a.budget_seconds, START_SHARE):   # the step's time limit is near: what was fetched is kept, nothing new starts
            report[name] = {'skipped': 'time budget', 'read': 0, 'kept': 0}
            continue
        t0 = time.monotonic()
        cap = source_cap(name, names[i:], t0, started, a.budget_seconds)   # this source's own share, so one slow source cannot starve the rest
        stopped = False
        seen = kept = 0
        sent = REQUESTS[0]
        it = None
        try:
            it = iter(fn())
            for j in it:
                if cap is not None and time.monotonic() - t0 > cap:
                    stopped = True
                    break
                seen += 1
                if not j['title'] or not j['company'] or not str(j['url']).startswith('https://'):
                    continue
                if name not in no_cutoff and j['posted_at'] and when(j['posted_at']) and when(j['posted_at']) < since:
                    continue
                cands = title_candidates(j['title'], rules)
                if not cands:
                    continue
                j['id'] = f"js:{ID_NAME.get(name, name)}:{hashlib.sha1(j['url'].encode()).hexdigest()[:20]}"
                if j['id'] in have:
                    continue
                if not reposters.admit(j, held):
                    continue
                j['candidates'] = cands
                j['board'] = name not in EMPLOYER_SITES   # an employer's own career site is not a job board
                if enrich_full_text(j, name, used, spent):
                    enriched[name] = enriched.get(name, 0) + 1
                merged['jobs'].append(clean(j)); have.add(j['id']); kept += 1
            report[name] = {'read': seen, 'kept': kept, 'requests': REQUESTS[0] - sent, **({'full_text': enriched[name]} if enriched.get(name) else {}),
                            **({'stopped': 'time cap', 'cap_seconds': round(cap)} if stopped else {})}
        except Exception as e:   # one failing source is skipped (a robots.txt refusal is reported here as "robots.txt disallows ...")
            report[name] = {'error': str(e)[:160], 'read': seen, 'kept': kept, 'requests': REQUESTS[0] - sent}
        finally:
            close = getattr(it, 'close', None)
            if close:   # a source stopped at its cap ends its generator now (no further request)
                try:
                    close()
                except Exception:
                    pass
        write_json(raw_path, merged)   # after every source: a step stopped at its time limit keeps what it fetched
        write_json(out / 'more_sources_report.json', report, indent=1)
    write_json(raw_path, merged)
    write_json(out / 'more_sources_report.json', report, indent=1)
    for w in time_warnings(report):
        print(f'::warning::{w}')
    print(json.dumps(report))
    if all_errored(report):
        print('every source failed', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
