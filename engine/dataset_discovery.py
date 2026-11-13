"""Daily job discovery over an open dataset of live ATS postings.

Source: the ats-scrapers "jobhive" dataset (MIT, https://github.com/kalil0321/ats-scrapers), a daily snapshot of about
5 million live postings from about 80,000 employers across 64 applicant-tracking systems (Greenhouse, Lever, Ashby,
Workday, SmartRecruiters, ...). The workflow downloads the parquet file once per run; DuckDB then queries it locally.

What this does (no candidate data is ever written to the repository):
  1. reads every candidate's search profile from D1 (the two built-in candidates use focused title searches that are subsets
     of the Worker's role rules; resold clients use their stored role keywords and location rule);
  2. selects postings per profile in two quotas (home country, and remote roles open to anyone) so neither crowds out the other;
  3. drops duplicates within the run and postings already in D1 (same id, same URL, or the same company and title active),
     and lists earlier jobs that reappeared after being closed (to reopen them);
  4. closes nothing on its own: a job this pipeline added is closed only after it is missing from two consecutive snapshots
     AND its ATS's row count is within 10% of the previous run (so one scraper failing for a day closes nothing);
  5. writes matches.json for dataset_apply.mjs, which scores everything with the Worker's own evaluate() and writes SQL.

Search values (keywords, home country) are always passed to DuckDB as bound parameters, never pasted into SQL.

Usage:
  python engine/dataset_discovery.py --out work/ [--dataset work/all.parquet] [--d1-local PATH] [--home-quota 400] [--remote-quota 200]
  python engine/dataset_discovery.py --dedupe work/jobsite_raw.json --out work/   (job-site results: duplicates against D1)
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:   # run as a script (engine/ on sys.path) or as part of the engine package (tests)
    from company_names import http_fetch, name_jobs
    from multi_place import from_count, merge_places
except ImportError:   # pragma: no cover
    from engine.company_names import http_fetch, name_jobs
    from engine.multi_place import from_count, merge_places

DATASET = 'https://storage.stapply.ai/jobhive/v1/all.parquet'
MANIFEST = 'https://storage.stapply.ai/jobhive/v1/manifest.json'
DASHBOARD = Path(__file__).resolve().parent.parent / 'dashboard'
SOURCE_CHANNEL = 'ATS_DATASET'


def _rules_marker():
    """The rules marker, read from its one definition in dashboard/worker/discovery.ts (plan R9), so the two sides can never disagree."""
    src = (DASHBOARD / 'worker' / 'discovery.ts').read_text()
    m = re.search(r"^export const RULES_MARKER = '([a-z0-9_]+)';$", src, re.M)
    if not m:
        raise RuntimeError('RULES_MARKER not found in dashboard/worker/discovery.ts')
    return m.group(1)


RULES_MARKER = _rules_marker()
HEALTHY_RATIO = 0.9   # an ATS whose row count fell more than 10% since the previous run closes nothing this run

# Discovery searches are narrower than the screen's role rule (a subset of it), so what is selected is a role match the
# screen will score, and broad words like a bare "operations" do not pull in warehouse or sales roles.
BUILTIN = {
    'farhan_shaikh': {
        # builder roles, any industry (owner rules 2026-11-07); roles needing hands-on Salesforce/HubSpot/Zoho work are excluded
        'role': r'implementation|integration|automation|business systems|(^|[^a-z])crm([^a-z]|$)|revops|sales ops|marketing ops|systems architect|customer onboarding|onboarding (manager|specialist|lead)|business operations|revenue operations|sales operations|marketing operations|gtm operations|go-to-market operations|gtm engineer|go-to-market engineer|solutions (engineer|consultant|architect|specialist|manager|lead)|technical (operations|delivery)|tech ops|platform operations|business operations (manager|lead)|operations (engineer|manager|lead)|chief of staff|founder.?s? (office|associate)|founding (operations|ops|generalist)|ai (ops|operations|workflow|implementation)',
        'exclude': r'power bi|software (engineer|developer)|devops|site reliability|data scientist|data engineer|machine learning|security engineer|sdet|qa engineer|qa automation|automation (test|qa)|test automation|firewall|warehouse|driver|nurse|clinical|intern([^a-z]|$)|internship|junior|business analyst|deal desk|account executive|sales (development|representative)|(salesforce|hubspot|zoho|netsuite) (admin|administrator|developer|engineer)|administrative assistant',
        'countries': ['IN'], 'mode': 'REMOTE_FROM_HOME', 'home': 'india', 'keywords': [], 'public': True, 'remote_anywhere': True,
    },
    'sana_ansari': {
        'role': r'electrical|power plant|power generation|turbine|boiler|field service engineer|plant operator|control room|instandhaltung|wartung|kraftwerk|elektro(?:ingenieur|techniker|technik)|betriebsingenieur|zuverl.ssigkeit|anlagen(?:ingenieur|techniker|betreuer)|ing.nieur(?:e)? (?:maintenance|.lectricien|exploitation|fiabilit)|centrale (?:.lectrique|thermique)|onderhouds(?:ingenieur|technicus|engineer)|elektrotechnisch|energiebesparing|energieeffizienz|power station|substation|switchgear|transmission|o ?& ?m|operations (&|and) maintenance|maintenance (engineer|manager|head|lead|planner|supervisor)|plant (engineer|manager|operations|maintenance)|reliability engineer|commissioning|asset performance|energy|utilities|renewable|solar|wind (farm|turbine|energy)|thermal (power|plant|station)|hydro|decarboni[sz]|sustainability (engineer|consultant|specialist|manager)|clean ?tech|net.?zero|emissions (engineer|specialist)|efficiency (engineer|consultant|specialist)|(technical|engineering) consultant',
        'exclude': r'(site|customer|product|network|platform|production|database|infrastructure|data|service|systems) reliability|software|cloud|devops|power platform|power bi|power apps|sales|account (executive|manager)|data (engineer|scientist|analyst)|developer|recruiter|research analyst',
        # India first, then anywhere in the world (owner rule 2026-11-07: "anywhere which can be her dream job")
        'countries': ['IN'], 'mode': 'HOME_OR_RELOCATE', 'home': 'india', 'keywords': [], 'public': True, 'worldwide': True,
    },
}
COUNTRY_ISO = {
    'india': 'IN', 'united states': 'US', 'usa': 'US', 'united kingdom': 'GB', 'uk': 'GB', 'canada': 'CA', 'australia': 'AU',
    'germany': 'DE', 'france': 'FR', 'netherlands': 'NL', 'ireland': 'IE', 'spain': 'ES', 'portugal': 'PT', 'poland': 'PL',
    'switzerland': 'CH', 'sweden': 'SE', 'norway': 'NO', 'denmark': 'DK', 'finland': 'FI', 'italy': 'IT', 'belgium': 'BE', 'austria': 'AT',
    'singapore': 'SG', 'united arab emirates': 'AE', 'uae': 'AE', 'saudi arabia': 'SA', 'qatar': 'QA', 'oman': 'OM', 'kuwait': 'KW', 'bahrain': 'BH',
    'philippines': 'PH', 'pakistan': 'PK', 'bangladesh': 'BD', 'sri lanka': 'LK', 'nepal': 'NP', 'brazil': 'BR', 'mexico': 'MX',
    'south africa': 'ZA', 'nigeria': 'NG', 'kenya': 'KE', 'egypt': 'EG', 'indonesia': 'ID', 'malaysia': 'MY', 'vietnam': 'VN', 'japan': 'JP',
    'new zealand': 'NZ', 'argentina': 'AR', 'colombia': 'CO', 'chile': 'CL', 'turkey': 'TR', 'israel': 'IL', 'china': 'CN', 'south korea': 'KR',
}
OPEN_REMOTE = r'anywhere|worldwide|global|apac|asia'
RELOCATION = r'visa sponsorship|sponsorship (is )?available|relocation (assistance|support|package|provided)|will sponsor'
# Every field written is bounded; control characters are removed (a NUL byte would abort the whole import).
LIMITS = {'url': 2000, 'apply_url': 2000, 'title': 300, 'company': 200, 'location': 300, 'description': 6000, 'salary_summary': 300,
          'employment_type': 40, 'salary_currency': 10, 'salary_period': 20, 'ats_type': 40, 'posted_at': 40, 'country_iso': 4}
CTRL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')


def clean(job):
    for k, n in LIMITS.items():
        v = job.get(k)
        if isinstance(v, str):
            job[k] = CTRL.sub(' ', v)[:n]
    return job


D1_WAITS = (5, 20, 60)   # seconds before each retry of a read that failed for a network or server reason
# wrangler's own wording for a failure that may pass on its own: connection problems, timeouts and 5xx-type answers from the API or D1.
TRANSIENT = re.compile(r'ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|fetch failed|network|timed? ?out|'
                       r'\b5\d\d\b|internal (server )?error|bad gateway|service unavailable|gateway time-?out|overloaded|temporarily unavailable|'
                       r'try again|connection (was )?(lost|reset|closed)', re.I)


class D1Error(RuntimeError):
    def __init__(self, message, transient):
        super().__init__(message)
        self.transient = transient


def _d1_once(sql, local):
    where = ['--local', '--persist-to', local] if local else ['--remote']
    try:
        out = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'career-job-engine', *where, '--json', '--command', sql],
                             cwd=DASHBOARD, capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired as e:
        raise D1Error(f'D1 query timed out after {e.timeout} s', True) from e
    text = out.stdout or ''
    if out.returncode != 0 or '[' not in text:
        msg = (out.stderr or text)[-400:]
        raise D1Error(f'D1 query failed: {msg}', bool(TRANSIENT.search(msg)))
    return json.loads(text[text.index('['):])[0]['results']


def d1(sql, local=None, waits=None, sleep=None):
    """Runs one read query on D1 through wrangler and returns the rows. local = a --persist-to path for a local database.
    A failure for a network or 5xx-type reason (or a wrangler timeout) is retried three times, after 5, 20 and 60 s; any other
    failure (an SQL error, a missing token) is raised at once."""
    import time
    waits = D1_WAITS if waits is None else waits
    sleep = sleep or time.sleep
    for attempt in range(len(waits) + 1):
        try:
            return _d1_once(sql, local)
        except D1Error as e:
            if not e.transient or attempt == len(waits):
                raise
            print(f'D1 read failed ({str(e)[:120]}); retrying in {waits[attempt]} s', file=sys.stderr)
            sleep(waits[attempt])


def sql_str(s):
    return "'" + str(s).replace("'", "''") + "'"


def kw_regex(words):
    parts = [re.escape(w.lower()).replace(r'\ ', r'\s+') for w in words if w and w.strip()]
    return '(^|[^a-z0-9])(' + '|'.join(parts) + ')($|[^a-z0-9])' if parts else None


def profiles(local=None):
    rows = d1("SELECT c.id, c.primary_skills, p.search_profile, p.visibility FROM candidates c LEFT JOIN client_profiles p ON p.candidate_id = c.id", local)
    out = {}
    for r in rows:
        if r['id'] in BUILTIN:
            out[r['id']] = dict(BUILTIN[r['id']])
            continue
        try:
            sp = json.loads(r['search_profile'] or 'null')
        except ValueError:
            sp = None
        if not sp or not sp.get('role_keywords'):
            continue
        home = (sp.get('home_country') or 'India').strip().lower()
        role = kw_regex(sp['role_keywords'])
        if not role:
            continue
        out[r['id']] = {
            'role': role, 'exclude': kw_regex(sp.get('avoid_keywords') or []),
            'countries': [COUNTRY_ISO[home]] if home in COUNTRY_ISO else [],   # unknown country: matched by name only
            'mode': sp.get('location_mode') or 'REMOTE_FROM_HOME', 'home': home,
            'keywords': [w for w in sp['role_keywords'] if w], 'public': r.get('visibility') == 'public',
        }
    return out


# What dataset_apply.mjs scores with: skills, years, pay floor, and employers that rejected the candidate before (applications
# marked REJECTED in the dashboard and past applications entered by hand, migration 0016).
CANDIDATES_SQL = """SELECT c.id, c.primary_skills, c.target_roles, c.total_years_experience, c.cash_floor_inr_monthly, c.qualification_threshold, p.search_profile,
  (SELECT json_group_array(json_object('company', x.company, 'on', x.decided_on)) FROM (
     SELECT company, decided_on FROM past_applications WHERE candidate_id = c.id AND outcome = 'REJECTED'
     UNION SELECT j.company, substr(coalesce(a.updated_at, a.created_at), 1, 10) FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE a.candidate_id = c.id AND a.status = 'REJECTED') x) AS rejected_companies
  FROM candidates c LEFT JOIN client_profiles p ON p.candidate_id = c.id"""
BASE_COLS = """url, title, company, ats_type, location, country_iso, lower(coalesce(CAST(is_remote AS VARCHAR), '')) AS remote_flag,
  left(description, 6000) AS description, CAST(posted_at AS VARCHAR) AS posted_at, TRY_CAST(salary_min AS DOUBLE) AS salary_min,
  TRY_CAST(salary_max AS DOUBLE) AS salary_max, salary_currency, salary_period, salary_summary, apply_url, employment_type"""
COMMON = """title IS NOT NULL AND url IS NOT NULL AND company IS NOT NULL
  AND regexp_matches(lower(title), $role) AND ($exclude = '' OR NOT regexp_matches(lower(title), $exclude))
  AND (posted_at IS NULL OR CAST(posted_at AS VARCHAR) >= $since)"""
INSIDE = "(list_contains($countries::VARCHAR[], country_iso) OR regexp_matches(lower(coalesce(location,'')), $home))"
OPEN = f"""(lower(coalesce(CAST(is_remote AS VARCHAR), '')) = 'true' AND (nullif(country_iso, '') IS NULL
  OR regexp_matches(lower(coalesce(location,'')), '{OPEN_REMOTE}')))"""


def select(con, src, p, home_quota, remote_quota, max_days, abroad_quota=300):
    """Two bounded selections per profile: in the home country (remote ones first for a remote-only search), and remote roles
    open to anyone that are not in the home country. Every search value is a bound parameter."""
    params = {'role': p['role'], 'exclude': p.get('exclude') or '', 'countries': p['countries'],
              'home': '(^|[^a-z])' + re.escape(p['home']) + '([^a-z]|$)',
              'since': (datetime.now(timezone.utc) - timedelta(days=max_days)).date().isoformat()}
    remote_first = "CASE WHEN lower(coalesce(CAST(is_remote AS VARCHAR), '')) = 'true' OR regexp_matches(lower(coalesce(location,'')), 'remote') THEN 0 ELSE 1 END," if p['mode'] == 'REMOTE_FROM_HOME' else ''
    rows = []
    quotas = [(INSIDE, remote_first, home_quota), (f'{OPEN} AND NOT {INSIDE}', '', remote_quota)]
    if p.get('worldwide'):   # on-site roles abroad; postings that offer visa sponsorship or relocation come first
        quotas.append((f'NOT {INSIDE} AND NOT {OPEN}', f"CASE WHEN regexp_matches(lower(coalesce(description,'')), '{RELOCATION}') THEN 0 ELSE 1 END,", abroad_quota))
    if p.get('remote_anywhere'):   # remote roles posted in another country (not the United States), newest first
        quotas.append((f"lower(coalesce(CAST(is_remote AS VARCHAR), '')) = 'true' AND NOT {INSIDE} AND NOT {OPEN} AND coalesce(country_iso, '') <> 'US'", '', abroad_quota))
    for where, order, limit in quotas:
        cur = con.execute(f"SELECT {BASE_COLS} FROM read_parquet($src) WHERE {COMMON} AND {where} ORDER BY {order} posted_at DESC NULLS LAST LIMIT {int(limit)}",
                          {**params, 'src': src})
        cols = [d[0] for d in cur.description]
        rows += [dict(zip(cols, r)) for r in cur.fetchall()]
    for r in rows:   # true, false, or unknown (most postings do not say)
        r['location'] = from_count(r.get('location'), r.get('url'))   # plan B2: 'Berlin; +7 more' instead of '8 Locations' (Workday)
        flag = r.pop('remote_flag')
        r['is_remote'] = True if flag == 'true' else False if flag == 'false' else None
    return rows


def job_id(ats, url):
    return f"ds:{ats or 'ats'}:{hashlib.sha1(url.encode()).hexdigest()[:20]}"


def adapter(s):
    return re.sub(r'[^a-z]', '', str(s or 'ats').lower())[:20] or 'ats'


def norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', str(s or '').lower()).strip()


def chunks(xs, n):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def existing(jobs, local=None):
    """Ids (with is_active), URLs and active (company, title, location) rows already in D1, so nothing is inserted twice. `stored` maps an
    active (company, title) pair to its rows (id, location, workplace) for the many-cities rule (plan B3)."""
    ids, urls = {}, set()
    for part in chunks(jobs, 150):
        id_list = json.dumps([j['id'] for j in part])
        url_list = json.dumps([j['url'] for j in part])
        for r in d1(f"SELECT id, is_active, source_channel FROM jobs WHERE id IN (SELECT value FROM json_each({sql_str(id_list)}))", local):
            ids[r['id']] = r
        for r in d1(f"SELECT source_url u FROM jobs WHERE source_url IN (SELECT value FROM json_each({sql_str(url_list)})) "
                    f"UNION SELECT original_posting_url FROM jobs WHERE original_posting_url IN (SELECT value FROM json_each({sql_str(url_list)}))", local):
            urls.add(r['u'])
    # Employer, title AND stated location: the same role in another city is a different opening (owner rule: only exact duplicates collapse),
    # unless its text is the same but for the city (plan B3, split_new()).
    pairs, stored = set(), {}
    for r in d1("SELECT id, company c, title t, location_restrictions l, workplace_type w FROM jobs WHERE is_active = 1", local):
        pairs.add((norm(r['c']), norm(r['t']), norm(r['l'])))
        stored.setdefault((norm(r['c']), norm(r['t'])), []).append(r)
    closed = {(norm(r['c']), norm(r['t'])) for r in d1("SELECT company c, title t FROM jobs WHERE is_active = 0 AND expired_at >= datetime('now', '-180 days')", local)}
    return ids, urls, pairs, closed, stored


SAME_TEXT_MIN = 200   # characters of description needed to call two postings the same job (shorter texts are never merged)


def _text(desc, *locations):
    """A posting's text with its places taken out, for the many-cities test: lower case, words only, the words of both locations removed."""
    import html
    words = norm(re.sub(r'<[^>]*>', ' ', html.unescape(str(desc or '')))).split()
    drop = {w for loc in locations for w in norm(loc).split()}
    return ' '.join(w for w in words if w not in drop)[:3000]


