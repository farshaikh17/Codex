import json,tempfile,unittest
from pathlib import Path
from crawl_pages import Halt,classify,robots_allows,run,validate,PAGE_KEYS,ATTEMPT_KEYS
PAGE={'id':'sample-careers','employer':'Sample','url':'https://careers.example.com/jobs','why':'private note never published'}
OTHER={'id':'other-careers','employer':'Other','url':'https://other.example.com/jobs'}
ALLOW=lambda url,timeout:(True,'allowed by robots.txt')
WORDS=' '.join('Implementation Manager role open in India remote team'.split()*30)
def page(text=WORDS,status=200,html='<html><body>ok</body></html>',final=None,error=None):
    return lambda p,limits:{'status_code':status,'final_url':final or p['url'],'html':html,'text':text,'error':error}
def go(path,fetcher,pages=(PAGE,),robots=ALLOW,**limits):
    return run(list(pages),path,fetcher,limits,robots=robots,pause=lambda _:None)
def entry(result,pid='sample-careers'):
    return next(p for p in result['pages'] if p['id']==pid)
class CaptureTests(unittest.TestCase):
    def test_change_detection(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)
            first=entry(go(path,page()))
            self.assertEqual((first['change'],first['capture_status'],first['fresh_this_run']),('new','usable',True))
            same=entry(go(path,page()))
            self.assertEqual(same['change'],'unchanged')
            self.assertEqual(same['changed_at'],first['changed_at'])
            self.assertEqual(same['content_hash'],first['content_hash'])
            changed=entry(go(path,page(WORDS+' New role added')))
            self.assertEqual(changed['change'],'changed')
            self.assertNotEqual(changed['content_hash'],first['content_hash'])
            self.assertNotEqual(changed['changed_at'],first['changed_at'])
            self.assertIn('New role added',(path/'captures'/'sample-careers.md').read_text())
    def test_whitespace_only_differences_do_not_count_as_changes(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)
            go(path,page())
            self.assertEqual(entry(go(path,page('  '+WORDS.replace(' ','   ')+'\n\n\n\n')))['change'],'unchanged')
    def test_failed_retrieval_preserves_old_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)
            good=entry(go(path,page()))
            capture=(path/'captures'/'sample-careers.md').read_text()
            def boom(p,limits):raise TimeoutError('page timeout 30s')
            for fetcher in (boom,page(status=500,text=''),page(error='net::ERR_NAME_NOT_RESOLVED',text='')):
                failed=entry(go(path,fetcher))
                self.assertEqual(failed['last_attempt']['result'],'failed')
                self.assertEqual((failed['captured_at'],failed['content_hash'],failed['changed_at']),(good['captured_at'],good['content_hash'],good['changed_at']))
                self.assertFalse(failed['fresh_this_run'])
                self.assertEqual(failed['change'],'unknown_after_failure')
                self.assertNotEqual(failed['last_attempt']['at'],failed['captured_at'])
                self.assertEqual((path/'captures'/'sample-careers.md').read_text(),capture)
    def test_changed_allowlist_url_discards_old_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)
            go(path,page())
            def boom(p,limits):raise TimeoutError('page timeout 30s')
            moved=entry(go(path,boom,pages=(dict(PAGE,url='https://careers.example.com/openings'),)))
            self.assertEqual((moved['change'],moved['captured_at'],moved['content_hash']),('no_capture',None,None))
            self.assertFalse((path/'captures'/'sample-careers.md').exists())
    def test_failure_without_prior_capture_has_no_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            failed=entry(go(Path(folder),page(status=404,text='')))
            self.assertEqual((failed['change'],failed['captured_at'],failed['content_hash'],failed['capture_file']),('no_capture',None,None,None))
            self.assertFalse((Path(folder)/'captures').exists())
    def test_thin_content(self):
        with tempfile.TemporaryDirectory() as folder:
            thin=entry(go(Path(folder),page('Loading... Enable JavaScript')))
            self.assertEqual((thin['capture_status'],thin['last_attempt']['result']),('thin','thin'))
            self.assertIn('only 3 words',thin['last_attempt']['reason'])
            self.assertIn('capture_status: thin',(Path(folder)/'captures'/'sample-careers.md').read_text())
    def test_stops_on_login_captcha_denial_and_rate_limit(self):
        cases=[(page(final='https://careers.example.com/login?next=/jobs'),'login required'),
               (page(html='<form><input type="password"></form>'),'login required'),
               (page(html='<div class="g-recaptcha"></div>'),'captcha or bot challenge'),
               (page(text='Checking your browser before accessing'),'captcha or bot challenge'),
               (page(status=403,text='Forbidden'),'access denied (403)'),
               (page(status=429,text=''),'rate limited')]
        for fetcher,reason in cases:
            with tempfile.TemporaryDirectory() as folder:
                got=entry(go(Path(folder),fetcher))
                self.assertEqual((got['last_attempt']['result'],got['last_attempt']['reason']),('blocked',reason))
                self.assertIsNone(got['captured_at'])
                self.assertFalse((Path(folder)/'captures').exists())
    def test_rate_limit_halts_rest_of_batch(self):
        calls=[]
        def limited(p,limits):
            calls.append(p['id'])
            return {'status_code':429,'final_url':p['url'],'html':'','text':''}
        with tempfile.TemporaryDirectory() as folder:
            result=go(Path(folder),limited,pages=(PAGE,OTHER),batch_size=2)
            self.assertEqual(calls,['sample-careers'])
            self.assertEqual(entry(result,'other-careers')['last_attempt']['result'],'skipped')
            self.assertTrue(result['halted'])
    def test_robots_disallow_means_no_page_request(self):
        def never(p,limits):raise AssertionError('page fetched despite robots.txt')
        with tempfile.TemporaryDirectory() as folder:
            got=entry(go(Path(folder),never,robots=lambda u,t:(False,'disallowed by robots.txt')))
            self.assertEqual((got['last_attempt']['result'],got['last_attempt']['reason']),('blocked','disallowed by robots.txt'))
    def test_robots_rules(self):
        body='User-agent: *\nDisallow: /private\n'
        self.assertEqual(robots_allows('https://x.example/jobs',5,lambda u,t:(200,body))[0],True)
        self.assertEqual(robots_allows('https://x.example/private/jobs',5,lambda u,t:(200,body))[0],False)
        self.assertEqual(robots_allows('https://x.example/jobs',5,lambda u,t:(200,'User-agent: public-job-collector-pages\nDisallow: /\n'))[0],False)
        self.assertEqual(robots_allows('https://x.example/jobs',5,lambda u,t:(404,''))[0],True)
        self.assertEqual(robots_allows('https://x.example/jobs',5,lambda u,t:(503,''))[0],False)
        self.assertEqual(robots_allows('https://x.example/jobs',5,lambda u,t:(403,''))[0],False)
        def down(u,t):raise OSError('unreachable')
        self.assertEqual(robots_allows('https://x.example/jobs',5,down)[0],False)
        with self.assertRaises(Halt):robots_allows('https://x.example/jobs',5,lambda u,t:(429,''))
    def test_redirect_off_allowlist_is_not_captured(self):
        with tempfile.TemporaryDirectory() as folder:
            got=entry(go(Path(folder),page(final='https://tracker.example.net/jobs')))
            self.assertEqual(got['last_attempt']['result'],'failed')
            self.assertIn('off allowlist',got['last_attempt']['reason'])
            self.assertIsNone(got['content_hash'])
    def test_allowlist_batch_and_request_limits(self):
        with self.assertRaises(ValueError):validate([{'id':'x-y','employer':'E','url':'http://insecure.example/'}])
        with self.assertRaises(ValueError):validate([{'id':'x-y','employer':'E','url':'https://user:pw@x.example/'}])
        with self.assertRaises(ValueError):validate([PAGE,dict(PAGE)])
        pages=[dict(PAGE,id='p-%d'%i,url='https://h%d.example.com/jobs'%i) for i in range(15)]
        calls=[]
        fetch=lambda p,limits:calls.append(p['id']) or page()(p,limits)
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(len(go(Path(folder),fetch,pages=pages,batch_size=50)['batch']),10)
            calls.clear()
            limited=go(Path(folder),fetch,pages=pages,batch_size=10,max_requests=5)
            self.assertEqual(limited['requests_made'],5)
            self.assertEqual(len(calls),2)
            with self.assertRaises(ValueError):run(pages,Path(folder),fetch,{},ids=['not-listed'],robots=ALLOW,pause=lambda _:None)
    def test_rotation_prefers_oldest_attempts(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)
            self.assertEqual(go(path,page(),pages=(PAGE,OTHER),batch_size=1)['batch'],['sample-careers'])
            self.assertEqual(go(path,page(),pages=(PAGE,OTHER),batch_size=1)['batch'],['other-careers'])
    def test_public_only_output(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)
            result=go(path,page(),pages=(PAGE,OTHER),batch_size=2)
            for p in result['pages']:
                self.assertEqual(set(p),set(PAGE_KEYS))
                self.assertEqual(set(p['last_attempt']),set(ATTEMPT_KEYS))
            published=(path/'index.json').read_text()+''.join(f.read_text() for f in (path/'captures').iterdir())
            self.assertNotIn('private note',published)
            for word in ('profile','resume','cv_','candidate_','eligible":','ready":','applied','password','token','cookie'):
                self.assertNotIn(word,published.lower().replace('implementation manager',''))
            self.assertIn('Not a verified job',json.loads((path/'index.json').read_text())['notice'])
    def test_classify_keeps_job_pages_with_invisible_recaptcha_script(self):
        got={'status_code':200,'html':'<script src="https://www.google.com/recaptcha/api.js?render=k"></script>','text':WORDS}
        self.assertEqual(classify(PAGE,got,150)[0],'usable')
if __name__=='__main__':unittest.main()
