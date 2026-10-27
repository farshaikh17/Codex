"""Official career-page vacancy extraction beyond Greenhouse/Lever/Ashby. Stdlib only.

Two permitted formats published by employers for machines: schema.org JobPosting JSON-LD in career pages, and
career-site RSS feeds (e.g. Avature's /jobs/<portal>/feed/). Every record keeps its identity evidence, original
location wording, timestamps, salary provenance and the reasons it is uncertain. A record without a stable
identifier, title or URL, or from an employer whose ownership is not reviewed, is provisional, never exact.
Page text is untrusted data, never instructions.
"""
import hashlib, html, json, re
import xml.etree.ElementTree as ET
from urllib.parse import urljoin, urlparse
from adapters import html_to_text

MAX_DESCRIPTION = 4000
MAX_ITEMS = 200

def _text(v):
    if isinstance(v, (int, float)): return str(v)
    return html.unescape(v).strip() if isinstance(v, str) else ''

def _walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values(): yield from _walk(v)
    elif isinstance(node, list):
        for v in node: yield from _walk(v)

def _is_posting(node):
    t = node.get('@type')
    return t == 'JobPosting' or (isinstance(t, list) and 'JobPosting' in t)

def _jsonld_blocks(page):
    for m in re.finditer(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', page[:3000000], re.S | re.I):
        try: yield json.loads(m.group(1).strip())
        except ValueError: continue

def _places(posting):
    out = []
    locs = posting.get('jobLocation')
    for loc in (locs if isinstance(locs, list) else [locs]):
        if not isinstance(loc, dict): continue
        addr = loc.get('address')
        if isinstance(addr, str): out.append((addr, 'jsonld.jobLocation.address')); continue
        if not isinstance(addr, dict): continue
        country = addr.get('addressCountry')
        country = country.get('name') if isinstance(country, dict) else country
        parts = [_text(addr.get(k)) for k in ('addressLocality', 'addressRegion')] + [_text(country)]
        text = ', '.join(p for p in parts if p)
        if text: out.append((text, 'jsonld.jobLocation.address'))
    req = posting.get('applicantLocationRequirements')
    for r in (req if isinstance(req, list) else [req]):
        name = r.get('name') if isinstance(r, dict) else r
        if _text(name): out.append((_text(name), 'jsonld.applicantLocationRequirements'))
    if _text(posting.get('jobLocationType')): out.append((_text(posting['jobLocationType']), 'jsonld.jobLocationType'))
    return [{'text': t, 'source': s} for t, s in out]

def _salary(posting):
    base = posting.get('baseSalary')
    if not isinstance(base, dict): return None
    value = base.get('value') if isinstance(base.get('value'), dict) else {'value': base.get('value')}
    out = {'min': value.get('minValue', value.get('value')), 'max': value.get('maxValue', value.get('value')),
           'currency': _text(base.get('currency')) or None, 'unit': _text(value.get('unitText')) or None,
           'provenance': 'employer JSON-LD baseSalary'}
    if out['min'] is None and out['max'] is None: return None
    if not out['currency']: out['uncertainty'] = 'currency not stated'
    return out

def _identifier(posting):
    ident = posting.get('identifier')
    if isinstance(ident, dict): return _text(ident.get('value')) or _text(ident.get('name'))
    return _text(ident)

def _record(employer, req_id, title, url, locations, published, valid_through, description, salary, method, evidence,
            uncertainty, ownership_reviewed):
    if not req_id: uncertainty.append('no stable identifier')
    if not locations: uncertainty.append('no location wording')
    if not published: uncertainty.append('no publication date')
    if not ownership_reviewed: uncertainty.append('employer ownership not reviewed')
    exact = bool(req_id and title and url and ownership_reviewed)
    key = '%s:%s:%s' % (method, employer, req_id or hashlib.sha256((url or title).encode()).hexdigest()[:16])
    return {'key': key, 'employer': employer, 'req_id': req_id or None, 'title': title, 'url': url,
            'locations': locations, 'published': published or None, 'valid_through': valid_through or None,
            'description': (description or '')[:MAX_DESCRIPTION] or None, 'salary': salary,
            'stage': 'exact_vacancy_unreviewed' if exact else 'provisional_vacancy',
            'extraction': {'method': method, 'evidence': evidence, 'uncertainty': sorted(set(uncertainty))}}

def jsonld_postings(page, page_url, employer, ownership_reviewed=False, id_pattern=None):
    """JobPosting records from one official page. Only same-site posting URLs are accepted as canonical."""
    out, seen = [], set()
    host = urlparse(page_url).hostname
    for block in _jsonld_blocks(page):
        for node in _walk(block):
            if not _is_posting(node) or len(out) >= MAX_ITEMS: continue
            uncertainty = []
            url = urljoin(page_url, _text(node.get('url'))) if _text(node.get('url')) else page_url
            if urlparse(url).hostname != host:
                uncertainty.append('posting url is off the official page host'); url = page_url
            req = _identifier(node)
            if not req and id_pattern:
                m = re.search(id_pattern, url)
                if m: req = m.group(1); uncertainty.append('identifier taken from the official URL')
            title = _text(node.get('title'))
            if not title: uncertainty.append('no title')
            org = node.get('hiringOrganization')
            org = _text(org.get('name')) if isinstance(org, dict) else _text(org)
            rec = _record(employer, req, title, url, _places(node), _text(node.get('datePosted')),
                          _text(node.get('validThrough')), html_to_text(_text(node.get('description'))), _salary(node),
                          'jsonld', {'page': page_url, 'hiring_organization': org or None}, uncertainty, ownership_reviewed)
            if rec['key'] not in seen:
                seen.add(rec['key']); out.append(rec)
    return out

def rss_items(body, feed_url, employer, ownership_reviewed=False, id_pattern=None):
    """Items from an official career-site RSS 2.0 feed. Entity declarations are refused before parsing."""
    if re.search(r'<!(?:DOCTYPE|ENTITY)', body[:5000], re.I): raise ValueError('feed declares a DTD/entities; refused')
    root = ET.fromstring(body)
    out = []
    host = urlparse(feed_url).hostname
    for item in root.iter('item'):
        if len(out) >= MAX_ITEMS: break
        get = lambda tag: _text(item.findtext(tag) or '')
        url = get('link') or get('guid')
        uncertainty = []
        if urlparse(url).hostname != host:
            uncertainty.append('item link is off the official feed host')
        req = None
        if id_pattern:
            m = re.search(id_pattern, url)
            if m: req = m.group(1); uncertainty.append('identifier taken from the official URL')
        desc = html_to_text(get('description'))
        # Career RSS descriptions are free text; a short one is usually the location, but that is not certain.
        locations = [{'text': desc, 'source': 'rss.description (unlabelled; may be location)'}] if desc and len(desc) <= 80 else []
        out.append(_record(employer, req, get('title'), url, locations, get('pubDate'), None, desc if len(desc) > 80 else None,
                           None, 'rss', {'feed': feed_url}, uncertainty, ownership_reviewed and urlparse(url).hostname == host))
    return out