def _country(location):
    """The country a location names: a trailing '(Country)' (multi_place.places_text) or the last comma part of its first place; None for a bare city."""
    loc = str(location or '')
    m = re.search(r'\(([^)]*)\)\s*$', loc)
    if m:
        return norm(m.group(1))
    parts = [p.strip() for p in loc.split(';')[0].split(',') if p.strip()]
    return norm(parts[-1]) if len(parts) >= 2 else None


def _remote(loc, flag=None, workplace=None):
    return flag is True or bool(re.search(r'remote', str(loc or ''), re.I)) or str(workplace or '').upper().startswith('REMOTE')


def same_job_other_city(a_loc, a_desc, a_remote, b_loc, b_desc, b_remote):
    """Plan B3: two postings of one employer and title differ only by city when their places differ, both are remote or both are not, they
    name no different country, and their texts (200 characters or more) are the same once each one's places are taken out."""
    if norm(a_loc) == norm(b_loc) or a_remote != b_remote:
        return False
    ca, cb = _country(a_loc), _country(b_loc)
    if ca and cb and ca != cb:
        return False
    ta, tb = _text(a_desc, a_loc, b_loc), _text(b_desc, a_loc, b_loc)
    return len(ta) >= SAME_TEXT_MIN and ta == tb


def _descriptions(ids, local=None):
    out = {}
    for part in chunks(sorted(ids), 150):
        for r in d1(f"SELECT id, substr(description, 1, 6000) d FROM jobs WHERE id IN (SELECT value FROM json_each({sql_str(json.dumps(part))}))", local):
            out[r['id']] = r['d'] or ''
    return out


