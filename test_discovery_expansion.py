import json,tempfile,unittest
from datetime import datetime,timedelta,timezone
from pathlib import Path
import career_pages as cp
import discover
import market_discovery as m
import role_search as rs
import signals

NOW=datetime(2030,1,1,tzinfo=timezone.utc)
SRC=[{"id":"aa","employer":"aa","provider":"lever","board":"aa"}]
EMP={"schema":"employer-registry-1","employers":[{"id":"aa","name":"Acme Energy","careers_url":None,"inclusion":{"reason":"test"}}]}
JSONLD='''<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Electrical Maintenance Planner",
"identifier":{"@type":"PropertyValue","value":"R-123"},"url":"/jobs/R-123","datePosted":"2030-01-01",
"jobLocation":{"@type":"Place","address":{"addressLocality":"Pune","addressRegion":"MH","addressCountry":"IN"}},
"baseSalary":{"@type":"MonetaryAmount","value":{"minValue":1,"maxValue":2,"unitText":"YEAR"}},
"description":"<p>Plan maintenance.</p>"}</script>'''
RSS='''<?xml version="1.0"?><rss version="2.0"><channel>
<item><title><![CDATA[Grid Commissioning Engineer]]></title><description><![CDATA[India]]></description>
<link>https://jobs.acme.example/jobs/FolderDetail/Grid-Commissioning-Engineer/305510</link><pubDate>Thu, 30 Oct 2025 00:00:00 +0000</pubDate></item>
<item><title><![CDATA[Account Executive]]></title><description><![CDATA[]]></description>
<link>https://elsewhere.example/job/1</link></item></channel></rss>'''

class ExtractionTests(unittest.TestCase):
    def test_jsonld_keeps_identity_location_wording_and_salary_provenance(self):
        r=cp.jsonld_postings(JSONLD,"https://careers.acme.example/list","acme",True)[0]
        self.assertEqual((r["req_id"],r["url"],r["stage"]),("R-123","https://careers.acme.example/jobs/R-123","exact_vacancy_unreviewed"))
        self.assertEqual(r["locations"],[{"text":"Pune, MH, IN","source":"jsonld.jobLocation.address"}])
        self.assertEqual(r["salary"]["provenance"],"employer JSON-LD baseSalary")
        self.assertEqual(r["salary"]["uncertainty"],"currency not stated")
        self.assertEqual(r["description"],"Plan maintenance.")

    def test_missing_identifier_or_unreviewed_owner_is_provisional(self):
        page=JSONLD.replace('"identifier":{"@type":"PropertyValue","value":"R-123"},','')
        r=cp.jsonld_postings(page,"https://careers.acme.example/list","acme",True)[0]
        self.assertEqual(r["stage"],"provisional_vacancy"); self.assertIn("no stable identifier",r["extraction"]["uncertainty"])
        r=cp.jsonld_postings(JSONLD,"https://careers.acme.example/list","acme",False)[0]
        self.assertEqual(r["stage"],"provisional_vacancy"); self.assertIn("employer ownership not reviewed",r["extraction"]["uncertainty"])

    def test_off_host_posting_url_is_not_canonical(self):
        page=JSONLD.replace('"url":"/jobs/R-123"','"url":"https://aggregator.example/x"')
        r=cp.jsonld_postings(page,"https://careers.acme.example/list","acme",True)[0]
        self.assertEqual(r["url"],"https://careers.acme.example/list")
        self.assertIn("posting url is off the official page host",r["extraction"]["uncertainty"])

    def test_rss_items_identity_from_official_url_and_off_host_items_provisional(self):
        a,b=cp.rss_items(RSS,"https://jobs.acme.example/jobs/Jobs/feed/","acme",True,r"/(\d+)$")
        self.assertEqual((a["req_id"],a["stage"],a["locations"][0]["text"]),("305510","exact_vacancy_unreviewed","India"))
        self.assertIn("identifier taken from the official URL",a["extraction"]["uncertainty"])
        self.assertEqual(b["stage"],"provisional_vacancy")

    def test_rss_with_entities_is_refused(self):
        with self.assertRaises(ValueError): cp.rss_items('<!DOCTYPE x [<!ENTITY a "b">]><rss/>',"https://a.example/f","acme")

