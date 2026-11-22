"""Daily "still open?" check of the best-ranked jobs (owner decision 2026-11-07).

Three steps, so credentials never reach the step that visits third-party websites:
  --export OUT   (D1 credentials) the 75 best-scored undecided jobs per candidate, with their posting URL; with --pool (plan A1) the shortlist
                 pool's rows come first: the automatic shortlist, then the pool by score, up to 150 per person
  --check  IN    (no credentials) one GET per URL (8 at a time, 8 s each; after 8 minutes it stops and keeps what it has); a job is dead only on HTTP 404/410 twice, or when a known hiring system
                 says so (a Greenhouse redirect carrying error=true, a Lever 404, a Workday posting record that is not found or no longer public);
                 403/429/5xx/timeouts prove nothing. Jobs QA 7: the employer's own record of the posting's place is read on the way (Workday's
                 remote type and country, Ashby's workplace type and applicant country, the Greenhouse and Lever posting records) and kept as 'facts'
  --sql    IN    writes SQL: dead jobs are closed (never one with an application or a human decision), live ones get
                 last_verified_at = now; a place the employer's record contradicts (hybrid or on-site where the job is stored remote; remote only
                 from another country) is written to the job and its scores are marked for re-scoring under the current rules
Usage: python engine/liveness.py --export work/liveness_targets.json [--pool work/shortlist_pool.json]
       python engine/liveness.py --check work/liveness_targets.json --out work/liveness_result.json
       python engine/liveness.py --sql work/liveness_result.json --out work/liveness.sql
"""
import argparse
import json
import re
import sys
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

PER_CANDIDATE = 75
# A Ready / Stretch row the screen shortlisted by itself (dataset_apply.mjs marks its reason) is not a person's decision: it is checked like an
# undecided row and its posting may be closed. A Ready / Stretch row without the mark was set by a person or the first import and stays protected.
AUTO = "x.qualification_status IN ('READY','STRETCH_READY') AND COALESCE(x.qualification_reason,'') LIKE 'Shortlisted automatically.%'"
DECIDED = f"(x.manual_override_status IS NOT NULL OR (x.qualification_status NOT IN ('NEEDS_REVIEW','HOLD') AND NOT ({AUTO})))"
UA = 'Mozilla/5.0 (compatible; career-job-engine/1.0; private job search)'
# Per person, the PER_CANDIDATE best undecided rows: the automatic shortlist first, then by score, then newest (the order the single window query
# over every score row used to give). D1 bills every row a query steps over, and that query read every score row of every person, each with a
# scan of the applications table (no index on job_id): about 2.1 million rows a day on a local copy of production size (dashboard/docs/
# COST_MODEL_2026-11-09.md section 6). Now two small queries per person: the shortlist rows through the (candidate, status) index, then the rest
# walking the (candidate, score) index and stopping after PER_CANDIDATE rows (CROSS JOIN fixes that join order); a few hundred rows read each.
_EXPORT_COLS = "SELECT j.id, CASE WHEN j.original_posting_url LIKE 'https://%' THEN j.original_posting_url ELSE j.source_url END AS url"
_EXPORT_OPEN = f"""j.is_active = 1
    AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id)
    AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = j.id AND {DECIDED})
    AND (j.original_posting_url LIKE 'https://%' OR j.source_url LIKE 'https://%')"""
SHORTLISTED = "('READY','STRETCH_READY')"


def export_sql(candidate_id, shortlisted, limit=PER_CANDIDATE):
    """One person's targets: shortlisted=True the Ready / Stretch rows (only automatic ones pass the decided test), False every other row."""
    cid = q(candidate_id)
    if shortlisted:
        return f"""{_EXPORT_COLS} FROM candidate_qualifications q CROSS JOIN candidate_job_scores s CROSS JOIN jobs j
  WHERE q.candidate_id = {cid} AND q.qualification_status IN {SHORTLISTED} AND s.candidate_id = q.candidate_id AND s.job_id = q.job_id AND j.id = q.job_id
    AND {_EXPORT_OPEN}
  ORDER BY s.overall_score DESC, j.discovered_at DESC LIMIT {int(limit)}"""
    return f"""{_EXPORT_COLS} FROM candidate_job_scores s CROSS JOIN candidate_qualifications q CROSS JOIN jobs j
  WHERE s.candidate_id = {cid} AND q.candidate_id = s.candidate_id AND q.job_id = s.job_id AND q.qualification_status NOT IN {SHORTLISTED} AND j.id = s.job_id
    AND {_EXPORT_OPEN}
  ORDER BY s.overall_score DESC, j.discovered_at DESC LIMIT {int(limit)}"""


