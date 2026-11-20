"""Daily job discovery over an open dataset of live ATS postings.

Source: the ats-scrapers "jobhive" dataset (MIT, https://github.com/kalil0321/ats-scrapers), a daily snapshot of about
5 million live postings from about 80,000 employers across 64 applicant-tracking systems (Greenhouse, Lever, Ashby,
Workday, SmartRecruiters, ...). The workflow downloads the parquet file once per run; DuckDB then queries it locally.

What this does (no candidate data is ever written to the repository):
  1. reads every candidate's search profile from D1 (the two built-in candidates use focused title searches that are subsets
     of the Worker's role rules; resold clients use their stored role keywords and location rule);
  2. selects postings per profile (wide intake): every posting whose title passes the person's role rule, in any country, is pre-scored on the
     runner with the Worker's own screen (dashboard/scripts/prescore.mjs), and every one that can plausibly fit (not ruled out by the person's
     place rules, scoring near or above their threshold) is selected, best fit first, within a cap set by the D1 read budget; bounded quotas per
     place are the fallback when the pre-score cannot run;
  3. drops duplicates within the run and postings already in D1 (same id, same URL, or the same company and title active),
     and lists earlier jobs that reappeared after being closed (to reopen them);
  4. closes nothing on its own: a job this pipeline added is closed only after it is missing from two consecutive snapshots
     AND its ATS's row count is within 10% of the previous run (so one scraper failing for a day closes nothing);
  5. writes matches.json for dataset_apply.mjs, which scores everything with the Worker's own evaluate() and writes SQL.

Search values (keywords, home country) are always passed to DuckDB as bound parameters, never pasted into SQL.

Usage:
  python engine/dataset_discovery.py --out work/ [--dataset work/all.parquet] [--d1-local PATH] [--select-read-budget 150000] [--no-prescore]
  python engine/dataset_discovery.py --dedupe work/jobsite_raw.json --out work/   (job-site results: duplicates against D1)
"""
import argparse
import time
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:   # run as a script (engine/ on sys.path) or as part of the engine package (tests)
    from company_names import display_company, http_fetch, name_jobs
    from multi_place import from_count, merge_places, place_listed
except ImportError:   # pragma: no cover
    from engine.company_names import display_company, http_fetch, name_jobs
    from engine.multi_place import from_count, merge_places, place_listed

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
def _worker_source():
    return (DASHBOARD / 'worker' / 'discovery.ts').read_text()


def india_place_words(src=None):
    """The Worker's own Indian places (INDIA_PLACE in dashboard/worker/discovery.ts: the country, states, cities and plant towns), read from its one
    definition so the selection and the screen never disagree (wide intake). dashboard/test/place_lists.test.mjs checks the same cases on both sides."""
    src = src or _worker_source()
    m = re.search(r"const INDIA_PLACE=new RegExp\('\\\\b\(\?:'\+\[(.*?)\]\.join\('\|'\)", src, re.S)
    if not m:
        raise RuntimeError('INDIA_PLACE not found in dashboard/worker/discovery.ts')
    return re.findall(r"'([^']+)'", m.group(1))


def gulf_place_source(src=None):
    """The Worker's GULF_PLACE alternation (place names, lower case), read from discovery.ts."""
    src = src or _worker_source()
    m = re.search(r"const GULF_PLACE=/\\b\((.*?)\)\\b/i", src)
    if not m:
        raise RuntimeError('GULF_PLACE not found in dashboard/worker/discovery.ts')
    return m.group(1)


# DuckDB (RE2) forms of the Worker's place tests, on lower(location): an Indian place, or the country code IN at the end ("Pithampur, IN"), as
# sanaIndiaCity() does; a Gulf place name, or a Gulf country code at the end ("Ruwais, AE"), as gulfPlace() does. Only the fallback selection
# (select_quota) uses them; the wide selection takes the place band from the Worker itself (scripts/prescore.mjs).
INDIA_LOC = '(^|[^a-z])(' + '|'.join(re.escape(w).replace(r'\ ', ' ') for w in india_place_words()) + r')([^a-z]|$)|(^|, )in$'
GULF_LOC = r'(^|[^a-z])(' + gulf_place_source() + r')([^a-z]|$)'
GULF_ISO = ['AE', 'SA', 'QA', 'OM', 'KW', 'BH']
INSIDE = ("(list_contains($countries::VARCHAR[], country_iso) OR regexp_matches(lower(coalesce(location,'')), $home)"
          " OR ($home_is_india AND regexp_matches(lower(coalesce(location,'')), $india_loc)))")
OPEN = f"""(lower(coalesce(CAST(is_remote AS VARCHAR), '')) = 'true' AND (nullif(country_iso, '') IS NULL
  OR regexp_matches(lower(coalesce(location,'')), '{OPEN_REMOTE}')))"""
GULF = f"(list_contains({GULF_ISO!r}::VARCHAR[], country_iso) OR regexp_matches(lower(coalesce(location,'')), $gulf_loc) OR regexp_matches(coalesce(location,''), ',\\s*(AE|QA|OM|KW|BH)\\s*$'))"
# Undated rows (all of KBR's Workday Gulf postings, for one) are live postings in today's snapshot: they sort as if posted today, not last.
NEWEST = "coalesce(CAST(posted_at AS VARCHAR), $today) DESC"


