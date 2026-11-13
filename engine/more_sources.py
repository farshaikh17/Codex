"""More free job sources (owner decision 2026-11-07: "if we need more sources, just get it done").

Each source is read through a public endpoint its own site uses (no login, no key). The reads are polite: one run a day,
a pause between requests, and bounded pages. Postings are kept only when the title matches a candidate's own role rule.
Results merge into work/jobsite_raw.json. Aggregators (Workable, Arbeitnow, Getro, UN Careers, EURES, Adzuna) are job-board reports
(the screen never takes eligibility from them). Employer career sites (EMPLOYER_SITES: Workday, Oracle, SuccessFactors, SmartRecruiters,
Siemens Energy, Eightfold) carry board=False: stored verified, with normal eligibility and provenance LIVE_PUBLIC.

  * Workable job search      jobs.workable.com/api/v1/jobs: every Workable employer (not in the open dataset)
  * Eightfold career sites   Fluor, NEOM, TAQA (energy and Gulf employers not in the open dataset)
  * Siemens Energy (Avature) the public jobs RSS feed
  * SuccessFactors RSS       ENGIE, ACWA Power, Tata Power (employer-branded sites)
  * Arbeitnow                the public job-board API, visa-sponsorship jobs (terms: link back; every job links to Arbeitnow)
  * Getro VC networks        public collection search (startup and climate-fund portfolio jobs)
  * UN Careers               the public openings list (consultancies are often home-based)
  * EURES                    the EU job-mobility portal's public search (about 2 million EU vacancies), English titles where given
  * Adzuna                   only when the free ADZUNA_APP_ID / ADZUNA_APP_KEY secrets are set (India, UK, Germany, Netherlands)

Runs WITHOUT database credentials. One failing source is skipped, never fatal.
Usage: python engine/more_sources.py --profiles work/profiles.json --out work/ [--days 30]
"""
import argparse
import hashlib
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

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from engine.dataset_discovery import clean  # noqa: E402
from engine.multi_place import from_count, places_text  # noqa: E402
from engine.remote_boards import UA, all_errored, job, over_budget, text, when, write_json  # noqa: E402

PAUSE = 0.6
# Sources that read an employer's own career site (not a job board): their rows are stored as the employer's posting.
EMPLOYER_SITES = ('workday', 'oracle_hcm', 'successfactors', 'smartrecruiters', 'siemens_energy', 'eightfold')
QUERIES = {
    'farhan_shaikh': ['gohighlevel', 'revops', 'revenue operations', 'implementation manager', 'automation specialist', 'crm manager',
                      'chief of staff', 'founder office', 'solutions engineer', 'technical operations', 'gtm engineer',
                      # plan D1 (13 Nov): kept only where a live Workable read returned mostly his roles (implementation 20 of 20, solutions consultant
                      # 16 of 20); onboarding (HR onboarding), technical account manager, customer engineer and business systems returned few and were left out
                      'implementation', 'solutions consultant'],
    'sana_ansari': ['power plant', 'reliability engineer', 'maintenance engineer', 'electrical engineer', 'energy efficiency',
                    'commissioning engineer', 'operations engineer', 'decarbonization',
                    # plan D1 (13 Nov): her non-maintenance roles, kept where a live Workable read returned mostly her field (utilities engineer 17 of 20,
                    # energy manager 18, plant engineer 13, O&M engineer 8); asset performance returned finance roles only and was left out
                    'utilities engineer', 'energy manager', 'plant engineer', 'O&M engineer'],
}
EIGHTFOLD = [('Fluor', 'careers.fluor.com', 'fluor.com'), ('NEOM', 'careers.neom.com', 'neom.com'), ('TAQA', 'careers.taqa.com', 'taqa.com')]
SUCCESSFACTORS = [('ENGIE', 'jobs.engie.com'), ('ACWA Power', 'careers.acwapower.com'), ('Tata Power', 'careers.tatapower.com'),
                  ('Emirates Global Aluminium', 'careers.ega.ae'), ('Black & Veatch', 'careers.bv.com'),
                  # jobs.doosan.com serves the whole Doosan group; Bobcat (vehicles) postings are skipped, Enerbility / Skoda Power / Fuel Cell are kept
                  ('Doosan', 'jobs.doosan.com', '/bobcat/'),
                  ('Tata Motors', 'careers.tatamotors.com')]   # added 2026-11-12, live that day (India plants)