def export_rows(read, per_candidate=PER_CANDIDATE):
    """The usual targets, per person in id order. read(sql) -> rows (dicts with id and url)."""
    out = []
    for c in read('SELECT id FROM candidates ORDER BY id'):
        first = list(read(export_sql(c['id'], True, per_candidate)))
        rest = list(read(export_sql(c['id'], False, per_candidate - len(first)))) if len(first) < per_candidate else []
        out += [{'id': r['id'], 'url': r['url']} for r in first + rest]
    return out


POOL_PER_CANDIDATE = 150


def pool_targets(pool, per_candidate=POOL_PER_CANDIDATE):
    """Plan A1: the still-open check verifies the shortlist pool first, so the selector (which keeps only rows verified in the last 4 days) can
    choose from it. Per person: the rows on the automatic shortlist now, then the pool by score, at most `per_candidate`; active rows with an
    https posting URL only."""
    out, seen, taken = [], set(), {}
    rows = [r for r in (pool or {}).get('rows', []) if r.get('kind') in ('auto', 'pool') and r.get('active') and str(r.get('url') or '').startswith('https://')]
    rows.sort(key=lambda r: (r['kind'] != 'auto', -(r.get('score') or 0), str(r['job_id'])))
    for r in rows:
        cid = r['candidate_id']
        if taken.get(cid, 0) >= per_candidate or r['job_id'] in seen:
            continue
        seen.add(r['job_id'])
        taken[cid] = taken.get(cid, 0) + 1
        out.append({'id': r['job_id'], 'url': r['url']})
    return out


def merge_targets(first, rest):
    """The pool's targets first, then the usual export's, each job once."""
    seen = {t['id'] for t in first}
    return list(first) + [t for t in rest if t['id'] not in seen]


WORKERS = 8           # parallel requests
TIMEOUT = 8           # seconds per request
DEADLINE = 8 * 60     # seconds: the workflow step stops at 10 minutes, so the check returns what it has well before that


# ---- Jobs QA 7: the employer's own record of a posting's place -----------------------------------------------------------------------------
# Job boards and the open dataset tag places their own way ('Remote, India' on Indeed for a Greenhouse 'Remote US' posting; 'India Remote Office'
# for a Workday 'Hybrid: Work in Office Part-Time' one; an Ashby 'Hybrid' posting flagged remote). The hiring system's own fields win. Read while the
# still-open check is fetching the posting anyway: Workday's posting record (the cxs JSON of the same URL, which also says when a posting was taken
# down: 'not found' or 'permission denied'), the Ashby page's own data, and the Greenhouse and Lever posting records (one small request each).
WORKDAY_URL = re.compile(r'^https://([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?([^/?#]+)/job/([^?#]+)', re.I)
GREENHOUSE_URL = re.compile(r'^https://(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io/([^/?#]+)/jobs/(\d+)', re.I)
LEVER_URL = re.compile(r'^https://jobs\.(eu\.)?lever\.co/([^/?#]+)/([0-9a-f-]{36})', re.I)
ASHBY_URL = re.compile(r'^https://jobs\.ashbyhq\.com/', re.I)
COUNTRY_CODES = {'IN': 'India', 'US': 'United States', 'GB': 'United Kingdom', 'UK': 'United Kingdom', 'CA': 'Canada', 'AU': 'Australia', 'DE': 'Germany',
                 'FR': 'France', 'ES': 'Spain', 'IT': 'Italy', 'NL': 'Netherlands', 'IE': 'Ireland', 'PL': 'Poland', 'PT': 'Portugal', 'BR': 'Brazil',
                 'MX': 'Mexico', 'SG': 'Singapore', 'AE': 'United Arab Emirates', 'SA': 'Saudi Arabia', 'PH': 'Philippines', 'BG': 'Bulgaria', 'RO': 'Romania'}
