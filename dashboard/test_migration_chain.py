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

assert 'auth_failures' in tables and 'candidate_qualifications' in tables, 'migration chain is incomplete'
print('migration chain OK')
