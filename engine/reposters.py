"""Reposting sites and virtual-assistant staffing firms, held back at the source so they do not flood a person's lists.

A reposter (Jobgether, Turing, Crossover, ...) republishes other employers' jobs; a VA staffing firm (20four7VA, ...) hires people to
place them with its clients. Their postings are not dropped: at most REPOSTER_CAP of them per firm enter one run's results, and each
is marked `reposter: true` so the run report can count them. The shortlist keeps its own cap (REPOSTERS in
dashboard/scripts/shortlist_select.mjs); the names here start from that list and add the staffing firms seen on 13 Nov.
"""
import re

REPOSTER_CAP = 3
# Whole-name keys (lower case, letters and digits only), as shortlist_select.mjs's isReposter() compares them.
REPOSTER_NAMES = {'jobgether', 'jobgethercom', 'turing', 'turingcom', 'crossover', 'crossoverforwork', 'peopleworth', 'pavago',
                  'braintrust', 'usebraintrust', 'braintrustnetwork',
                  # 14 Nov: virtual-assistant staffing firms seen in Farhan's dataset rows (Breezy)
                  '20four7va', 'twentyfour7va', 'myoutdesk', 'wingassistant', 'virtualstaffingph', 'remotestaff'}
# A company name that says it is a virtual-assistant staffing firm.
VA_NAME = re.compile(r'(?:^|[^a-z])(?:virtual (?:assistants?|staff(?:ing)?)|va (?:staffing|services|agency)|\d+\s*va)(?:[^a-z]|$)', re.I)


def key(company):
    return re.sub(r'(?:inc|llc|ltd)$', '', re.sub(r'[^a-z0-9]+', '', str(company or '').lower()))


def is_reposter(company):
    k = key(company)
    return bool(k) and (k in REPOSTER_NAMES or bool(VA_NAME.search(str(company or '').strip())))


def admit(job, counts, cap=REPOSTER_CAP):
    """True when the posting may enter this run's results. counts: firm key -> postings admitted so far (shared by every source)."""
    if not is_reposter(job.get('company')):
        return True
    k = key(job.get('company'))
    if counts.get(k, 0) >= cap:
        return False
    counts[k] = counts.get(k, 0) + 1
    job['reposter'] = True
    return True


def counts_in(jobs):
    """Reposter postings already in a merged results file (an earlier source of the same run)."""
    out = {}
    for j in jobs:
        if is_reposter(j.get('company')):
            out[key(j.get('company'))] = out.get(key(j.get('company')), 0) + 1
    return out
