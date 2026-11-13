// The job seeker's screens built from cards: Today (plan U5), everything else (the full list), and the hidden jobs (U2).
import React, { useEffect, useState } from 'react';
import { Job } from '../types';
import { TodayData, fetchJobs, fetchHiddenJobs } from '../api';
import { updatedNote } from '../jobHelpers';
import { JobCard, btnPlain } from './JobCard';
import { todayLabel, listedAt, timeIST } from './format';

export interface CardActions {
  onOpen: (job: Job) => void;
  onPosting: (job: Job) => void;
  onSave: (job: Job) => void;
  onHide: (job: Job) => void;
}

const Section: React.FC<{ title: string; count?: number; children: React.ReactNode; testid: string }> = ({ title, count, children, testid }) => (
  <section aria-label={title} data-testid={testid} className="space-y-3">
    <h2 className="text-lg font-bold text-slate-900">{title}{count != null ? ` (${count})` : ''}</h2>
    {children}
  </section>
);

const NEW_SHOWN = 5;   // the first Best match stays near the top of a phone screen even after a long absence

export const TodayView: React.FC<{ data: TodayData; baseline: number; lastRunAt: string | null | undefined; actions: CardActions; go: (view: 'all' | 'applications' | 'hidden') => void }> = ({ data, baseline, lastRunAt, actions, go }) => {
  const [openWorth, setOpenWorth] = useState(false);
  const [allNew, setAllNew] = useState(false);
  const all = [...data.best, ...data.worth_a_try, ...data.recent];
  const newOnes = all.filter((j, i) => all.findIndex((x) => x.id === j.id) === i && listedAt(j) > baseline);
  const isNew = new Set(newOnes.map((j) => j.id));
  const best = data.best.filter((j) => !isNew.has(j.id));
  const worth = data.worth_a_try.filter((j) => !isNew.has(j.id));
  const c = data.counts;
  const note = updatedNote(lastRunAt);
  const card = (j: Job, fresh = false) => <JobCard key={j.id} job={j} isNew={fresh} {...actions} />;
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-700" data-testid="status-line">
        <span>{todayLabel()}</span>
        <span> · {newOnes.length} new since your last visit</span>
        <span> · {c.more_good} more good match{c.more_good === 1 ? '' : 'es'}</span>
        {note && (note.stale
          ? <span> · <span role="status" className="rounded-full bg-amber-200 text-amber-950 px-2" data-testid="updated-note">{note.label}</span></span>
          : <span data-testid="updated-note"> · Updated {lastRunAt ? timeIST(lastRunAt) : ''}</span>)}
      </p>
      {c.followups_due > 0 && (
        <button type="button" onClick={() => go('applications')} data-testid="nudge" className="w-full min-h-[44px] rounded-xl bg-amber-100 text-amber-950 border border-amber-300 text-base font-semibold px-4 text-left">
          {c.followups_due} follow-up{c.followups_due === 1 ? '' : 's'} due →
        </button>
      )}
      {newOnes.length > 0 && (
        <Section title="New since your last visit" count={newOnes.length} testid="section-new">
          {(allNew ? newOnes : newOnes.slice(0, NEW_SHOWN)).map((j) => card(j, true))}
          {newOnes.length > NEW_SHOWN && !allNew && <button type="button" className={btnPlain} onClick={() => setAllNew(true)}>Show all {newOnes.length} new</button>}
        </Section>
      )}
      <Section title="Best matches" count={c.best} testid="section-best">
        {best.length ? best.map((j) => card(j)) : <p className="text-base text-slate-600">{c.best ? 'All of them are under "New" above.' : 'None today. Look through "Worth a try" below.'}</p>}
      </Section>
      <section aria-label="Worth a try" data-testid="section-worth" className="space-y-3">
        <button type="button" aria-expanded={openWorth} onClick={() => setOpenWorth((o) => !o)} className="w-full min-h-[44px] flex items-center justify-between text-lg font-bold text-slate-900 text-left">
          <span>Worth a try ({c.worth_a_try})</span><span aria-hidden="true">{openWorth ? '▴' : '▾'}</span>
        </button>
        {openWorth && (worth.length ? worth.map((j) => card(j)) : <p className="text-base text-slate-600">Nothing else here today.</p>)}
      </section>
      <div className="flex flex-wrap gap-3 pt-2 border-t border-slate-200">
        <button type="button" onClick={() => go('all')} className={btnPlain} data-testid="show-everything">Show everything else ({c.everything})</button>
        {c.hidden > 0 && <button type="button" onClick={() => go('hidden')} className={btnPlain}>Hidden jobs ({c.hidden})</button>}
      </div>
    </div>
  );
};