# Jobs QA 10: closed-page facts. A hiring system's own words on the posting page that the posting is closed (ENGIE's SAP SuccessFactors career site:
# 'You can't view this job because it's not available at this time.', HTTP 200). SuccessFactors pages carry these words after their scripts, past the
# 64 KB read, so a page that names the system in its first part is read on to SF_PAGE_BYTES.
CLOSED_PAGE_FACTS = [
    ('successfactors closed page', re.compile(r"you can(?:'|’|&#39;|&#x27;|&rsquo;)?t view this job because it(?:'|’|&#39;|&#x27;|&rsquo;)?s not available at this time", re.I)),
]
SF_PAGE = re.compile(rb'successfactors|\brmk-|j2w', re.I)
SF_PAGE_BYTES = 524288


def closed_page(html):
    """The label of the first closed-page fact the page text shows, or None."""
    h = html.decode('utf-8', 'replace') if isinstance(html, bytes) else str(html or '')
    return next((label for label, rx in CLOSED_PAGE_FACTS if rx.search(h)), None)


# Jobs QA 10 (Koch 'Utilities Engineer', stored with no place): an Avature posting page names its place in a 'Location(s)' field
# ('Lincoln, Nebraska'), and its URL starts the job's slug with the country ('/JobDetail/United-States-Utility-Engineer/195640').
AVATURE_URL = re.compile(r'^https://[a-z0-9-]+\.avature\.net/', re.I)
AVATURE_LOCATION = re.compile(r'Location\(s\)\s*</div>\s*<div[^>]*field__value[^>]*>\s*([^<]{2,120}?)\s*</div>', re.I)
SLUG_COUNTRIES = ['United States', 'United Kingdom', 'United Arab Emirates', 'Saudi Arabia', 'South Africa', 'New Zealand', 'India', 'Canada',
                  'Australia', 'Germany', 'France', 'Mexico', 'Brazil', 'China', 'Japan', 'Singapore', 'Qatar', 'Oman', 'Kuwait', 'Bahrain', 'Egypt',
                  'Netherlands', 'Belgium', 'Spain', 'Italy', 'Poland', 'Ireland']


def avature_facts(html, url):
    h = html.decode('utf-8', 'replace') if isinstance(html, bytes) else str(html or '')
    m = AVATURE_LOCATION.search(h)
    loc = re.sub(r'\s+', ' ', m.group(1)).strip() if m else None
    slug = re.search(r'/JobDetail/([^/?#]+)/', str(url or ''), re.I)
    words = slug.group(1).replace('-', ' ').lower() + ' ' if slug else ''
    country = next((c for c in SLUG_COUNTRIES if words.startswith(c.lower() + ' ')), None)
    return {k: v for k, v in {'location': loc, 'countries': [country] if country else []}.items() if v}


US_WORDS = re.compile(r'(?<![A-Za-z])(?:US|USA|U\.S\.?)(?![A-Za-z])|\bunited states\b', re.I)


def workday_record_url(url):
    """The cxs record of a Workday posting URL ('.../job/<path>', without the '/apply' or '/apply/applyManually' of an application link)."""
    m = WORKDAY_URL.match(str(url or ''))
    if not m:
        return None
    path = re.sub(r'/apply(?:/applyManually)?/?$', '', m.group(4).rstrip('/'), flags=re.I)
    return f"https://{m.group(1)}.{m.group(2)}.myworkdayjobs.com/wday/cxs/{m.group(1)}/{m.group(3)}/job/{path}"


