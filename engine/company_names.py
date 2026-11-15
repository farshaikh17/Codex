"""Employer names a person can read (plan B1, phase 4).

Some hiring systems give the dataset their tenant id instead of the employer: 'mdlz' (Workday), 'Fa Espx Saasfaprod1' and 'Egup' (Oracle
Recruiting Cloud). display_company(raw, source, url) returns the employer's name:
  1. a known id from the table below (each read from the employer's own career site, the page title or og:site_name, on 13 Nov 2026);
  2. otherwise, for a tenant-looking name only, the career site's own name, read once from its page title or og:site_name (fetch given);
  3. otherwise the raw name, unchanged.
A looked-up name is used only when it is a plausible name (three letters or more, not a generic word like 'Careers'); 'Careers', 'Talent
Acquisition' and 'Family of Companies' are trimmed ('Cummins Talent Acquisition' -> 'Cummins'). The shortlist never shows a tenant id
(scripts/shortlist_select.mjs tenantEmployer()), so a name that stays raw costs the job its place on the shortlist, not its place in the pool.
"""
import json
import pathlib
import re
import urllib.parse

# Ids the hiring systems use for these employers: engine/company_names.json (keys lower case, with '-' and ' ' alike; where each name was read).
# The shortlist selector and its audit read the same file (dashboard/scripts/shortlist_select.mjs), so a name known here is known there.
KNOWN = json.loads((pathlib.Path(__file__).resolve().parent / 'company_names.json').read_text(encoding='utf-8'))['names']
FA_TENANT = re.compile(r'^fa[ -][a-z]{4}[ -](?:test[ -])?saasfaprod\d+(?:\s*\([^)]*\))?$', re.I)   # also with its site: 'Fa Elxu Saasfaprod1 (CX_1001)'
SHORT_TOKEN = re.compile(r'^[a-z]{1,5}$')   # lower case only: 'Wood' is a name, 'bmc' an id
TENANT_SOURCES = re.compile(r'^(workday|oracle|oracle_?hcm)$', re.I)
# Words a career site puts around the employer's name, and names that are not an employer at all.
TRIM = re.compile(r'\s*(?:[-|:–—]\s*)?(?:careers?(?: site| portal| page)?|jobs?|job search|talent acquisition|family of companies|recruiting|recruitment|'
                  r'candidate experience|external career site|current openings)\s*$', re.I)
LEAD = re.compile(r'^\s*(?:careers?|jobs?|work)\s+(?:at|with)\s+', re.I)
GENERIC = re.compile(r'^(?:careers?|jobs?|home|search|oracle|oracle cloud|candidate experience|recruiting|workday|job search|sign in|welcome|error|not found)$', re.I)


def _key(raw):
    return re.sub(r'[\s-]+', ' ', str(raw or '').strip().lower())


def _host(url):
    try:
        return (urllib.parse.urlsplit(str(url or '')).hostname or '').lower()
    except ValueError:
        return ''


def tenant_like(raw, source, url):
    """Plan B1: 'fa xxxx saasfaprod1', an Oracle name equal to its oraclecloud.com tenant host ('Egup' at egup.fa.us2.oraclecloud.com), or one
    short token (five letters or fewer) from Workday or Oracle. Same reading as tenantEmployer() in scripts/shortlist_select.mjs."""
    c = str(raw or '').strip()
    if not c:
        return False
    if FA_TENANT.match(c):
        return True
    host = _host(url)
    if host.endswith('.oraclecloud.com') and host.split('.')[0] == c.lower() and re.fullmatch(r'[a-z]{3,8}', c, re.I):
        return True
    src = str(source or '').lower()
    if not TENANT_SOURCES.match(src) and 'oraclecloud.com' not in host and 'myworkdayjobs.com' not in host:
        return False
    return bool(SHORT_TOKEN.match(c))


def site_page(url):
    """The career site's own page for a posting URL, or None. Oracle: https://<host>/hcmUI/CandidateExperience/en/sites/<site> (the dataset's
    URL is https://<host>/?...&site_number=<site>#<id>). Workday pages carry no employer name in their title, so none is tried."""
    host = _host(url)
    if not host.endswith('.oraclecloud.com'):
        return None
    try:
        parts = urllib.parse.urlsplit(str(url))
    except ValueError:
        return None
    site = (urllib.parse.parse_qs(parts.query).get('site_number') or [''])[0]
    if not site:
        m = re.search(r'/sites/([^/?#]+)', parts.path)
        site = m.group(1) if m else ''
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,60}', site or ''):
        return None
    return f'https://{host}/hcmUI/CandidateExperience/en/sites/{site}'