# Workday public career-site JSON (no key). (display name, tenant, data-centre prefix, site id); all three answered on a live read.
WORKDAY = [('KBR', 'kbr', 'wd5', 'KBR_Careers'), ('GE Vernova', 'gevernova', 'wd5', 'Vernova_ExternalSite'), ('Hitachi', 'hitachi', 'wd1', 'hitachi'),
           # Added 2026-11-12 (Sana: plant, utilities and energy employers with large India and Gulf operations); each answered a live read that day.
           ('Johnson Controls', 'jci', 'wd5', 'JCI'), ('Baker Hughes', 'bakerhughes', 'wd5', 'BakerHughes'), ('Shell', 'shell', 'wd3', 'ShellCareers'),
           ('Unilever', 'unilever', 'wd3', 'Unilever_Experienced_Professionals'), ('Dow', 'dow', 'wd1', 'ExternalCareers'), ('3M', '3m', 'wd1', 'Search')]
# SmartRecruiters public postings API (no key). (display name, company identifier). Statkraft's identifier is 'Statkraft1'.
SMARTRECRUITERS = [('Masdar', 'Masdar'), ('Vattenfall', 'Vattenfall'), ('AFRY', 'AFRY'), ('Statkraft', 'Statkraft1'),
                   ('Bosch', 'BoschGroup'), ('Continental', 'Continental')]   # added 2026-11-12, live that day (large India plants)
# Oracle Recruiting Cloud public candidate-experience REST (no key). (display name, host, site number); answered on a live read.
ORACLE = [('Wood', 'ehif.fa.em2.oraclecloud.com', 'CX_1')]
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
                j = job('workable', r.get('url') or '', text(r.get('title')), text((r.get('company') or {}).get('title')),
                        f'Remote ({place})' if remote else place, text((r.get('description') or '') + ' ' + (r.get('requirementsSection') or '')),
                        when(r.get('created')))
                j['is_remote'] = remote   # job() defaults to remote (it was written for the remote boards): an on-site Workable job was stored as remote
                yield j
            token = d.get('nextPageToken')
            if not token:
                break


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


def successfactors():
    for company, host, *skip in SUCCESSFACTORS:
        for term in SF_TERMS:
            raw = http(f'https://{host}/services/rss/job/?locale=en_US&keywords={urllib.parse.quote(term)}')
            for it in rss_items(raw):
                if any(x in (it.findtext('link') or '') for x in skip):
                    continue
                title = text(it.findtext('title'))
                if title.lower().startswith('no jobs currently available'):   # the portal's empty-result placeholder
                    continue
                m = re.match(r'^(.*?)\s*\(([^()]*)\)\s*$', title)   # "Role (City, CC, zip)"
                j = job('successfactors', (it.findtext('link') or '').strip(), m.group(1) if m else title, company, m.group(2) if m else '',
                        text(it.findtext('description')), when(it.findtext('pubDate')), board=False)
                j['is_remote'] = False
                yield j


def workday(pages=3):
    """Open postings of a few energy employers from Workday's public career-site JSON, searched with the same energy terms as SuccessFactors.
    The list answer carries no job text and only a relative "Posted N Days Ago", so the description is the location text and the posted date is unknown."""
    failed = 0
    for company, tenant, dc, site in WORKDAY:
        base = f'https://{tenant}.{dc}.myworkdayjobs.com'
        seen = set()
        try:
            for term in SF_TERMS:
                for page in range(pages):
                    d = json.loads(http(f'{base}/wday/cxs/{tenant}/{site}/jobs', {'appliedFacets': {}, 'limit': 20, 'offset': page * 20, 'searchText': term}))
                    rows = d.get('jobPostings') or []
                    for r in rows:
                        path = r.get('externalPath') or ''
                        if not path or path in seen:
                            continue
                        seen.add(path)
                        url = f'{base}/en-US/{site}{path}'
                        place = from_count(text(r.get('locationsText')), url) or 'See posting'   # plan B2: '5 Locations' -> 'Assen; +4 more'
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