def split_new(jobs, local=None, merges=None):
    """New jobs to insert, and earlier dataset jobs that reappeared after being closed (to reopen).
    Plan B3: a new posting with the same employer and title as a stored active one (or an earlier one in this run), differing only by city, is
    stored once: its city is added to the other's location ("Pune; Chennai; +3 more"). For a stored row the change is appended to `merges`
    ('stored': [{id, old, new}], dataset_apply.mjs writes it, guarded); stored duplicates are not merged with each other."""
    seen, unique = set(), []
    for j in jobs:   # duplicates inside one run (same company, title and location)
        k = (norm(j['company']), norm(j['title']), norm(j.get('location')))
        if k not in seen:
            seen.add(k); unique.append(j)
    ids, urls, pairs, closed, stored = existing(unique, local) if unique else ({}, set(), set(), set(), {})
    reopen = [j['id'] for j in unique if j['id'] in ids and not ids[j['id']]['is_active'] and ids[j['id']]['source_channel'] == SOURCE_CHANNEL]
    fresh = [j for j in unique if j['id'] not in ids and j['url'] not in urls and (norm(j['company']), norm(j['title']), norm(j.get('location'))) not in pairs]
    # Plan B3, against stored rows: read the text of only the stored rows that share an employer and title with a new posting.
    want = {r.get('id') for j in fresh for r in stored.get((norm(j['company']), norm(j['title'])), []) if r.get('id')}
    texts = _descriptions(want, local) if want else {}
    changed, kept, merged = {}, [], 0
    for j in fresh:
        jr = _remote(j.get('location'), j.get('is_remote'))
        host = next((r for r in stored.get((norm(j['company']), norm(j['title'])), [])
                     if r.get('id') and same_job_other_city(changed.get(r['id'], r['l']), texts.get(r['id'], ''), _remote(r['l'], None, r.get('w')),
                                            j.get('location'), j.get('description'), jr)), None)
        if host:
            now = changed.get(host['id'], host['l'])
            changed[host['id']] = merge_places(now, j.get('location'))
            merged += 1
            continue
        twin = next((k for k in kept if norm(k['company']) == norm(j['company']) and norm(k['title']) == norm(j['title'])
                     and same_job_other_city(k.get('location'), k.get('description'), _remote(k.get('location'), k.get('is_remote')),
                                             j.get('location'), j.get('description'), jr)), None)
        if twin:   # the same job twice in this run: one row, both cities
            twin['location'] = merge_places(twin.get('location'), j.get('location'))
            merged += 1
            continue
        kept.append(j)
    fresh = kept
    if merges is not None:   # {'stored': [{id, old, new}], 'merged': n}
        old = {r.get('id'): r['l'] for rows in stored.values() for r in rows}
        merges.setdefault('stored', []).extend({'id': i, 'old': old[i], 'new': loc} for i, loc in changed.items() if (loc or '') != (old[i] or ''))
        merges['merged'] = merges.get('merged', 0) + merged
    for j in fresh:   # the same role closed within the last 180 days and is back under a new id
        if (norm(j['company']), norm(j['title'])) in closed:
            j['repost'] = True
    return fresh, reopen, len(jobs) - len(unique)