def _params(p, max_days):
    now = datetime.now(timezone.utc)
    return {'role': p['role'], 'exclude': p.get('exclude') or '', 'countries': p['countries'],
            'home': '(^|[^a-z])' + re.escape(p['home']) + '([^a-z]|$)', 'home_is_india': p.get('home') == 'india',
            'india_loc': INDIA_LOC, 'since': (now - timedelta(days=max_days)).date().isoformat()}


def _finish(rows):
    for r in rows:   # true, false, or unknown (most postings do not say)
        r['location'] = from_count(r.get('location'), r.get('url'))   # plan B2: 'Berlin; +7 more' instead of '8 Locations' (Workday)
        flag = r.pop('remote_flag')
        r['is_remote'] = True if flag == 'true' else False if flag == 'false' else None
    return rows


def select_quota(con, src, p, home_quota, remote_quota, max_days, abroad_quota=300, gulf_quota=150):
    """The fallback selection (used only when the wide pre-score cannot run): bounded quotas per place, newest first with undated rows treated as
    today's. In the home country (an Indian place by the Worker's list counts as India; remote ones first for a remote-only search), remote roles open
    to anyone, and for a worldwide search the Gulf and other places abroad (postings that offer visa sponsorship or relocation first)."""
    params = {**_params(p, max_days), 'today': datetime.now(timezone.utc).date().isoformat()}
    remote_first = "CASE WHEN lower(coalesce(CAST(is_remote AS VARCHAR), '')) = 'true' OR regexp_matches(lower(coalesce(location,'')), 'remote') THEN 0 ELSE 1 END," if p['mode'] == 'REMOTE_FROM_HOME' else ''
    reloc = f"CASE WHEN regexp_matches(lower(coalesce(description,'')), '{RELOCATION}') THEN 0 ELSE 1 END,"
    quotas = [(INSIDE, remote_first, home_quota, {}), (f'{OPEN} AND NOT {INSIDE}', '', remote_quota, {})]
    if p.get('worldwide'):
        quotas.append((f'NOT {INSIDE} AND {GULF} AND NOT {OPEN}', reloc, gulf_quota, {'gulf_loc': GULF_LOC}))
        quotas.append((f'NOT {INSIDE} AND NOT {OPEN} AND NOT {GULF}', reloc, abroad_quota, {'gulf_loc': GULF_LOC}))
    if p.get('remote_anywhere'):   # remote roles posted in another country (not the United States)
        quotas.append((f"lower(coalesce(CAST(is_remote AS VARCHAR), '')) = 'true' AND NOT {INSIDE} AND NOT {OPEN} AND coalesce(country_iso, '') <> 'US'", '', abroad_quota, {}))
    rows = []
    for where, order, limit, extra in quotas:
        cur = con.execute(f"SELECT {BASE_COLS} FROM read_parquet($src) WHERE {COMMON} AND {where} ORDER BY {order} {NEWEST} LIMIT {int(limit)}",
                          {**params, **extra, 'src': src})
        cols = [d[0] for d in cur.description]
        rows += [dict(zip(cols, r)) for r in cur.fetchall()]
    return _finish(rows)


select = select_quota   # the name earlier callers and notes use


# ---- Wide intake (14 Nov 2026) ---------------------------------------------------------------------------------------------------------------
# Every posting in the snapshot whose title passes a person's role rule (any country, any region, dated or not, last max_days) is pre-scored on the
# runner with the Worker's own evaluate() (scripts/prescore.mjs; free compute, no database reads). Each person gets every row that can plausibly fit:
# not ineligible under their place rules and scoring near or above their threshold, best fit first. No place is filtered out before the score: the
# person's own place rules decide (Farhan: remote and workable from India; Sana: India, the Gulf, or abroad with a stated visa route).
# The only cap is the D1 read budget of the duplicate check that follows (split_new: about SELECT_READS_PER_ROW rows read per selected row); the
# writes are bounded by dataset_apply.mjs --max-new, best score first.
SELECT_READS_PER_ROW = 11      # measured on a local D1 (miniflare rows_read): existing() id + URL lookups and the many-cities texts, per selected row
SELECT_READ_BUDGET = 150_000   # D1 rows read the daily run may spend on the duplicate check of the dataset selection (about 6% of the run)
FIT_MARGIN = 15                # "near the threshold": a row within this many points below it can still reach the lists after a re-score or taste
LOW_MATCH = 45                 # dataset_apply.mjs moves rows at or below this to Hold: never worth importing
# Place sets filled first, in this order, each up to its share of the person's cap; the rest of the cap goes to the best remaining rows. With the
# default budget the caps rarely bind; the shares only decide what goes first if they do.
PLACE_SETS = {
    'farhan_shaikh': [('india_worldwide_apac', ('remote_global', 'remote'), 0.7)],
    'sana_ansari': [('india', ('india_onsite',), 0.4), ('gulf', ('gulf',), 0.25), ('abroad_with_route', ('abroad_with_route',), 0.15), ('remote', ('remote',), 0.05)],
}


def fit_floor(threshold):
    return max(LOW_MATCH + 1, int(threshold) - FIT_MARGIN)


