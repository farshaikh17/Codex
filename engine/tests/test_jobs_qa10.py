"""Jobs QA 10 (22 Nov), engine side: a SuccessFactors page saying the job is not available is a closed posting; a job board's copy of an employer's
requisition (the same Oracle requisition with ':443' and no site part in its apply link) or the same text twice on one employer site is one posting,
and the employer's copy is kept; an empty place is filled from the employer's own posting page (Avature 'Location(s)', the country in the URL).
Invented postings only."""
import io
import sqlite3
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

from engine import dataset_discovery as dd
from engine import liveness

ROOT = Path(__file__).resolve().parents[2]
TEXT = 'Supervise a team of maintenance foremen and technicians at the power and desalination plant; plan preventive maintenance of switchgear, ' * 3


class Response(io.BytesIO):
    def __init__(self, body, url):
        super().__init__(body)
        self.status, self._url = 200, url

    def geturl(self):
        return self._url

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def opener(pages):
    return lambda req, timeout=20: Response(pages[req.full_url], req.full_url)


class ClosedPage(unittest.TestCase):
    CLOSED = "<p class=\"jobErrMsg\"><strong>You can't view this job because it's not available at this time.</strong></p>"

    def test_the_successfactors_words_are_a_closed_page(self):
        self.assertEqual(liveness.closed_page(self.CLOSED), 'successfactors closed page')
        self.assertEqual(liveness.closed_page(self.CLOSED.replace("'", '&#39;')), 'successfactors closed page')
        self.assertIsNone(liveness.closed_page('<p>Apply now: Electrical Engineer, Jubail</p>'))

    def test_a_successfactors_page_is_read_past_64_kb_and_closes_the_job(self):
        url = 'https://jobs.example.com/job/Jubail-Electrical-Engineer/1362757155/'
        body = b'<html><link href="/platform/css/j2w/min/rmk-base.css">' + b' ' * 200000 + self.CLOSED.encode() + b'</html>'
        with mock.patch.object(liveness.urllib.request, 'urlopen', opener({url: body})):
            self.assertEqual(liveness.probe(url, facts={}), ('dead', 'successfactors closed page'))
        open_page = b'<html><link href="/platform/css/j2w/min/rmk-base.css">' + b' ' * 200000 + b'<h1>Electrical Engineer</h1></html>'
        with mock.patch.object(liveness.urllib.request, 'urlopen', opener({url: open_page})):
            self.assertEqual(liveness.probe(url, facts={})[0], 'alive')

    def test_other_pages_are_not_read_further(self):
        url = 'https://careers.example.org/jobs/1'
        body = b'<html>' + b' ' * 70000 + self.CLOSED.encode()   # past 64 KB on a page that does not name SuccessFactors
        with mock.patch.object(liveness.urllib.request, 'urlopen', opener({url: body})):
            self.assertEqual(liveness.probe(url, facts={})[0], 'alive')


