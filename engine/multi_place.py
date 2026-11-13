"""Places for a posting listed in several locations (plan B2, phase 4).

Workday lists a posting open in several places as "N Locations". The places themselves are in the posting's own path
(/job/<first place>/<title>_<id>) and, in full, in its detail answer (location and additionalLocations). Storing up to three places, with
"+N more", lets the screen read where the job is ("Assen; Norg; Delfzijl - Tankenpark; +2 more (Netherlands)") instead of a count it cannot
place. SmartRecruiters already gives one place per posting and needs nothing here.
"""
import re
import urllib.parse

COUNT = re.compile(r'^\s*(\d+)\s+locations?\s*$', re.I)
MAX_PLACES = 3


def count_location(location):
    """The number in a location written as a count ("3 Locations"), or None."""
    m = COUNT.match(str(location or ''))
    return int(m.group(1)) if m else None


def workday_path_place(url):
    """The first place of a Workday posting, read from its path: .../job/Berlin/AI-Engineer_R4362 -> 'Berlin';
    .../job/Brockville---Lube-Plant/... -> 'Brockville - Lube Plant'. None when the URL has no such segment."""
    try:
        path = urllib.parse.unquote(urllib.parse.urlsplit(str(url or '')).path)
    except ValueError:
        return None
    m = re.search(r'/job/([^/]+)/[^/]+$', path)
    if not m or 'myworkdayjobs.com' not in str(url):
        return None
    place = re.sub(r'\s+', ' ', m.group(1).replace('---', '\x00').replace('--', ' ').replace('-', ' ').replace('\x00', ' - ')).strip()
    return place[:120] or None


def places_text(places, total=None, country=None):
    """Up to three places joined by '; ', then '+N more' for the rest of `total`, then the country in brackets when it is not already named."""
    seen = []
    for p in places:
        p = re.sub(r'\s+', ' ', str(p or '')).strip()
        if p and p.lower() not in (s.lower() for s in seen):
            seen.append(p)
    if not seen:
        return None
    total = max(int(total or 0), len(seen))
    out = '; '.join(seen[:MAX_PLACES])
    if total > MAX_PLACES or total > len(seen[:MAX_PLACES]):
        out += f'; +{total - len(seen[:MAX_PLACES])} more'
    country = re.sub(r'\s+', ' ', str(country or '')).strip()
    if country and country.lower() not in out.lower():
        out += f' ({country})'
    return out[:300]


def from_count(location, url):
    """A dataset or list location written as a count, replaced by the posting's first place and "+N more" when the URL gives it."""
    n = count_location(location)
    if n is None:
        return location
    first = workday_path_place(url)
    return places_text([first], n) if first else location


MORE = re.compile(r'^\+(\d+) more$')


def merge_places(current, add):
    """Plan B3: the location of a job listed in several cities, with one more city added: 'Pune' + 'Chennai' -> 'Pune; Chennai'; past three
    places nothing more is added: the posting a city came from is not stored, so it comes back every day, and counting it again would grow
    '+N more' each run. A '+N more' already there (a source's own count) is kept, as is a trailing '(Country)'. A city already named changes
    nothing."""
    cur = str(current or '').strip()
    suffix = ''
    m = re.search(r'\s*(\([^)]*\))\s*$', cur)
    if m and ';' in cur:
        suffix, cur = ' ' + m.group(1), cur[:m.start()]
    places, extra = [], 0
    for part in [p.strip() for p in cur.split(';') if p.strip()]:
        mm = MORE.match(part)
        if mm:
            extra += int(mm.group(1))
        else:
            places.append(part)
    new = str(add or '').strip()
    key = lambda x: re.sub(r'[^a-z0-9]+', ' ', x.lower()).strip()   # noqa: E731
    if not new or key(new) in {key(p) for p in places}:
        return current
    if len(places) >= MAX_PLACES:
        return current
    places.append(new)
    out = '; '.join(places) + (f'; +{extra} more' if extra else '') + suffix
    return out[:300]


def place_listed(current, add):
    """True when the place is already one of the places a location names (so adding it changes nothing and the posting is the one merged before)."""
    key = lambda x: re.sub(r'[^a-z0-9]+', ' ', x.lower()).strip()   # noqa: E731
    cur = re.sub(r'\s*\([^)]*\)\s*$', '', str(current or ''))
    places = {key(p) for p in cur.split(';') if p.strip() and not MORE.match(p.strip())}
    return bool(str(add or '').strip()) and (key(str(add)) in places or key(str(add)) == key(str(current or '')))