def closures(con, src, manifest, local=None):
    """Two-run closure with a per-ATS health check. Returns (close, mark_missing, clear_missing, counts_to_store)."""
    counts = {adapter(k): int(v.get('rows') or 0) for k, v in (manifest.get('by_ats') or {}).items()}
    prev = {}
    for r in d1("SELECT value FROM discovery_state WHERE key = 'ats_counts'", local):
        try:
            prev = json.loads(r['value'])
        except ValueError:
            prev = {}
    healthy = {a for a, n in counts.items() if prev.get(a) and n >= HEALTHY_RATIO * prev[a]}
    tracked = d1(f"SELECT id, source_url, source_id FROM jobs WHERE source_channel = '{SOURCE_CHANNEL}' AND is_active = 1", local)
    if not tracked:
        return [], [], [], counts
    con.execute('CREATE OR REPLACE TEMP TABLE tracked(url VARCHAR)')
    con.executemany('INSERT INTO tracked VALUES (?)', [(t['source_url'],) for t in tracked])
    live = {r[0] for r in con.execute('SELECT t.url FROM tracked t JOIN read_parquet($src) d ON d.url = t.url', {'src': src}).fetchall()}
    missing_before = {r['job_id'] for r in d1('SELECT job_id FROM discovery_missing', local)}
    close, mark, clear = [], [], []
    for t in tracked:
        ats = str(t.get('source_id') or '').split(':', 1)[-1]
        if t['source_url'] in live:
            if t['id'] in missing_before:
                clear.append(t['id'])
        elif ats in healthy:
            (close if t['id'] in missing_before else mark).append(t['id'])
    return close, mark, clear, counts