def _workplace(text):
    """Hybrid first, then remote ('Remote: Home Office', 'Work from home' are remote), then an office or on-site place."""
    t = str(text or '').lower()
    if 'hybrid' in t:
        return 'HYBRID'
    if re.search(r'\bremote\b|\bhome[- ]office\b|\bwork(?:ing)? from home\b|\bwfh\b|\btelecommut', t):
        return 'REMOTE'
    return 'ONSITE' if re.search(r'on[- ]?site|in[- ]office|\boffice\b', t) else None


def workday_facts(record):
    info = (record or {}).get('jobPostingInfo') or {}
    country = (info.get('country') or {}).get('descriptor')
    return {k: v for k, v in {'workplace': _workplace(info.get('remoteType')), 'location': info.get('location'), 'countries': [country] if country else []}.items() if v}


def ashby_facts(html):
    h = str(html or '')
    wp = re.search(r'"workplaceType"\s*:\s*"([A-Za-z]+)"', h)
    loc = re.search(r'"locationName"\s*:\s*"([^"]{1,120})"', h)
    req = re.search(r'"applicantLocationRequirements"\s*:\s*(\{[^{}]*\}|\[[^\]]*\])', h)
    countries = re.findall(r'"name"\s*:\s*"([^"]{2,60})"', req.group(1)) if req else []
    return {k: v for k, v in {'workplace': _workplace(wp.group(1)) if wp else None, 'location': loc.group(1) if loc else None, 'countries': countries}.items() if v}


def greenhouse_facts(record):
    name = ((record or {}).get('location') or {}).get('name') or ''
    countries = ['India'] if re.search(r'\bindia\b', name, re.I) else ['United States'] if US_WORDS.search(name) else []
    return {k: v for k, v in {'workplace': 'REMOTE' if re.search(r'\bremote\b', name, re.I) else None, 'location': name, 'countries': countries}.items() if v}


def lever_facts(record):
    r = record or {}
    code = str(r.get('country') or '').upper()
    wp = {'remote': 'REMOTE', 'hybrid': 'HYBRID', 'onsite': 'ONSITE', 'on-site': 'ONSITE'}.get(str(r.get('workplaceType') or '').lower())
    return {k: v for k, v in {'workplace': wp, 'location': (r.get('categories') or {}).get('location'), 'countries': [COUNTRY_CODES[code]] if code in COUNTRY_CODES else []}.items() if v}


RECORD_BYTES = 131072   # a posting record is small; the description inside it is the bulk
ASHBY_PAGE_BYTES = 262144   # an Ashby page carries its data after the scripts; other pages are read to 64 KB as before
RECORD_RESERVE = 60     # seconds: with less than this left before the deadline, the extra Greenhouse / Lever record request is skipped


def _get_json(url, timeout):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:   # noqa: S310 (built from our own https posting URLs)
        return json.loads(r.read(RECORD_BYTES).decode('utf-8', 'replace'))


def _record_facts(url, timeout, facts):
    """Greenhouse and Lever: the posting record's place, added to `facts` (a failure adds nothing; it never decides open or closed)."""
    try:
        m = GREENHOUSE_URL.match(url)
        if m:
            facts.update(greenhouse_facts(_get_json(f'https://boards-api.greenhouse.io/v1/boards/{m.group(1)}/jobs/{m.group(2)}', timeout)))
            return
        m = LEVER_URL.match(url)
        if m:
            facts.update(lever_facts(_get_json(f"https://api.{m.group(1) or ''}lever.co/v0/postings/{m.group(2)}/{m.group(3)}", timeout)))
    except Exception:   # noqa: BLE001
        pass


