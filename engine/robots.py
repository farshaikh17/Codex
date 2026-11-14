"""Run-time robots.txt check shared by every reader (more_sources.py, remote_boards.py, jobsite_discovery.py).

Before a reader requests a URL it asks `allowed(url)`. The host's robots.txt is read once per run (cached per host) with the
engine's own User-Agent and matched the way RFC 9309 says: the group for our agent name, else the `*` group; the longest
matching Allow/Disallow rule wins (Allow on a tie); `*` matches any characters and `$` ends the pattern. Python's
urllib.robotparser is not used because it ignores `*` and `$` in paths (Remotive's `Disallow: /*search=` would pass).

  * 4xx other than 429 (no robots.txt, e.g. 404, or an API host answering 401)  everything allowed (RFC 9309 2.3.1.3)
  * 429, 5xx, timeout, network error  everything disallowed for this run (unreachable means "do not crawl", RFC 9309 2.3.1.4)
A bot wall (a challenge page) is a separate refusal the readers never pass; robots.txt allowing a path does not override it.

A refused URL raises RobotsDisallowed, which a reader treats like any other failed request: that source or employer is
skipped and the run report says why. Nothing here sends any personal data: only the robots.txt GET with the generic UA.
"""
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

AGENT = 'career-job-engine'
UA = 'career-job-engine/1.0 (+private job search)'

_cache = {}


class RobotsDisallowed(RuntimeError):
    """robots.txt of the host does not allow this path for our agent."""


def parse(body):
    """robots.txt text -> list of (agents, rules, crawl_delay); rules are (allow: bool, pattern)."""
    groups, agents, rules, delay, last_was_agent = [], [], [], None, False
    for raw in body.splitlines():
        line = raw.split('#', 1)[0].strip()
        if ':' not in line:
            continue
        key, _, value = line.partition(':')
        key, value = key.strip().lower(), value.strip()
        if key == 'user-agent':
            if not last_was_agent and (agents or rules):
                groups.append((agents, rules, delay))
                agents, rules, delay = [], [], None
            agents.append(value.lower())
            last_was_agent = True
            continue
        last_was_agent = False
        if key in ('allow', 'disallow') and agents and value:   # an empty Disallow allows everything: no rule needed
            rules.append((key == 'allow', value))
        elif key == 'crawl-delay' and agents:
            try:
                delay = min(float(value), 30.0)
            except ValueError:
                pass
    if agents or rules:
        groups.append((agents, rules, delay))
    return groups


def _group(groups, agent=AGENT):
    agent = agent.lower()
    mine = [g for g in groups if any(x != '*' and x in agent for x in g[0])]
    return mine or [g for g in groups if '*' in g[0]]


def _rules_for(groups, agent=AGENT):
    return [x for g in _group(groups, agent) for x in g[1]]


def delay_for(groups, agent=AGENT):
    """The Crawl-delay (seconds, capped at 30) that applies to our agent, or 0."""
    return max([g[2] for g in _group(groups, agent) if g[2]] or [0.0])


def _pattern(p):
    end = p.endswith('$')
    body = re.escape(p[:-1] if end else p).replace(r'\*', '.*')
    return re.compile(body + ('$' if end else ''))


def path_allowed(groups, path, agent=AGENT):
    """True when `path` (path plus query) is allowed for `agent` by the parsed robots.txt groups."""
    best = None   # (length, allow)
    for allow, pat in _rules_for(groups, agent):
        if _pattern(pat).match(path):
            key = (len(pat), allow)
            if best is None or key > best:
                best = key
    return True if best is None else best[1]


def _fetch(origin, timeout):
    req = urllib.request.Request(origin + '/robots.txt', headers={'User-Agent': UA, 'Accept': 'text/plain, */*'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:   # noqa: S310 (https origin of a fixed source URL)
            return parse(r.read(500_000).decode('utf-8', 'replace'))
    except urllib.error.HTTPError as e:
        if 400 <= e.code < 500 and e.code != 429:
            return []                         # robots.txt unavailable: everything allowed
        return [(['*'], [(False, '/')], None)]      # 429/5xx: unreachable, treated as "disallow all"
    except Exception as e:   # noqa: BLE001 - unreachable: do not crawl this host in this run
        print(f'robots: {origin} unreachable ({type(e).__name__}); host skipped this run', file=sys.stderr)
        return [(['*'], [(False, '/')], None)]


def _groups(url, timeout, fetch):
    u = urllib.parse.urlsplit(url)
    origin = f'{u.scheme}://{u.netloc}'
    if origin not in _cache:
        _cache[origin] = (fetch or _fetch)(origin, timeout)
    return _cache[origin]


def allowed(url, agent=AGENT, timeout=15, fetch=None):
    """True when the host's robots.txt allows `url` for our agent. robots.txt is read once per host per run."""
    u = urllib.parse.urlsplit(url)
    path = (u.path or '/') + (('?' + u.query) if u.query else '')
    return path_allowed(_groups(url, timeout, fetch), path, agent)


def crawl_delay(url, agent=AGENT, timeout=15, fetch=None):
    """Seconds to wait between requests to this host, from its robots.txt Crawl-delay (0 when none)."""
    return delay_for(_groups(url, timeout, fetch), agent)


def check(url, **kw):
    """Raise RobotsDisallowed when robots.txt does not allow `url`."""
    if not allowed(url, **kw):
        raise RobotsDisallowed(f'robots.txt disallows {urllib.parse.urlsplit(url).netloc}{urllib.parse.urlsplit(url).path}')


def reset():
    _cache.clear()