def smartrecruiters(pages=10):
    """Open postings of a few energy employers from SmartRecruiters' public API; the title filter in main() keeps the relevant ones.
    The list answer carries no job text, so the description is the function / industry / location labels only."""
    failed = 0
    for company, ident in SMARTRECRUITERS:
        try:
            for page in range(pages):
                d = json.loads(http(f'https://api.smartrecruiters.com/v1/companies/{urllib.parse.quote(ident)}/postings?limit=100&offset={page * 100}'))
                rows = d.get('content') or []
                for r in rows:
                    loc = r.get('location') or {}
                    place = loc.get('fullLocation') or ', '.join(x for x in (loc.get('city'), (loc.get('country') or '').upper()) if x) or 'See posting'
                    remote = bool(loc.get('remote'))
                    labels = ' '.join(text((r.get(k) or {}).get('label')) for k in ('function', 'industry', 'typeOfEmployment', 'experienceLevel'))
                    j = job('smartrecruiters', f"https://jobs.smartrecruiters.com/{ident}/{r.get('id')}", text(r.get('name')), company,
                            f'Remote ({place})' if remote else place, labels, when(r.get('releasedDate')), board=False)
                    j['is_remote'] = remote
                    yield j
                if len(rows) < 100:
                    break
        except Exception as e:   # one employer down never loses the others
            failed += 1
            print(f'smartrecruiters {company}: {type(e).__name__}', file=sys.stderr)
    _all_failed('smartrecruiters', failed, len(SMARTRECRUITERS))


def oracle_hcm(pages=3):
    """Open postings of Oracle Recruiting Cloud career sites (Wood), searched with the same energy terms as SuccessFactors/Workday.
    The list answer carries no job text, so the description is the location text and the workplace type."""
    failed = 0
    for company, host, site in ORACLE:
        seen = set()
        try:
            for term in SF_TERMS:
                for page in range(pages):
                    finder = f'findReqs;siteNumber={site},limit=25,offset={page * 25},keyword={urllib.parse.quote(term)},sortBy=POSTING_DATES_DESC'
                    d = json.loads(http(f'https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder={finder}',
                                        headers={'Accept': 'application/json'}))
                    rows = ((d.get('items') or [{}])[0].get('requisitionList')) or []
                    for r in rows:
                        rid = str(r.get('Id') or '')
                        if not rid or rid in seen:
                            continue
                        seen.add(rid)
                        place = text(r.get('PrimaryLocation')) or 'See posting'
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
    app_id, key = os.environ.get('ADZUNA_APP_ID', ''), os.environ.get('ADZUNA_APP_KEY', '')
    if not app_id or not key:
        return
    for cid, pairs in queries.items():
        for country, what in pairs:
            url = f'https://api.adzuna.com/v1/api/jobs/{country}/search/1?' + urllib.parse.urlencode(
                {'app_id': app_id, 'app_key': key, 'results_per_page': 50, 'what': what, 'max_days_old': 14, 'content-type': 'application/json'})
            d = json.loads(http(url))
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
    m = re.match(r'^https://jobs\.smartrecruiters\.com/([^/]+)/(\d+)$', j['url'])
    if not m:
        return None
    r = json.loads(http(f'https://api.smartrecruiters.com/v1/companies/{urllib.parse.quote(m.group(1))}/postings/{m.group(2)}'))
    sec = (r.get('jobAd') or {}).get('sections') or {}
    return ' '.join(text((sec.get(k) or {}).get('text')) for k in ('jobDescription', 'qualifications', 'additionalInformation'))


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


def _detail_oracle(j):
    m = re.match(r'^https://([^/]+)/hcmUI/CandidateExperience/en/sites/([^/]+)/job/(\d+)$', j['url'])
    if not m:
        return None
    host, site, rid = m.groups()
    d = json.loads(http(f'https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id="{rid}",siteNumber={site}',
                        headers={'Accept': 'application/json'}))
    it = (d.get('items') or [{}])[0]
    return ' '.join(text(it.get(k)) for k in ('ExternalDescriptionStr', 'ExternalQualificationsStr'))