def candidate_rows(con, src, p, max_days):
    """Every row whose title passes the person's role rule, in any place, posted in the last max_days or undated."""
    cur = con.execute(f"SELECT {BASE_COLS} FROM read_parquet($src) WHERE {COMMON}",
                      {k: v for k, v in {**_params(p, max_days), 'src': src}.items() if k in ('role', 'exclude', 'since', 'src')})
    cols = [d[0] for d in cur.description]
    return _finish([dict(zip(cols, r)) for r in cur.fetchall()])


def node_scorer(work, candidates_file):
    """The pre-score: scripts/prescore.mjs (the Worker's evaluate() and placeBand()) over a JSON-lines file. Returns score(items) -> results."""
    def score(items):
        inp, out = Path(work) / 'prescore_in.jsonl', Path(work) / 'prescore_out.jsonl'
        with inp.open('w') as f:
            for k, (cid, r) in enumerate(items):
                f.write(json.dumps({'k': k, 'cid': cid, **{x: r.get(x) for x in ('title', 'company', 'ats_type', 'location', 'description', 'is_remote', 'url',
                        'salary_min', 'salary_max', 'salary_currency', 'salary_period')}}, default=str) + '\n')
        subprocess.run(['node', '--import', './test/register.mjs', 'scripts/prescore.mjs', '--candidates', str(Path(candidates_file).resolve()),
                        '--in', str(inp.resolve()), '--out', str(out.resolve())], cwd=DASHBOARD, check=True, timeout=1800)
        res = [None] * len(items)
        for line in out.read_text().splitlines():
            if line.strip():
                x = json.loads(line)
                res[x['k']] = x
        inp.unlink(missing_ok=True)
        out.unlink(missing_ok=True)
        return res
    return score


def _fit_key(r, today):
    s = r['_pre']
    return (-s['score'], 0 if s['eligibility'] == 'ELIGIBLE' else 1, _neg_date(r.get('posted_at') or today))


def _neg_date(d):
    """Newest first as an ascending key (undated rows count as today's)."""
    return ''.join(chr(0x10FFFF - ord(ch)) for ch in str(d)[:19])


def pick(rows, cap, sets=()):
    """Rows (each with '_pre') in fit order within the person's cap: each place set first, up to its share, then the best of the rest."""
    today = datetime.now(timezone.utc).date().isoformat()
    ordered = sorted(rows, key=lambda r: _fit_key(r, today))
    taken, out = set(), []
    for _, bands, share in sets:
        n = 0
        for i, r in enumerate(ordered):
            if n >= int(cap * share) or len(out) >= cap:
                break
            if i not in taken and r['_pre'].get('band') in bands:
                taken.add(i); out.append(r); n += 1
    for i, r in enumerate(ordered):
        if len(out) >= cap:
            break
        if i not in taken:
            taken.add(i); out.append(r)
    return sorted(out, key=lambda r: _fit_key(r, today))


