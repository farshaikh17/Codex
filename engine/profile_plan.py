"""Discovery from a profile config (dashboard/docs/MULTI_CANDIDATE.md section 6).

A person with a profile config (table candidate_profile_configs, schema 1) gets their searches from it: the dataset prefilter, JobSpy queries,
Workable / EURES / Adzuna terms and employer boards, built from the config's discovery hints, its role families (dashboard/shared/role_families.json)
and its place policies. The result is one entry of work/profiles.json, the file every discovery step reads, with the same keys the built-in and
client entries have (role, exclude, countries, mode, home, keywords, public) plus the per-person lists and caps below. No network, no database.

  python engine/profile_plan.py --config dashboard/test/profiles/example_data_analyst_remote_eu.json [--candidate-id x]   (prints the entry)
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAMILIES = json.loads((ROOT / 'dashboard' / 'shared' / 'role_families.json').read_text())['families']
# Per-person bounds (documented in MULTI_CANDIDATE.md section 8)
MAX_JOBSPY, MAX_WORKABLE, MAX_WORKABLE_PLACES, MAX_EURES, MAX_ADZUNA, MAX_BOARDS = 5, 8, 6, 4, 3, 10
DEFAULT_MAX_ROWS, DEFAULT_MAX_SELECTED = 20000, 400
# The country name JobSpy takes for Indeed (country_indeed) and as the search location.
JOBSPY_COUNTRY = {'IN': 'India', 'GB': 'UK', 'IE': 'Ireland', 'US': 'USA', 'CA': 'Canada', 'DE': 'Germany', 'NL': 'Netherlands', 'FR': 'France', 'ES': 'Spain',
                  'PT': 'Portugal', 'PL': 'Poland', 'SE': 'Sweden', 'AE': 'United Arab Emirates', 'SA': 'Saudi Arabia', 'QA': 'Qatar', 'SG': 'Singapore', 'AU': 'Australia'}
EU = {'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO'}
ADZUNA_COUNTRIES = {'GB', 'US', 'DE', 'NL', 'FR', 'IN', 'AU', 'CA', 'ES', 'IT', 'PL', 'AT', 'BE', 'BR', 'CH', 'MX', 'NZ', 'SG', 'ZA'}
GULF = {'AE', 'SA', 'QA', 'OM', 'KW', 'BH'}
SITES = ('indeed', 'linkedin', 'glassdoor', 'google', 'bayt')


def phrase_regex(words):
    """Plain phrases -> one whole-phrase regex on the lower-cased title (the Worker's phrase rule: spaces or hyphens between words)."""
    parts = [re.escape(w.strip().lower()).replace(r'\ ', r'[\s-]+') for w in words if w and len(w.strip()) >= 2]
    return '(^|[^a-z0-9])(' + '|'.join(dict.fromkeys(parts)) + ')($|[^a-z0-9])' if parts else None


def _list(v):
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except ValueError:
            return []
    return [str(x) for x in v] if isinstance(v, list) else []


def homes(cfg):
    out = []
    for p in cfg.get('place') or [{'policy': 'onsite_in', 'countries': ['IN']}]:
        for c in ([p['country']] if p.get('country') else p.get('countries') or []):
            if c not in out:
                out.append(c)
    return out or ['IN']


def plan(cfg, candidate=None, builtin=None):
    """The profiles.json entry for one person. `candidate` is their candidates row (target roles are the fallback search), `builtin` the
    dataset_discovery.BUILTIN table (a config using the built-in field packs reuses their dataset role rule)."""
    # None when the config gives no role rule (no families, title words, built-in field pack or target roles): the caller skips that person
    # with a warning; the run never stops for one person's config.
    candidate, builtin = candidate or {}, builtin or {}
    field = cfg.get('field') or {}
    fams = [k for k in field.get('role_families') or [] if k in FAMILIES]
    title = field.get('title') or {}
    targets = _list(candidate.get('target_roles')) + list(field.get('target_roles') or [])
    must = [w for k in fams for w in FAMILIES[k]['title']] + list(title.get('must') or [])
    words = must or targets
    roles = [phrase_regex(words)] if words else []
    packs = field.get('packs') or ['keyword']
    for pack, cid in (('revops_automation', 'farhan_shaikh'), ('plant_maintenance', 'sana_ansari')):
        if pack in packs and cid in builtin:
            roles.append(builtin[cid]['role'])
    avoid = list(title.get('avoid') or []) + [w for k in field.get('excluded_families') or [] if k in FAMILIES for w in FAMILIES[k]['title']]
    places = cfg.get('place') or [{'policy': 'onsite_in', 'countries': ['IN']}]
    remote_only = any(p.get('policy') == 'remote_from_country' and p.get('remote_only', True) for p in places)
    hs = homes(cfg)
    disc = cfg.get('discovery') or {}
    countries = [c for c in (disc.get('countries') or hs) if c]
    terms = list(dict.fromkeys(list(disc.get('search_terms') or []) or [w for k in fams for w in FAMILIES[k]['search']] or targets))
    sites = [s for s in (disc.get('jobspy_sites') or ['indeed', 'linkedin']) if s in SITES]
    jobspy = []
    for i, term in enumerate(terms[:MAX_JOBSPY]):
        c = countries[i % len(countries)] if countries else 'IN'
        name = JOBSPY_COUNTRY.get(c, c)
        jobspy.append([f'{term} remote' if remote_only else term, name, name, sites + (['bayt'] if c in GULF and 'bayt' not in sites else [])])
    onsite = [c for p in places if p.get('policy') == 'onsite_in' for c in p.get('countries') or []]
    workable_places = [[t, False, JOBSPY_COUNTRY.get(c, c)] for c in onsite[:2] for t in terms[:3]][:MAX_WORKABLE_PLACES] if not remote_only else []
    role = '|'.join(r for r in roles if r)
    if not role:
        return None
    try:
        re.compile(role)
    except re.error:
        return None
    th = (cfg.get('thresholds') or {})
    return {
        'role': role, 'exclude': phrase_regex(avoid) or '',
        'countries': countries, 'mode': 'REMOTE_FROM_HOME' if remote_only else 'HOME_OR_RELOCATE', 'home': JOBSPY_COUNTRY.get(hs[0], hs[0]).lower(),
        'keywords': terms[:MAX_JOBSPY], 'public': False, 'profile_engine': True, 'remote_only': remote_only,
        'jobspy': jobspy, 'workable': terms[:MAX_WORKABLE], 'workable_places': workable_places,
        'eures': terms[:MAX_EURES] if any(c in EU for c in countries) else [],
        'adzuna': [[c.lower(), t] for c in countries if c in ADZUNA_COUNTRIES for t in terms][:MAX_ADZUNA],
        'boards': [b for b in (disc.get('employer_boards') or []) if b.get('kind') in ('greenhouse', 'lever', 'ashby', 'workable', 'jazzhr')][:MAX_BOARDS],
        'max_rows': int(disc.get('max_rows') or DEFAULT_MAX_ROWS), 'max_selected': int(disc.get('max_selected') or DEFAULT_MAX_SELECTED),
        # the cut-off the config scores against (worker/profiles/resolve.ts: qualify, else the candidate row, else the base's default)
        'threshold': th.get('qualify') or candidate.get('qualification_threshold') or th.get('default'),
    }


def engine_config(raw, candidate_id, legacy_ids=('farhan_shaikh', 'sana_ansari')):
    """The config when it asks for the profile engine (the same rule as worker/profiles/dispatch.ts engineConfig()), else None. Only a resolved
    config (merged with its built-in base and validated by dashboard/scripts/profile_config.mjs, marked "resolved": true) is used, so this side
    reads exactly the config the scorer reads; a built-in id needs its own legacy base."""
    try:
        cfg = json.loads(raw) if isinstance(raw, str) else raw
    except (ValueError, TypeError):
        return None
    if not isinstance(cfg, dict) or cfg.get('schema') != 1 or cfg.get('resolved') is not True:
        return None
    if candidate_id in legacy_ids and cfg.get('extends') != f'legacy:{candidate_id}':
        return None
    engine = cfg.get('engine') or ('legacy' if candidate_id in legacy_ids else 'profile')
    return cfg if engine == 'profile' else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--config', required=True)
    ap.add_argument('--candidate', default=None, help='a candidates.json-style row (JSON file) for the fallback target roles')
    a = ap.parse_args()
    cand = json.loads(Path(a.candidate).read_text()) if a.candidate else {}
    from engine.dataset_discovery import BUILTIN  # noqa: E402 - only for configs that use the built-in field packs
    print(json.dumps(plan(json.loads(Path(a.config).read_text()), cand, BUILTIN), indent=1))
    return 0


if __name__ == '__main__':
    sys.path.insert(0, str(ROOT))
    sys.exit(main())