class EmptyPlace(unittest.TestCase):
    URL = 'https://acme.avature.net/en_US/careers/JobDetail/United-States-Utility-Engineer/195640'
    PAGE = ('<div class="article__content__view__field__label">\n  Location(s)\n </div>\n'
            '<div class="article__content__view__field__value">\n   Lincoln, Nebraska\n </div>')

    def test_avature_page_and_url_give_the_place(self):
        self.assertEqual(liveness.avature_facts(self.PAGE, self.URL), {'location': 'Lincoln, Nebraska', 'countries': ['United States']})
        self.assertEqual(liveness.avature_facts('', 'https://acme.avature.net/en_US/careers/JobDetail/India-Plant-Engineer/1'), {'countries': ['India']})
        self.assertEqual(liveness.avature_facts('', 'https://acme.avature.net/en_US/careers/JobDetail/Utility-Engineer/1'), {})
        with mock.patch.object(liveness.urllib.request, 'urlopen', opener({self.URL: self.PAGE.encode()})):
            facts = {}
            self.assertEqual(liveness.probe(self.URL, facts=facts)[0], 'alive')
        self.assertEqual(facts['location'], 'Lincoln, Nebraska')

    def _db(self):
        db = sqlite3.connect(':memory:')
        for f in sorted((ROOT / 'dashboard' / 'migrations').glob('*.sql')):
            db.executescript(f.read_text())
        db.executescript("INSERT INTO candidates(id, full_name) VALUES ('s','S');")
        for jid, loc in (('empty', ''), ('none', None), ('kept', 'Pune, India')):
            db.execute('INSERT INTO jobs(id,title,company,source_adapter,source_url,is_active,location_restrictions,workplace_type,discovered_at) VALUES (?,?,?,?,?,1,?,?,?)',
                       (jid, 'Utilities Engineer', 'Acme', 'avature', 'https://e.com/' + jid, loc, 'ONSITE', '2026-11-22'))
            db.execute('INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score,score_breakdown) VALUES (?,?,?,?)',
                       ('s', jid, 90, '{"preliminary":true,"%s":true}' % dd.RULES_MARKER))
        return db

    def test_an_empty_place_is_filled_once_and_a_stored_place_is_kept(self):
        db = self._db()
        facts = {'location': 'Lincoln, Nebraska', 'countries': ['United States']}
        india = {'location': 'Mumbai', 'countries': ['India']}
        sql = liveness.to_sql({'dead': [], 'alive': ['empty', 'none', 'kept'], 'unknown': 0, 'facts': {'empty': facts, 'none': facts, 'kept': india}})
        db.executescript(sql)
        place = dict(db.execute('SELECT id, location_restrictions FROM jobs').fetchall())
        self.assertEqual(place['empty'], 'Lincoln, Nebraska (United States)')
        self.assertEqual(place['none'], 'Lincoln, Nebraska (United States)')
        self.assertEqual(place['kept'], 'Pune, India', 'a stored place is never replaced by the fill')
        marked = dict(db.execute('SELECT job_id, score_breakdown LIKE ? FROM candidate_job_scores', ('%"' + dd.RULES_MARKER + '":true%',)).fetchall())
        self.assertEqual((marked['empty'], marked['none']), (0, 0), 'a filled job is re-scored under the current rules')
        db.executescript(sql)   # a second run changes nothing
        self.assertEqual(dict(db.execute('SELECT id, location_restrictions FROM jobs').fetchall()), place)


