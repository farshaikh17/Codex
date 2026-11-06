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

DATASET = 'https://storage.stapply.ai/jobhive/v1/all.parquet'
MANIFEST = 'https://storage.stapply.ai/jobhive/v1/manifest.json'
DASHBOARD = Path(__file__).resolve().parent.parent / 'dashboard'
SOURCE_CHANNEL = 'ATS_DATASET'
HEALTHY_RATIO = 0.9   # an ATS whose row count fell more than 10% since the previous run closes nothing this run

# Discovery searches are narrower than the screen's role rule (a subset of it), so what is selected is a role match the
# screen will score, and broad words like a bare "operations" do not pull in warehouse or sales roles.
BUILTIN = {
    'farhan_shaikh': {
        'role': r'implementation|integration|automation|business systems|(^|[^a-z])crm([^a-z]|$)|revops|revenue operations|sales operations|marketing operations|gtm operations|go-to-market operations|solutions (engineer|consultant|architect|specialist|manager|lead)|technical (operations|delivery)|tech ops|platform operations|business operations (manager|analyst|lead)|operations (engineer|analyst)|salesforce (admin|administrator|consultant|developer)|hubspot',
        'exclude': r'power bi|software (engineer|developer)|devops|site reliability|data scientist|machine learning|security engineer|sdet|qa engineer|qa automation|automation (test|qa)|test automation|firewall|warehouse|driver|nurse|clinical|intern([^a-z]|$)',
        'countries': ['IN'], 'mode': 'REMOTE_FROM_HOME', 'home': 'india', 'keywords': [], 'public': True,
    },
    'sana_ansari': {
        'role': r'electrical|power plant|power generation|power station|substation|switchgear|transmission|o ?& ?m|operations (&|and) maintenance|maintenance (engineer|manager|head|lead|planner|supervisor)|plant (engineer|manager|operations|maintenance)|reliability engineer|commissioning|asset performance|energy|utilities|renewable|solar|wind (farm|turbine|energy)|thermal|hydro|decarbon',
        'exclude': r'(site|customer|product|network|platform|production|database|infrastructure|data|service|systems) reliability|software|cloud|devops|power platform|power bi|power apps|sales|account (executive|manager)|data (engineer|scientist|analyst)|developer|recruiter|research analyst',
        # India, and the Gulf states she named as relocation preferences
        'countries': ['IN', 'AE', 'SA', 'QA', 'OM', 'KW', 'BH'], 'mode': 'HOME_OR_RELOCATE', 'home': 'india', 'keywords': [], 'public': True,
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


def d1(sql, local=None):
    """Runs one read query on D1 through wrangler and returns the rows. local = a --persist-to path for a local database."""
    where = ['--local', '--persist-to', local] if local else ['--remote']
    out = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'career-job-engine', *where, '--json', '--command', sql],
                         cwd=DASHBOARD, capture_output=True, text=True, timeout=180)
    text = out.stdout
    if out.returncode != 0 or '[' not in text:
        raise RuntimeError(f'D1 query failed: {(out.stderr or text)[-400:]}')
    return json.loads(text[text.index('['):])[0]['results']


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


BASE_COLS = """url, title, company, ats_type, location, country_iso, lower(coalesce(CAST(is_remote AS VARCHAR), '')) AS remote_flag,
  left(description, 6000) AS description, CAST(posted_at AS VARCHAR) AS posted_at, TRY_CAST(salary_min AS DOUBLE) AS salary_min,
  TRY_CAST(salary_max AS DOUBLE) AS salary_max, salary_currency, salary_period, salary_summary, apply_url, employment_type"""
COMMON = """title IS NOT NULL AND url IS NOT NULL AND company IS NOT NULL
  AND regexp_matches(lower(title), $role) AND ($exclude = '' OR NOT regexp_matches(lower(title), $exclude))
  AND (posted_at IS NULL OR CAST(posted_at AS VARCHAR) >= $since)"""
INSIDE = "(list_contains($countries::VARCHAR[], country_iso) OR regexp_matches(lower(coalesce(location,'')), $home))"
OPEN = f"""(lower(coalesce(CAST(is_remote AS VARCHAR), '')) = 'true' AND (nullif(country_iso, '') IS NULL
  OR regexp_matches(lower(coalesce(location,'')), '{OPEN_REMOTE}')))"""


