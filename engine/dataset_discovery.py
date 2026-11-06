"""Daily job discovery over an open dataset of live ATS postings.

Source: the ats-scrapers "jobhive" dataset (MIT, https://github.com/kalil0321/ats-scrapers), a daily snapshot of about
5 million live postings from about 80,000 employers across 64 applicant-tracking systems (Greenhouse, Lever, Ashby,
Workday, SmartRecruiters, ...). DuckDB reads only the columns a query needs over HTTP, so a full scan takes seconds.

What this does (no candidate data is ever written to the repository):
  1. reads every candidate's search profile from D1 (the two built-in candidates use the same title rules as the Worker's
     screen; resold clients use their stored role keywords and location rule);
  2. selects the postings whose title and location fit each profile (newest first, bounded per candidate);
  3. drops postings already in D1 (same id, same URL, or the same company and title still active);
  4. lists jobs this pipeline added earlier that are no longer in the dataset (closed upstream);
  5. writes matches.json for dataset_apply.mjs, which scores them with the Worker's own evaluate() and writes SQL.

Usage: python engine/dataset_discovery.py --out work/ [--d1-local PATH] [--per-candidate 400] [--max-days 45]
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

# The Worker's own role rules for the built-in candidates (worker/discovery.ts, evaluate()). Kept identical on purpose:
# a posting this query selects is one the screen will call a role match.
BUILTIN = {
    # Discovery searches are narrower than the screen's role rule (a subset of it), so what is selected is a role match the
    # screen will score, and broad words like a bare "operations" do not pull in warehouse or sales roles.
    'farhan_shaikh': {
        'role': r'implementation|integration|automation|business systems|(^|[^a-z])crm([^a-z]|$)|revops|revenue operations|sales operations|marketing operations|gtm operations|go-to-market operations|solutions (engineer|consultant|architect|specialist|manager|lead)|technical (operations|delivery)|tech ops|platform operations|business operations (manager|analyst|lead)|operations (engineer|analyst)|salesforce (admin|administrator|consultant|developer)|hubspot',
        'exclude': r'power bi|software (engineer|developer)|devops|site reliability|data scientist|machine learning|security engineer|sdet|qa engineer|qa automation|automation (test|qa)|test automation|firewall|warehouse|driver|nurse|clinical|intern([^a-z]|$)',
        'countries': ['IN'], 'mode': 'REMOTE_FROM_HOME', 'home': 'india',
    },
    'sana_ansari': {
        'role': r'electrical|power plant|power generation|power station|substation|switchgear|transmission|o ?& ?m|operations (&|and) maintenance|maintenance (engineer|manager|head|lead|planner|supervisor)|plant (engineer|manager|operations|maintenance)|reliability engineer|commissioning|asset performance|energy|utilities|renewable|solar|wind (farm|turbine|energy)|thermal|hydro|decarbon',
        'exclude': r'(site|customer|product|network|platform|production|database|infrastructure|data|service|systems) reliability|software|cloud|devops|power platform|power bi|power apps|sales|account (executive|manager)|data (engineer|scientist|analyst)|developer|recruiter|research analyst',
        # India, and the Gulf states she named as relocation preferences
        'countries': ['IN', 'AE', 'SA', 'QA', 'OM', 'KW', 'BH'], 'mode': 'HOME_OR_RELOCATE', 'home': 'india',
    },
}
COUNTRY_ISO = {
    'india': 'IN', 'united states': 'US', 'usa': 'US', 'united kingdom': 'GB', 'uk': 'GB', 'canada': 'CA', 'australia': 'AU',
    'germany': 'DE', 'france': 'FR', 'netherlands': 'NL', 'ireland': 'IE', 'spain': 'ES', 'portugal': 'PT', 'poland': 'PL',
    'singapore': 'SG', 'united arab emirates': 'AE', 'uae': 'AE', 'saudi arabia': 'SA', 'qatar': 'QA', 'philippines': 'PH',
    'pakistan': 'PK', 'bangladesh': 'BD', 'sri lanka': 'LK', 'nepal': 'NP', 'brazil': 'BR', 'mexico': 'MX', 'south africa': 'ZA',
    'nigeria': 'NG', 'kenya': 'KE', 'egypt': 'EG', 'indonesia': 'ID', 'malaysia': 'MY', 'vietnam': 'VN', 'japan': 'JP',
}
OPEN_REMOTE = r'anywhere|worldwide|global|apac|asia'


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
        words = [re.escape(w.lower()).replace(r'\ ', r'\s+') for w in sp['role_keywords'] if w]
        avoid = [re.escape(w.lower()).replace(r'\ ', r'\s+') for w in sp.get('avoid_keywords') or [] if w]
        home = (sp.get('home_country') or 'India').strip().lower()
        out[r['id']] = {
            'role': '(^|[^a-z0-9])(' + '|'.join(words) + ')($|[^a-z0-9])',
            'exclude': '(^|[^a-z0-9])(' + '|'.join(avoid) + ')($|[^a-z0-9])' if avoid else None,
            'countries': [COUNTRY_ISO.get(home, home.upper()[:2])], 'mode': sp.get('location_mode') or 'REMOTE_FROM_HOME', 'home': home,
            'keywords': [w for w in sp['role_keywords'] if w],
        }
    return out


def location_sql(p):
    countries = ','.join(sql_str(c) for c in p['countries'])
    home = re.escape(p['home'])
    inside = f"(country_iso IN ({countries}) OR regexp_matches(lower(coalesce(location,'')), '(^|[^a-z]){home}([^a-z]|$)'))"
    # Remote roles open to anyone (or with no stated country) can be worked from home; the Worker's screen then decides
    # eligibility from the posting's own words. Country-restricted remote roles elsewhere are not selected.
    open_remote = f"(lower(coalesce(CAST(is_remote AS VARCHAR), '')) = 'true' AND (nullif(country_iso, '') IS NULL OR regexp_matches(lower(coalesce(location,'')), '{OPEN_REMOTE}')))"
    return f'({inside} OR {open_remote})', inside


def select(con, p, per_candidate, max_days):
    where_loc, inside = location_sql(p)
    since = (datetime.now(timezone.utc) - timedelta(days=max_days)).date().isoformat()
    exclude = f"AND NOT regexp_matches(lower(title), '{p['exclude']}')" if p.get('exclude') else ''
    q = f"""
      SELECT url, title, company, ats_type, location, country_iso, lower(coalesce(CAST(is_remote AS VARCHAR), '')) = 'true' AS is_remote, left(description, 8000) AS description,
             CAST(posted_at AS VARCHAR) AS posted_at, TRY_CAST(salary_min AS DOUBLE) AS salary_min, TRY_CAST(salary_max AS DOUBLE) AS salary_max, salary_currency, salary_period, salary_summary,
             apply_url, employment_type, CASE WHEN {inside} THEN 0 ELSE 1 END AS priority
      FROM read_parquet('{DATASET}')
      WHERE title IS NOT NULL AND url IS NOT NULL AND company IS NOT NULL
        AND regexp_matches(lower(title), '{p['role']}') {exclude}
        AND {where_loc}
        AND (posted_at IS NULL OR CAST(posted_at AS VARCHAR) >= '{since}')
      ORDER BY priority, posted_at DESC NULLS LAST
      LIMIT {int(per_candidate)}"""
    cur = con.execute(q)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def job_id(ats, url):
    return f"ds:{ats or 'ats'}:{hashlib.sha1(url.encode()).hexdigest()[:20]}"


def chunks(xs, n):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def existing(jobs, local=None):
    """Ids, URLs and active (company, title) pairs already in D1, so nothing is inserted twice."""
    ids, urls = set(), set()
    for part in chunks(jobs, 150):
        id_list = json.dumps([j['id'] for j in part])
        url_list = json.dumps([j['url'] for j in part])
        for r in d1(f"SELECT id FROM jobs WHERE id IN (SELECT value FROM json_each({sql_str(id_list)}))", local):
            ids.add(r['id'])
        for r in d1(f"SELECT source_url u FROM jobs WHERE source_url IN (SELECT value FROM json_each({sql_str(url_list)})) "
                    f"UNION SELECT original_posting_url FROM jobs WHERE original_posting_url IN (SELECT value FROM json_each({sql_str(url_list)}))", local):
            urls.add(r['u'])
    pairs = {(str(r['c']).strip().lower(), str(r['t']).strip().lower()) for r in d1("SELECT company c, title t FROM jobs WHERE is_active = 1", local)}
    return ids, urls, pairs


def closed(con, local=None):
    """Jobs this pipeline added that are no longer in the dataset. Only trusted when the snapshot looks complete."""
    tracked = d1(f"SELECT id, source_url FROM jobs WHERE source_channel = '{SOURCE_CHANNEL}' AND is_active = 1", local)
    if not tracked:
        return []
    con.execute('CREATE OR REPLACE TEMP TABLE tracked(url VARCHAR)')
    con.executemany('INSERT INTO tracked VALUES (?)', [(t['source_url'],) for t in tracked])
    live = {r[0] for r in con.execute(f"SELECT t.url FROM tracked t JOIN read_parquet('{DATASET}') d ON d.url = t.url").fetchall()}
    return [t['id'] for t in tracked if t['source_url'] not in live]


def rescore_rows(local=None, page=400):
    """Preliminary rows (the screen's own, not yet scored with stored skills) that no person has decided on."""
    rows, offset = [], 0
    while True:
        part = d1(f"""SELECT q.candidate_id, q.job_id, j.title, j.location_restrictions AS location, j.description, j.workplace_type, s.score_breakdown
          FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id JOIN candidate_job_scores s ON s.candidate_id = q.candidate_id AND s.job_id = q.job_id
          WHERE j.is_active = 1 AND q.manual_override_status IS NULL AND q.qualification_status IN ('NEEDS_REVIEW','HOLD')
            AND s.score_breakdown LIKE '%preliminary%' AND s.score_breakdown NOT LIKE '%"skills_v1":true%'
            AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = q.candidate_id AND a.job_id = q.job_id)
          ORDER BY q.candidate_id, q.job_id LIMIT {page} OFFSET {offset}""", local)
        rows += part
        if len(part) < page:
            return rows
        offset += page


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--d1-local', default=None, help='a local wrangler --persist-to path instead of the remote database')
    ap.add_argument('--per-candidate', type=int, default=400)
    ap.add_argument('--max-days', type=int, default=45)
    ap.add_argument('--rescore-export', action='store_true', help='also export preliminary rows not yet scored with stored skills')
    a = ap.parse_args()
    import duckdb
    import urllib.request
    manifest = json.load(urllib.request.urlopen(urllib.request.Request(MANIFEST, headers={'User-Agent': 'career-job-engine/1.0'}), timeout=60))
    total = manifest.get('stats', {}).get('total_jobs', 0)
    snapshot = manifest.get('generated_at')
    con = duckdb.connect()
    con.execute('INSTALL httpfs; LOAD httpfs;')
    profs = profiles(a.d1_local)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    # what the scoring step needs per candidate (id, skills, search profile); stays in the run's work folder, never committed
    (out / 'candidates.json').write_text(json.dumps(d1("SELECT c.id, c.primary_skills, p.search_profile FROM candidates c LEFT JOIN client_profiles p ON p.candidate_id = c.id", a.d1_local)))
    if a.rescore_export:
        (out / 'rescore.json').write_text(json.dumps(rescore_rows(a.d1_local)))
    found = {}
    per = {}
    for cid, p in profs.items():
        rows = select(con, p, a.per_candidate, a.max_days)
        per[cid] = len(rows)
        for r in rows:
            jid = job_id(r['ats_type'], r['url'])
            j = found.setdefault(jid, {**{k: v for k, v in r.items() if k != 'priority'}, 'id': jid, 'candidates': []})
            j['candidates'].append(cid)
    jobs = list(found.values())
    ids, urls, pairs = existing(jobs, a.d1_local) if jobs else (set(), set(), set())
    fresh = [j for j in jobs if j['id'] not in ids and j['url'] not in urls
             and (str(j['company']).strip().lower(), str(j['title']).strip().lower()) not in pairs]
    # A partial or broken snapshot must not close real jobs: closures only when the dataset has its usual size.
    gone = closed(con, a.d1_local) if total >= 1_000_000 else []
    report = {'snapshot': snapshot, 'dataset_jobs': total, 'selected_per_candidate': per, 'selected': len(jobs),
              'already_stored': len(jobs) - len(fresh), 'new': len(fresh), 'closed_upstream': len(gone)}
    (out / 'matches.json').write_text(json.dumps({'source': 'ats_dataset', 'snapshot': snapshot, 'jobs': fresh, 'closed': gone}, default=str))
    (out / 'report.json').write_text(json.dumps(report, indent=1))
    print(json.dumps(report))


if __name__ == '__main__':
    sys.exit(main())
