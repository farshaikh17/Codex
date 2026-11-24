"""Jobs QA 12 (24 Nov), engine side: more hiring systems' own answers for a closed posting. A SuccessFactors page saying the position has been
filled; a JazzHR posting URL that lands on the board's job list without the posting; a UKG OpportunityDetail page without its opportunity data, or
saying it is an internal opportunity; an amazon.jobs apply link checked at its public page, where a closed job is a 404. Invented pages only."""
import io
import unittest
import urllib.error
from unittest import mock

from engine import liveness


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


def opener(pages, redirects=None, seen=None):
    """pages: url -> body (bytes) or an HTTP status; redirects: url -> final url."""
    def open_(req, timeout=20):
        url = req.full_url
        if seen is not None:
            seen.append(url)
        final = (redirects or {}).get(url, url)
        body = pages[final]
        if isinstance(body, int):
            raise urllib.error.HTTPError(url, body, 'x', {}, io.BytesIO(b''))
        return Response(body, final)
    return open_


def probe(url, pages, redirects=None, seen=None):
    with mock.patch.object(liveness.urllib.request, 'urlopen', opener(pages, redirects, seen)):
        return liveness.probe(url, facts={})


class FilledPage(unittest.TestCase):
    def test_sorry_this_position_has_been_filled_is_closed(self):
        url = 'https://jobs.example.com/job/Plant-Maintenance/1/'
        self.assertEqual(probe(url, {url: b'<p>Sorry, this position has been filled.</p>'}), ('dead', 'position filled page'))
        self.assertEqual(probe(url, {url: b'<p>This position is open. Apply now.</p>'})[0], 'alive')

    def test_the_phrase_in_a_script_block_is_not_the_page_saying_so(self):   # review of #249
        url = 'https://careers.example.org/jobs/7'
        page = b'<script>var msgs={filled:"Sorry, this position has been filled."}</script><h1>Plant Engineer</h1><p>Apply now.</p>'
        self.assertEqual(probe(url, {url: page})[0], 'alive')


class JazzHR(unittest.TestCase):
    URL = 'https://acme.applytojob.com/apply/jobs/details/64FaArERCz'
    LIST = 'https://acme.applytojob.com/apply/jobs'

    def test_a_redirect_to_the_list_without_the_posting_is_closed(self):
        page = b'<title>Job Listings</title>' + b'<a href="/apply/jobs/details/bzWI99viVn">Lecturer</a>' * 50
        self.assertEqual(probe(self.URL, {self.LIST: page}, {self.URL: self.LIST}), ('dead', 'jazzhr posting gone from the board list'))

    def test_a_redirect_elsewhere_or_a_list_cut_off_proves_nothing(self):   # review of #249
        signin = 'https://acme.applytojob.com/login'
        self.assertEqual(probe(self.URL, {signin: b'<form>Sign in</form>'}, {self.URL: signin})[0], 'unknown')
        other = 'https://status.example.com/apply/jobs'
        self.assertEqual(probe(self.URL, {other: b'<p>Down for maintenance</p>'}, {self.URL: other})[0], 'unknown', 'another host')
        long_list = b'<a href="/apply/jobs/details/bzWI99viVn">Lecturer</a>' * 20000   # past the 512 KB bound: cut off
        self.assertGreater(len(long_list), liveness.JAZZHR_LIST_BYTES)
        self.assertEqual(probe(self.URL, {self.LIST: long_list}, {self.URL: self.LIST})[0], 'unknown')

    def test_the_posting_page_or_a_list_still_carrying_it_is_open(self):
        self.assertEqual(probe(self.URL, {self.URL: b'<h1>Marketing Automation Manager</h1>'})[0], 'alive')
        page = b'<a href="/apply/jobs/details/64FaArERCz">Marketing Automation Manager</a>'
        self.assertEqual(probe(self.URL, {self.LIST: page}, {self.URL: self.LIST})[0], 'alive')


class UKG(unittest.TestCase):
    ID = '78ebc7b5-8df2-49be-a3d2-32d347245085'
    URL = 'https://recruiting.ultipro.com/ACME1000/JobBoard/c34cd0cf-aee3-47f1-bc4b-530112a37fed/OpportunityDetail?opportunityId=' + ID

    def test_open_closed_and_missing_opportunity_data(self):
        open_page = ('<script>new US.Opportunity.CandidateOpportunityDetail({"Id":"%s","Title":"Senior Project Manager","OpportunityIsClosed":false})</script>' % self.ID).encode()
        self.assertEqual(probe(self.URL, {self.URL: b'x' * 50000 + open_page})[0], 'alive')
        self.assertEqual(probe(self.URL, {self.URL: open_page.replace(b'"OpportunityIsClosed":false', b'"OpportunityIsClosed":true')}), ('dead', 'ukg opportunity closed'))
        # review of #249: missing data is no positive signal; it proves nothing (the usual reading: the page answered)
        self.assertNotEqual(probe(self.URL, {self.URL: b'<script>var flags=["OpportunityList"]</script>'})[0], 'dead')
        internal = b'This is an internal opportunity. To view this opportunity, please log in through your company portal.'
        self.assertEqual(probe(self.URL, {self.URL: internal})[0], 'dead')

    def test_other_pages_are_not_read_as_ukg(self):
        url = 'https://careers.example.com/OpportunityDetail?opportunityId=' + self.ID
        self.assertEqual(probe(url, {url: b'<h1>Senior Project Manager</h1>'})[0], 'alive')


class Amazon(unittest.TestCase):
    def test_an_apply_link_is_checked_at_its_public_page(self):
        self.assertEqual(liveness.public_url('https://account.amazon.jobs/jobs/10523559/apply'), 'https://www.amazon.jobs/en/jobs/10523559')
        self.assertEqual(liveness.public_url('https://account.amazon.jobs/en-US/jobs/10523559'), 'https://www.amazon.jobs/en/jobs/10523559')
        self.assertEqual(liveness.public_url('https://www.amazon.jobs/en/jobs/10523559'), 'https://www.amazon.jobs/en/jobs/10523559')
        seen = []
        state = probe('https://account.amazon.jobs/jobs/10523559/apply', {'https://www.amazon.jobs/en/jobs/10523559': 404}, seen=seen)
        self.assertEqual((state[0], seen), ('dead', ['https://www.amazon.jobs/en/jobs/10523559']))
        self.assertEqual(probe('https://account.amazon.jobs/jobs/1/apply', {'https://www.amazon.jobs/en/jobs/1': b'<h1>Reliability Engineer</h1>'})[0], 'alive')


if __name__ == '__main__':
    unittest.main()
