"""Public normalization adapters extracted from MIT-licensed local collector."""

import html, json

from datetime import datetime,timezone

from html.parser import HTMLParser

NL=chr(10)

class Skip(Exception):
    def __init__(self, kind, message):
        super().__init__(message)
        self.kind = kind

def clean_text(s):
    lines = [' '.join(line.split()) for line in (s or '').splitlines()]
    t = NL.join(lines)
    while NL * 3 in t:
        t = t.replace(NL * 3, NL * 2)
    return t.strip()

class _Text(HTMLParser):
    BLOCK = {'p', 'br', 'li', 'ul', 'ol', 'div', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        elif tag in self.BLOCK:
            self.parts.append(NL)

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip = max(0, self.skip - 1)
        elif tag in self.BLOCK:
            self.parts.append(NL)

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)

def html_to_text(s):
    p = _Text()
    p.feed(s or '')
    p.close()
    return clean_text(''.join(p.parts))

def parse_date(v):
    try:
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0:
            return datetime.fromtimestamp(v / 1000 if v > 1e11 else v, timezone.utc).isoformat()
        if isinstance(v, str) and v.strip():
            d = datetime.fromisoformat(v.strip().replace('Z', '+00:00'))
            if d.tzinfo is None:
                d = d.replace(tzinfo=timezone.utc)
            return d.isoformat()
    except (ValueError, OverflowError, OSError):
        pass
    return None

def _s(v):
    if v is None:
        return ''
    return v.strip() if isinstance(v, str) else str(v)

def _list(v):
    # A feed may send a number, boolean or string where a list belongs; treat anything but a list as empty instead of failing the whole board.
    return v if isinstance(v, list) else []

def extract_jobs(provider, data):
    if provider == 'lever':
        if not isinstance(data, list):
            raise ValueError('Lever response is not a JSON array')
        return data
    jobs = data.get('jobs') if isinstance(data, dict) else None
    if not isinstance(jobs, list):
        raise ValueError('%s response has no jobs array' % provider)
    return jobs

def _loc_list(pairs):
    seen, out = set(), []
    for text, source in pairs:
        text = _s(text)
        if text and (text, source) not in seen:
            seen.add((text, source))
            out.append({'text': text, 'source': source})
    return out

def _rec(provider, board, req, title, locs, flag, wtype, url, apply_url, pub, upd, desc, comp, raw):
    return {
        'provider': provider, 'board': board, 'req_id': req,
        'key': '%s:%s:%s' % (provider, board, req),
        'title': _s(title), 'locations': _loc_list(locs), 'remote_flag': flag,
        'workplace_type': _s(wtype) or None, 'url': _s(url) or None, 'apply_url': _s(apply_url) or None,
        'published_raw': pub, 'updated_raw': upd, 'published': parse_date(pub),
        'description': clean_text(desc), 'compensation_raw': comp or None, 'raw': raw,
    }

def _flag_from_workplace(wt):
    wt = _s(wt).lower()
    if wt == 'remote':
        return True
    if wt in ('onsite', 'on-site', 'on site', 'hybrid'):
        return False
    return None

def ashby_workplace(job):
    workplace = job.get('workplaceType')
    flag = _flag_from_workplace(workplace)
    if flag is None and job.get('isRemote') is True:
        return True, 'isRemote=true'
    return flag, workplace


ASHBY_COMPONENT_KEYS = ('compensationType', 'currencyCode', 'interval', 'minValue', 'maxValue', 'summary')