class RoleSearchTests(unittest.TestCase):
    DATA={"jobs":[{"guid":"https://himalayas.app/companies/acme-energy/jobs/hubspot-specialist","title":"HubSpot Specialist",
                   "companyName":"Acme Energy","companySlug":"acme-energy","locationRestrictions":["India"],"pubDate":1893456000,
                   "applicationLink":"https://himalayas.app/companies/acme-energy/jobs/hubspot-specialist?utm_source=api"},
                  {"guid":"https://himalayas.app/companies/z/jobs/y","title":"Remote Analyst","companyName":"Z","locationRestrictions":[]}]}
    def test_listings_are_provisional_attributed_and_keep_apply_link(self):
        a,b=rs.listings(self.DATA,"HubSpot","India","2030-01-01")
        self.assertEqual(a["stage"],"aggregator_listing_provisional")
        self.assertTrue(a["apply_url"].startswith("https://himalayas.app/"))
        self.assertIn("Himalayas",a["discovery"]["attribution"])
        self.assertEqual(signals.geography(a["locations"])["class"],"india_explicit")
        self.assertEqual(signals.geography(b["locations"])["class"],"remote_or_region_only")

    def test_resolution_is_evidence_not_proof(self):
        a=rs.listings(self.DATA,"HubSpot","India","2030-01-01")[0]
        official=[{"employer":"aa","title":"HubSpot  specialist","key":"lever:aa:1"}]
        self.assertEqual(rs.resolve(a,{"acme energy":"aa"},official),{"employer":"aa","status":"official_title_match","official_keys":["lever:aa:1"]})
        self.assertIsNone(rs.resolve(a,{},official))

    def test_bad_shape_is_a_failure_not_zero_results(self):
        with self.assertRaises(ValueError): rs.listings({"error":"x"},"q",None,"t")
        self.assertEqual(rs.listings({"jobs":[]},"q",None,"t"),[])

class ProfileTraversalTests(unittest.TestCase):
    def test_profile_links_same_host_only(self):
        html='<a href="/partner/a">a</a><a href="https://dir.example/partner/b">b</a><a href="https://other.example/partner/c">c</a><a href="/partner/a?x=1">q</a>'
        self.assertEqual(m.profile_links(html,"https://dir.example/list",r"^/partner/[^/]+$"),["https://dir.example/partner/a","https://dir.example/partner/b"])

    def test_profile_website_is_most_linked_external_host_excluding_social_and_cdn(self):
        html=('<a href="https://agency.example/">x</a><a href="https://agency.example/cases">x</a><a href="https://www.linkedin.com/in/x">x</a>'
              '<a href="https://cdn.dir.example/a.css">x</a><a href="https://calendly.com/x">x</a><a href="https://other.example/">x</a>')
        site,c=m.profile_website(html,"https://www.dir.example/partner/a")
        self.assertEqual(site,"https://agency.example/")
        self.assertEqual([x["host"] for x in c],["agency.example","other.example"])

