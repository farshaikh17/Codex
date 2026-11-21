import React from 'react';
import { jobPayText } from '../jobHelpers';
import { Job } from '../types';
import { Search, Bookmark, XCircle, ChevronRight, RotateCcw, MapPin, Building, Sparkles, CheckCircle2, HelpCircle } from 'lucide-react';

// The job list, in plain words (owner request 2026-11-07: "much simpler for our dumb human brain").
// Every filter maps to a value the API actually stores; see /api/jobs in worker/index.ts.

interface JobTableProps {
  jobs: Job[];
  totalJobsCount?: number;
  currentPage?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onResetFilters?: () => void;
  onSelectJob: (job: Job) => void;
  onSaveJob: (jobId: string, e: React.MouseEvent) => void;
  onDismissJob?: (jobId: string, e: React.MouseEvent) => void;
  search: string;
  setSearch: (s: string) => void;
  eligibilityFilter: string;
  setEligibilityFilter: (e: string) => void;
  minScore: number;
  setMinScore: (score: number) => void;
  workplaceFilter: string;
  setWorkplaceFilter: (w: string) => void;
  /** where the posting was found: ALL | EMPLOYER | JOB_SITES | BOARDS (API parameter found_on) */
  sourceFilter?: string;
  setSourceFilter?: (s: string) => void;
  sortBy: string;
  setSortBy: (s: string) => void;
  isLoading: boolean;
}