def ashby_compensation(c):
    """Ashby compensation, verbatim. With compensationTiers (one tier per location or level), returns compact JSON
    keeping each tier's title and each component's type, currency, interval and amounts exactly as published, so
    nothing is lost to the one-line summary (which shows only the first tier, e.g. '$54.6K \u2013 $61.2K \u2022
    Multiple Ranges' for a USD and a CAD tier). Without tiers, the summary text as before. Never converts or infers."""
    tiers = [t for t in c.get('compensationTiers') or [] if isinstance(t, dict)]
    if tiers:
        return json.dumps({'source': 'ashby.compensationTiers', 'summary': _s(c.get('compensationTierSummary')) or None,
                           'tiers': [{'title': t.get('title'), 'summary': t.get('tierSummary'),
                                      'additional_information': t.get('additionalInformation'),
                                      'components': [{k: comp.get(k) for k in ASHBY_COMPONENT_KEYS}
                                                     for comp in t.get('components') or [] if isinstance(comp, dict)]}
                                     for t in tiers]}, ensure_ascii=False, separators=(',', ':'))
    return _s(c.get('compensationTierSummary')) or _s(c.get('scrapeableCompensationSalarySummary')) or None

def normalize(provider, board, j):
    if not isinstance(j, dict):
        raise Skip('not_object', 'job entry is not an object')
    req = _s(j.get('id'))
    if not req:
        raise Skip('missing_id', 'job has empty or missing id (title=%r); not deduplicated by title' % _s(j.get('title') or j.get('text')))
    if provider == 'greenhouse':
        loc = j.get('location')
        name = _s(loc.get('name') if isinstance(loc, dict) else loc)
        locs = [(p, 'location.name') for p in name.split(';')]
        for o in _list(j.get('offices')):
            if isinstance(o, dict):
                locs += [(o.get('location'), 'offices.location'), (o.get('name'), 'offices.name')]
        comp = json.dumps(j['pay_input_ranges'], ensure_ascii=False) if j.get('pay_input_ranges') else None
        desc = html_to_text(html.unescape(_s(j.get('content'))))
        return _rec(provider, board, req, j.get('title'), locs, None, None, j.get('absolute_url'),
                    j.get('absolute_url'), j.get('first_published'), j.get('updated_at'), desc, comp, j)
    if provider == 'lever':
        cats = j.get('categories') if isinstance(j.get('categories'), dict) else {}
        locs = [(cats.get('location'), 'categories.location')]
        locs += [(x, 'categories.allLocations') for x in _list(cats.get('allLocations'))]
        parts = [_s(j.get('descriptionPlain')) or html_to_text(_s(j.get('description')))
                 or html_to_text(_s(j.get('descriptionBody')))]
        for lst in _list(j.get('lists')):
            if isinstance(lst, dict):
                parts.append(_s(lst.get('text')) + NL + html_to_text(_s(lst.get('content'))))
        parts.append(_s(j.get('additionalPlain')) or html_to_text(_s(j.get('additional'))))
        comp = _s(j.get('salaryDescriptionPlain')) or (json.dumps(j['salaryRange']) if j.get('salaryRange') else None)
        wt = j.get('workplaceType')
        return _rec(provider, board, req, j.get('text'), locs, _flag_from_workplace(wt), wt, j.get('hostedUrl'),
                    j.get('applyUrl'), j.get('createdAt'), None, NL.join(parts), comp, j)
    if provider == 'ashby':
        if j.get('isListed') is False:
            raise Skip('unlisted', 'job %s is not listed' % req)
        locs = [(j.get('location'), 'location')]
        for sec in _list(j.get('secondaryLocations')):
            locs.append((sec.get('location') if isinstance(sec, dict) else sec, 'secondaryLocations'))
        addr = j.get('address') if isinstance(j.get('address'), dict) else {}
        postal = addr.get('postalAddress') if isinstance(addr.get('postalAddress'), dict) else {}
        locs.append((postal.get('addressCountry'), 'address.addressCountry'))
        flag, wt = ashby_workplace(j)
        c = j.get('compensation') if isinstance(j.get('compensation'), dict) else {}
        comp = ashby_compensation(c)
        desc = _s(j.get('descriptionPlain')) or html_to_text(_s(j.get('descriptionHtml')))
        return _rec(provider, board, req, j.get('title'), locs, flag, wt, j.get('jobUrl'),
                    j.get('applyUrl'), j.get('publishedAt'), None, desc, comp, j)
    raise Skip('unknown_provider', provider)