def select(con, src, p, home_quota, remote_quota, max_days):
    """Two bounded selections per profile: in the home country (remote ones first for a remote-only search), and remote roles
    open to anyone that are not in the home country. Every search value is a bound parameter."""
    params = {'role': p['role'], 'exclude': p.get('exclude') or '', 'countries': p['countries'],
              'home': '(^|[^a-z])' + re.escape(p['home']) + '([^a-z]|$)',
              'since': (datetime.now(timezone.utc) - timedelta(days=max_days)).date().isoformat()}
    remote_first = "CASE WHEN lower(coalesce(CAST(is_remote AS VARCHAR), '')) = 'true' OR regexp_matches(lower(coalesce(location,'')), 'remote') THEN 0 ELSE 1 END," if p['mode'] == 'REMOTE_FROM_HOME' else ''
    rows = []
    for where, order, limit in ((INSIDE, remote_first, home_quota), (f'{OPEN} AND NOT {INSIDE}', '', remote_quota)):
        cur = con.execute(f"SELECT {BASE_COLS} FROM read_parquet($src) WHERE {COMMON} AND {where} ORDER BY {order} posted_at DESC NULLS LAST LIMIT {int(limit)}",
                          {**params, 'src': src})
        cols = [d[0] for d in cur.description]
        rows += [dict(zip(cols, r)) for r in cur.fetchall()]
    for r in rows:   # true, false, or unknown (most postings do not say)
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
    """Ids (with is_active), URLs and active (company, title) pairs already in D1, so nothing is inserted twice."""
    ids, urls = {}, set()
    for part in chunks(jobs, 150):
        id_list = json.dumps([j['id'] for j in part])
        url_list = json.dumps([j['url'] for j in part])
        for r in d1(f"SELECT id, is_active, source_channel FROM jobs WHERE id IN (SELECT value FROM json_each({sql_str(id_list)}))", local):
            ids[r['id']] = r
        for r in d1(f"SELECT source_url u FROM jobs WHERE source_url IN (SELECT value FROM json_each({sql_str(url_list)})) "
                    f"UNION SELECT original_posting_url FROM jobs WHERE original_posting_url IN (SELECT value FROM json_each({sql_str(url_list)}))", local):
            urls.add(r['u'])
    pairs = {(norm(r['c']), norm(r['t'])) for r in d1("SELECT company c, title t FROM jobs WHERE is_active = 1", local)}
    return ids, urls, pairs


def split_new(jobs, local=None):
    """New jobs to insert, and earlier dataset jobs that reappeared after being closed (to reopen)."""
    seen, unique = set(), []
    for j in jobs:   # duplicates inside one run (same company, title and location)
        k = (norm(j['company']), norm(j['title']), norm(j.get('location')))
        if k not in seen:
            seen.add(k); unique.append(j)
    ids, urls, pairs = existing(unique, local) if unique else ({}, set(), set())
    reopen = [j['id'] for j in unique if j['id'] in ids and not ids[j['id']]['is_active'] and ids[j['id']]['source_channel'] == SOURCE_CHANNEL]
    fresh = [j for j in unique if j['id'] not in ids and j['url'] not in urls and (norm(j['company']), norm(j['title'])) not in pairs]
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