MANIFEST_MAX_AGE_HOURS = 48


def load_manifest(tries=3, wait=10, sleep=None):
    """The dataset's manifest (snapshot time and size). Three tries; None when it cannot be read."""
    import time
    import urllib.request
    sleep = sleep or time.sleep
    for n in range(tries):
        try:
            req = urllib.request.Request(MANIFEST, headers={'User-Agent': 'career-job-engine/1.0'})
            return json.load(urllib.request.urlopen(req, timeout=60))
        except Exception as e:   # network, HTTP or JSON error
            print(f'manifest read failed ({type(e).__name__}); try {n + 1} of {tries}', file=sys.stderr)
            if n + 1 < tries:
                sleep(wait)
    return None


def manifest_age_hours(manifest, now=None):
    """Hours since the snapshot was generated, or None when the manifest or its time is missing."""
    try:
        t = datetime.fromisoformat(str((manifest or {}).get('generated_at')).replace('Z', '+00:00'))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return ((now or datetime.now(timezone.utc)) - t).total_seconds() / 3600
    except (TypeError, ValueError):
        return None


def write_context(out, local, rescore_export, rescore_per_candidate):
    """What the later steps need whatever happens to the dataset: candidates, search profiles, rows to re-score and taste rows."""
    profs = profiles(local)
    (out / 'candidates.json').write_text(json.dumps(d1(CANDIDATES_SQL, local)))
    (out / 'profiles.json').write_text(json.dumps(profs))
    if rescore_export:
        (out / 'rescore.json').write_text(json.dumps(rescore_rows(local, per_candidate=rescore_per_candidate)))
    (out / 'taste_rows.json').write_text(json.dumps(taste_rows(local)))
    (out / 'taste_targets.json').write_text(json.dumps(taste_targets(local)))
    return profs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--dataset', default=DATASET, help='a downloaded copy of all.parquet (the workflow downloads it once per run)')
    ap.add_argument('--d1-local', default=None, help='a local wrangler --persist-to path instead of the remote database')
    ap.add_argument('--home-quota', type=int, default=400)
    ap.add_argument('--remote-quota', type=int, default=200)
    ap.add_argument('--abroad-quota', type=int, default=300)
    ap.add_argument('--max-days', type=int, default=45)
    ap.add_argument('--rescore-export', action='store_true', help='also export preliminary rows not yet scored with the current profile and rules')
    ap.add_argument('--rescore-per-candidate', type=int, default=1500, help='most rows re-scored per person per run (bounds the writes)')
    ap.add_argument('--dedupe', default=None, help='only de-duplicate a job-site result file against D1')
    ap.add_argument('--profiles-only', action='store_true', help='only write candidates.json, profiles.json and taste_rows.json (watchlist runs)')
    ap.add_argument('--shortlist-pool', default=None, help='only export the shortlist pool to this file (plan A1; after the import, before the still-open check)')
    ap.add_argument('--pool-per-candidate', type=int, default=300)
    ap.add_argument('--no-name-lookup', action='store_true', help='use only the known employer names; open no career site (plan B1)')
    ap.add_argument('--no-dataset', action='store_true', help='the dataset download failed: write everything the later steps need and an empty matches.json')
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    if a.shortlist_pool:
        print(json.dumps(write_pool(Path(a.shortlist_pool), a.d1_local, a.pool_per_candidate)))
        return 0
    if a.profiles_only:
        profs = profiles(a.d1_local)
        (out / 'candidates.json').write_text(json.dumps(d1(CANDIDATES_SQL, a.d1_local)))
        (out / 'profiles.json').write_text(json.dumps(profs))
        (out / 'taste_rows.json').write_text(json.dumps(taste_rows(a.d1_local)))
        print(json.dumps({'profiles': len(profs)}))
        return 0
    if a.dedupe:
        raw = json.loads(Path(a.dedupe).read_text())
        jobs = [clean(j) for j in raw.get('jobs', [])]
        names = name_jobs(jobs, None if a.no_name_lookup else http_fetch())   # plan B1: employer names before the duplicate test
        merges = {}
        fresh, _, dup = split_new(jobs, a.d1_local, merges)
        (out / 'jobsite_matches.json').write_text(json.dumps({'source': 'job_sites', 'jobs': fresh, 'closed': [], 'merge': merges.get('stored', [])}, default=str))
        print(json.dumps({'job_sites_selected': len(raw.get('jobs', [])), 'duplicates_in_run': dup, 'new': len(fresh), 'employer_names': names,
                          'same_job_other_city': merges.get('merged', 0)}))
        return 0
    if a.no_dataset:
        # The 2.3 GB download failed: the boards, other sources, re-score, still-open check and shortlist still run today.
        write_context(out, a.d1_local, a.rescore_export, a.rescore_per_candidate)
        report = {'dataset': 'download_failed', 'new': 0, 'selected': 0, 'close': 0}
        (out / 'matches.json').write_text(json.dumps({'source': 'ats_dataset', 'snapshot': None, 'jobs': [], 'closed': []}))
        (out / 'report.json').write_text(json.dumps(report, indent=1))
        print('::warning::The dataset download failed; continuing without it (boards, other sources, re-score, still-open check and shortlist still run).')
        print(json.dumps(report))
        return 0
    import duckdb
    manifest = load_manifest() or {}
    total = manifest.get('stats', {}).get('total_jobs', 0)
    age = manifest_age_hours(manifest)
    stale = age is not None and age > MANIFEST_MAX_AGE_HOURS
    if stale:
        # The same old snapshot read twice is not two observations, so nothing is closed or marked missing from it. The run goes on;
        # the workflow's last step fails it, so the stale dataset is seen.
        (out / 'dataset_stale.txt').write_text(f'{manifest.get("generated_at")} ({age:.0f} h old)\n')
        print(f'::error::The dataset snapshot is {age:.0f} hours old (generated {manifest.get("generated_at")}); over {MANIFEST_MAX_AGE_HOURS} h. No closures from it.')
    elif age is None:
        print('::warning::The dataset manifest could not be read; no closures this run.')
    con = duckdb.connect()
    if a.dataset.startswith('http'):
        con.execute('INSTALL httpfs; LOAD httpfs;')
    profs = write_context(out, a.d1_local, a.rescore_export, a.rescore_per_candidate)
    found = {}
    for cid, p in profs.items():
        for r in select(con, a.dataset, p, a.home_quota, a.remote_quota, a.max_days, a.abroad_quota):
            jid = job_id(r['ats_type'], r['url'])
            j = found.setdefault(jid, {**clean(r), 'id': jid, 'candidates': [], 'public': False})
            if cid not in j['candidates']:
                j['candidates'].append(cid)
            j['public'] = j['public'] or bool(p.get('public'))
    jobs = [j for j in found.values() if len(j['url']) < LIMITS['url']]
    # Plan B1: the employer's name, not its hiring-system tenant id, before the duplicate test (so caps and dedupe see the display name).
    names = name_jobs(jobs, None if a.no_name_lookup else http_fetch())
    merges = {}
    fresh, reopen, dup = split_new(jobs, a.d1_local, merges)
    # A partial snapshot must not close real jobs: no closures at all unless the snapshot has its usual size.
    close, mark, clear, counts = closures(con, a.dataset, manifest, a.d1_local) if total >= 1_000_000 and not stale else ([], [], [], {})
    report = {'snapshot': manifest.get('generated_at'), 'snapshot_age_hours': None if age is None else round(age, 1), 'stale': stale, 'dataset_jobs': total, 'profiles': len(profs), 'selected': len(jobs),
              'duplicates_in_run': dup, 'already_stored': len(jobs) - dup - len(fresh), 'new': len(fresh), 'reopen': len(reopen),
              'close': len(close), 'missing_first_time': len(mark), 'missing_cleared': len(clear), 'employer_names': names,
              'same_job_other_city': merges.get('merged', 0)}
    (out / 'matches.json').write_text(json.dumps({'source': 'ats_dataset', 'snapshot': manifest.get('generated_at'), 'jobs': fresh, 'closed': close,
                                                  'reopen': reopen, 'missing_mark': mark, 'missing_clear': clear, 'ats_counts': counts,
                                                  'merge': merges.get('stored', [])}, default=str))
    (out / 'report.json').write_text(json.dumps(report, indent=1))
    print(json.dumps(report))
    return 0