const FILTERS: [string, string][] = [['ALL', 'All'], ['INDIA', 'Says it hires in India'], ['REMOTE', 'Remote']];

export const AllView: React.FC<{ candidateId: string; total: number; actions: CardActions; refreshKey: number }> = ({ candidateId, total, actions, refreshKey }) => {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [count, setCount] = useState(total);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('ALL');
  const [sort, setSort] = useState('score_desc');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 400); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [filter, sort, term]);
  useEffect(() => {
    let live = true;
    setError('');
    fetchJobs({ candidate_id: candidateId, exclude_applied: true, exclude_dismissed: true, sort_by: sort, search: term || undefined, page, limit: 25,
      eligibility: filter === 'INDIA' ? 'ELIGIBLE' : undefined, workplace_type: filter === 'REMOTE' ? 'REMOTE_ANY' : undefined })
      .then((r) => { if (live) { setJobs(r.jobs); setCount(r.total); } })
      .catch(() => { if (live) setError('Could not load the list. Check the connection and try again.'); });
    return () => { live = false; };
  }, [candidateId, filter, sort, term, page, refreshKey]);
  const pages = Math.max(1, Math.ceil(count / 25));
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-900">Everything else ({count})</h2>
      <input type="search" aria-label="Search jobs" placeholder="Search a title, employer or place" value={search} onChange={(e) => setSearch(e.target.value)}
        className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-base" />
      <div className="flex flex-wrap gap-3" role="group" aria-label="Show">
        {FILTERS.map(([k, l]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
          className={filter === k ? `${btnPlain} bg-slate-900 text-white border-slate-900 hover:bg-slate-800` : btnPlain}>{l}</button>)}
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm bg-white">
          <option value="score_desc">Best match first</option><option value="date_desc">Newest first</option>
        </select>
      </div>
      {error && <p role="alert" className="text-base text-rose-800">{error}</p>}
      {jobs === null ? <p className="text-base text-slate-600">Loading…</p> : jobs.length === 0 ? <p className="text-base text-slate-600">No jobs here.</p> : jobs.map((j) => <JobCard key={j.id} job={j} {...actions} />)}
      {pages > 1 && (
        <div className="flex items-center gap-3">
          <button type="button" className={btnPlain} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span className="text-sm text-slate-700">Page {page} of {pages}</span>
          <button type="button" className={btnPlain} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
};

export const HiddenView: React.FC<{ candidateId: string; actions: CardActions; onRestore: (job: Job) => void; refreshKey: number }> = ({ candidateId, actions, onRestore, refreshKey }) => {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  useEffect(() => { let live = true; fetchHiddenJobs(candidateId).then((j) => { if (live) setJobs(j); }).catch(() => { if (live) setJobs([]); }); return () => { live = false; }; }, [candidateId, refreshKey]);
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-900">Hidden jobs{jobs ? ` (${jobs.length})` : ''}</h2>
      <p className="text-base text-slate-700">Jobs you marked Not for me. Restore one to put it back where it was.</p>
      {jobs === null ? <p className="text-base text-slate-600">Loading…</p> : jobs.length === 0 ? <p className="text-base text-slate-600">Nothing hidden.</p>
        : jobs.map((j) => <JobCard key={j.id} job={j} onOpen={actions.onOpen} onPosting={actions.onPosting} onRestore={onRestore} />)}
    </div>
  );
};