ENRICH = {'smartrecruiters': _detail_smartrecruiters, 'workday': _detail_workday, 'oracle_hcm': _detail_oracle}


def enrich_full_text(j, name, used, spent):
    """Replace the thin list description of a kept posting by the posting's own text, so the screen can read sponsorship, years, pay and remote wording.
    Bounded per source and by time; any failure keeps the posting with its list description."""
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--profiles', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--days', type=int, default=30)
    ap.add_argument('--fast', action='store_true')
    ap.add_argument('--budget-seconds', type=int, default=0, help="the step's time limit: no source starts after 80%% of it")
    a = ap.parse_args()
    started = time.monotonic()
    profs = json.loads(Path(a.profiles).read_text())
    rules = {cid: (re.compile(p['role'], re.I), re.compile(p['exclude'], re.I) if p.get('exclude') else None) for cid, p in profs.items()}
    wq = [(q, cid == 'farhan_shaikh') for cid in profs for q in QUERIES.get(cid, [])]
    sources = {'workable': lambda: workable(wq), 'eightfold': eightfold, 'siemens_energy': siemens_energy, 'successfactors': successfactors, 'smartrecruiters': smartrecruiters, 'workday': workday, 'oracle_hcm': oracle_hcm,
               'arbeitnow': arbeitnow, 'getro': getro, 'uncareers': un_careers,
               'eures': lambda: eures({c: t for c, t in EURES_TERMS.items() if c in profs}), 'adzuna': lambda: adzuna({c: t for c, t in ADZUNA.items() if c in profs})}
    if a.fast:   # watchlist runs: the employer sites and the big aggregator only
        sources = {k: v for k, v in sources.items() if k in ('workable', 'eightfold', 'siemens_energy', 'successfactors', 'smartrecruiters', 'workday', 'oracle_hcm')}
    since = datetime.now(timezone.utc) - timedelta(days=a.days)
    no_cutoff = {'siemens_energy', 'successfactors', 'eightfold', 'smartrecruiters', 'workday', 'oracle_hcm'}   # employer sites: the date is the original posting date; the still-open check guards staleness
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    raw_path = out / 'jobsite_raw.json'
    merged = json.loads(raw_path.read_text()) if raw_path.exists() else {'source': 'job_sites', 'jobs': []}
    have = {j['id'] for j in merged['jobs']}
    report = {}
    used, enriched, spent = {}, {}, [0.0]
    for name, fn in sources.items():
        if over_budget(started, a.budget_seconds):   # the step's time limit is near: what was fetched is kept, nothing new starts
            report[name] = {'skipped': 'time budget', 'read': 0, 'kept': 0}
            continue
        seen = kept = 0
        try:
            for j in fn():
                seen += 1
                if not j['title'] or not j['company'] or not str(j['url']).startswith('https://'):
                    continue
                if name not in no_cutoff and j['posted_at'] and when(j['posted_at']) and when(j['posted_at']) < since:
                    continue
                t = j['title'].lower()
                cands = [cid for cid, (role, excl) in rules.items() if role.search(t) and not (excl and excl.search(t))]
                if not cands:
                    continue
                j['id'] = f"js:{name}:{hashlib.sha1(j['url'].encode()).hexdigest()[:20]}"
                if j['id'] in have:
                    continue
                j['candidates'] = cands
                j['board'] = name not in EMPLOYER_SITES   # an employer's own career site is not a job board
                if enrich_full_text(j, name, used, spent):
                    enriched[name] = enriched.get(name, 0) + 1
                merged['jobs'].append(clean(j)); have.add(j['id']); kept += 1
            report[name] = {'read': seen, 'kept': kept, **({'full_text': enriched[name]} if enriched.get(name) else {})}
        except Exception as e:   # one failing source is skipped
            report[name] = {'error': str(e)[:160], 'read': seen, 'kept': kept}
        write_json(raw_path, merged)   # after every source: a step stopped at its time limit keeps what it fetched
        write_json(out / 'more_sources_report.json', report, indent=1)
    write_json(raw_path, merged)
    write_json(out / 'more_sources_report.json', report, indent=1)
    print(json.dumps(report))
    if all_errored(report):
        print('every source failed', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