def load_manifest():
    import urllib.request
    req = urllib.request.Request(MANIFEST, headers={'User-Agent': 'career-job-engine/1.0'})
    return json.load(urllib.request.urlopen(req, timeout=60))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--dataset', default=DATASET, help='a downloaded copy of all.parquet (the workflow downloads it once per run)')
    ap.add_argument('--d1-local', default=None, help='a local wrangler --persist-to path instead of the remote database')
    ap.add_argument('--home-quota', type=int, default=400)
    ap.add_argument('--remote-quota', type=int, default=200)
    ap.add_argument('--max-days', type=int, default=45)
    ap.add_argument('--rescore-export', action='store_true', help='also export preliminary rows not yet scored with stored skills')
    ap.add_argument('--dedupe', default=None, help='only de-duplicate a job-site result file against D1')
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    if a.dedupe:
        raw = json.loads(Path(a.dedupe).read_text())
        fresh, _, dup = split_new([clean(j) for j in raw.get('jobs', [])], a.d1_local)
        (out / 'jobsite_matches.json').write_text(json.dumps({'source': 'job_sites', 'jobs': fresh, 'closed': []}, default=str))
        print(json.dumps({'job_sites_selected': len(raw.get('jobs', [])), 'duplicates_in_run': dup, 'new': len(fresh)}))
        return 0
    import duckdb
    manifest = load_manifest()
    total = manifest.get('stats', {}).get('total_jobs', 0)
    con = duckdb.connect()
    if a.dataset.startswith('http'):
        con.execute('INSTALL httpfs; LOAD httpfs;')
    profs = profiles(a.d1_local)
    # What the scoring step needs per candidate, and the search profiles for the job-site step (which runs without database
    # credentials). Both stay in the run's work folder and are never committed.
    (out / 'candidates.json').write_text(json.dumps(d1("SELECT c.id, c.primary_skills, p.search_profile FROM candidates c LEFT JOIN client_profiles p ON p.candidate_id = c.id", a.d1_local)))
    (out / 'profiles.json').write_text(json.dumps(profs))
    if a.rescore_export:
        (out / 'rescore.json').write_text(json.dumps(rescore_rows(a.d1_local)))
    found = {}
    for cid, p in profs.items():
        for r in select(con, a.dataset, p, a.home_quota, a.remote_quota, a.max_days):
            jid = job_id(r['ats_type'], r['url'])
            j = found.setdefault(jid, {**clean(r), 'id': jid, 'candidates': [], 'public': False})
            if cid not in j['candidates']:
                j['candidates'].append(cid)
            j['public'] = j['public'] or bool(p.get('public'))
    jobs = [j for j in found.values() if len(j['url']) < LIMITS['url']]
    fresh, reopen, dup = split_new(jobs, a.d1_local)
    # A partial snapshot must not close real jobs: no closures at all unless the snapshot has its usual size.
    close, mark, clear, counts = closures(con, a.dataset, manifest, a.d1_local) if total >= 1_000_000 else ([], [], [], {})
    report = {'snapshot': manifest.get('generated_at'), 'dataset_jobs': total, 'profiles': len(profs), 'selected': len(jobs),
              'duplicates_in_run': dup, 'already_stored': len(jobs) - dup - len(fresh), 'new': len(fresh), 'reopen': len(reopen),
              'close': len(close), 'missing_first_time': len(mark), 'missing_cleared': len(clear)}
    (out / 'matches.json').write_text(json.dumps({'source': 'ats_dataset', 'snapshot': manifest.get('generated_at'), 'jobs': fresh, 'closed': close,
                                                  'reopen': reopen, 'missing_mark': mark, 'missing_clear': clear, 'ats_counts': counts}, default=str))
    (out / 'report.json').write_text(json.dumps(report, indent=1))
    print(json.dumps(report))
    return 0


def rescore_rows(local=None, page=400):
    """Preliminary rows (the screen's own, not yet scored with stored skills) that no person has decided on, for candidates
    that have skills to score with."""
    rows, offset = [], 0
    while True:
        part = d1(f"""SELECT q.candidate_id, q.job_id, j.title, j.location_restrictions AS location, j.description, j.workplace_type, s.score_breakdown
          FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id JOIN candidate_job_scores s ON s.candidate_id = q.candidate_id AND s.job_id = q.job_id
          JOIN candidates c ON c.id = q.candidate_id
          WHERE j.is_active = 1 AND q.manual_override_status IS NULL AND q.qualification_status IN ('NEEDS_REVIEW','HOLD')
            AND c.primary_skills IS NOT NULL AND trim(c.primary_skills) NOT IN ('', '[]', 'null')
            AND s.score_breakdown LIKE '%preliminary%' AND s.score_breakdown NOT LIKE '%"skills_v1":true%'
            AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = q.candidate_id AND a.job_id = q.job_id)
          ORDER BY q.candidate_id, q.job_id LIMIT {page} OFFSET {offset}""", local)
        rows += part
        if len(part) < page:
            return rows
        offset += page


if __name__ == '__main__':
    sys.exit(main())
