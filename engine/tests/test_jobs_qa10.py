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
                 'location': 'HR, India', 'description': TEXT}
        other = {**board, 'id': 'js:indeed:2', 'url': 'https://in.indeed.com/viewjob?jk=2', 'apply_url': self.ATS.replace('28315', '28316')}
        stored = [{'source_url': self.ATS, 'source_channel': 'ATS_DATASET'}]
        self.assertEqual(dd.board_twins([board, other], stored, []), ([other], ['js:indeed:1']))
        self.assertEqual(dd.board_twins([board, other], [], [{'url': self.ATS, 'title': 'x', 'description': ''}]), ([other], ['js:indeed:1']))
        self.assertEqual(dd.board_twins([board], [{'source_url': self.BOARD_APPLY, 'source_channel': 'JOB_SITES'}], [])[1], [], 'only an employer copy counts')

    def test_the_same_text_on_one_site_is_one_posting_another_city_is_not(self):
        a = {'id': 'ds:sf:a', 'url': 'https://jobs.example.com/job/Jubail-Electrical-Engineer/1362757155/', 'title': 'Electrical Engineer', 'location': 'Jubail, SA', 'description': TEXT}
        b = {**a, 'id': 'js:sf:b', 'url': 'https://jobs.example.com/job/Jubail-Electrical-Engineer/1334210455/?feedId=null&utm_source=J2WRSS'}
        c = {**a, 'id': 'ds:sf:c', 'url': 'https://jobs.example.com/job/Yanbu-Electrical-Engineer/1/', 'location': 'Yanbu, SA'}
        short = {**a, 'id': 'ds:sf:d', 'description': 'Electrical Engineer.'}
        self.assertEqual(dd.same_text_twins([a, b, c, short]), ([a, c, short], ['js:sf:b']))
        self.assertEqual(dd.board_twins([b], [], [a])[1], ['js:sf:b'])
        self.assertEqual(dd.board_twins([c], [], [a])[1], [], 'another city goes to the many-cities rule')


if __name__ == '__main__':
    unittest.main()