def select_wide(con, src, profs, cands, max_days, read_budget=SELECT_READ_BUDGET, scorer=None, stats=None):
    """Wide intake. Returns {cid: rows}, each row carrying its pre-score ('_pre': score, status, eligibility, band). `cands` = candidates.json rows
    (threshold). `stats` (a dict) receives per-person counts: candidates read, plausible, picked, and picked by place band."""
    cap_total = max(0, int(read_budget) // SELECT_READS_PER_ROW)
    thresholds = {c['id']: c.get('qualification_threshold') for c in cands}
    items, by_cid = [], {}
    for cid, p in profs.items():
        rows = candidate_rows(con, src, p, max_days)
        by_cid[cid] = rows
        items += [(cid, r) for r in rows]
    results = scorer(items) if items else []
    for (cid, r), res in zip(items, results):
        r['_pre'] = res or {'score': 0, 'status': 'INELIGIBLE', 'eligibility': 'UNKNOWN', 'band': 'other'}
    per_person = cap_total // max(1, len(profs))
    out = {}
    for cid, rows in by_cid.items():
        t = thresholds.get(cid) or (70 if cid == 'farhan_shaikh' else 60)
        ok = [r for r in rows if r['_pre']['status'] not in ('INELIGIBLE', 'UNKNOWN_CANDIDATE') and r['_pre']['score'] >= fit_floor(t)]
        out[cid] = pick(ok, per_person, PLACE_SETS.get(cid, ()))
        if stats is not None:
            bands = {}
            for r in out[cid]:
                bands[r['_pre']['band']] = bands.get(r['_pre']['band'], 0) + 1
            stats[cid] = {'read': len(rows), 'plausible': len(ok), 'picked': len(out[cid]), 'cap': per_person, 'floor': fit_floor(t), 'by_band': bands}
    return out


def job_id(ats, url):
    return f"ds:{ats or 'ats'}:{hashlib.sha1(url.encode()).hexdigest()[:20]}"


# Jobs QA 7 (ENGIE 'Solar Asset Manager- State Lead' shown twice: the dataset's copy and a job-site copy whose URL only adds
# '?feedId=null&utm_source=J2WRSS&utm_medium=rss&utm_campaign=J2W_RSS'): a posting URL is compared without its tracking parameters. Other parameters
# stay (on many career sites they are the job: '?gh_jid=6173440004', 'default.aspx?c=apply&lJobID=560804'). The same reading as postingUrlKey() in
# dashboard/worker/discovery.ts.
TRACKING_PARAM = re.compile(r'^(?:utm_[a-z_]*|feedid|gh_src|source|src|ref|referrer|lever-[a-z_-]*|fbclid|gclid|mc_[a-z]+|trk|rss)$', re.I)


def clean_posting_url(url):
    """The URL without tracking parameters (scheme, host, path and fragment as written)."""
    from urllib.parse import urlsplit, urlunsplit, unquote_plus
    try:
        u = urlsplit(str(url or '').strip())
    except ValueError:
        return str(url or '')
    if u.scheme not in ('http', 'https'):
        return str(url or '')
    # the tracking pairs are dropped from the query as written; every other pair is kept byte for byte ('jobid', '%20', '+' unchanged)
    query = '&'.join(p for p in u.query.split('&') if p and not TRACKING_PARAM.match(unquote_plus(p.split('=', 1)[0])))
    return urlunsplit((u.scheme, u.netloc, u.path, query, u.fragment))   # a fragment can be the job ('...oraclecloud.com/?site_number=CX#26081')


def url_variants(url):
    """The stored forms one posting URL may have: as given, without tracking parameters, and either with or without a trailing slash."""
    raw, clean = str(url or ''), clean_posting_url(url)
    out = {raw, clean}
    if '?' not in clean and '#' not in clean:
        out |= {clean.rstrip('/'), clean.rstrip('/') + '/'}
    return {v for v in out if v}


def posting_url_key(url):
    """One key per posting across sources: lower-case host without 'www.', path without trailing slash, the remaining parameters sorted."""
    from urllib.parse import urlsplit, parse_qsl, urlencode
    try:
        u = urlsplit(clean_posting_url(url))
    except ValueError:
        return ''
    if u.scheme not in ('http', 'https'):
        return ''
    host = (u.hostname or '').lower()
    host = host[4:] if host.startswith('www.') else host
    q = urlencode(sorted(parse_qsl(u.query, keep_blank_values=True)))
    return host + u.path.rstrip('/') + ('?' + q if q else '') + ('#' + u.fragment if u.fragment else '')


def adapter(s):
    return re.sub(r'[^a-z]', '', str(s or 'ats').lower())[:20] or 'ats'


def norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', str(s or '').lower()).strip()


def chunks(xs, n):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


ACTIVE_SQL = "SELECT id, company c, title t, location_restrictions l, workplace_type w, source_url, source_id, source_channel FROM jobs WHERE is_active = 1"
CLOSED_SQL = "SELECT company c, title t FROM jobs WHERE is_active = 0 AND expired_at >= datetime('now', '-180 days')"
# D1 read diet (17 Nov): the daily run read every active job three times (duplicate check, closures, job-site duplicate check) and every recently
# closed one twice. One read now serves the run: kept in memory for the closures and written to the work folder (ACTIVE_SNAPSHOT) for the
# job-site duplicate check, a later step of the same job; nothing writes jobs between the two (the import comes after both). Ids and URLs are
# still checked against D1 every time.
ACTIVE_SNAPSHOT = 'stored_jobs.json'
SNAPSHOT_MAX_AGE_S = 3 * 3600


def stored_jobs(local=None, snapshot=None, cache=None):
    """(active rows, closed (company, title) rows). cache: a dict that keeps them for the rest of this run; snapshot: a work-folder file
    written by an earlier step of the same run (read when no older than SNAPSHOT_MAX_AGE_S)."""
    _ACTIVE = cache if cache is not None else {}
    if 'rows' in _ACTIVE:
        return _ACTIVE['rows'], _ACTIVE['closed']
    if snapshot and Path(snapshot).exists():
        try:
            data = json.loads(Path(snapshot).read_text())
            if time.time() - float(data.get('at', 0)) < SNAPSHOT_MAX_AGE_S:
                _ACTIVE.update(rows=data['rows'], closed=data['closed'])
                return _ACTIVE['rows'], _ACTIVE['closed']
        except (ValueError, KeyError, TypeError):
            pass
    rows = d1(ACTIVE_SQL, local)
    closed = d1(CLOSED_SQL, local)
    _ACTIVE.update(rows=rows, closed=closed)
    return rows, closed


def write_stored_snapshot(path, cache):
    if 'rows' in cache:
        Path(path).write_text(json.dumps({'at': time.time(), 'rows': cache['rows'], 'closed': cache['closed']}))


def existing(jobs, local=None, snapshot=None, cache=None):
    """Ids (with is_active), URLs and active (company, title, location) rows already in D1, so nothing is inserted twice. `stored` maps an
    active (company, title) pair to its rows (id, location, workplace) for the many-cities rule (plan B3)."""
    ids, urls = {}, set()
    for part in chunks(jobs, 150):
        id_list = json.dumps([j['id'] for j in part])
        for r in d1(f"SELECT id, is_active, source_channel FROM jobs WHERE id IN (SELECT value FROM json_each({sql_str(id_list)}))", local):
            ids[r['id']] = r
        # The URL matters only for a posting whose id is not stored (a stored id is never inserted again): most of a day's selection is
        # already stored, so this halves the duplicate check's reads.
        url_list = json.dumps(sorted({v for j in part if j['id'] not in ids for v in url_variants(j['url'])}))   # jobs QA 7: tracking parameters aside
        if url_list == '[]':
            continue
        for r in d1(f"SELECT source_url u FROM jobs WHERE source_url IN (SELECT value FROM json_each({sql_str(url_list)})) "
                    f"UNION SELECT original_posting_url FROM jobs WHERE original_posting_url IN (SELECT value FROM json_each({sql_str(url_list)}))", local):
            urls.add(r['u'])
    # Employer, title AND stated location: the same role in another city is a different opening (owner rule: only exact duplicates collapse),
    # unless its text is the same but for the city (plan B3, split_new()).
    # A stored employer is read through the known-names table (tenth-man review, phase 4): a row the rename left on its tenant id (applied to or
    # decided, or stored before migration 0021 ran) is the same employer as a new row named at import.
    pairs, stored = set(), {}
    active, closed_rows = stored_jobs(local, snapshot, cache)
    for r in active:
        c = norm(display_company(r['c']))
        pairs.add((c, norm(r['t']), norm(r['l'])))
        stored.setdefault((c, norm(r['t'])), []).append({k: r.get(k) for k in ('id', 'c', 't', 'l', 'w')})
    closed = {(norm(display_company(r['c'])), norm(r['t'])) for r in closed_rows}
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
    name the same country (or both name none), and their texts (200 characters or more) are the same once each one's places are taken out."""
    if norm(a_loc) == norm(b_loc) or a_remote != b_remote:
        return False
    ca, cb = _country(a_loc), _country(b_loc)
    if ca != cb:   # both name the same country, or both are bare cities (tenth-man review: 'Berlin' and 'Austin, TX' are not one job)
        return False
    ta, tb = _text(a_desc, a_loc, b_loc), _text(b_desc, a_loc, b_loc)
    return len(ta) >= SAME_TEXT_MIN and ta == tb


def _descriptions(ids, local=None):
    """Text and guard of the stored rows a new posting may join (plan B3): {id: (text, guarded)}. A guarded row (someone applied to it, or a person
    decided on it) is never changed, so a posting is never merged into one."""
    out = {}
    for part in chunks(sorted(ids), 150):
        for r in d1(f"SELECT id, substr(description, 1, 6000) d, (EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id) "
                    f"OR EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND x.manual_override_status IS NOT NULL)) g "
                    f"FROM jobs WHERE id IN (SELECT value FROM json_each({sql_str(json.dumps(part))}))", local):
            out[r['id']] = (r.get('d') or '', bool(r.get('g')))
    return out


def merge_cities(fresh, stored, local=None, merges=None):
    """Plan B3 on the new postings: returns those still to insert. A posting joins a stored, unguarded row (or an earlier posting in this run) that
    is the same job in another city: its city is added (merge_places) and the posting is not inserted. A posting whose city is already listed there
    is the one merged before (it comes back every day) and is dropped too. A posting that cannot be added (three places listed already, or the
    stored row is guarded) is inserted as its own row, so no city is lost."""
    want = {r.get('id') for j in fresh for r in stored.get((norm(j['company']), norm(j['title'])), []) if r.get('id')}
    texts = _descriptions(want, local) if want else {}
    changed, kept, merged, listed = {}, [], 0, 0
    for j in fresh:
        jr, loc = _remote(j.get('location'), j.get('is_remote')), j.get('location')
        host = next((r for r in stored.get((norm(j['company']), norm(j['title'])), [])
                     if r.get('id') and not texts.get(r['id'], ('', True))[1]
                     and same_job_other_city(changed.get(r['id'], r['l']), texts[r['id']][0], _remote(r['l'], None, r.get('w')), loc, j.get('description'), jr)), None)
        if host:
            now = changed.get(host['id'], host['l'])
            if place_listed(now, loc):
                listed += 1
                continue
            after = merge_places(now, loc)
            if after != now:
                changed[host['id']] = after
                merged += 1
                continue
        twin = next((k for k in kept if norm(k['company']) == norm(j['company']) and norm(k['title']) == norm(j['title'])
                     and same_job_other_city(k.get('location'), k.get('description'), _remote(k.get('location'), k.get('is_remote')), loc, j.get('description'), jr)), None)
        if twin:   # the same job twice in this run: one row, both cities
            after = merge_places(twin.get('location'), loc)
            if after != twin.get('location'):
                twin['location'] = after
                merged += 1
                continue
        kept.append(j)
    if merges is not None:   # {'stored': [{id, old, new}], 'merged': n, 'already_listed': n}
        old = {r.get('id'): r['l'] for rows in stored.values() for r in rows}
        merges.setdefault('stored', []).extend({'id': i, 'old': old[i], 'new': loc} for i, loc in changed.items())
        merges['merged'] = merges.get('merged', 0) + merged
        merges['already_listed'] = merges.get('already_listed', 0) + listed
    return kept


def split_new(jobs, local=None, merges=None, snapshot=None, cache=None):
    """New jobs to insert, and earlier dataset jobs that reappeared after being closed (to reopen).
    Plan B3: a new posting with the same employer and title as a stored active one (or an earlier one in this run), differing only by city, is
    stored once: its city is added to the other's location ("Pune; Chennai; +3 more"). For a stored row the change is appended to `merges`
    ('stored': [{id, old, new}], dataset_apply.mjs writes it, guarded); stored duplicates are not merged with each other."""
    seen, unique, seen_urls = set(), [], set()
    for j in jobs:   # duplicates inside one run (same company, title and location; jobs QA 7: or the same posting URL, tracking parameters aside)
        k = (norm(j['company']), norm(j['title']), norm(j.get('location')))
        u = posting_url_key(j.get('url'))
        u = (u, norm(j['title'])) if u else None   # with the title: a careers page URL shared by several jobs is not one job (urlTwinKey)
        if k not in seen and not (u and u in seen_urls):
            seen.add(k); unique.append(j)
            if u:
                seen_urls.add(u)
    ids, urls, pairs, closed, stored = existing(unique, local, snapshot, cache) if unique else ({}, set(), set(), set(), {})
    reopen = [j['id'] for j in unique if j['id'] in ids and not ids[j['id']]['is_active'] and ids[j['id']]['source_channel'] == SOURCE_CHANNEL]
    fresh = [j for j in unique if j['id'] not in ids and not (url_variants(j['url']) & urls) and (norm(j['company']), norm(j['title']), norm(j.get('location'))) not in pairs]
    # Plan B3. A failure here never stops the run (tenth-man review): every posting is then inserted as before.
    try:
        part = {}
        fresh = merge_cities(fresh, stored, local, part)
        if merges is not None:
            for k, v in part.items():
                merges[k] = merges.get(k, []) + v if isinstance(v, list) else merges.get(k, 0) + v
    except Exception as e:   # noqa: BLE001
        print(f'::warning::Same-job-other-city check skipped this run ({type(e).__name__}: {str(e)[:160]})', file=sys.stderr)
    for j in fresh:   # the same role closed within the last 180 days and is back under a new id
        if (norm(j['company']), norm(j['title'])) in closed:
            j['repost'] = True
    return fresh, reopen, len(jobs) - len(unique)


def closures(con, src, manifest, local=None, cache=None):
    """Two-run closure with a per-ATS health check. Returns (close, mark_missing, clear_missing, counts_to_store)."""
    counts = {adapter(k): int(v.get('rows') or 0) for k, v in (manifest.get('by_ats') or {}).items()}
    prev = {}
    for r in d1("SELECT value FROM discovery_state WHERE key = 'ats_counts'", local):
        try:
            prev = json.loads(r['value'])
        except ValueError:
            prev = {}
    healthy = {a for a, n in counts.items() if prev.get(a) and n >= HEALTHY_RATIO * prev[a]}
    tracked = [{'id': r['id'], 'source_url': r['source_url'], 'source_id': r['source_id']} for r in stored_jobs(local, None, cache)[0] if r.get('source_channel') == SOURCE_CHANNEL]
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
    (out / 'candidates.json').write_text(json.dumps(candidates_rows(local)))
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
    ap.add_argument('--select-read-budget', type=int, default=SELECT_READ_BUDGET,
                    help='D1 rows read the duplicate check of the dataset selection may cost; the selection cap is this / SELECT_READS_PER_ROW')
    ap.add_argument('--no-prescore', action='store_true', help='skip the wide pre-score and use the bounded quotas (select_quota)')
    ap.add_argument('--home-quota', type=int, default=400, help='fallback quotas (select_quota) only')
    ap.add_argument('--remote-quota', type=int, default=200)
    ap.add_argument('--abroad-quota', type=int, default=300)
    ap.add_argument('--gulf-quota', type=int, default=150)
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
        (out / 'candidates.json').write_text(json.dumps(candidates_rows(a.d1_local)))
        (out / 'profiles.json').write_text(json.dumps(profs))
        (out / 'taste_rows.json').write_text(json.dumps(taste_rows(a.d1_local)))
        print(json.dumps({'profiles': len(profs)}))
        return 0
    if a.dedupe:
        raw = json.loads(Path(a.dedupe).read_text())
        jobs = [clean(j) for j in raw.get('jobs', [])]
        names = safe_names(jobs, not a.no_name_lookup)   # plan B1: employer names before the duplicate test
        merges = {}
        fresh, _, dup = split_new(jobs, a.d1_local, merges, snapshot=out / ACTIVE_SNAPSHOT)
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
    picked, intake = wide_or_quota(con, a, profs, out)
    found = {}
    for cid, p in profs.items():
        for r in picked.get(cid, []):
            r = {k: v for k, v in r.items() if k != '_pre'}
            jid = job_id(r['ats_type'], r['url'])
            j = found.setdefault(jid, {**clean(r), 'id': jid, 'candidates': [], 'public': False})
            if cid not in j['candidates']:
                j['candidates'].append(cid)
            j['public'] = j['public'] or bool(p.get('public'))
    jobs = [j for j in found.values() if len(j['url']) < LIMITS['url']]
    # Plan B1: the employer's name, not its hiring-system tenant id, before the duplicate test (so caps and dedupe see the display name).
    names = safe_names(jobs, not a.no_name_lookup)
    merges = {}
    run_cache = {}   # one read of the stored jobs for the duplicate check, the closures and (through the snapshot) the job-site duplicate check
    fresh, reopen, dup = split_new(jobs, a.d1_local, merges, cache=run_cache)
    write_stored_snapshot(out / ACTIVE_SNAPSHOT, run_cache)   # for the job-site duplicate check later in this run
    # A partial snapshot must not close real jobs: no closures at all unless the snapshot has its usual size.
    close, mark, clear, counts = closures(con, a.dataset, manifest, a.d1_local, run_cache) if total >= 1_000_000 and not stale else ([], [], [], {})
    report = {'snapshot': manifest.get('generated_at'), 'snapshot_age_hours': None if age is None else round(age, 1), 'stale': stale, 'dataset_jobs': total, 'profiles': len(profs), 'selected': len(jobs),
              'duplicates_in_run': dup, 'already_stored': len(jobs) - dup - len(fresh), 'new': len(fresh), 'reopen': len(reopen),
              'close': len(close), 'missing_first_time': len(mark), 'missing_cleared': len(clear), 'employer_names': names,
              'same_job_other_city': merges.get('merged', 0), 'intake': intake}
    (out / 'matches.json').write_text(json.dumps({'source': 'ats_dataset', 'snapshot': manifest.get('generated_at'), 'jobs': fresh, 'closed': close,
                                                  'reopen': reopen, 'missing_mark': mark, 'missing_clear': clear, 'ats_counts': counts,
                                                  'merge': merges.get('stored', [])}, default=str))
    (out / 'report.json').write_text(json.dumps(report, indent=1))
    print(json.dumps(report))
    return 0


def wide_or_quota(con, a, profs, out, scorer=None):
    """The wide selection, or, when its pre-score cannot run (Node missing, a script error), the bounded quotas, so the day's import still runs.
    Returns ({cid: rows}, report)."""
    if not a.no_prescore:
        try:
            cands = json.loads((out / 'candidates.json').read_text())
            stats = {}
            picked = select_wide(con, a.dataset, profs, cands, a.max_days, a.select_read_budget,
                                 scorer or node_scorer(out, out / 'candidates.json'), stats)
            return picked, {'mode': 'wide', 'read_budget': a.select_read_budget, 'per_person': stats}
        except Exception as e:   # noqa: BLE001
            print(f'::warning::Wide pre-score failed ({type(e).__name__}: {str(e)[:160]}); using the bounded quotas today', file=sys.stderr)
    picked = {cid: select_quota(con, a.dataset, p, a.home_quota, a.remote_quota, a.max_days, a.abroad_quota, a.gulf_quota) for cid, p in profs.items()}
    return picked, {'mode': 'quota', 'per_person': {cid: {'picked': len(r)} for cid, r in picked.items()}}


def safe_names(jobs, lookup=True):
    """name_jobs() that never stops the run (tenth-man review, phase 4): on any failure the career-site lookups are skipped and the known-names
    table alone is used."""
    try:
        return name_jobs(jobs, http_fetch() if lookup else None)
    except Exception as e:   # noqa: BLE001
        print(f'::warning::Employer-name lookups skipped this run ({type(e).__name__}: {str(e)[:160]})', file=sys.stderr)
        try:
            return {**name_jobs(jobs, None), 'lookup_failed': True}
        except Exception:   # noqa: BLE001
            return {'renamed': 0, 'looked_up': 0, 'lookup_failed': True}


def with_names(rows):
    """Rows whose 'company' is read through the known-names table (no fetch). A stored row the rename left on its tenant id (someone applied to it,
    or decided on it) then keys the same as the employer's new rows: the rejected-before note, the taste model and the shortlist's twin test see one
    employer (tenth-man review, phase 4)."""
    for r in rows:
        if r.get('company'):
            r['company'] = display_company(r['company'])
    return rows


def candidates_rows(local=None):
    """CANDIDATES_SQL, with each rejected employer read through the known-names table."""
    rows = d1(CANDIDATES_SQL, local)
    for r in rows:
        try:
            rej = json.loads(r.get('rejected_companies') or '[]')
        except ValueError:
            continue
        if isinstance(rej, list):
            r['rejected_companies'] = json.dumps(with_names([x for x in rej if isinstance(x, dict)]))
    return rows


def taste_rows(local=None):
    """The operator's own decisions, for the taste model (engine/signals.py): title and company only, with a label."""
    return with_names(d1("""SELECT a.candidate_id, j.title, j.company, a.status AS label FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE a.status IN ('SAVED','APPLIED','SUBMITTED','INTERVIEWING','OFFER')
      UNION ALL SELECT q.candidate_id, j.title, j.company, q.manual_override_status FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id
      WHERE q.manual_override_status IS NOT NULL AND q.manual_override_status IN ('READY','STRETCH_READY','INELIGIBLE','HOLD','CLOSED')   -- IS NOT NULL: the partial index of decided rows (migration 0026)
      UNION ALL SELECT f.candidate_id, j.title, j.company, CASE f.rating WHEN 'UP' THEN 'GOOD_MATCH' ELSE 'NOT_FOR_ME' END FROM job_feedback f JOIN jobs j ON j.id = f.job_id
      LIMIT 4000""", local))


def taste_targets(local=None, per_candidate=400):
    """The rows a person actually looks at (best-ranked undecided To review / Hold rows and the automatic shortlist), for the daily taste pass
    in dataset_apply.mjs: the learned taste is re-applied to them every run, not only to new jobs."""
    rows = []
    for c in d1("SELECT id FROM candidates ORDER BY id", local):
        # CROSS JOIN: walk the (candidate, score) index best first and stop at the limit (the planner otherwise read every row of the person
        # and sorted them: about 50,000 rows read per person on a production-size copy; now about 2,000). Same rows, same order.
        rows += d1(f"""SELECT q.candidate_id, q.job_id, j.title, j.company, s.overall_score AS score, s.score_breakdown, q.qualification_reason AS reason
          FROM candidate_job_scores s CROSS JOIN candidate_qualifications q CROSS JOIN jobs j
          WHERE s.candidate_id = {sql_str(c['id'])} AND q.candidate_id = s.candidate_id AND q.job_id = s.job_id AND j.id = s.job_id AND j.is_active = 1 AND q.manual_override_status IS NULL
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
    return rows + legacy_rows(cands, local, gate=True)


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
          WHERE q.candidate_id = {cid} AND {auto} AND {POOL_FREE} ORDER BY +q.job_id""", local)]   # +: sort these few rows, read them through the status index
        # Both shortlist rules need a score of at least the threshold minus 10, so the walk down the (candidate, score) index stops there
        # (the same rows as before; every row of the person used to be read).
        rows += [{**r, 'kind': 'pool'} for r in d1(f"""SELECT {POOL_COLS}, 1 AS marked
          FROM candidates c CROSS JOIN candidate_job_scores s CROSS JOIN candidate_qualifications q CROSS JOIN jobs j
          WHERE c.id = {cid} AND s.candidate_id = c.id AND s.overall_score >= c.qualification_threshold - 10
            AND q.candidate_id = s.candidate_id AND q.job_id = s.job_id AND j.id = q.job_id
            AND q.qualification_status = 'NEEDS_REVIEW' AND {POOL_FREE} AND j.is_active = 1
            AND s.score_breakdown LIKE '%"{RULES_MARKER}":true%'
            AND (s.skill_score >= 40 OR s.score_breakdown LIKE '%"target_exact":true%') AND {fits}
          ORDER BY s.overall_score DESC, q.job_id LIMIT {int(per_candidate)}""", local)]
        rows += [{**r, 'kind': 'held'} for r in d1(f"""SELECT q.candidate_id, j.id AS job_id, j.title, j.company, j.location_restrictions AS location, j.workplace_type AS workplace,
            q.qualification_status AS status
          FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id
          WHERE q.candidate_id = {cid} AND q.qualification_status IN ('READY','READY_HIGH','STRETCH_READY')
            AND NOT ({auto} AND {POOL_FREE}) ORDER BY +q.job_id""", local)]
    return rows


