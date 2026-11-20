"""Merges the results of the parallel collector jobs of discovery.yml (max discovery, 20 Nov 2026) into the one work folder the import uses.

Each collector job (a JobSpy shard, the remote boards, a group of more_sources) runs on its own runner, without database credentials, and
uploads its work folder: jobsite_raw.json plus its report (jobsite_report.json, boards_report.json or more_sources_report.json). This joins them:
  - jobsite_raw.json: every posting once (by id; the people of both copies kept), reposting sites and VA staffing firms at most
    reposters.REPOSTER_CAP per firm across all parts, as one sequential run admitted them;
  - jobsite_report.json: counts summed, the logs joined, the shards listed;
  - more_sources_report.json and boards_report.json: one entry per source (the groups read different sources);
  - with --profiles (the run's profiles, clients included), every person whose role rule matches a posting's title is added to it.
A part that is missing (its job failed or timed out before uploading) is reported in collect_parts.json and skipped; the run goes on.

Usage: python engine/merge_collect.py --out work PART_DIR [PART_DIR ...]
"""
import argparse
import json
import re
import sys
from pathlib import Path

try:   # run as a script (engine/ on sys.path) or as part of the engine package (tests)
    import reposters
except ImportError:   # pragma: no cover
    from engine import reposters

# The order one sequential run read them in (job sites, remote boards, more sources), so the reposter cap admits the same postings.
KIND_ORDER = ('jobsites', 'clients', 'boards', 'more')
SUM_KEYS = ('searches', 'blocked', 'skipped_after_refusals', 'returned', 'selected')


def _read(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def merge_jobs(parts):
    """Postings of every part, each once; reposter firms capped across the parts."""
    by_id, order, held = {}, [], {}
    for jobs in parts:
        for j in jobs:
            jid = j.get('id')
            if not jid:
                continue
            if jid in by_id:
                have = by_id[jid]
                have['candidates'] = list(dict.fromkeys((have.get('candidates') or []) + (j.get('candidates') or [])))
                continue
            if reposters.is_reposter(j.get('company')) and not reposters.admit(j, held):
                continue
            by_id[jid] = dict(j)
            order.append(jid)
    return [by_id[i] for i in order]


def part_rank(path):
    name = Path(path).name.replace('collect-', '')
    for i, k in enumerate(KIND_ORDER):
        if name.startswith(k):
            return (i, name)
    return (len(KIND_ORDER), name)


def attribute(jobs, profs):
    """Adds every person whose role rule (the Worker's own for a built-in candidate, the stored keywords for a client) matches a posting's title
    and whose exclusions do not. The collector jobs had only the built-in profiles; this matches the clients, and a posting one person's search
    found to the other person when it is in their field. Never removes a person. Returns the number of people added."""
    rules = []
    for cid, p in (profs or {}).items():
        try:
            rules.append((cid, re.compile(p.get('wide_role') or p['role'], re.I), re.compile(p['exclude'], re.I) if p.get('exclude') else None))
        except (KeyError, re.error, TypeError):
            continue
    added = 0
    for j in jobs:
        title = str(j.get('title') or '').lower()
        have = j.setdefault('candidates', [])
        for cid, role, exclude in rules:
            if cid not in have and role.search(title) and not (exclude and exclude.search(title)):
                have.append(cid)
                added += 1
    return added


def merge_jobsite_reports(reports):
    out = {k: 0 for k in SUM_KEYS}
    out.update({'shards': [], 'by_site': {}, 'robots': {}, 'log': []})
    for r in reports:
        out['shards'].append(r.get('shard', 'all'))
        for k in SUM_KEYS:
            out[k] += int(r.get(k) or 0)
        for site, n in (r.get('by_site') or {}).items():
            out['by_site'][site] = out['by_site'].get(site, 0) + int(n or 0)
        for site, v in (r.get('robots') or {}).items():
            out['robots'].setdefault(site, v)
        out['log'] += r.get('log') or []
    return out


def merge(part_dirs, out_dir, profs=None):
    out_dir = Path(out_dir)
    part_dirs = sorted(part_dirs, key=part_rank)
    out_dir.mkdir(parents=True, exist_ok=True)
    jobs, js_reports, more, boards, parts = [], [], {}, {}, {}
    for d in part_dirs:
        d = Path(d)
        raw = _read(d / 'jobsite_raw.json')
        parts[d.name] = 'ok' if raw is not None else 'missing'
        if raw is not None:
            jobs.append(raw.get('jobs') or [])
        js = _read(d / 'jobsite_report.json')
        if js is not None:
            js_reports.append(js)
        more.update(_read(d / 'more_sources_report.json') or {})
        boards.update(_read(d / 'boards_report.json') or {})
    merged = merge_jobs(jobs)
    added = attribute(merged, profs) if profs else 0
    (out_dir / 'jobsite_raw.json').write_text(json.dumps({'source': 'job_sites', 'jobs': merged}, default=str))
    if js_reports:
        (out_dir / 'jobsite_report.json').write_text(json.dumps(merge_jobsite_reports(js_reports), indent=1, default=str))
    if more:
        (out_dir / 'more_sources_report.json').write_text(json.dumps(more, indent=1))
    if boards:
        (out_dir / 'boards_report.json').write_text(json.dumps(boards, indent=1))
    summary = {'parts': parts, 'jobs_in': sum(len(x) for x in jobs), 'jobs': len(merged), 'people_added_by_role_rule': added}
    (out_dir / 'collect_parts.json').write_text(json.dumps(summary, indent=1))
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--profiles', default=None, help="the run's search profiles (work/profiles.json, with the clients)")
    ap.add_argument('parts', nargs='*')
    a = ap.parse_args()
    profs = _read(a.profiles) if a.profiles else None
    summary = merge(a.parts, a.out, profs)
    for name, state in summary['parts'].items():
        if state != 'ok':
            print(f'::warning::collector part {name} uploaded no results (its job failed or ran out of time); the run goes on without it')
    print(json.dumps(summary))
    return 0


if __name__ == '__main__':
    sys.exit(main())
