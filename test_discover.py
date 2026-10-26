import json,unittest
from pathlib import Path
import discover
from discover import Blocked,detect_board,discover as run,parse_page,unsupported_ats
ROOT=Path(__file__).resolve().parent
SOURCES=json.loads((ROOT/'sources.json').read_text())
EMPLOYERS=json.loads((ROOT/'employers.json').read_text())
ROBOTS_OK=(200,'','User-agent: *\nAllow: /\n')
class Site:
    """Fake web: {url: (status, final_url, html)} plus a log of every request."""
    def __init__(self,pages,robots=ROBOTS_OK):
        self.pages,self.robots,self.log=pages,robots,[]
    def get(self,url,allowed,limits):
        self.log.append(url)
        if url.endswith('/robots.txt'): return self.robots
        if url not in self.pages: return 404,url,''
        got=self.pages[url]
        if isinstance(got,Exception): raise got
        return got
def feed_with(jobs):
    calls=[]
    def feed(source):
        calls.append(source['url'])
        return {'jobs':jobs} if source['provider']!='lever' else jobs
    feed.calls=calls
    return feed
def target(employer='acme',url='https://acme.example/careers',**kw):
    return dict({'employer':employer,'start_url':url},**kw)
def go(site,targets,feed=None,**limits):
    return run(targets,SOURCES,EMPLOYERS,get=site.get,feed=feed or feed_with([{'id':1}]),limits=limits,pause=lambda _:None,now='2026-10-26T00:00:00+00:00')
class DetectionTests(unittest.TestCase):
    def test_board_urls(self):
        self.assertEqual(detect_board('https://job-boards.greenhouse.io/acme/jobs/123'),('greenhouse','acme'))
        self.assertEqual(detect_board('https://boards.greenhouse.io/embed/job_board?for=acme&b=x'),('greenhouse','acme'))
        self.assertEqual(detect_board('https://boards.greenhouse.io/embed/job_board/js?for=acme'),('greenhouse','acme'))
        self.assertEqual(detect_board('https://boards-api.greenhouse.io/v1/boards/acme/jobs'),('greenhouse','acme'))
        self.assertEqual(detect_board('https://jobs.lever.co/acme/abc-123'),('lever','acme'))
        self.assertEqual(detect_board('https://jobs.ashbyhq.com/Acme.Co'),('ashby','Acme.Co'))
        self.assertIsNone(detect_board('https://jobs.lever.co/'))
        self.assertIsNone(detect_board('https://greenhouse.io/blog'))
        self.assertIsNone(detect_board('https://boards.greenhouse.io/embed/job_board?for=../../x'))
    def test_unsupported_ats_recorded_not_followed(self):
        self.assertEqual(unsupported_ats('https://acme.wd5.myworkdayjobs.com/External'),'workday')
        self.assertEqual(unsupported_ats('https://job-boards.eu.greenhouse.io/acme'),'greenhouse-eu')
        self.assertIsNone(unsupported_ats('https://acme.example/jobs'))
    def test_json_ld_job_postings(self):
        html='<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"JobPosting","url":"https://jobs.lever.co/acme/1"}]}</script>'
        links,postings=parse_page(html,'https://acme.example/careers')
        self.assertEqual(postings,1)
        self.assertIn(('json-ld','https://jobs.lever.co/acme/1'),links)