class SignalAndRotationTests(unittest.TestCase):
    def test_sales_and_specialist_software_are_not_strong(self):
        self.assertEqual(signals.title_signal("Battery Sales Director")["strength"],"excluded")
        self.assertEqual(signals.title_signal("Senior Software Engineer, Battery")["strength"],"weak")
        self.assertEqual(signals.title_signal("Technical Support Engineer (CRM)")["strength"],"excluded")
        self.assertEqual(signals.title_signal("Electrical Commissioning Engineer")["strength"],"strong")
        self.assertEqual(signals.title_signal("GoHighLevel Workflow Specialist")["strength"],"strong")

    def test_apac_or_worldwide_is_never_india(self):
        self.assertEqual(signals.geography([{"text":"Remote - APAC"},{"text":"Worldwide"}])["class"],"remote_or_region_only")
        self.assertEqual(signals.geography([{"text":"Mumbai"}])["india_terms"],["mumbai"])

    def test_rotation_shows_unseen_cards_before_repeating(self):
        jobs=[{"key":"k%d"%i,"employer":"a","title":"Implementation Manager %s"%chr(65+i)} for i in range(6)]
        history={}
        first=m.diverse(jobs,history=history); m.remember_shown(history,first,NOW,{j["key"] for j in jobs})
        second=m.diverse(jobs,history=history)
        self.assertEqual(len(first),3); self.assertFalse({c["key"] for c in first}&{c["key"] for c in second})

    def test_same_title_group_keeps_every_identity_and_evidence(self):
        jobs=[{"key":"k%d"%i,"req_id":str(i),"employer":"a","title":"Project Engineer","provenance":"p%d"%i,"locations":[{"text":"X%d"%i}]} for i in range(3)]
        card=m.diverse(jobs)[0]
        self.assertEqual([(e["key"],e["req_id"],e["provenance"]) for e in card["same_title_elsewhere"]],[("k1","1","p1"),("k2","2","p2")])

    def test_failure_backoff_grows_and_success_resets(self):
        s=None
        for days in (1,2,4,8,14,14):
            s=m._cooldown(NOW,"failed",s)
            self.assertEqual(datetime.fromisoformat(s["retry_after"])-NOW,timedelta(days=days))
        self.assertEqual(m._cooldown(NOW,"ok",s)["consecutive_failures"],0)

class FakeNet:
    """Counts requests like Network; pages keyed by URL; raises Halt after budget."""
    def __init__(self,pages,budget=40):
        self.pages,self.budget,self.requests,self.halted,self.log=pages,budget,0,None,[]
    def _allowed(self,url): return __import__("urllib.parse",fromlist=["urlparse"]).urlparse(url)
    def get(self,url,allowed,limits):
        if self.halted or self.requests>=self.budget: self.halted="request/time budget reached"; raise discover.Halt(self.halted)
        self.requests+=1; self.log.append(url)
        if url.endswith("/robots.txt"): return 200,url,"User-agent: *\nAllow: /\n"
        got=self.pages.get(url,(404,url,""))
        if isinstance(got,Exception): raise got
        return got
    def page(self,url):
        status,final,body=self.get(url,None,None)
        if status>=400: raise ValueError("HTTP %s"%status)
        return body
    def feed(self,source): raise ValueError("no feeds in this fake")

CONFIG={"schema":"market-sources-1","targets":[],
  "directories":[{"url":"https://dir.example/partners","link_pattern":"^$","profile_pattern":r"^/partner/[^/]+$"}],
  "role_queries":[{"id":"crm-india","channel":"himalayas","query":"HubSpot","country":"India","families":["crm-implementation"]},
                  {"id":"ops","channel":"himalayas","query":"business systems","families":["business-systems-automation"]},
                  {"id":"grid","channel":"himalayas","query":"grid","families":["power-utilities-energy"]},
                  {"id":"maint","channel":"himalayas","query":"maintenance planner","families":["asset-reliability-maintenance"]}],
  "career_feeds":[{"employer":"aa","kind":"rss","url":"https://jobs.acme.example/jobs/Jobs/feed/","id_pattern":r"/(\d+)$",
                   "ownership_evidence":{"url":"https://acme.example/careers","checked_at":"2030-01-01","basis":"test"}}]}

