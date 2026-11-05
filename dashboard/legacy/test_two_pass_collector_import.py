import sqlite3
import tempfile
import sys
from pathlib import Path

# Add repo root to sys.path
REPO_ROOT = Path(r"C:\Users\admin\.gemini\antigravity\scratch\farhan-job-engine")
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from engine.staging_bridge import D1StagingBridge
from engine.collector_importer import import_collector_postings

temp_db = tempfile.NamedTemporaryFile(suffix='.sqlite', delete=False).name
conn = sqlite3.connect(temp_db)
with open(REPO_ROOT / 'migrations' / '0001_initial_schema.sql', 'r', encoding='utf-8') as f:
    conn.executescript(f.read())
with open(REPO_ROOT / 'migrations' / '0007_qualification_history.sql', 'r', encoding='utf-8') as f:
    conn.executescript(f.read())
conn.close()

def sqlite_exec(sql):
    c = sqlite3.connect(temp_db)
    c.executescript(sql)
    c.close()
    return [{'success': True}]

sample_postings = [
    {
        'key': 'lever:drivetrain:12345',
        'title': 'Senior Automation Engineer',
        'board': 'drivetrain',
        'employer_name': 'Drivetrain',
        'url': 'https://jobs.lever.co/drivetrain/12345/apply?ref=linkedin',
        'workplace_type': 'REMOTE',
        'locations': [{'city': 'Bengaluru', 'country': 'India'}]
    },
    {
        'key': 'greenhouse:gitlab:67890',
        'title': 'Reliability Engineer',
        'board': 'gitlab',
        'employer_name': 'GitLab',
        'url': 'https://boards.greenhouse.io/gitlab/jobs/67890?gh_src=custom',
        'workplace_type': 'REMOTE',
        'locations': [{'country': 'Global'}]
    }
]

# Pass 1: Initial automated import
bridge = D1StagingBridge(executor=sqlite_exec)
import engine.collector_importer as ci
ci.D1StagingBridge = lambda **kwargs: bridge

res1 = import_collector_postings(sample_postings)
print('Pass 1 Result:', res1['status'])

# Set manual human override for Farhan on job 1
conn = sqlite3.connect(temp_db)
conn.execute('''
    UPDATE candidate_qualifications 
    SET manual_override_status = 'READY_HIGH', 
        manual_override_reason = 'Owner verified fit' 
    WHERE candidate_id = 'farhan_shaikh' AND job_id = 'lever:drivetrain:12345'
''')
conn.execute('''
    INSERT INTO qualification_history (candidate_id, job_id, previous_status, new_status, reason, actor, changed_at)
    VALUES ('farhan_shaikh', 'lever:drivetrain:12345', 'NEEDS_REVIEW', 'READY_HIGH', 'Owner verified fit', 'farhan_shaikh', '2026-11-03T00:00:00Z')
''')
conn.commit()
conn.close()

# Pass 2: Repeat automated import
res2 = import_collector_postings(sample_postings)
print('Pass 2 Result:', res2['status'])

# Assertions
conn = sqlite3.connect(temp_db)
rows = conn.execute('SELECT candidate_id, job_id, qualification_status, manual_override_status, manual_override_reason FROM candidate_qualifications ORDER BY candidate_id, job_id').fetchall()
print('Qualifications in DB:')
for r in rows:
    print(' ', r)

hist = conn.execute('SELECT id, candidate_id, job_id, previous_status, new_status, reason, actor FROM qualification_history').fetchall()
print('Audit History in DB:')
for h in hist:
    print(' ', h)

jobs = conn.execute('SELECT id, title, company, original_posting_url, source_url FROM jobs ORDER BY id').fetchall()
print('Jobs in DB:')
for j in jobs:
    print(' ', j)
conn.close()

# Checks:
assert len(rows) == 4, f'Expected 4 qualifications, got {len(rows)}'
assert rows[0] == ('farhan_shaikh', 'greenhouse:gitlab:67890', 'NEEDS_REVIEW', None, None)
assert rows[1] == ('farhan_shaikh', 'lever:drivetrain:12345', 'NEEDS_REVIEW', 'READY_HIGH', 'Owner verified fit'), 'Farhan manual override must be preserved!'
assert rows[2] == ('sana_ansari', 'greenhouse:gitlab:67890', 'NEEDS_REVIEW', None, None)
assert rows[3] == ('sana_ansari', 'lever:drivetrain:12345', 'NEEDS_REVIEW', None, None), 'Sana must have independent qualification without override!'
assert len(hist) == 1, 'Audit history must remain intact!'
assert jobs[0][3] == 'https://boards.greenhouse.io/gitlab/jobs/67890', 'Greenhouse original_posting_url must be normalized'
assert jobs[1][3] == 'https://jobs.lever.co/drivetrain/12345', 'Lever original_posting_url must be normalized'

print('>>> ALL 2-PASS REPEAT IMPORT AND PRESERVATION CHECKS PASSED SUCCESSFULLY! <<<')