def taste_rows(local=None):
    """The operator's own decisions, for the taste model (engine/signals.py): title and company only, with a label."""
    return d1("""SELECT a.candidate_id, j.title, j.company, a.status AS label FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE a.status IN ('SAVED','APPLIED','SUBMITTED','INTERVIEWING','OFFER')
      UNION ALL SELECT q.candidate_id, j.title, j.company, q.manual_override_status FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id
      WHERE q.manual_override_status IN ('READY','STRETCH_READY','INELIGIBLE','HOLD','CLOSED')
      UNION ALL SELECT f.candidate_id, j.title, j.company, CASE f.rating WHEN 'UP' THEN 'GOOD_MATCH' ELSE 'NOT_FOR_ME' END FROM job_feedback f JOIN jobs j ON j.id = f.job_id
      LIMIT 4000""", local)


def taste_targets(local=None, per_candidate=400):
    """The rows a person actually looks at (best-ranked undecided To review / Hold rows and the automatic shortlist), for the daily taste pass
    in dataset_apply.mjs: the learned taste is re-applied to them every run, not only to new jobs."""
    rows = []
    for c in d1("SELECT id FROM candidates ORDER BY id", local):
        rows += d1(f"""SELECT q.candidate_id, q.job_id, j.title, j.company, s.overall_score AS score, s.score_breakdown, q.qualification_reason AS reason
          FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id JOIN candidate_job_scores s ON s.candidate_id = q.candidate_id AND s.job_id = q.job_id
          WHERE q.candidate_id = {sql_str(c['id'])} AND j.is_active = 1 AND q.manual_override_status IS NULL
            AND COALESCE(q.qualification_reason, '') NOT LIKE 'You marked%'   -- a job the person hid (plan U2) is theirs, not the taste pass's
            AND (q.qualification_status IN ('NEEDS_REVIEW','HOLD') OR q.qualification_reason LIKE 'Shortlisted automatically.%')
            AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = q.candidate_id AND a.job_id = q.job_id)
          ORDER BY s.overall_score DESC, q.job_id LIMIT {int(per_candidate)}""", local)
    return rows


