"""D1 read diet (17 Nov): the daily run's duplicate check reads the stored jobs once per run (closures and the job-site check reuse it), the
taste pass reads only the rows it uses, and the legacy scan is skipped while it has nothing to find. Runs on a scratch SQLite built from the dashboard
migrations (d1() replaced by a function that executes the same SQL locally and counts the queries)."""
import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from engine import dataset_discovery as dd

MIGRATIONS = sorted((Path(__file__).resolve().parent.parent.parent / 'dashboard' / 'migrations').glob('*.sql'))


class Base(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        for m in MIGRATIONS:
            self.db.executescript(m.read_text(encoding='utf-8'))
        self.db.execute("INSERT INTO candidates(id, full_name) VALUES ('farhan_shaikh', 'T')")
        self.calls = []

    def d1(self, sql, local=None):
        self.calls.append(sql)
        return [dict(r) for r in self.db.execute(sql).fetchall()]

    def job(self, jid, url, company='Acme', title='Ops Lead', location='Remote', active=1, channel='ATS_DATASET'):
        self.db.execute("INSERT INTO jobs(id,title,company,source_adapter,source_url,is_active,discovered_at,source_channel,source_id,location_restrictions) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?)", (jid, title, company, 'greenhouse', url, active, '2026-11-01T00:00:00Z', channel, 'src:' + jid, location))

    def posting(self, jid, url, company='Acme', title='Ops Lead', location='Remote'):
        return {'id': jid, 'url': url, 'company': company, 'title': title, 'location': location, 'description': 'x'}


class OneReadPerRun(Base):
    def test_active_jobs_are_read_once_for_the_duplicate_check_the_closures_and_the_job_site_check(self):
        self.job('ds:a', 'https://e.com/a'); self.job('ds:b', 'https://e.com/b', company='B'); self.job('js:c', 'https://e.com/c', company='C', channel='JOB_SITES')
        cache = {}
        with mock.patch.object(dd, 'd1', self.d1), tempfile.TemporaryDirectory() as d:
            fresh, _, _ = dd.split_new([self.posting('ds:a', 'https://e.com/a'), self.posting('ds:n', 'https://e.com/n', 'Acme', 'Ops Lead', 'Remote')], cache=cache)
            self.assertEqual(fresh, [], 'same employer, title and place as a stored job: not stored twice')
            snap = Path(d) / dd.ACTIVE_SNAPSHOT
            dd.write_stored_snapshot(snap, cache)
            tracked = [r for r in dd.stored_jobs(None, None, cache)[0] if r['source_channel'] == 'ATS_DATASET']
            self.assertEqual(sorted(r['id'] for r in tracked), ['ds:a', 'ds:b'], 'the closures see the same tracked jobs')
            full_scans = [c for c in self.calls if c == dd.ACTIVE_SQL]
            self.assertEqual(len(full_scans), 1)
            # the job-site check (another process) uses the snapshot: no second full read, ids and URLs still checked live
            self.calls.clear()
            fresh2, _, _ = dd.split_new([self.posting('js:new', 'https://e.com/z', 'B', 'Ops Lead', 'Remote')], snapshot=snap)
            self.assertEqual(fresh2, [], 'B / Ops Lead / Remote is stored (from the snapshot)')
            self.assertNotIn(dd.ACTIVE_SQL, self.calls)
            self.assertTrue(any('FROM jobs WHERE id IN' in c for c in self.calls))
            # an old snapshot is not trusted
            data = json.loads(snap.read_text()); data['at'] -= dd.SNAPSHOT_MAX_AGE_S + 1; snap.write_text(json.dumps(data))
            self.calls.clear()
            dd.split_new([self.posting('js:new2', 'https://e.com/y', 'Q')], snapshot=snap)
            self.assertIn(dd.ACTIVE_SQL, self.calls)

    def test_known_ids_are_not_looked_up_by_url(self):
        self.job('ds:a', 'https://e.com/a')
        with mock.patch.object(dd, 'd1', self.d1):
            dd.split_new([self.posting('ds:a', 'https://e.com/a')])
        self.assertFalse([c for c in self.calls if 'source_url IN' in c], 'a stored id needs no URL check')


OLD_TASTE_TARGETS = """SELECT q.candidate_id, q.job_id, j.title, j.company, s.overall_score AS score, s.score_breakdown, q.qualification_reason AS reason
          FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id JOIN candidate_job_scores s ON s.candidate_id = q.candidate_id AND s.job_id = q.job_id
          WHERE q.candidate_id = '{c}' AND j.is_active = 1 AND q.manual_override_status IS NULL
            AND COALESCE(q.qualification_reason, '') NOT LIKE 'You marked%'
            AND (q.qualification_status IN ('NEEDS_REVIEW','HOLD') OR q.qualification_reason LIKE 'Shortlisted automatically.%')
            AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = q.candidate_id AND a.job_id = q.job_id)
          ORDER BY s.overall_score DESC, q.job_id LIMIT {n}"""


class TasteTargets(Base):
    def test_same_rows_in_the_same_order_as_before(self):
        import random
        rnd = random.Random(3)
        self.db.execute("INSERT INTO candidates(id, full_name) VALUES ('sana_ansari', 'S')")
        for i in range(600):
            self.job(f'j{i:03d}', f'https://e.com/{i}', active=1 if i % 7 else 0)
            for c in ('farhan_shaikh', 'sana_ansari'):
                st = rnd.choice(['NEEDS_REVIEW', 'HOLD', 'INELIGIBLE', 'READY'])
                reason = rnd.choice(['x', 'You marked this Not for me', 'Shortlisted automatically. y'])
                self.db.execute("INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,qualification_reason,manual_override_status) VALUES (?,?,?,?,?)",
                                (c, f'j{i:03d}', st, reason, 'HOLD' if rnd.random() < 0.05 else None))
                self.db.execute("INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score) VALUES (?,?,?)", (c, f'j{i:03d}', rnd.randint(0, 100)))
        for i in range(0, 600, 41):
            self.db.execute("INSERT INTO applications(id,candidate_id,job_id) VALUES (?,?,?)", (f'a{i}', 'farhan_shaikh', f'j{i:03d}'))
        with mock.patch.object(dd, 'd1', self.d1):
            new = dd.taste_targets(per_candidate=120)
        old = []
        for c in ('farhan_shaikh', 'sana_ansari'):
            old += [dict(r) for r in self.db.execute(OLD_TASTE_TARGETS.format(c=c, n=120)).fetchall()]
        self.assertEqual(new, old)
        self.assertEqual(len(new), 240)


class LegacyGate(Base):
    def test_scan_skipped_while_the_last_one_found_nothing_under_the_same_rules(self):
        with mock.patch.object(dd, 'd1', self.d1):
            self.assertEqual(dd.legacy_rows(['farhan_shaikh'], gate=True), [])
            scans = len([c for c in self.calls if 'AS legacy' in c])
            self.assertEqual(scans, 1)
            state = json.loads(self.db.execute("SELECT value FROM discovery_state WHERE key = 'legacy_scan'").fetchone()[0])
            self.assertEqual((state['marker'], state['found']), (dd.RULES_MARKER, 0))
            dd.legacy_rows(['farhan_shaikh'], gate=True)
            self.assertEqual(len([c for c in self.calls if 'AS legacy' in c]), 1, 'not scanned again the next day')
            dd.legacy_rows(['farhan_shaikh'])
            self.assertEqual(len([c for c in self.calls if 'AS legacy' in c]), 2, 'ungated calls always scan')
            old = (datetime.now(timezone.utc) - timedelta(days=dd.LEGACY_RESCAN_DAYS + 1)).strftime('%Y-%m-%dT%H:%M:%SZ')
            self.db.execute("UPDATE discovery_state SET value = ? WHERE key = 'legacy_scan'", (json.dumps({**state, 'at': old}),))
            dd.legacy_rows(['farhan_shaikh'], gate=True)
            self.assertEqual(len([c for c in self.calls if 'AS legacy' in c]), 3, 'scanned again after a week')
            self.db.execute("UPDATE discovery_state SET value = ? WHERE key = 'legacy_scan'", (json.dumps({**state, 'marker': 'profile_v0'}),))
            dd.legacy_rows(['farhan_shaikh'], gate=True)
            self.assertEqual(len([c for c in self.calls if 'AS legacy' in c]), 4, 'and at once after a rules bump')

    def test_rows_found_means_scan_again(self):
        self.job('j1', 'https://e.com/1')
        self.db.execute("INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,qualification_reason) VALUES ('farhan_shaikh','j1','NEEDS_REVIEW','Preserved')")
        with mock.patch.object(dd, 'd1', self.d1):
            self.assertEqual(len(dd.legacy_rows(['farhan_shaikh'], gate=True)), 1)
            self.assertEqual(len(dd.legacy_rows(['farhan_shaikh'], gate=True)), 1, 'the last scan found rows: it runs again')


if __name__ == '__main__':
    unittest.main()