class BoundTests(unittest.TestCase):
    def test_depth_one_same_host_job_pages_only(self):
        site=Site({'https://acme.example/careers':(200,'https://acme.example/careers',
                    '<a href="/careers/engineering">Eng</a><a href="https://other.example/jobs">Other</a><a href="/blog">Blog</a>'),
                   'https://acme.example/careers/engineering':(200,'https://acme.example/careers/engineering','<a href="/careers/engineering/deeper">deeper</a>')})
        go(site,[target()],sitemaps=False)
        self.assertIn('https://acme.example/careers/engineering',site.log)
        self.assertNotIn('https://other.example/jobs',site.log)   # off the allowed hosts
        self.assertNotIn('https://acme.example/blog',site.log)    # not a jobs page
        self.assertNotIn('https://acme.example/careers/engineering/deeper',site.log)  # depth 2
    def test_only_anchor_links_to_pages_are_followed(self):
        # Found live on getweave.com: a Next.js chunk with "careers" in its path was queued as a page.
        site=Site({'https://acme.example/careers':(200,'https://acme.example/careers',
                    '<script src="/_next/static/chunks/app/careers/page-1.js"></script><link href="/careers/style.css">'
                    '<a href="/careers/brochure.pdf">pdf</a><form action="/careers/apply"></form><a href="/careers/team">team</a>')})
        go(site,[target()],sitemaps=False)
        self.assertEqual([u for u in site.log if not u.endswith('robots.txt')],['https://acme.example/careers','https://acme.example/careers/team'])
    def test_page_and_request_budgets_are_hard_caps(self):
        links=''.join('<a href="/jobs/%d">j</a>'%n for n in range(50))
        pages={'https://acme.example/careers':(200,'https://acme.example/careers',links)}
        pages.update({'https://acme.example/jobs/%d'%n:(200,'https://acme.example/jobs/%d'%n,'') for n in range(50)})
        site=Site(pages)
        report=go(site,[target()],max_pages=99,max_requests=99,sitemaps=False)
        self.assertEqual(report['limits']['max_pages'],discover.LIMITS['max_pages_cap'])
        self.assertLessEqual(len([u for u in site.log if not u.endswith('robots.txt')]),discover.LIMITS['max_pages_cap'])
        site=Site(pages)
        report=go(site,[target(),target('other','https://acme.example/jobs/1')],max_requests=3,sitemaps=False)
        self.assertEqual(len(site.log),3)
        self.assertIn('request budget 3 reached',report['halted'])
        self.assertIn('run halted',report['targets'][1]['stopped'])
    def test_robots_disallow_and_unreachable_block(self):
        site=Site({'https://acme.example/careers':(200,'https://acme.example/careers','x')},robots=(200,'','User-agent: *\nDisallow: /careers\n'))
        report=go(site,[target()],sitemaps=False)
        self.assertEqual(site.log,['https://acme.example/robots.txt'])
        self.assertEqual(report['targets'][0]['pages'][0]['result'],'blocked')
        site=Site({},robots=(503,'',''))
        self.assertIn('server error',go(site,[target()])['targets'][0]['pages'][0]['reason'])
        for failure,reason in ((Blocked('redirect off the allowed hosts to cdn.example'),'robots.txt: redirect off'),
                               (OSError('timed out'),'robots.txt unreachable: timed out')):
            site=Site({'https://acme.example/careers':(200,'https://acme.example/careers','x')},robots=failure)
            site.get=lambda url,allowed,limits,site=site,failure=failure:(site.log.append(url),(_ for _ in ()).throw(failure))[1] if url.endswith('robots.txt') else Site.get(site,url,allowed,limits)
            page=go(site,[target()])['targets'][0]['pages'][0]
            self.assertEqual(page['result'],'blocked')
            self.assertIn(reason,page['reason'])
            self.assertNotIn('https://acme.example/careers',site.log)  # nothing fetched without a robots decision
    def test_access_restrictions_stop_the_host(self):
        site=Site({'https://acme.example/careers':(200,'https://acme.example/careers','<div class="g-recaptcha"></div><a href="/jobs/1">j</a>')})
        report=go(site,[target()])
        self.assertEqual(report['targets'][0]['pages'][-1]['result'],'blocked')
        self.assertNotIn('https://acme.example/jobs/1',site.log)
        site=Site({'https://acme.example/careers':(429,'https://acme.example/careers','')})
        report=go(site,[target(),target('other','https://other.example/careers')])
        self.assertIn('rate limited',report['halted'])
        self.assertNotIn('https://other.example/robots.txt',site.log)
    def test_off_host_redirect_is_blocked(self):
        site=Site({'https://acme.example/careers':Blocked('redirect off the allowed hosts to evil.example')})
        page=go(site,[target()])['targets'][0]['pages'][-1]
        self.assertEqual((page['result'],page['reason']),('blocked','redirect off the allowed hosts to evil.example'))
    def test_cross_host_redirect_checks_destination_robots(self):
        class Two(Site):
            def get(self,url,allowed,limits):
                self.log.append(url)
                if url=='https://acme.example/robots.txt': return ROBOTS_OK
                if url=='https://careers.acme.example/robots.txt': return (200,'','User-agent: *\nDisallow: /\n')
                if url=='https://acme.example/careers': return (200,'https://careers.acme.example/','<a href="https://jobs.lever.co/acme">jobs</a>')
                return 404,url,''
        site=Two({})
        t=go(site,[target(allowed_hosts=['acme.example','careers.acme.example'])])['targets'][0]
        self.assertIn('https://careers.acme.example/robots.txt',site.log)
        self.assertEqual(t['pages'][-1]['result'],'blocked')
        self.assertIn('redirect target careers.acme.example: disallowed by robots.txt',t['pages'][-1]['reason'])
        self.assertEqual(t['boards'],[])  # nothing taken from a page its host disallows
    def test_redirect_target_not_fetched_twice(self):
        # Found live: clipboardhealth.com/careers redirects to clipboard.com/careers, which links to itself.
        site=Site({'https://acme.example/careers':(200,'https://acme.example/jobs','<a href="/jobs">Jobs</a>')})
        go(site,[target()],sitemaps=False)
        self.assertEqual([u for u in site.log if not u.endswith('robots.txt')],['https://acme.example/careers'])
    def test_sitemap_read_once_within_scope(self):
        site=Site({'https://acme.example/sitemap.xml':(200,'','<loc>https://acme.example/jobs/9</loc><loc>https://acme.example/blog/1</loc><loc>https://x.example/jobs/1</loc>'),
                   'https://acme.example/careers':(200,'https://acme.example/careers',''),
                   'https://acme.example/jobs/9':(200,'https://acme.example/jobs/9','<a href="https://jobs.ashbyhq.com/acme">Open roles</a>')},
                  robots=(200,'','User-agent: *\nAllow: /\nSitemap: https://acme.example/sitemap.xml\n'))
        report=go(site,[target()])
        self.assertIn('https://acme.example/jobs/9',site.log)
        self.assertNotIn('https://acme.example/blog/1',site.log)
        self.assertEqual(report['targets'][0]['boards'][0]['board'],'acme')
    def test_targets_validated(self):
        with self.assertRaises(ValueError): go(Site({}),[target(url='http://acme.example/careers')])
        with self.assertRaises(ValueError): go(Site({}),[target(employer='Bad Id')])
        with self.assertRaises(ValueError): go(Site({}),[target(allowed_hosts=['other.example'])])
