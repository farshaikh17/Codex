import React, { useState, useEffect, useCallback } from 'react';
import { Job, IndiaRemoteResult } from '../types';
import { fetchIndiaRemoteJobs, updateApplication } from '../api';
import {
  Globe2,
  CheckCircle2,
  Search,
  ExternalLink,
  ShieldCheck,
  Bookmark,
  Sparkles,
  RotateCcw,
  Building,
  DollarSign,
  AlertCircle
} from 'lucide-react';

interface IndiaRemoteViewProps {
  candidateId?: string;
  onSelectJob: (job: Job) => void;
  onRefreshGlobal?: () => void;
}

type Fit = 'ALL' | 'READY' | 'STRETCH' | 'REVIEW' | 'NOT_FIT';
const PAGE_SIZE = 25;
const FIT_LABEL: Record<string, string> = { READY: 'READY', STRETCH: 'STRETCH', REVIEW: 'NEEDS REVIEW', NOT_FIT: 'NOT FIT' };

export const IndiaRemoteView: React.FC<IndiaRemoteViewProps> = ({ candidateId = 'farhan_shaikh', onSelectJob, onRefreshGlobal }) => {
  const [result, setResult] = useState<IndiaRemoteResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filter states. Every one of them is sent to the server, which filters, counts and paginates; nothing is filtered in the browser.
  const [fitFilter, setFitFilter] = useState<Fit>('ALL');
  const [roleFamilyFilter, setRoleFamilyFilter] = useState<string>('ALL');
  const [payFilter, setPayFilter] = useState<string>('ALL');
  const [searchInput, setSearchInput] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [excludeApplied, setExcludeApplied] = useState<boolean>(true);
  const [sortBy, setSortBy] = useState<string>('score_desc');
  const [page, setPage] = useState<number>(0);

  // A different candidate has different role families and counts: start from a clean state.
  useEffect(() => {
    setFitFilter('ALL'); setRoleFamilyFilter('ALL'); setPayFilter('ALL'); setSearchInput(''); setSearch(''); setPage(0);
  }, [candidateId]);

  // Typing does not query on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(0); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadSeq = React.useRef(0);
  const loadData = useCallback(async () => {
    const seq = ++loadSeq.current;
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchIndiaRemoteJobs({
        candidate_id: candidateId,
        farhan_fit: fitFilter,
        role_family: roleFamilyFilter,
        pay_filter: payFilter,
        search: search || undefined,
        exclude_applied: excludeApplied,
        sort_by: sortBy,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      // A slower response for an earlier filter or candidate must not overwrite the current screen.
      if (seq !== loadSeq.current) return;
      setResult(data);
    } catch (err: any) {
      if (seq !== loadSeq.current) return;
      console.error(err);
      setError(err.message || 'Failed to load India Remote opportunities.');
    } finally {
      if (seq === loadSeq.current) setIsLoading(false);
    }
  }, [candidateId, fitFilter, roleFamilyFilter, payFilter, search, excludeApplied, sortBy, page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const jobs = result?.jobs ?? [];
  const total = result?.total ?? 0;
  const fitCounts = result?.facets?.fit;
  const payCounts = result?.facets?.pay;
  const families = result?.facets?.role_family ?? [];
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const firstShown = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastShown = Math.min(total, page * PAGE_SIZE + jobs.length);

  // If the data shrank under the current page (for example a job was applied to), step back to the last page that exists.
  useEffect(() => {
    if (result && result.total > 0 && result.jobs.length === 0 && page > lastPage) setPage(lastPage);
  }, [result, page, lastPage]);

  const pickFit = (f: Fit) => { setFitFilter(f); setPage(0); };

  const handleToggleSave = async (job: Job, e: React.MouseEvent) => {
    e.stopPropagation();
    const newStatus = job.application?.status === 'SAVED' ? 'WITHDRAWN' : 'SAVED';
    try {
      await updateApplication({ job_id: job.id, status: newStatus, candidate_id: candidateId });
      await loadData();
      if (onRefreshGlobal) onRefreshGlobal();
    } catch {
      setError('Unable to update application state.');
    }
  };

  const handleClearFilters = () => {
    setFitFilter('ALL');
    setRoleFamilyFilter('ALL');
    setPayFilter('ALL');
    setSearchInput('');
    setSearch('');
    setExcludeApplied(true);
    setSortBy('score_desc');
    setPage(0);
  };

  const count = (n: number | undefined) => (n === undefined ? '—' : n);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-teal-900 via-slate-900 to-indigo-950 text-white p-6 rounded-2xl shadow-md border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="bg-emerald-500/20 text-emerald-300 text-xs px-2.5 py-0.5 rounded-full font-mono border border-emerald-500/30 font-semibold flex items-center gap-1.5">
                <Globe2 className="w-3.5 h-3.5" />
                INDIA ELIGIBILITY SCREEN
              </span>
              <span className="text-slate-400 text-xs">Eligibility and candidate fit are separate</span>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white">India Remote Opportunities</h1>
            <p className="text-slate-300 text-sm mt-1 max-w-2xl leading-relaxed">
              Vacancies whose own posting text met an automated screen for working from India. This is not confirmation from the employer, so read the posting
              before applying. The fit label is the recorded qualification status and is shown next to the stored score; where the two disagree the card explains it.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={isLoading}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Top Metric Pills: the counts are the facets of the same query, so each equals what choosing it shows */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-6 pt-6 border-t border-slate-800">
          <button
            onClick={() => pickFit('ALL')}
            className={`p-3 rounded-xl border text-left transition-all ${
              fitFilter === 'ALL'
                ? 'bg-white/10 border-white/30 ring-2 ring-emerald-400 shadow-md'
                : 'bg-slate-800/40 border-slate-800 hover:bg-slate-800/70'
            }`}
          >
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">All eligible</div>
            <div className="text-xl font-black text-white mt-0.5">{count(fitCounts?.ALL)}</div>
            <div className="text-[10px] text-emerald-400 mt-1">Per posting text</div>
          </button>

          <button
            onClick={() => pickFit('READY')}
            className={`p-3 rounded-xl border text-left transition-all ${
              fitFilter === 'READY'
                ? 'bg-emerald-950/60 border-emerald-500 ring-2 ring-emerald-400 shadow-md'
                : 'bg-emerald-950/20 border-emerald-900/50 hover:bg-emerald-950/40'
            }`}
          >
            <div className="text-[11px] uppercase tracking-wider text-emerald-400 font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Ready
            </div>
            <div className="text-xl font-black text-emerald-300 mt-0.5">{count(fitCounts?.READY)}</div>
            <div className="text-[10px] text-emerald-400 mt-1 font-mono font-medium">Recorded status</div>
          </button>

          <button
            onClick={() => pickFit('STRETCH')}
            className={`p-3 rounded-xl border text-left transition-all ${
              fitFilter === 'STRETCH'
                ? 'bg-blue-950/60 border-blue-500 ring-2 ring-blue-400 shadow-md'
                : 'bg-blue-950/20 border-blue-900/50 hover:bg-blue-950/40'
            }`}
          >
            <div className="text-[11px] uppercase tracking-wider text-blue-400 font-semibold flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Stretch
            </div>
            <div className="text-xl font-black text-blue-300 mt-0.5">{count(fitCounts?.STRETCH)}</div>
            <div className="text-[10px] text-blue-400 mt-1 font-mono font-medium">Recorded status</div>
          </button>

          <button
            onClick={() => pickFit('REVIEW')}
            className={`p-3 rounded-xl border text-left transition-all ${
              fitFilter === 'REVIEW'
                ? 'bg-amber-950/60 border-amber-500 ring-2 ring-amber-400 shadow-md'
                : 'bg-amber-950/20 border-amber-900/50 hover:bg-amber-950/40'
            }`}
          >
            <div className="text-[11px] uppercase tracking-wider text-amber-400 font-semibold">Needs review</div>
            <div className="text-xl font-black text-amber-300 mt-0.5">{count(fitCounts?.REVIEW)}</div>
            <div className="text-[10px] text-amber-400 mt-1 font-mono font-medium">Recorded status</div>
          </button>

          <button
            onClick={() => pickFit('NOT_FIT')}
            className={`p-3 rounded-xl border text-left transition-all ${
              fitFilter === 'NOT_FIT'
                ? 'bg-slate-800 border-slate-500 ring-2 ring-slate-400 shadow-md'
                : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800/40'
            }`}
          >
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Not fit</div>
            <div className="text-xl font-black text-slate-300 mt-0.5">{count(fitCounts?.NOT_FIT)}</div>
            <div className="text-[10px] text-slate-400 mt-1 font-mono font-medium">Ineligible or on hold</div>
          </button>
        </div>
      </div>

      {/* Practical Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Box */}
          <div className="flex-1 min-w-[240px] relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search title, company, description..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
            />
          </div>

          {/* Fit Dropdown */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500">Fit:</span>
            <select
              value={fitFilter}
              onChange={(e) => pickFit(e.target.value as Fit)}
              className="bg-slate-50 border border-slate-200 text-xs font-medium rounded-lg px-2.5 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="ALL">All ({count(fitCounts?.ALL)})</option>
              <option value="READY">Ready ({count(fitCounts?.READY)})</option>
              <option value="STRETCH">Stretch ({count(fitCounts?.STRETCH)})</option>
              <option value="REVIEW">Needs review ({count(fitCounts?.REVIEW)})</option>
              <option value="NOT_FIT">Not fit ({count(fitCounts?.NOT_FIT)})</option>
            </select>
          </div>

          {/* Role Family Dropdown: only families that exist in this candidate's data, derived from titles */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500">Role family:</span>
            <select
              value={roleFamilyFilter}
              onChange={(e) => { setRoleFamilyFilter(e.target.value); setPage(0); }}
              className="bg-slate-50 border border-slate-200 text-xs font-medium rounded-lg px-2.5 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 max-w-[16rem]"
            >
              <option value="ALL">All families</option>
              {families.map((f) => (
                <option key={f.key} value={f.key}>{f.label} ({f.count})</option>
              ))}
              {roleFamilyFilter !== 'ALL' && !families.some((f) => f.key === roleFamilyFilter) && (
                <option value={roleFamilyFilter}>{roleFamilyFilter === 'UNCLASSIFIED' ? 'Unclassified' : roleFamilyFilter} (0)</option>
              )}
            </select>
          </div>

          {/* Pay Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500">Pay:</span>
            <select
              value={payFilter}
              onChange={(e) => { setPayFilter(e.target.value); setPage(0); }}
              className="bg-slate-50 border border-slate-200 text-xs font-medium rounded-lg px-2.5 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="ALL">All ({count(payCounts?.ALL)})</option>
              <option value="PUBLISHED">Salary published ({count(payCounts?.PUBLISHED)})</option>
              <option value="UNPUBLISHED">Salary not published ({count(payCounts?.UNPUBLISHED)})</option>
            </select>
          </div>

          {/* Sort */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value); setPage(0); }}
              className="bg-slate-50 border border-slate-200 text-xs font-medium rounded-lg px-2.5 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="score_desc">Stored score, high to low</option>
              <option value="date_desc">Newest first</option>
              <option value="title_asc">Title A–Z</option>
              <option value="company_asc">Company A–Z</option>
            </select>
          </div>

          {/* Exclude Applied Toggle */}
          <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 select-none">
            <input
              type="checkbox"
              checked={excludeApplied}
              onChange={(e) => { setExcludeApplied(e.target.checked); setPage(0); }}
              className="rounded text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5"
            />
            <span className="text-xs font-medium text-slate-700">Hide jobs already applied to</span>
          </label>

          {/* Clear Button */}
          <button
            onClick={handleClearFilters}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg text-xs flex items-center gap-1 font-semibold transition-colors"
            title="Clear all filters"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Content Area */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="underline font-bold">Dismiss</button>
        </div>
      )}

      {isLoading && !result ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-3 shadow-sm">
          <div className="inline-block animate-spin text-emerald-600">
            <RotateCcw className="w-6 h-6" />
          </div>
          <p className="text-xs font-semibold text-slate-500">Loading India Remote vacancies...</p>
        </div>
      ) : jobs.length === 0 && !isLoading && !error ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-3 shadow-sm">
          <Globe2 className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="text-sm font-bold text-slate-800">No vacancies match these filters</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Nothing matches the combination you chose. Loosen a filter, clear the search, or show jobs you have already applied to.
          </p>
          <button
            onClick={handleClearFilters}
            className="px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg shadow-sm hover:bg-emerald-500 transition-colors"
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div className="space-y-4" aria-busy={isLoading}>
          <div className="flex items-center justify-between px-1 text-xs text-slate-500 font-semibold">
            <span data-testid="india-remote-range">Showing {firstShown}–{lastShown} of {total} vacancies</span>
            <span>{{ score_desc: 'Sorted by stored score', date_desc: 'Newest first', title_asc: 'Title A–Z', company_asc: 'Company A–Z' }[sortBy] ?? ''}</span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {jobs.map((job) => {
              const score = job.score?.overall_score ?? 0;
              const fit = job.farhan_fit ?? 'REVIEW';
              const appState = job.application_state ?? (job.application?.status ? job.application.status : 'NEW');
              const basis = job.eligibility?.reason || job.eligibility?.evidence_text;
              const unverified = job.eligibility?.epistemic_status === 'UNKNOWN';

              return (
                <div
                  key={job.id}
                  data-job-id={job.id}
                  onClick={() => onSelectJob(job)}
                  className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:border-emerald-400 hover:shadow-md transition-all cursor-pointer space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold text-slate-900 group-hover:text-emerald-700">
                          {job.title}
                        </h3>
                        <span className="text-xs font-medium text-slate-400 flex items-center gap-1">
                          <Building className="w-3 h-3" />
                          {job.company}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-medium" data-role-family={job.role_family_key ?? ''}>
                          {job.role_family || 'Unclassified'}
                        </span>
                        {job.location_restrictions && (
                          <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono text-[11px]">
                            {job.location_restrictions}
                          </span>
                        )}
                        <span className="text-slate-400">• Source: {job.source_adapter}</span>
                      </div>
                    </div>

                    {/* Three separate dimensions */}
                    <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                      {/* Dimension 1: eligibility to work from India, as read from the posting text */}
                      <span
                        title={basis || undefined}
                        className={`border text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 ${
                          unverified ? 'bg-amber-50 text-amber-800 border-amber-300' : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                        }`}
                      >
                        <Globe2 className="w-3 h-3" />
                        {unverified ? 'Eligible per posting text (unverified)' : 'Eligible per posting text'}
                      </span>

                      {/* Dimension 2: recorded fit status and the stored score, side by side */}
                      <span
                        data-fit={fit}
                        className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                          fit === 'READY'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                            : fit === 'STRETCH'
                            ? 'bg-blue-50 text-blue-800 border-blue-300'
                            : fit === 'NOT_FIT'
                            ? 'bg-slate-100 text-slate-700 border-slate-300'
                            : 'bg-amber-50 text-amber-800 border-amber-300'
                        }`}
                      >
                        Status: {FIT_LABEL[fit] ?? fit} · stored score {score}
                      </span>

                      {/* Dimension 3: Application State */}
                      <span
                        className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                          appState === 'SAVED'
                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                            : appState === 'APPLIED'
                            ? 'bg-purple-100 text-purple-800 border-purple-300'
                            : appState === 'REJECTED'
                            ? 'bg-rose-100 text-rose-800 border-rose-300'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        Application: {appState}
                      </span>
                    </div>
                  </div>

                  {/* Why this status and score disagree (never repaired, only explained) */}
                  {job.assessment_conflict && job.assessment_conflict_reason && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                      <span className="leading-relaxed">{job.assessment_conflict_reason}</span>
                    </div>
                  )}

                  {/* Basis recorded for the eligibility result */}
                  {basis && (
                    <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-3 text-xs text-emerald-900 flex items-start gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                      <div className="space-y-0.5 leading-relaxed">
                        <span className="font-bold text-emerald-950">Basis (automated screen of the posting): </span>
                        <span>{basis}</span>
                      </div>
                    </div>
                  )}

                  {/* Qualification reasoning */}
                  {job.qualification_reason && (
                    <div className="text-xs text-slate-600 flex items-start gap-2">
                      <span className="font-semibold text-slate-800 flex-shrink-0">Qualification note:</span>
                      <span className="text-slate-600">{job.qualification_reason}</span>
                    </div>
                  )}

                  {/* Card Bottom Controls */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                    <div className="flex items-center gap-3 text-slate-500">
                      {job.salary_published ? (
                        <span className="font-semibold text-emerald-700 flex items-center gap-1">
                          <DollarSign className="w-3.5 h-3.5" />
                          {[job.salary_currency, job.salary_min?.toLocaleString(), job.salary_max != null ? `- ${job.salary_max.toLocaleString()}` : '', job.salary_period].filter(Boolean).join(' ')}
                        </span>
                      ) : (
                        <span className="text-slate-400">Salary not published</span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => handleToggleSave(job, e)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                          job.application?.status === 'SAVED'
                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <Bookmark className="w-3.5 h-3.5" />
                        {job.application?.status === 'SAVED' ? 'Saved' : 'Save'}
                      </button>

                      <a
                        href={job.original_posting_url || job.source_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
                      >
                        Open posting
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-2 text-xs">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || isLoading}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-semibold disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-slate-500 font-semibold">Page {page + 1} of {lastPage + 1}</span>
              <button
                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                disabled={page >= lastPage || isLoading}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-semibold disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