def write_pool(path, local=None, per_candidate=300):
    """Writes the pool atomically (a temporary file renamed into place), so a failed export never leaves a partial pool for the selector."""
    rows = shortlist_pool(local, per_candidate)
    for r in rows:   # the name stored on the job: the selector's tenant test reads it, as the audit does (scripts/shortlist_select.mjs shortlistTenant)
        if r.get('company'):
            r['stored_company'] = r['company']
    rows = with_names(rows)
    tmp = Path(str(path) + '.tmp')
    tmp.write_text(json.dumps({'generated_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'rows': rows}))
    tmp.replace(path)
    kinds = {}
    for r in rows:
        key = f"{r['candidate_id']}:{r['kind']}"
        kinds[key] = kinds.get(key, 0) + 1
    return kinds


LEGACY_STATE_KEY = 'legacy_scan'
LEGACY_RESCAN_DAYS = 7


def _legacy_due(local=None, now=None):
    """D1 read diet: the legacy scan walks every screening row of every person (about 100,000 rows read a day at production size) and, once the
    first-import rows are screened, finds none. A scan that found none under the current rules is repeated weekly, not daily (a row can only
    become legacy again when a person clears an override on a first-import row); any rules bump or a scan that found rows scans again at once."""
    try:
        rows = d1(f"SELECT value FROM discovery_state WHERE key = {sql_str(LEGACY_STATE_KEY)}", local)
        st = json.loads(rows[0]['value']) if rows else {}
        at = datetime.fromisoformat(str(st.get('at')).replace('Z', '+00:00'))
    except Exception:   # noqa: BLE001 - no state (or no table): scan
        return True
    now = now or datetime.now(timezone.utc)
    return st.get('marker') != RULES_MARKER or st.get('found') != 0 or now - at > timedelta(days=LEGACY_RESCAN_DAYS)


def _legacy_record(found, local=None):
    value = json.dumps({'marker': RULES_MARKER, 'found': found, 'at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')})
    try:
        d1(f"INSERT INTO discovery_state(key, value, updated_at) VALUES ({sql_str(LEGACY_STATE_KEY)}, {sql_str(value)}, datetime('now')) "
           "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", local)
    except Exception:   # noqa: BLE001 - the scan runs again next time
        pass


def legacy_rows(cands, local=None, page=300, per_candidate=1000, gate=False):
    """Undecided rows the CURRENT screen never scored: still NEEDS_REVIEW, score 0 (or no score row), no 'preliminary' breakdown, not a collector
    import waiting for the Worker. They came from the first import (reason 'Preserved verified ... status') and neither the Worker's
    assessment (which looks for the collector reason) nor the re-score above (which looks for a preliminary breakdown) ever selects them, so
    they sat in "to review" with no score. Exported with legacy = 1 so dataset_apply.mjs screens them fully (status, lane, score).
    Paged by job id through the primary key, a bounded number per person per run. Never a row with an override or an application.
    gate: the daily run skips the scan while the last one (same rules) found nothing, for up to LEGACY_RESCAN_DAYS (see _legacy_due)."""
    if gate and not _legacy_due(local):
        return []
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
    if gate:
        _legacy_record(len(rows), local)
    return rows


if __name__ == '__main__':
    sys.exit(main())