class RunTests(unittest.TestCase):
    def pages(self):
        return {"https://dir.example/partners":(200,"https://dir.example/partners",'<a href="/partner/one">1</a><a href="/partner/two">2</a>'),
                "https://dir.example/partner/one":(200,"","<a href='x'></a><a href=\"https://one-agency.example/\">site</a>"),
                "https://dir.example/partner/two":(500,"",""),
                rs.search_url("HubSpot","India"):(200,"",json.dumps(RoleSearchTests.DATA)),
                rs.search_url("maintenance planner"):(200,"",json.dumps({"jobs":[]})),
                rs.search_url("grid"):(503,"",""),
                "https://jobs.acme.example/jobs/Jobs/feed/":(200,"",RSS)}

    def go(self,out,net,now=NOW):
        return m.run(CONFIG,SRC,EMP,out,network=net,now=now)

    def test_directory_cursors_survive_failure_and_resume_after_cooldown(self):
        url = 'https://dir.example/partners'
        directory = {'url': url, 'link_pattern': r'^https://agency', 'profile_pattern': r'^/partner/'}
        config = {'schema': 'market-sources-1', 'targets': [], 'directories': [directory]}
        links = ''.join(f'<a href="https://agency{i:02}.example/">site</a>' for i in range(60))
        profiles = [f'https://dir.example/partner/{i}' for i in range(7)]
        links += ''.join(f'<a href="{p}">profile</a>' for p in profiles)
        pages = {url: (200, url, links), **{p: (200, p, '') for p in profiles}}
        key = 'directory:' + url
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)/'discovery'
            def run(net, now):
                report = m.run(config, SRC, EMP, out, network=net, now=now)
                return report, json.loads((out/'state.json').read_text())[key]
            _, first = run(FakeNet(pages), NOW)
            self.assertEqual((first['offset'], first['profile_offset']), (25, 3))
            _, failed = run(FakeNet({url: (503, url, '')}), NOW + timedelta(days=1))
            self.assertEqual(failed['status'], 'failed')
            waiting = FakeNet(pages)
            run(waiting, NOW + timedelta(days=1, hours=12))
            self.assertNotIn(url, waiting.log)
            retry = FakeNet(pages)
            report, resumed = run(retry, NOW + timedelta(days=2))
            self.assertEqual([p for p in retry.log if p in profiles], profiles[3:6])
            self.assertEqual((resumed['offset'], resumed['profile_offset']), (50, 6))
            self.assertEqual({lead['host'] for lead in report['employer_leads']},
                             {f'agency{i:02}.example' for i in range(50)})

    def test_full_run_separates_exact_provisional_and_measures_cost(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/"discovery"; net=FakeNet(self.pages())
            r=self.go(out,net)
            state=json.loads((out/"state.json").read_text())
        leads={l["host"]:l for l in r["employer_leads"]}
        self.assertEqual(leads["one-agency.example"]["discovered_via"],"directory_profile")
        self.assertFalse(leads["one-agency.example"]["collection_enabled"])
        self.assertIn("profile:https://dir.example/partner/two",[e["source"] for e in r["errors"]])
        self.assertEqual({c["title"] for c in r["vacancies"]},{"Grid Commissioning Engineer"})  # exact, career RSS
        self.assertIn("HubSpot Specialist",{c["title"] for c in r["provisional_cards"]})
        self.assertTrue(all(c["stage"]!="exact_vacancy_unreviewed" for c in r["provisional_cards"]))
        self.assertEqual((state["query:maint"]["status"],state["query:maint"]["results"]),("ok",0))  # zero results
        self.assertEqual(state["query:grid"]["status"],"failed")  # a failure is not zero results
        self.assertIn("query:ops",[d["source"] for d in r["deferred"]])  # three queries per run: two stalest + one best
        self.assertEqual(r["metrics"]["cost"]["requests"],net.requests)
        self.assertEqual(set(r["metrics"]["cost"]["by_method"])>={"directories","role_search","career_pages"},True)
        self.assertEqual(r["metrics"]["new_identities_since_last_run"],r["metrics"]["exact_identities"]+r["metrics"]["provisional_identities"])
        self.assertIn("no candidate relevance feedback",r["metrics"]["basis"])
        self.assertNotIn("READY",json.dumps(r["vacancies"]+r["provisional_cards"]))

    def test_second_run_respects_cooldowns_and_counts_repeats(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/"discovery"
            self.go(out,FakeNet(self.pages()))
            net=FakeNet(self.pages()); r=self.go(out,net,NOW+timedelta(hours=5))
        self.assertEqual([u for u in net.log if "himalayas" in u],[rs.search_url("business systems")])  # only the unqueried one is due
        self.assertNotIn("https://jobs.acme.example/jobs/Jobs/feed/",net.log)
        self.assertEqual(r["metrics"]["new_identities_since_last_run"],0)
        # cooled channels' last records stay observed, labelled as cached with their real check time
        self.assertEqual({c["title"] for c in r["vacancies"]},{"Grid Commissioning Engineer"})
        self.assertEqual(r["vacancies"][0]["freshness"],"cached_from_last_check")
        self.assertIn("HubSpot Specialist",{c["title"] for c in r["provisional_cards"]})
        self.assertGreater(r["metrics"]["cached_identities"],0)

    def test_budget_halt_is_resumable_without_marking_unattempted_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/"discovery"
            r=self.go(out,FakeNet(self.pages(),budget=3))
            state=json.loads((out/"state.json").read_text())
            self.assertTrue(r["halted"])
            self.assertNotIn("career:aa:https://jobs.acme.example/jobs/Jobs/feed/",state)
            self.assertTrue(any(d["reason"].startswith("not_attempted") for d in r["deferred"]))
            net=FakeNet(self.pages()); self.go(out,net,NOW+timedelta(hours=1))
            self.assertIn("https://jobs.acme.example/jobs/Jobs/feed/",net.log)  # picked up next run

    def test_career_detail_pages_already_observed_are_not_fetched(self):
        cfg=dict(CONFIG,career_feeds=[{"employer":"aa","kind":"jsonld_page","url":"https://careers.acme.example/list","detail_pattern":r"^/jobs/",
                 "ownership_evidence":{"url":"https://acme.example/careers","checked_at":"2030-01-01"}}],role_queries=[],directories=[])
        pages={"https://careers.acme.example/list":(200,"",'<a href="/jobs/R-1">1</a><a href="/jobs/R-2">2</a>'),
               "https://careers.acme.example/jobs/R-1":(200,"",JSONLD),"https://careers.acme.example/jobs/R-2":(200,"",JSONLD.replace("R-123","R-2"))}
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/"discovery"; out.mkdir()
            cached=cp.jsonld_postings(JSONLD,"https://careers.acme.example/jobs/R-1","aa",True)
            (out/"state.json").write_text(json.dumps({"_detail_cache":{"https://careers.acme.example/jobs/R-1":cached}}))
            net=FakeNet(pages); r=m.run(cfg,SRC,EMP,out,network=net,now=NOW)
            cache=json.loads((out/"state.json").read_text())["_detail_cache"]
        self.assertNotIn("https://careers.acme.example/jobs/R-1",net.log)
        self.assertIn("https://careers.acme.example/jobs/R-2",net.log)
        self.assertEqual(set(cache),{"https://careers.acme.example/jobs/R-1","https://careers.acme.example/jobs/R-2"})
        self.assertEqual(r["metrics"]["exact_identities"],2)  # cached identity still observed

    def test_config_rejects_private_or_unreviewed_entries(self):
        for bad in ({"role_queries":[{"id":"x1","channel":"jobspy","query":"crm"}]},
                    {"role_queries":[{"id":"x1","channel":"himalayas","query":"crm","candidate":"someone"}]},
                    {"career_feeds":[{"employer":"aa","kind":"rss","url":"https://a.example/f"}]}):
            with self.assertRaises(ValueError): m.validate_config({"schema":"market-sources-1","targets":[],**bad})

    def test_repository_config_is_valid(self):
        m.validate_config(json.loads(Path("market_sources.json").read_text()))

class RefinementTests(unittest.TestCase):
    def test_sdet_and_sde_titles_are_specialist(self):
        self.assertEqual(signals.title_signal("Senior Software Development Engineer (Social Planner- AI)")["strength"],"weak")
        self.assertEqual(signals.title_signal("Lead - Software Development Engineer in Test (SDET) / QA Manager")["strength"],"weak")

    def test_profile_leads_are_validated_before_bare_directory_links(self):
        leads=[{"host":"a","first_seen_at":"2029-01-01"},{"host":"b","first_seen_at":"2029-12-01","discovered_via":"directory_profile"}]
        self.assertEqual([l["host"] for l in m.leads_to_validate(leads,NOW,limit=1)],["b"])

    def test_booking_subdomain_resolves_to_site(self):
        site,_=m.profile_website('<a href="https://book.agency.example/x">b</a>',"https://dir.example/p")
        self.assertEqual(site,"https://agency.example/")

if __name__=='__main__':unittest.main()
