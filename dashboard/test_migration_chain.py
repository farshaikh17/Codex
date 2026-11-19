import sqlite3
import os

conn = sqlite3.connect(':memory:')
migrations = [
    '0001_initial_schema.sql',
    '0002_cloud_discovery.sql',
    '0003_validated_sources.sql',
    '0004_broad_discovery.sql',
    '0005_role_searches.sql',
    '0006_startup_location_unknown.sql',
    '0007_qualification_history.sql',
    '0008_auth_failures.sql',
    '0009_response_cache.sql',
    '0010_assessment.sql',
    '0011_clients.sql',
    '0012_site.sql',
    '0013_candidate_skills.sql',
    '0014_discovery_state.sql',
    '0015_candidate_profiles_v2.sql',
    '0016_past_applications.sql',
    '0017_sana_profile_cv.sql',
    '0018_followups.sql',
    '0019_job_feedback.sql',
    '0020_farhan_drop_marketing_stretch.sql',
    '0021_company_display_names.sql',
    '0022_history_client.sql',
    '0023_company_names_svkm.sql',
    '0024_drop_remotive_source.sql',
    '0025_queue_404_gone.sql',
    '0026_read_diet.sql',
]
base = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'migrations')
for m in migrations:
    p = os.path.join(base, m)
    with open(p, 'r', encoding='utf-8') as f:
        sql = f.read()
    conn.executescript(sql)
    print(f'Applied {m} successfully')

tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print('\nFinal tables in disposable DB:', sorted(tables))

# Verify cloud_automation columns
cols_auto = [r[1] for r in conn.execute("PRAGMA table_info(cloud_automation)").fetchall()]
print('cloud_automation columns:', cols_auto)

# Verify cloud_sources columns
cols_sources = [r[1] for r in conn.execute("PRAGMA table_info(cloud_sources)").fetchall()]
print('cloud_sources columns:', cols_sources)

# Verify cloud_discovery_queue columns
cols_queue = [r[1] for r in conn.execute("PRAGMA table_info(cloud_discovery_queue)").fetchall()]
print('cloud_discovery_queue columns:', cols_queue)

# Verify cloud_discovery_runs columns
cols_runs = [r[1] for r in conn.execute("PRAGMA table_info(cloud_discovery_runs)").fetchall()]
print('cloud_discovery_runs columns:', cols_runs)

# Verify cloud_job_evidence columns
cols_evi = [r[1] for r in conn.execute("PRAGMA table_info(cloud_job_evidence)").fetchall()]
print('cloud_job_evidence columns:', cols_evi)

assert 'history_client' in tables, 'migration 0022 missing'
assert 'auth_failures' in tables and 'candidate_qualifications' in tables, 'migration chain is incomplete'
print('migration chain OK')

# 0009 is additive: the read cache and meter tables exist, and applying it twice changes nothing
assert {'response_cache', 'read_meter', 'cache_state'} <= set(r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'"))
with open(os.path.join(base, '0009_response_cache.sql'), 'r', encoding='utf-8') as f:
    conn.executescript(f.read())
print('0009 re-applied idempotently')
assert conn.execute('SELECT generation FROM cache_state WHERE id = 1').fetchone() == (0,)

# 0025: old FAILED queue rows with HTTP 404 become GONE; other failures and every other table are untouched; re-applying changes nothing
src = conn.execute('SELECT id FROM cloud_sources LIMIT 1').fetchone()
if src is None:
    cols = [r for r in conn.execute('PRAGMA table_info(cloud_sources)').fetchall()]
    names = [c[1] for c in cols if c[3] and c[4] is None and c[1] != 'id']
    conn.execute(f"INSERT INTO cloud_sources(id{''.join(',' + n for n in names)}) VALUES ('t:src'{''.join(",'x'" for _ in names)})")
    src = ('t:src',)
conn.execute("INSERT INTO cloud_discovery_queue(id,source_id,posting_id,payload,state,last_error,updated_at) VALUES "
             "('q404',?, 'p1','{}','FAILED','Source HTTP 404','2026-11-01'),('q500',?, 'p2','{}','FAILED','Source HTTP 500','2026-11-01'),"
             "('qok',?, 'p3','{}','DONE',NULL,'2026-11-01')", (src[0], src[0], src[0]))
with open(os.path.join(base, '0025_queue_404_gone.sql'), 'r', encoding='utf-8') as f:
    m25 = f.read()
conn.executescript(m25)
states = dict(conn.execute("SELECT id, state FROM cloud_discovery_queue WHERE id IN ('q404','q500','qok')").fetchall())
assert states == {'q404': 'GONE', 'q500': 'FAILED', 'qok': 'DONE'}, states
stamp = conn.execute("SELECT updated_at FROM cloud_discovery_queue WHERE id='q404'").fetchone()
conn.executescript(m25)
assert conn.execute("SELECT updated_at FROM cloud_discovery_queue WHERE id='q404'").fetchone() == stamp, '0025 is not idempotent'
assert 'UPDATE jobs' not in m25 and 'applications' not in m25.split('Idempotent')[1], '0025 must touch the queue table only'
print('0025 converts old HTTP 404 queue rows to GONE, idempotently')

# 0026: indexes only (no row of any table changes); re-applying changes nothing
with open(os.path.join(base, '0026_read_diet.sql'), 'r', encoding='utf-8') as f:
    m26 = f.read()
idx = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
assert {'idx_app_job', 'idx_jobs_channel_active_disc', 'idx_cq_override', 'idx_jobs_closed_at'} <= idx, idx
body = '\n'.join(l for l in m26.splitlines() if not l.startswith('--'))
for word in ('UPDATE', 'DELETE', 'INSERT', 'DROP', 'ALTER', 'CREATE TABLE'):
    assert word not in body.upper(), f'0026 must only add indexes ({word})'
conn.executescript(m26)
print('0026 adds the read-diet indexes, idempotently')
