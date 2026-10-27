import copy,json,tempfile,unittest
from datetime import datetime,timedelta,timezone
from pathlib import Path
from unittest.mock import patch
import market_discovery as m
import discover

class MarketTests(unittest.TestCase):
    def test_directory_cards_are_provisional_and_never_auto_enabled(self):
        leads=m.directory_leads('<a href="https://employer.example/">Visit Website</a><a href="javascript:evil()">x</a><a href="https://u:p@bad.example/">x</a>',"https://directory.example/",".*")
        self.assertEqual(len(leads),1)
        self.assertFalse(leads[0]["collection_enabled"])
        self.assertEqual(leads[0]["ownership"],"unverified")

    def test_exact_dedup_and_employer_cap_do_not_change_input_or_assess_jobs(self):
        jobs=[{"key":"lever:a:"+str(i),"employer":"a","title":"Implementation Manager "+chr(65+i)} for i in range(10)]
        jobs += [{"key":"lever:b:1","employer":"b","title":"Electrical Commissioning Engineer"}]
        jobs += [copy.deepcopy(jobs[0])]
        before=copy.deepcopy(jobs)
        batch=m.diverse(jobs)
        self.assertEqual(len(batch),4)
        self.assertEqual([j["employer"] for j in batch[:2]],["a","b"])
        self.assertEqual(jobs,before)
        self.assertTrue(all(j["stage"]=="exact_vacancy_unreviewed" for j in batch))

    def test_cooldowns_and_rotation_use_actual_public_source_observations(self):
        now=datetime(2030,1,1,tzinfo=timezone.utc)
        cfg={"targets":[{"employer":"a"},{"employer":"b"},{"employer":"c"}]}
        state={"a":{"retry_after":"2031-01-01T00:00:00+00:00"},"b":{"checked_at":"2029-01-01T00:00:00+00:00","plausible":99}}
        selected,deferred=m.due_targets(cfg,state,now,limit=1)
        self.assertEqual([t["employer"] for t in selected],["c"])
        self.assertEqual({d["employer"]:d["reason"] for d in deferred},{"a":"cooldown","b":"rotation_limit"})

    def test_redirect_is_refused_before_destination_request(self):
        handler=discover._SameHosts({"a.example","b.example"},3)
        with self.assertRaises(discover.Blocked):
            handler.redirect_request(None,None,302,"",{},"https://b.example/private")

    def test_private_endpoints_and_credentials_rejected(self):
        for url in ("http://example.com","https://user:pw@example.com","https://localhost/x","https://example.com:8443"):
            with self.assertRaises(ValueError): m.public_url(url)
        with patch("socket.getaddrinfo",return_value=[(2,1,6,"",("127.0.0.1",443))]):
            with self.assertRaises(ValueError): m.public_url("https://example.com/")

    def test_global_budget_and_429_stop_all_next_requests(self):
        n=m.Network(max_requests=1)
        with patch.object(m,"public_url",return_value=__import__("urllib.parse",fromlist=["urlparse"]).urlparse("https://a.example/")):
            with patch.object(discover,"http_get",return_value=(429,"https://a.example/","")) as get:
                with self.assertRaises(discover.Halt): n.get("https://a.example/",{"a.example"},discover.LIMITS)
                with self.assertRaises(discover.Halt): n.get("https://a.example/",{"a.example"},discover.LIMITS)
                self.assertEqual(get.call_count,1)
        self.assertEqual(n.requests,1)

    def test_robots_path_decision_not_cached_as_host_permission(self):
        class Net(m.Network):
            def get(self,url,allowed,limits):
                if url.endswith("robots.txt"): return 200,url,"User-agent: *\nDisallow: /private\n"
                return 200,url,"hello"
        n=Net()
        with patch.object(m,"public_url",side_effect=lambda u:__import__("urllib.parse",fromlist=["urlparse"]).urlparse(u)),patch.object(m.time,"sleep"):
            self.assertEqual(n.page("https://a.example/public"),"hello")
            with self.assertRaises(discover.Blocked): n.page("https://a.example/private")

    def test_existing_exports_remain_untouched_and_missing_stays_evidence(self):
        class Net:
            requests=0; halted=None
            def get(self,*args): raise AssertionError("unexpected request")
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); (root/"boards").mkdir()
            job={"key":"lever:a:1","title":"Electrical Engineer","url":"https://jobs.lever.co/a/1","observed_at":"2020-01-01"}
            (root/"boards/a.json").write_text(json.dumps({"jobs":[job]}))
            (root/"postings").mkdir(); sentinel=root/"postings/index.json"; sentinel.write_text('{"schema":"posting-index-1"}')
            source=[{"id":"a","employer":"a","provider":"lever","board":"a"}]
            # Scanner's validated registry needs a valid id.
            source[0].update(id="aa",employer="aa",board="aa")
            (root/"boards/a.json").rename(root/"boards/aa.json")
            employers={"schema":"employer-registry-1","employers":[{"id":"aa","name":"A","careers_url":None,"inclusion":{"reason":"test"}}]}
            result=m.run({"schema":"market-sources-1","targets":[]},source,employers,root/"discovery",network=Net())
            self.assertEqual(sentinel.read_text(),'{"schema":"posting-index-1"}')
            self.assertEqual(result["vacancies"][0]["observed_at"],"2020-01-01")
            self.assertEqual(result["vacancies"][0]["stage"],"exact_vacancy_unreviewed")

    def test_private_fields_rejected_before_any_network_work(self):
        with self.assertRaises(ValueError):
            m.validate_config({'schema':'market-sources-1','targets':[],'candidate_profile':{}})

    def test_directory_assets_are_not_employer_leads(self):
        self.assertEqual(m.directory_leads('<a href="https://cdn.example/banner.png">x</a>',
            'https://directory.example/','.*'),[])