class BoardCopies(unittest.TestCase):
    ATS = 'https://abcd.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/28315'
    BOARD_APPLY = 'https://abcd.fa.em2.oraclecloud.com:443/hcmUI/CandidateExperience/en/job/28315'

    def test_an_oracle_requisition_keys_by_host_and_id(self):
        self.assertEqual(dd.posting_url_key(self.ATS), dd.posting_url_key(self.BOARD_APPLY))
        self.assertEqual(dd.posting_url_key(self.ATS), 'abcd.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/job/28315')
        self.assertNotEqual(dd.posting_url_key(self.ATS), dd.posting_url_key(self.ATS.replace('28315', '28316')))
        self.assertNotEqual(dd.posting_url_key(self.ATS), dd.posting_url_key(self.ATS.replace('abcd', 'wxyz')))

    def test_a_board_copy_of_a_stored_or_same_run_employer_posting_is_dropped(self):
        board = {'id': 'js:indeed:1', 'url': 'https://in.indeed.com/viewjob?jk=1', 'apply_url': self.BOARD_APPLY, 'title': 'Senior Executive - Electrical',
                 'location': 'HR, India', 'description': TEXT, 'company': 'Acme Terminals'}
        other = {**board, 'id': 'js:indeed:2', 'url': 'https://in.indeed.com/viewjob?jk=2', 'apply_url': self.ATS.replace('28315', '28316')}
        stored = [{'source_url': self.ATS, 't': 'Senior Executive - Electrical', 'source_channel': 'ATS_DATASET'}]
        self.assertEqual(dd.board_twins([board, other], stored, []), ([other], ['js:indeed:1']))
        self.assertEqual(dd.board_twins([board, other], [], [{'url': self.ATS, 'title': 'Senior Executive - Electrical', 'description': ''}]), ([other], ['js:indeed:1']))
        self.assertEqual(dd.board_twins([board], [{'source_url': self.BOARD_APPLY, 't': board['title'], 'source_channel': 'JOB_SITES'}], [])[1], [], 'only an employer copy counts')

    def test_a_shared_careers_url_does_not_merge_different_jobs(self):   # review of #247: keyed on (URL, title), as split_new does
        careers = 'https://careers.example.com/jobs'
        board = {'id': 'js:indeed:3', 'url': 'https://in.indeed.com/viewjob?jk=3', 'apply_url': careers + '?utm_source=indeed', 'title': 'Reliability Engineer',
                 'location': 'Pune', 'description': TEXT, 'company': 'Acme'}
        stored = [{'source_url': careers, 't': 'Maintenance Engineer', 'source_channel': 'ATS_DATASET'}]
        self.assertEqual(dd.board_twins([board], stored, []), ([board], []))
        self.assertEqual(dd.board_twins([board], [{**stored[0], 't': 'Reliability  engineer'}], [])[1], ['js:indeed:3'], 'the same title is the same job')

    def test_the_same_text_on_one_site_is_one_posting_another_city_is_not(self):
        a = {'id': 'ds:sf:a', 'url': 'https://jobs.example.com/job/Jubail-Electrical-Engineer/1362757155/', 'title': 'Electrical Engineer', 'location': 'Jubail, SA',
             'description': TEXT, 'company': 'Acme Energy'}
        b = {**a, 'id': 'js:sf:b', 'url': 'https://jobs.example.com/job/Jubail-Electrical-Engineer/1334210455/?feedId=null&utm_source=J2WRSS'}
        c = {**a, 'id': 'ds:sf:c', 'url': 'https://jobs.example.com/job/Yanbu-Electrical-Engineer/1/', 'location': 'Yanbu, SA'}
        short = {**a, 'id': 'ds:sf:d', 'description': 'Electrical Engineer.'}
        self.assertEqual(dd.same_text_twins([a, b, c, short]), ([a, c, short], ['js:sf:b']))
        self.assertEqual(dd.board_twins([b], [], [a])[1], ['js:sf:b'])
        self.assertEqual(dd.board_twins([c], [], [a])[1], [], 'another city goes to the many-cities rule')
        self.assertEqual(dd.board_twins([{**b, 'company': 'Acme Energy Information Technologies SA'}], [], [a])[1], ['js:sf:b'], 'one employer written two ways')

    def test_a_shared_ats_host_keeps_two_employers_apart(self):   # review of #247: jobs.lever.co serves many employers
        a = {'id': 'ds:lever:a', 'url': 'https://jobs.lever.co/acme/1', 'title': 'Implementation Manager', 'location': 'Remote', 'description': TEXT, 'company': 'Acme'}
        b = {**a, 'id': 'ds:lever:b', 'url': 'https://jobs.lever.co/globex/2', 'company': 'Globex'}
        self.assertEqual(dd.same_text_twins([a, b]), ([a, b], []))

    def test_one_text_reading_shared_with_the_selector(self):   # review of #247: the same output as twinText() in discovery.ts
        self.assertEqual(dd.twin_text("<p>Plan &amp; run the plant&#39;s boilers &rsquo;&#x41;</p> CAPEX"), 'plan run the plant s boilers a capex')
        self.assertEqual(dd.twin_text('Plan &amp; run'), dd.twin_text('Plan & run'))
        self.assertEqual(dd.twin_text('x' * 2000 + ' tail'), 'x' * 2000)
        self.assertEqual((dd.twin_employer('The Convergence Foundation'), dd.twin_employer('ENGIE Information Technologies SA')), ('convergence', 'engie'))


class DedupeReads(unittest.TestCase):   # review of #247: the read diet
    def _run(self, jobs, tmp):
        raw = Path(tmp) / 'jobsite_raw.json'
        raw.write_text(__import__('json').dumps({'jobs': jobs}))
        reads = []
        def d1(sql, local=None, **k):
            reads.append(sql)
            return []
        argv = ['dataset_discovery.py', '--dedupe', str(raw), '--out', tmp, '--no-name-lookup']
        with mock.patch.object(dd, 'd1', d1), mock.patch.object(dd.sys, 'argv', argv), mock.patch.object(dd, 'safe_names', lambda j, l=True: 0):
            self.assertEqual(dd.main(), 0)
        return reads

    def test_an_empty_job_site_file_reads_nothing(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(self._run([], tmp), [])

    def test_the_stored_jobs_are_read_once_for_both_checks(self):
        import tempfile
        job = {'id': 'js:indeed:9', 'url': 'https://in.indeed.com/viewjob?jk=9', 'apply_url': None, 'title': 'Plant Engineer', 'company': 'Acme',
               'location': 'Pune', 'description': TEXT}
        with tempfile.TemporaryDirectory() as tmp:
            reads = self._run([job], tmp)
        self.assertEqual(sum(1 for q in reads if q == dd.ACTIVE_SQL), 1, 'board_twins and split_new share one read of the stored jobs')


if __name__ == '__main__':
    unittest.main()