class ProposalTests(unittest.TestCase):
    def test_new_board_verified_and_validated_never_written(self):
        before=(ROOT/'sources.json').read_bytes()
        site=Site({'https://acme.example/careers':(200,'https://acme.example/careers','<iframe src="https://boards.greenhouse.io/embed/job_board?for=acmeco"></iframe>')})
        feed=feed_with([{'id':1},{'id':2}])
        b=go(site,[target()],feed=feed)['targets'][0]['boards'][0]
        self.assertEqual((b['status'],b['feed_jobs'],b['registry_problems'],b['employer_entry_needed']),('verified_feed',2,[],True))
        self.assertEqual(b['proposed_source'],{'id':'acmeco-greenhouse','employer':'acme','provider':'greenhouse','board':'acmeco'})
        self.assertEqual(feed.calls,[discover.registry.feed_url('greenhouse','acmeco')])  # the official feed URL, host-pinned
        self.assertEqual((ROOT/'sources.json').read_bytes(),before)
    def test_configured_board_proposes_careers_url_with_evidence(self):
        site=Site({'https://about.gitlab.example/jobs/':(200,'https://about.gitlab.example/jobs/','<a href="https://job-boards.greenhouse.io/gitlab">All jobs</a>')})
        feed=feed_with([])
        t=go(site,[target('gitlab','https://about.gitlab.example/jobs/')],feed=feed)['targets'][0]
        self.assertEqual((t['boards'][0]['status'],t['boards'][0]['source_id']),('already_configured','gitlab-greenhouse'))
        self.assertEqual(feed.calls,[])  # no request spent re-verifying a configured board
        p=t['careers_url_proposal']
        self.assertEqual((p['careers_url'],p['evidence']['quote'],p['evidence']['checked_at']),
                         ('https://about.gitlab.example/jobs/','https://job-boards.greenhouse.io/gitlab','2026-10-26'))
    def test_feed_failure_is_reported(self):
        def broken(source): raise ValueError('Redirect requires source review')
        site=Site({'https://acme.example/careers':(200,'https://acme.example/careers','<a href="https://jobs.lever.co/acme">jobs</a>')})
        b=go(site,[target()],feed=broken)['targets'][0]['boards'][0]
        self.assertEqual((b['status'],b['reason']),('feed_failed','Redirect requires source review'))
        self.assertNotIn('proposed_source',b)
    def test_targets_file_is_valid(self):
        targets=json.loads((ROOT/'discovery_targets.json').read_text())['targets']
        discover.validate_targets(targets)
        self.assertTrue(all(t.get('basis') for t in targets))
if __name__=='__main__':unittest.main()