export const STATUS_WORDS: Record<string, { label: string; cls: string }> = {
  READY: { label: 'Ready to apply', cls: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  READY_HIGH: { label: 'Ready to apply', cls: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  STRETCH_READY: { label: 'Stretch', cls: 'bg-blue-50 text-blue-800 border-blue-300' },
  NEEDS_REVIEW: { label: 'To review', cls: 'bg-amber-50 text-amber-800 border-amber-300' },
  HOLD: { label: 'On hold', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  INELIGIBLE: { label: 'Not eligible', cls: 'bg-rose-50 text-rose-800 border-rose-300' },
  CLOSED: { label: 'Closed', cls: 'bg-slate-100 text-slate-500 border-slate-300' },
};

const SOURCE_WORDS: Record<string, string> = {
  indeed: 'Indeed', linkedin: 'LinkedIn', naukri: 'Naukri', glassdoor: 'Glassdoor', bayt: 'Bayt', adzuna: 'Adzuna',
  remoteok: 'Remote OK', weworkremotely: 'We Work Remotely', himalayas: 'Himalayas', workingnomads: 'Working Nomads',
  hnhiring: 'Hacker News', hnjobs: 'Hacker News', jobicy: 'Jobicy', remotive: 'Remotive', workable: 'Workable', arbeitnow: 'Arbeitnow',
  getro: 'VC job board', uncareers: 'UN Careers', eures: 'EURES (EU)', eightfold: 'Company site', avature: 'Company site',
  successfactors: 'Company site', greenhouse: 'Company site', lever: 'Company site', ashby: 'Company site', workday: 'Company site',
  smartrecruiters: 'Company site', icims: 'Company site', oracle: 'Company site', darwinbox: 'Company site', breezy: 'Company site',
  fixture: 'Test data',
};
export const sourceWord = (a?: string | null) => (a ? SOURCE_WORDS[a] || 'Company site' : 'Company site');

// The screen's standard opening sentences say nothing a person needs; the rest of the note is the useful "why".
const BOILERPLATE = [
  'Cloud discovery match. Full requirements, pay and experience require review before READY.',
  'Cloud discovery match. Public job-board/startup announcement; employer verification, full requirements and compensation review pending.',
  'Conservative discovery screen; full qualification review pending.',
];
export function whyText(reason?: string | null) {
  let t = String(reason || '');
  for (const b of BOILERPLATE) t = t.replace(b, '');
  t = t.replace('Outside candidate target role family; retained for review.', 'Outside the usual role family.').trim();
  return t || 'Matches the role family. Open it to see the full posting.';
}

const scoreCls = (s: number) => (s >= 75 ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : s >= 55 ? 'text-blue-700 bg-blue-50 border-blue-200' : 'text-amber-700 bg-amber-50 border-amber-200');

const Seg: React.FC<{ value: string; onChange: (v: string) => void; options: [string, string][]; label: string }> = ({ value, onChange, options, label }) => (
  <div role="group" aria-label={label} className="flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-xs font-medium">
    {options.map(([v, l]) => (
      <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
        className={`px-3 py-1.5 min-h-[34px] rounded-md transition-all ${value === v ? 'bg-white text-slate-900 shadow-sm font-semibold' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
    ))}
  </div>
);

export const JobTable: React.FC<JobTableProps> = ({
  jobs, totalJobsCount, currentPage = 1, pageSize = 50, onPageChange, onResetFilters, onSelectJob, onSaveJob, onDismissJob,
  search, setSearch, eligibilityFilter, setEligibilityFilter, minScore, setMinScore, workplaceFilter, setWorkplaceFilter,
  sourceFilter = 'ALL', setSourceFilter, sortBy, setSortBy, isLoading,
}) => {
  const pages = Math.max(1, Math.ceil((totalJobsCount || 0) / pageSize));
  const select = 'border border-slate-300 rounded-lg px-3 py-1.5 min-h-[34px] text-xs text-slate-700 bg-white focus:ring-2 focus:ring-emerald-500 outline-none';
  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3" data-testid="job-filters">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input type="text" aria-label="Search jobs" placeholder="Search a title, company, skill or place…" value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none" />
          </div>
          <div className="flex gap-2">
            <select aria-label="Sort jobs" value={sortBy} onChange={(e) => setSortBy(e.target.value)} className={select}>
              <option value="score_desc">Best match first</option>
              <option value="date_desc">Newest first</option>
              <option value="company_asc">Company A–Z</option>
              <option value="title_asc">Job title A–Z</option>
            </select>
            {onResetFilters && (
              <button type="button" onClick={onResetFilters} className="px-3 py-1.5 min-h-[34px] rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5">
                <RotateCcw className="w-3.5 h-3.5 text-slate-500" /><span>Clear filters</span>
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Seg label="Eligibility" value={eligibilityFilter === 'INELIGIBLE' ? 'ALL' : eligibilityFilter} onChange={setEligibilityFilter}
            options={[['ALL', 'All jobs'], ['ELIGIBLE', 'Can apply ✓'], ['UNKNOWN', 'Needs checking']]} />
          <button type="button" aria-pressed={minScore >= 70} onClick={() => setMinScore(minScore >= 70 ? 0 : 70)}
            className={`px-3 py-1.5 min-h-[34px] rounded-lg text-xs font-semibold flex items-center gap-1 border transition-colors ${minScore >= 70 ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'}`}>
            <Sparkles className="w-3.5 h-3.5" />Strong matches only
          </button>
          <select aria-label="Workplace" value={workplaceFilter} onChange={(e) => setWorkplaceFilter(e.target.value)} className={select}>
            <option value="ALL">Any workplace</option>
            <option value="REMOTE_ANY">Remote</option>
            <option value="HYBRID">Hybrid</option>
            <option value="ONSITE">On-site</option>
            <option value="UNKNOWN">Not stated</option>
          </select>
          {setSourceFilter && (
            <select aria-label="Found on" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={select}>
              <option value="ALL">Found anywhere</option>
              <option value="EMPLOYER">Company career sites</option>
              <option value="JOB_SITES">Job sites (Indeed, LinkedIn, Naukri…)</option>
              <option value="BOARDS">Remote job boards</option>
            </select>
          )}
          <span className="text-xs text-slate-500 sm:ml-auto" data-testid="job-count">
            {isLoading ? 'Loading…' : `${(totalJobsCount ?? jobs.length).toLocaleString()} job${(totalJobsCount ?? jobs.length) === 1 ? '' : 's'}${pages > 1 ? ` · page ${currentPage} of ${pages}` : ''}`}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-500">
            <div className="animate-spin w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full mx-auto mb-2" />Loading jobs…
          </div>
        ) : jobs.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Search className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="font-medium text-slate-700">No jobs match these filters.</p>
            <p className="text-xs text-slate-400 mt-1">Try "Clear filters", or turn off "Strong matches only".</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="job-list">
            {jobs.map((job) => {
              const app = job.application?.status;
              const isSaved = app === 'SAVED';
              // A collector import the screen has not judged yet is not "to review": say so.
              const notScreened = job.qualification_status === 'NEEDS_REVIEW' && String(job.qualification_reason || '').startsWith('[GITHUB_COLLECTOR] Unassessed');
              const st = notScreened ? { label: 'Not screened yet', cls: 'bg-slate-100 text-slate-600 border-slate-300' } : (STATUS_WORDS[String(job.qualification_status || 'NEEDS_REVIEW')] || STATUS_WORDS.NEEDS_REVIEW);
              const score = Number(job.score?.overall_score) || 0;
              const pay = jobPayText(job);
              const elig = job.eligibility?.classification;
              return (
                <li key={job.id} data-job-id={job.id} onClick={() => onSelectJob(job)} tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelectJob(job); } }} className="p-4 hover:bg-slate-50/80 cursor-pointer transition-colors group flex gap-3 items-start focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600">
                  <div className={`shrink-0 w-14 text-center rounded-lg border py-1.5 ${scoreCls(score)}`} title="Match score: how well the posting fits the profile">
                    <div className="text-lg font-bold leading-none">{score}</div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide mt-0.5">match</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-900 group-hover:text-emerald-700">{job.title}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${st.cls}`}>{st.label}</span>
                      {app && app !== 'SAVED' && <span className="text-[11px] px-2 py-0.5 rounded-full border bg-blue-50 text-blue-700 border-blue-200 font-semibold">{app === 'APPLIED' ? 'Applied' : app.charAt(0) + app.slice(1).toLowerCase()}</span>}
                      {isSaved && <span className="text-[11px] px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200 font-semibold">Saved</span>}
                      {!job.is_active && <span className="text-[11px] px-2 py-0.5 rounded-full border bg-slate-100 text-slate-500 border-slate-300">No longer listed</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500 mt-1">
                      <span className="flex items-center gap-1"><Building className="w-3 h-3 text-slate-400" />{job.company}</span>
                      {job.location_restrictions && <span className="flex items-center gap-1 max-w-[22rem] truncate"><MapPin className="w-3 h-3 text-slate-400" />{job.location_restrictions}</span>}
                      <span className="text-slate-400">via {sourceWord(job.source_adapter)}</span>
                      {pay && <span className="text-emerald-700 font-semibold">{pay}</span>}
                      {elig === 'ELIGIBLE' && <span className="flex items-center gap-1 text-emerald-700 font-semibold"><CheckCircle2 className="w-3 h-3" />Can apply</span>}
                      {elig === 'UNKNOWN' && <span className="flex items-center gap-1 text-amber-700" title={job.eligibility?.reason || ''}><HelpCircle className="w-3 h-3" />Check location</span>}
                    </div>
                    <p className="text-xs text-slate-600 mt-1.5 line-clamp-2" data-testid="job-why">{whyText(job.qualification_reason)}</p>
                  </div>
                  <div className="shrink-0 flex flex-col sm:flex-row items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button onClick={(e) => onSaveJob(job.id, e)} aria-label={`${isSaved ? 'Saved' : 'Save this job'}: ${job.title}`} title={isSaved ? 'Saved' : 'Save this job'}
                      className={`min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border transition-colors ${isSaved ? 'bg-amber-50 border-amber-300 text-amber-600' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800'}`}>
                      <Bookmark className="w-4 h-4" fill={isSaved ? 'currentColor' : 'none'} />
                    </button>
                    {onDismissJob && (
                      <button onClick={(e) => onDismissJob(job.id, e)} aria-label={`Not for me (hide this job): ${job.title}`} title="Not for me (hide this job)"
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-rose-600 hover:border-rose-200">
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => onSelectJob(job)} aria-label={`Open details: ${job.title}`} title="Open details"
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-600">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {totalJobsCount !== undefined && totalJobsCount > pageSize && (
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
            <button type="button" disabled={currentPage <= 1} onClick={() => onPageChange && onPageChange(currentPage - 1)}
              className="px-3 py-1.5 min-h-[36px] rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold disabled:opacity-40">← Previous</button>
            <span className="text-xs text-slate-600">Page {currentPage} of {pages}</span>
            <button type="button" disabled={currentPage >= pages} onClick={() => onPageChange && onPageChange(currentPage + 1)}
              className="px-3 py-1.5 min-h-[36px] rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold disabled:opacity-40">Next →</button>
          </div>
        )}
      </div>
    </div>
  );
};