def rescore_rows(local=None, page=400, per_candidate=1500):
    """Preliminary rows that no person has decided on and that were not yet scored with the CURRENT profile and rules (RULES_MARKER),
    for candidates that have skills to score with. At most `per_candidate` rows each, best-ranked first, so one run writes a bounded
    number of rows (writes are the tight free-tier limit) and the queue a person actually reads is corrected first; the rest follow on
    the next runs. Paged by the last (score, job) seen, never by OFFSET (OFFSET re-reads every earlier page)."""
    rows = []
    cands = [r['id'] for r in d1("SELECT id FROM candidates WHERE primary_skills IS NOT NULL AND trim(primary_skills) NOT IN ('', '[]', 'null') ORDER BY id", local)]
    for cid in cands:
        taken, last = 0, None
        while taken < per_candidate:
            after = f"AND (s.overall_score < {int(last[0])} OR (s.overall_score = {int(last[0])} AND q.job_id > {sql_str(last[1])}))" if last else ''
            part = d1(f"""SELECT q.candidate_id, q.job_id, s.overall_score AS cur_score, j.title, j.company, j.salary_min, j.salary_max, j.salary_currency, j.salary_period, j.location_restrictions AS location, j.description, j.workplace_type, j.source_adapter, j.provenance, s.score_breakdown
              FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id JOIN candidate_job_scores s ON s.candidate_id = q.candidate_id AND s.job_id = q.job_id
              WHERE q.candidate_id = {sql_str(cid)} AND j.is_active = 1 AND q.manual_override_status IS NULL
                AND COALESCE(q.qualification_reason, '') NOT LIKE 'You marked%'   -- hidden by the person (plan U2): never re-scored
                AND (q.qualification_status IN ('NEEDS_REVIEW','HOLD') OR q.qualification_reason LIKE 'Shortlisted automatically.%'   -- the shortlist is re-scored too, so new rules never empty it for a day
                     OR (q.qualification_status = 'INELIGIBLE' AND q.eligibility_reason LIKE 'Hybrid or set office days%'))   -- the office-days reading (plan S8) is re-checked at each rules bump
                AND s.score_breakdown LIKE '%preliminary%' AND s.score_breakdown NOT LIKE '%"{RULES_MARKER}":true%'
                AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = q.candidate_id AND a.job_id = q.job_id) {after}
              ORDER BY s.overall_score DESC, q.job_id LIMIT {int(min(page, per_candidate - taken))}""", local)
            rows += part
            taken += len(part)
            if len(part) < min(page, per_candidate - taken + len(part)):
                break
            last = (part[-1]['cur_score'], part[-1]['job_id'])
    return rows + legacy_rows(cands, local)


# ---- Shortlist pool (plan phase 3, A1) ------------------------------------------------------------------------------------------
# The automatic shortlist is chosen by dashboard/scripts/shortlist_select.mjs from this export, not by SQL inside the database. The pool is every
# row that passes the shortlist conditions EXCEPT "verified open in the last 4 days" (the still-open check that follows verifies the pool first,
# and the selector then keeps only rows verified in 4 days), plus every row on the automatic shortlist now, whatever it scores (so the selector
# can move or demote it). Rows a person decided on, or applied to, are never in the pool; their employer and title are exported as "held", so the
# selector does not shortlist a twin of them.
SHORTLIST_MARK = 'Shortlisted automatically. '
POOL_COLS = """q.candidate_id, j.id AS job_id, j.title, j.company, j.location_restrictions AS location, j.workplace_type AS workplace,
  j.source_adapter AS source, j.provenance, j.discovered_at, j.last_verified_at, j.is_active AS active,
  CASE WHEN j.original_posting_url LIKE 'https://%' THEN j.original_posting_url ELSE j.source_url END AS url,
  substr(COALESCE(j.description, ''), 1, 2000) AS description,
  COALESCE(s.overall_score, 0) AS score, COALESCE(s.skill_score, 0) AS skill_score, q.eligibility_status AS eligibility,
  q.qualification_status AS status, q.qualification_reason AS reason, c.qualification_threshold AS threshold,
  CASE WHEN s.score_breakdown LIKE '%"target_exact":true%' THEN 1 ELSE 0 END AS target_exact"""
POOL_FROM = """FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id JOIN candidates c ON c.id = q.candidate_id
  LEFT JOIN candidate_job_scores s ON s.candidate_id = q.candidate_id AND s.job_id = q.job_id"""