class HaltAndHealthTests(unittest.TestCase):
    def test_robots_budget_halt_is_not_reported_as_unreachable_rules(self):
        def get(url): raise discover.Halt("request budget 1 reached")
        with self.assertRaises(discover.Halt): discover.robots_rules(get,"https://a.example/careers")

    def test_halted_run_leaves_later_directories_unattempted_and_uncooled(self):
        class Net:
            requests=0; halted=None
            def page(self,url):
                self.halted="HTTP 429; stop run"; raise discover.Halt(self.halted)
            def get(self,*a): raise discover.Halt(self.halted)
        dirs=[{"url":"https://d%d.example/"%i,"link_pattern":".*"} for i in range(3)]
        prior={"directory:https://d2.example/":{"checked_at":"2029-01-01T00:00:00+00:00","status":"ok","offset":25}}
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/"discovery"; out.mkdir(); (out/"state.json").write_text(json.dumps(prior))
            r=m.run({"schema":"market-sources-1","targets":[],"directories":dirs},[{"id":"aa","employer":"aa","provider":"lever","board":"aa"}],
                    {"schema":"employer-registry-1","employers":[{"id":"aa","name":"A","careers_url":None,"inclusion":{"reason":"test"}}]},out,network=Net(),
                    now=datetime(2030,1,1,tzinfo=timezone.utc))
            state=json.loads((out/"state.json").read_text())
        self.assertEqual({k:v for k,v in state.items() if not k.startswith("_")},prior)  # nothing marked failed or cooled down
        self.assertEqual(r["errors"],[])
        self.assertEqual(len(r["deferred"]),3)
        self.assertTrue(all(d["reason"].startswith("not_attempted") for d in r["deferred"]))

    def test_cards_are_compact_and_carry_source_health(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); (root/"boards").mkdir()
            job={"key":"lever:aa:1","req_id":"1","title":"Commissioning Engineer","url":"https://jobs.lever.co/aa/1",
                 "observed_at":"2020-01-01","description":"x"*5000,"locations":[{"text":"Remote - APAC","source":"location"}]}
            (root/"boards/aa.json").write_text(json.dumps({"jobs":[job]}))
            (root/"status.json").write_text(json.dumps({"sources":[{"source":"aa","status":"failed","checked_at":"2030-01-01T00:00:00+00:00","last_success_at":"2029-12-01T00:00:00+00:00"}]}))
            employers={"schema":"employer-registry-1","employers":[{"id":"aa","name":"A","careers_url":None,"inclusion":{"reason":"test"}}]}
            r=m.run({"schema":"market-sources-1","targets":[]},[{"id":"aa","employer":"aa","provider":"lever","board":"aa"}],employers,root/"discovery",
                    network=type("N",(),{"requests":0,"halted":None,"get":lambda *a:1/0})())
        card=r["vacancies"][0]
        self.assertNotIn("description",card)
        self.assertEqual((card["freshness"],card["source_status"]),("last_known_good_after_failure","failed"))
        self.assertEqual(card["locations"][0]["text"],"Remote - APAC")
        self.assertIn("not_assessed",card["eligibility"])
        self.assertEqual(r["metrics"]["stale_or_unreported_identities"],1)

    def test_crawl_delay_and_minimum_spacing_per_host(self):
        waits=[]
        n=m.Network(sleep=waits.append)
        responses={"https://a.example/robots.txt":(200,"","User-agent: *\nCrawl-delay: 5\n"),"https://a.example/x":(200,"","ok"),"https://a.example/y":(200,"","ok")}
        with patch.object(m,"public_url",side_effect=lambda u:__import__("urllib.parse",fromlist=["urlparse"]).urlparse(u)),\
             patch.object(discover,"http_get",side_effect=lambda url,allowed,limits:responses[url]):
            n.page("https://a.example/x"); n.page("https://a.example/y")
        self.assertEqual(len(waits),2)  # before /x (after robots) and before /y
        self.assertTrue(all(4<w<=5 for w in waits))

    def test_excessive_crawl_delay_blocks_host(self):
        n=m.Network(sleep=lambda s:None); n.delays["a.example"]=60
        with patch.object(m,"public_url",side_effect=lambda u:__import__("urllib.parse",fromlist=["urlparse"]).urlparse(u)):
            with self.assertRaises(discover.Blocked): n.get("https://a.example/x",{"a.example"},discover.LIMITS)
        self.assertEqual(n.requests,0)

    def test_body_read_has_total_time_bound(self):
        class Slow:
            status=200
            def __enter__(self): return self
            def __exit__(self,*a): return False
            def read(self,n): return b"x"*10
            def geturl(self): return "https://a.example/"
        clock=iter(range(0,1000,10))
        with patch("urllib.request.OpenerDirector.open",return_value=Slow()),patch.object(discover.time,"monotonic",side_effect=lambda:next(clock)):
            with self.assertRaises(discover.Blocked): discover.http_get("https://a.example/",{"a.example"},{**discover.LIMITS,"max_seconds":30})

    def test_software_reliability_and_sales_commission_are_not_asset_signals(self):
        self.assertEqual(m.families("Senior Site Reliability Engineer (Night Shift)"),[])
        self.assertEqual(m.families("Sales Commission Analyst"),[])
        self.assertEqual(m.families("Electrical Commissioning Engineer"),["asset-reliability-maintenance"])
        self.assertEqual(m.families("Reliability Engineer - Rotating Equipment"),["asset-reliability-maintenance"])