def name_from_html(html):
    """The employer's name from a career page: og:site_name first, then <title>; None when neither is a plausible name."""
    text = str(html or '')[:200000]
    found = []
    m = re.search(r'<meta[^>]+property=["\']og:site_name["\'][^>]*content=["\']([^"\']{1,200})["\']', text, re.I) or \
        re.search(r'<meta[^>]+content=["\']([^"\']{1,200})["\'][^>]*property=["\']og:site_name["\']', text, re.I)
    if m:
        found.append(m.group(1))
    m = re.search(r'<title[^>]*>([^<]{1,200})</title>', text, re.I)
    if m:
        found.append(m.group(1))
    for raw in found:
        name = clean_site_name(raw)
        if name:
            return name
    return None


def clean_site_name(raw):
    import html as _html
    s = re.sub(r'\s+', ' ', _html.unescape(str(raw or ''))).strip()
    s = LEAD.sub('', s)
    for _ in range(2):
        s = TRIM.sub('', s).strip(' -|:')
    if len(re.sub(r'[^A-Za-z]', '', s)) < 3 or len(s) > 80 or GENERIC.match(s) or FA_TENANT.match(s):
        return None
    return s


def display_company(raw, source=None, url=None, fetch=None, cache=None):
    """The employer's name to store and show. fetch(url) -> html (or raises) is tried at most once per career site (cache: a dict kept for
    the run); without fetch only the table is used. Never raises."""
    name = str(raw or '').strip()
    known = KNOWN.get(_key(name))
    if known:
        return known
    if not tenant_like(name, source, url):
        return name
    page = site_page(url)
    if not page:
        return name
    cache = {} if cache is None else cache
    if page not in cache:
        if not fetch:
            return name
        try:
            cache[page] = name_from_html(fetch(page))
        except Exception:   # a career site that does not answer keeps the raw name
            cache[page] = None
    return cache[page] or name


def http_fetch(timeout=8, total=15, limit=262144):
    """A fetch for display_company(): one GET, `timeout` seconds per socket wait and `total` seconds for the whole answer (a server that sends a
    trickle of bytes is cut off), at most `limit` bytes read."""
    import time
    import urllib.request

    def get(url):
        end = time.monotonic() + total
        req = urllib.request.Request(url, headers={'User-Agent': 'career-job-engine/1.0 (employer name lookup)', 'Accept': 'text/html'})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            chunks, size = [], 0
            while size < limit:
                if time.monotonic() > end:
                    raise TimeoutError('career page too slow')
                b = r.read(min(16384, limit - size))
                if not b:
                    break
                chunks.append(b); size += len(b)
            return b''.join(chunks).decode('utf-8', 'replace')
    return get


def name_jobs(jobs, fetch=None, max_lookups=40, workers=8, deadline=60):
    """Gives every job its display name in place (plan B1, at import). At most max_lookups career sites are opened per run, eight at a time
    (each with its own short timeout), and the whole lookup stops after `deadline` seconds, so a slow site costs seconds, not the step; the rest
    keep the table name or the raw one.
    Returns {'renamed': n, 'looked_up': n}."""
    cache = {}
    if fetch:
        pages = []
        for j in jobs:
            name = str(j.get('company') or '').strip()
            if KNOWN.get(_key(name)) or not tenant_like(name, j.get('ats_type'), j.get('url')):
                continue
            page = site_page(j.get('url'))
            if page and page not in pages:
                pages.append(page)
        pages = pages[:max_lookups]
        if pages:
            from concurrent.futures import ThreadPoolExecutor

            def one(page):
                try:
                    return page, name_from_html(fetch(page))
                except Exception:   # a career site that does not answer keeps the raw name
                    return page, None
            from concurrent.futures import wait
            pool = ThreadPoolExecutor(max_workers=workers)
            futures = [pool.submit(one, p) for p in pages]
            done, _ = wait(futures, timeout=deadline)   # the whole lookup has a deadline; whatever has not answered keeps its raw name
            pool.shutdown(wait=False, cancel_futures=True)
            cache.update(f.result() for f in done)
    renamed = 0
    for j in jobs:
        before = j.get('company') or ''
        after = display_company(before, j.get('ats_type'), j.get('url'), None, cache)
        if after != before:
            j['company'] = after
            renamed += 1
    return {'renamed': renamed, 'looked_up': len(cache)}