POOL_FREE = "q.manual_override_status IS NULL AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = q.candidate_id AND a.job_id = q.job_id)"


def shortlist_pool(local=None, per_candidate=300):
    """Rows the shortlist selector chooses from, per candidate (plan A1):
      kind 'auto'  every row on the automatic shortlist now (marked by its reason), no override and no application, whatever its state;
      kind 'pool'  undecided rows (To review) that pass every shortlist condition except the 4-day verification: active, scored under the
                   current rules, two matched skills or a title that is exactly a target role, and the Ready or Stretch score and eligibility
                   rule; best score first, at most `per_candidate`;
      kind 'held'  rows on Ready / Stretch that are not ours to move (a person's decision, an application, the first import): employer and
                   title only, for the one-posting-per-employer-and-title rule.
    `marked` says whether the row was scored under the current rules (RULES_MARKER)."""
    marked = f"CASE WHEN s.score_breakdown LIKE '%\"{RULES_MARKER}\":true%' THEN 1 ELSE 0 END AS marked"
    auto = f"q.qualification_status IN ('READY','STRETCH_READY') AND COALESCE(q.qualification_reason, '') LIKE {sql_str(SHORTLIST_MARK + '%')}"
    fits = """((s.overall_score >= c.qualification_threshold AND q.eligibility_status IN ('ELIGIBLE','UNKNOWN'))
              OR (q.eligibility_status = 'ELIGIBLE' AND s.overall_score >= c.qualification_threshold - 10))"""
    rows = []
    for c in d1("SELECT id FROM candidates ORDER BY id", local):
        cid = sql_str(c['id'])
        rows += [{**r, 'kind': 'auto'} for r in d1(f"""SELECT {POOL_COLS}, {marked} {POOL_FROM}
          WHERE q.candidate_id = {cid} AND {auto} AND {POOL_FREE} ORDER BY q.job_id""", local)]
        rows += [{**r, 'kind': 'pool'} for r in d1(f"""SELECT {POOL_COLS}, 1 AS marked {POOL_FROM}
          WHERE q.candidate_id = {cid} AND q.qualification_status = 'NEEDS_REVIEW' AND {POOL_FREE} AND j.is_active = 1
            AND s.score_breakdown LIKE '%"{RULES_MARKER}":true%'
            AND (s.skill_score >= 40 OR s.score_breakdown LIKE '%"target_exact":true%') AND {fits}
          ORDER BY s.overall_score DESC, q.job_id LIMIT {int(per_candidate)}""", local)]
        rows += [{**r, 'kind': 'held'} for r in d1(f"""SELECT q.candidate_id, j.id AS job_id, j.title, j.company, j.location_restrictions AS location, j.workplace_type AS workplace,
            q.qualification_status AS status
          FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id
          WHERE q.candidate_id = {cid} AND q.qualification_status IN ('READY','READY_HIGH','STRETCH_READY')
            AND NOT ({auto} AND {POOL_FREE}) ORDER BY q.job_id""", local)]
    return rows


def write_pool(path, local=None, per_candidate=300):
    """Writes the pool atomically (a temporary file renamed into place), so a failed export never leaves a partial pool for the selector."""
    rows = shortlist_pool(local, per_candidate)
    tmp = Path(str(path) + '.tmp')
    tmp.write_text(json.dumps({'generated_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'rows': rows}))
    tmp.replace(path)
    kinds = {}
    for r in rows:
        key = f"{r['candidate_id']}:{r['kind']}"
        kinds[key] = kinds.get(key, 0) + 1
    return kinds


def legacy_rows(cands, local=None, page=300, per_candidate=1000):
    """Undecided rows the CURRENT screen never scored: still NEEDS_REVIEW, score 0 (or no score row), no 'preliminary' breakdown, not a collector
    import waiting for the Worker. They came from the first import (reason 'Preserved verified ... status') and neither the Worker's
    assessment (which looks for the collector reason) nor the re-score above (which looks for a preliminary breakdown) ever selects them, so
    they sat in "to review" with no score. Exported with legacy = 1 so dataset_apply.mjs screens them fully (status, lane, score).
    Paged by job id through the primary key, a bounded number per person per run. Never a row with an override or an application."""
    rows = []
    for cid in cands:
        taken, last = 0, ''
        while taken < per_candidate:
            part = d1(f"""SELECT q.candidate_id, q.job_id, 0 AS cur_score, j.title, j.company, j.salary_min, j.salary_max, j.salary_currency, j.salary_period, j.location_restrictions AS location,
                j.description, j.workplace_type, s.score_breakdown, j.provenance, j.source_adapter, 1 AS legacy
              FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id LEFT JOIN candidate_job_scores s ON s.candidate_id = q.candidate_id AND s.job_id = q.job_id
              WHERE q.candidate_id = {sql_str(cid)} AND q.job_id > {sql_str(last)} AND j.is_active = 1 AND q.manual_override_status IS NULL
                AND (s.score_breakdown IS NULL OR s.score_breakdown NOT LIKE '%preliminary%')
                AND ((q.qualification_status = 'NEEDS_REVIEW' AND COALESCE(s.overall_score, 0) = 0)
                     OR q.qualification_status IN ('READY', 'READY_HIGH', 'STRETCH_READY'))   -- first-import shortlist rows: set by the old engine, never re-checked
                AND COALESCE(q.qualification_reason, '') NOT LIKE '[GITHUB_COLLECTOR] Unassessed%'
                AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = q.candidate_id AND a.job_id = q.job_id)
              ORDER BY q.job_id LIMIT {int(min(page, per_candidate - taken))}""", local)
            rows += part
            taken += len(part)
            if len(part) < min(page, per_candidate - taken + len(part)):
                break
            last = part[-1]['job_id']
    return rows


if __name__ == '__main__':
    sys.exit(main())