class LeadValidationTests(unittest.TestCase):
    def run_once(self,out,now,pages):
        class Net:
            requests=0; halted=None; log=[]
            def get(self,url,allowed,limits):
                self.log.append(url); self.requests+=1
                if url.endswith("/robots.txt"): return 200,url,"User-agent: *\nAllow: /\n"
                return pages.get(url,(404,url,""))
            def feed(self,source): self.log.append(source["url"]); return [{"id":"x1","text":"Implementation Manager","hostedUrl":"https://jobs.lever.co/acmeco/x1"}]
        net=Net()
        src=[{"id":"aa","employer":"aa","provider":"lever","board":"aa"}]
        emp={"schema":"employer-registry-1","employers":[{"id":"aa","name":"A","careers_url":None,"inclusion":{"reason":"test"}}]}
        return m.run({"schema":"market-sources-1","targets":[]},src,emp,out,network=net,now=now),net

    def test_leads_are_scanned_for_boards_but_stay_provisional(self):
        pages={"https://acme.example/":(200,"https://acme.example/",'<a href="/careers">Careers</a>'),
               "https://acme.example/careers":(200,"https://acme.example/careers",'<a href="https://jobs.lever.co/acmeco">Jobs</a>')}
        lead={"url":"https://acme.example/","discovered_from":"https://directory.example/","stage":"provisional_employer_link",
              "ownership":"unverified","collection_enabled":False}
        before=Path("sources.json").read_bytes()
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/"discovery"; out.mkdir()
            (out/"report.json").write_text(json.dumps({"generated_at":"2029-12-01T00:00:00+00:00","employer_leads":[lead]}))
            now=datetime(2030,1,1,tzinfo=timezone.utc)
            r,net=self.run_once(out,now,pages)
            got=r["employer_leads"][0]
            self.assertEqual(got["validation"]["result"],"supported_board_found")
            self.assertEqual(got["validation"]["boards"][0]["board"],"acmeco")
            self.assertTrue(got["validation"]["ownership"].startswith("unverified"))
            self.assertEqual((got["ownership"],got["collection_enabled"],got["stage"]),("unverified",False,"provisional_employer_link"))
            self.assertEqual(got["first_seen_at"],"2029-12-01T00:00:00+00:00")
            self.assertFalse(any(v["employer"].startswith("lead-") for v in r["vacancies"]),"lead boards never become review cards")
            self.assertEqual(r["metrics"]["lead_validation_results"],{"supported_board_found":1})
            r2,net2=self.run_once(out,now+timedelta(days=1),pages)
            self.assertEqual(net2.log,[],"a validated lead waits for its recheck time")
            self.assertEqual(r2["employer_leads"][0]["validation"]["checked_at"],now.isoformat())
        self.assertEqual(Path("sources.json").read_bytes(),before)

    def test_lead_order_prefers_never_validated(self):
        now=datetime(2030,1,1,tzinfo=timezone.utc)
        leads=[{"host":"b","validation":{"checked_at":"2029-01-01","retry_after":"2029-01-08T00:00:00+00:00"}},{"host":"c","first_seen_at":"2029-06-01"},
               {"host":"a","validation":{"checked_at":"2029-12-30","retry_after":"2030-01-06T00:00:00+00:00"}}]
        self.assertEqual([l["host"] for l in m.leads_to_validate(leads,now)],["c","b"])

    def test_same_title_requisitions_share_one_card(self):
        jobs=[{"key":"gh:c:%d"%i,"req_id":str(i),"employer":"c","title":"Senior Project Manager","locations":[{"text":t}]} for i,t in enumerate(["UK","France","UAE"])]
        jobs+=[{"key":"gh:c:9","req_id":"9","employer":"c","title":"Implementation Lead","locations":[]}]
        batch=m.diverse(jobs)
        self.assertEqual([c["title"] for c in batch],["Implementation Lead","Senior Project Manager"])
        self.assertEqual([e["locations"] for e in batch[1]["same_title_elsewhere"]],[["France"],["UAE"]])

    def test_detected_but_unverifiable_board_is_not_reported_as_absent(self):
        target={"pages":[{"result":"read"}],"boards":[{"provider":"ashby","board":"x","status":"feed_failed"}],"unsupported_ats":[],"stopped":None}
        self.assertEqual(m.validation_result(target)["result"],"board_found_unverified")

if __name__=='__main__':unittest.main()