def probe(url, timeout=TIMEOUT, facts=None, records=True):
    """('dead'|'alive'|'unknown', detail). With a `facts` dict, the employer's own record of the posting's place is added to it (jobs QA 7);
    records=False skips the extra Greenhouse / Lever record request (near the deadline)."""
    rec = workday_record_url(url)
    if rec:   # Workday: the posting record itself. Not found (S21) or no longer public (S22) is a closed posting; anything else falls back to the page
        try:
            record = _get_json(rec, timeout)
            if facts is not None:
                facts.update(workday_facts(record))
            return 'alive', 'workday record'
        except urllib.error.HTTPError as e:
            body = ''
            try:
                body = e.read(4096).decode('utf-8', 'replace')
            except Exception:   # noqa: BLE001
                pass
            # only Workday's own answers close a posting: not found (S21) or no longer public (S22). Any other error (a 404 page from a
            # record URL we built wrongly, a block, throttling) falls back to the page below, which never closes on a guess.
            if (e.code == 404 and '"S21"' in body) or (e.code == 403 and '"S22"' in body):
                return 'dead', f'workday record {e.code}'
        except Exception:   # noqa: BLE001 - timeouts, unreadable JSON: the page below decides
            pass
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html,application/json;q=0.9,*/*;q=0.5'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:   # noqa: S310 (URLs from our own database, https only)
            final = r.geturl()
            ashby = facts is not None and bool(ASHBY_URL.match(final or url))
            body = r.read(ASHBY_PAGE_BYTES if ashby else 65536)
            if isinstance(body, bytes) and SF_PAGE.search(body[:65536]) and len(body) >= 65536:   # jobs QA 10: read a SuccessFactors page on
                body += r.read(SF_PAGE_BYTES - len(body))
            closed = closed_page(body)
            if closed:
                return 'dead', closed
            if ashby:
                facts.update(ashby_facts(body.decode('utf-8', 'replace') if isinstance(body, bytes) else body))
            if facts is not None and AVATURE_URL.match(final or url):
                facts.update(avature_facts(body, final or url))
            if 'greenhouse.io' in final and 'error=true' in final:
                return 'dead', 'greenhouse error redirect'
            initial_url, final_url = urlsplit(url), urlsplit(final)
            # A generic homepage after a redirect does not prove that a specific posting remains open.
            if initial_url.path.strip('/') and not final_url.path.strip('/'):
                return 'unknown', 'redirected to homepage'
            if facts is not None and records:
                _record_facts(url, timeout, facts)
            return 'alive', str(r.status)
    except urllib.error.HTTPError as e:
        return ('dead' if e.code in (404, 410) else 'unknown'), str(e.code)
    except Exception as e:   # timeouts, TLS, DNS: prove nothing
        return 'unknown', type(e).__name__


def _one(url, pause, records_until=None):
    records = lambda: records_until is None or time.monotonic() < records_until   # noqa: E731
    facts = {}
    state, _ = probe(url, facts=facts, records=records())
    if state == 'dead':   # a second look before anything is closed
        time.sleep(1)
        facts = {}
        state, _ = probe(url, facts=facts, records=records())
    if pause:
        time.sleep(pause)
    return state, facts


def check(targets, pause=0.3, workers=None, deadline=None):
    """Probe each target (WORKERS at a time). After `deadline` seconds no new probe starts and the result so far is returned,
    so a slow day still writes what it verified instead of nothing. Targets not reached are counted in 'unchecked'."""
    workers = workers or WORKERS
    deadline = DEADLINE if deadline is None else deadline
    out = {'dead': [], 'alive': [], 'unknown': 0, 'unchecked': 0, 'facts': {}}
    todo, seen = [], set()
    for t in targets:
        if t['id'] not in seen:
            seen.add(t['id'])
            todo.append(t)
    stop_at = time.monotonic() + deadline
    left = lambda: max(0.0, stop_at - time.monotonic())   # noqa: E731
    pool = ThreadPoolExecutor(max_workers=max(1, workers))
    futures = {}
    try:
        for n, t in enumerate(todo):
            while len(futures) >= workers and left() > 0:   # at most `workers` in flight, so nothing new starts after the deadline
                done, _ = wait(list(futures), timeout=left(), return_when=FIRST_COMPLETED)
                for f in done:
                    _record(out, futures.pop(f), f)
            if left() <= 0:
                out['unchecked'] += len(todo) - n
                break
            futures[pool.submit(_one, t['url'], pause, stop_at - RECORD_RESERVE)] = t['id']
        done, not_done = wait(list(futures), timeout=left())
        for f in done:
            _record(out, futures.pop(f), f)
        out['unchecked'] += len(not_done)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return out


def _record(out, job_id, fut):
    try:
        res = fut.result()
    except Exception:   # noqa: BLE001 - a probe that raised proves nothing
        res = 'unknown'
    state, facts = res if isinstance(res, tuple) else (res, {})
    if state == 'dead':
        out['dead'].append(job_id)
    elif state == 'alive':
        out['alive'].append(job_id)
        if facts:
            out.setdefault('facts', {})[job_id] = facts
    else:
        out['unknown'] += 1


def not_verified_by_host(targets, res, top=10):
    """Tenth-man review (phase 3): which sites never answer the check (403, 429, timeouts), so a source whose rows can never be verified, and so
    never shortlisted, is visible in the run summary. Host names only; the hosts with the most targets left unverified, at most `top`."""
    done = set(res.get('alive', [])) | set(res.get('dead', []))
    counts = {}
    for t in targets:
        if t['id'] in done:
            continue
        host = urlsplit(str(t.get('url') or '')).hostname or '?'
        host = '.'.join(host.split('.')[-3:]) if not host.endswith(('oraclecloud.com', 'myworkdayjobs.com')) else '.'.join(host.split('.')[-2:])
        counts[host] = counts.get(host, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:top])


def q(v):
    return "'" + str(v).replace("'", "''") + "'"


def not_remote_from_india(facts):
    """Jobs QA 7: the employer's record says the job is hybrid or on site, or remote only from a country other than India (the selector keeps such
    a row off Farhan's lists the same day; to_sql() writes it to the job for the next re-score)."""
    f = facts or {}
    countries = [str(c) for c in f.get('countries') or [] if c]
    return f.get('workplace') in ('HYBRID', 'ONSITE') or (bool(countries) and not any(c.lower() == 'india' for c in countries))


def place_sql(job_id, facts, marker):
    """Jobs QA 7: SQL writing the employer's own place where it contradicts the stored one, each write guarded by the contradiction itself, so a
    second run changes nothing. The scores of a changed job lose the rules marker first, so the next run re-scores them (rescore_rows)."""
    f = facts or {}
    wp, loc = f.get('workplace'), str(f.get('location') or '').strip()
    countries = [str(c).strip() for c in f.get('countries') or [] if str(c).strip()]
    abroad = bool(countries) and not any(c.lower() == 'india' for c in countries)
    writes = []
    # Jobs QA 10: a job stored with no place gets the employer's own (with its country when the place does not name it): the guard is the empty place.
    if loc:
        filled = loc if not countries or any(c.lower() in loc.lower() for c in countries) else f"{loc} ({', '.join(countries)})"
        writes.append(("TRIM(COALESCE(location_restrictions, '')) = ''", f'location_restrictions = {q(filled)}'))
    elif countries:
        writes.append(("TRIM(COALESCE(location_restrictions, '')) = ''", f"location_restrictions = {q(', '.join(countries))}"))
    if wp in ('HYBRID', 'ONSITE'):   # stored remote, the employer says hybrid or on site: both the flag and the place say so ('IND-Pune (Hybrid)')
        word = 'Hybrid' if wp == 'HYBRID' else 'On-site'
        place = f"{q(loc + ' (' + word + ')')}" if loc else f"COALESCE(NULLIF(location_restrictions, '') || ' ', '') || {q('(' + word + ')')}"
        writes.append((f"workplace_type LIKE 'REMOTE%'", f"workplace_type = {q(wp)}, location_restrictions = CASE WHEN lower(COALESCE(location_restrictions, '')) "
                       f"NOT LIKE '%hybrid%' AND lower(COALESCE(location_restrictions, '')) NOT LIKE '%on-site%' THEN {place} ELSE location_restrictions END"))
    if abroad:
        named = ' OR '.join(f"instr(lower(COALESCE(location_restrictions, '')), {q(c.lower())}) > 0" for c in countries)
        if wp in (None, 'REMOTE'):   # remote only from that country: the employer's place, with its country
            new = loc if any(c.lower() in loc.lower() for c in countries) else (f"{loc} ({', '.join(countries)})" if loc else ', '.join(countries))
            writes.append((f'NOT ({named})', f'location_restrictions = {q(new)}'))
        else:   # an office abroad whose city the rules may not know ('Pessione'): the country is added
            writes.append((f"NOT ({named}) AND lower(COALESCE(location_restrictions, '')) NOT LIKE '%india%'",
                           f"location_restrictions = COALESCE(NULLIF(location_restrictions, '') || ', ', '') || {q(countries[0])}"))
    out = []
    for guard, change in writes:
        where = f'id = {q(job_id)} AND {guard}'
        out.append(f"""UPDATE candidate_job_scores SET score_breakdown = replace(score_breakdown, {q('"' + marker + '":true')}, {q('"' + marker + '":false')}) WHERE job_id IN (SELECT id FROM jobs WHERE {where});""")
        out.append(f'UPDATE jobs SET {change} WHERE {where};')
    return out


def _marker():
    from engine.dataset_discovery import RULES_MARKER
    return RULES_MARKER


def to_sql(result, now=None):
    # "+is_active": find the listed ids by key; with the bare column D1's planner walked every active job instead (about 25,000 rows read).
    now = now or datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    guard = ("AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id) "
             f"AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND {DECIDED})")
    lines = []
    for i in range(0, len(result['dead']), 100):
        ids = json.dumps(result['dead'][i:i + 100])
        lines.append(f"UPDATE jobs SET is_active = 0, expired_at = {q(now)} WHERE id IN (SELECT value FROM json_each({q(ids)})) AND +is_active = 1 {guard};")
    for i in range(0, len(result['alive']), 100):
        ids = json.dumps(result['alive'][i:i + 100])
        lines.append(f"UPDATE jobs SET last_verified_at = {q(now)} WHERE id IN (SELECT value FROM json_each({q(ids)}));")
    facts = {k: v for k, v in (result.get('facts') or {}).items() if k not in set(result['dead'])}
    marker = _marker() if facts else None
    places = [s for job_id, f in sorted(facts.items()) for s in place_sql(job_id, f, marker)]
    lines += places
    if result['dead'] or places:
        lines.append('UPDATE cache_state SET generation = generation + 1 WHERE id = 1;')
    return '\n'.join(lines) + '\n'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--export')
    ap.add_argument('--check')
    ap.add_argument('--sql')
    ap.add_argument('--out')
    ap.add_argument('--pool', help='the shortlist pool (engine/dataset_discovery.py --shortlist-pool); its rows are checked first')
    a = ap.parse_args()
    if a.export:
        from engine.dataset_discovery import d1
        first = []
        if a.pool and Path(a.pool).exists():
            try:
                first = pool_targets(json.loads(Path(a.pool).read_text()))
            except ValueError:
                first = []   # an unreadable pool: the usual targets only (the selector does not run without a pool)
        rows = merge_targets(first, export_rows(d1))
        Path(a.export).write_text(json.dumps(rows))
        print(json.dumps({'targets': len(rows), 'pool_targets': len(first)}))
    elif a.check:
        targets = json.loads(Path(a.check).read_text())
        res = check(targets)
        Path(a.out).write_text(json.dumps(res))
        print(json.dumps({'targets': len(targets), 'dead': len(res['dead']), 'alive': len(res['alive']), 'place_records': len(res.get('facts') or {}),
                          'not_remote_from_india': sum(1 for f in (res.get('facts') or {}).values() if not_remote_from_india(f)),
                          'unknown': res['unknown'], 'unchecked': res['unchecked'], 'not_verified_by_host': not_verified_by_host(targets, res)}))
    elif a.sql:
        Path(a.out).write_text(to_sql(json.loads(Path(a.sql).read_text())))
    else:
        ap.error('one of --export, --check, --sql')


if __name__ == '__main__':
    sys.exit(main())

