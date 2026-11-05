import React, { useState, useEffect, useCallback } from 'react';
import { Job, IndiaRemoteSummary } from '../types';
import { fetchIndiaRemoteJobs, fetchIndiaRemoteSummary, updateApplication } from '../api';
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
  DollarSign
} from 'lucide-react';

interface IndiaRemoteViewProps {
  candidateId?: string;
  onSelectJob: (job: Job) => void;
  onRefreshGlobal?: () => void;
}

export const IndiaRemoteView: React.FC<IndiaRemoteViewProps> = ({ candidateId = 'farhan_shaikh', onSelectJob, onRefreshGlobal }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [summary, setSummary] = useState<IndiaRemoteSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filter States
  const [fitFilter, setFitFilter] = useState<'ALL' | 'READY' | 'STRETCH' | 'REVIEW' | 'NOT_FIT'>('ALL');
  const [roleFamilyFilter, setRoleFamilyFilter] = useState<string>('ALL');
  const [payFilter, setPayFilter] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');
  const [excludeApplied, setExcludeApplied] = useState<boolean>(true);
  const [sortBy, setSortBy] = useState<string>('score_desc');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [summaryData, jobsData] = await Promise.all([
        fetchIndiaRemoteSummary(candidateId),
        fetchIndiaRemoteJobs({
          candidate_id: candidateId,
          farhan_fit: fitFilter,
          role_family: roleFamilyFilter,
          pay_filter: payFilter,
          search: search.trim() || undefined,
          exclude_applied: excludeApplied,
          sort_by: sortBy
        })
      ]);
      setSummary(summaryData);
      setJobs(jobsData);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to load India Remote opportunities.');
    } finally {
      setIsLoading(false);
    }
  }, [fitFilter, roleFamilyFilter, payFilter, search, excludeApplied, sortBy]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleSave = async (job: Job, e: React.MouseEvent) => {
    e.stopPropagation();
    const newStatus = job.application?.status === 'SAVED' ? 'WITHDRAWN' : 'SAVED';
    try {
      await updateApplication({ job_id: job.id, status: newStatus });
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
    setSearch('');
    setExcludeApplied(true);
    setSortBy('score_desc');
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-teal-900 via-slate-900 to-indigo-950 text-white p-6 rounded-2xl shadow-md border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="bg-emerald-500/20 text-emerald-300 text-xs px-2.5 py-0.5 rounded-full font-mono border border-emerald-500/30 font-semibold flex items-center gap-1.5">
                <Globe2 className="w-3.5 h-3.5" />
                AFFIRMATIVE INDIA REMOTE QUEUE
              </span>
              <span className="text-slate-400 text-xs">Decoupled Remote Eligibility & Candidate Fit</span>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white">Confirmed India Remote Opportunities</h1>
            <p className="text-slate-300 text-sm mt-1 max-w-2xl leading-relaxed">
              Every vacancy in this queue is verified with affirmative evidence allowing remote work from India. Opportunities are cleanly segmented into candidate target fit, stretch matches, review cases, and unaligned technical roles.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={isLoading}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition-colors"
            >
              Refresh Queue
            </button>
          </div>
        </div>

        {/* Top Metric Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-6 pt-6 border-t border-slate-800">
          <button
            onClick={() => setFitFilter('ALL')}
            className={`p-3 rounded-xl border text-left transition-all ${
              fitFilter === 'ALL'
                ? 'bg-white/10 border-white/30 ring-2 ring-emerald-400 shadow-md'
                : 'bg-slate-800/40 border-slate-800 hover:bg-slate-800/70'
            }`}
          >
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">All Confirmed</div>
            <div className="text-xl font-black text-white mt-0.5">{summary?.total_confirmed ?? 412}</div>
            <div className="text-[10px] text-emerald-400 mt-1">India Verified</div>
          </button>

          <button
            onClick={() => setFitFilter('READY')}
            className={`p-3 rounded-xl border text-left transition-all ${
              fitFilter === 'READY'
                ? 'bg-emerald-950/60 border-emerald-500 ring-2 ring-emerald-400 shadow-md'
                : 'bg-emerald-950/20 border-emerald-900/50 hover:bg-emerald-950/40'
            }`}
          >
            <div className="text-[11px] uppercase tracking-wider text-emerald-400 font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Ready
            </div>
            <div className="text-xl font-black text-emerald-300 mt-0.5">{summary?.ready_count ?? 13}</div>
            <div className="text-[10px] text-emerald-400 mt-1 font-mono font-medium">Ready to Apply</div>
          </button>

          <button
            onClick={() => setFitFilter('STRETCH')}
            className={`p-3 rounded-xl border text-left transition-all ${
              fitFilter === 'STRETCH'
                ? 'bg-blue-950/60 border-blue-500 ring-2 ring-blue-400 shadow-md'
                : 'bg-blue-950/20 border-blue-900/50 hover:bg-blue-950/40'
            }`}
          >
            <div className="text-[11px] uppercase tracking-wider text-blue-400 font-semibold flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Stretch
            </div>
            <div className="text-xl font-black text-blue-300 mt-0.5">{summary?.stretch_count ?? 15}</div>
            <div className="text-[10px] text-blue-400 mt-1 font-mono font-medium">Adjacent Match</div>
          </button>

          <button
            onClick={() => setFitFilter('REVIEW')}
            className={`p-3 rounded-xl border text-left transition-all ${
              fitFilter === 'REVIEW'
                ? 'bg-amber-950/60 border-amber-500 ring-2 ring-amber-400 shadow-md'
                : 'bg-amber-950/20 border-amber-900/50 hover:bg-amber-950/40'
            }`}
          >
            <div className="text-[11px] uppercase tracking-wider text-amber-400 font-semibold">Needs Review</div>
            <div className="text-xl font-black text-amber-300 mt-0.5">{summary?.review_count ?? 126}</div>
            <div className="text-[10px] text-amber-400 mt-1 font-mono font-medium">Operator Check</div>
          </button>

          <button
            onClick={() => setFitFilter('NOT_FIT')}
            className={`p-3 rounded-xl border text-left transition-all ${
              fitFilter === 'NOT_FIT'
                ? 'bg-slate-800 border-slate-500 ring-2 ring-slate-400 shadow-md'
                : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800/40'
            }`}
          >
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Not Role Fit</div>
            <div className="text-xl font-black text-slate-300 mt-0.5">{summary?.not_fit_count ?? 256}</div>
            <div className="text-[10px] text-slate-400 mt-1 font-mono font-medium">Unaligned Roles</div>
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
              placeholder="Search title, company, skills, description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
            />
          </div>

          {/* Farhan Fit Dropdown */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500">Fit:</span>
            <select
              value={fitFilter}
              onChange={(e) => setFitFilter(e.target.value as any)}
              className="bg-slate-50 border border-slate-200 text-xs font-medium rounded-lg px-2.5 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="ALL">All Confirmed</option>
              <option value="READY">Ready ({summary?.ready_count ?? 13})</option>
              <option value="STRETCH">Stretch ({summary?.stretch_count ?? 15})</option>
              <option value="REVIEW">Needs Review ({summary?.review_count ?? 126})</option>
              <option value="NOT_FIT">Not Fit ({summary?.not_fit_count ?? 256})</option>
            </select>
          </div>

          {/* Role Family Dropdown */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500">Role Family:</span>
            <select
              value={roleFamilyFilter}
              onChange={(e) => setRoleFamilyFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 text-xs font-medium rounded-lg px-2.5 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="ALL">All Families</option>
              <option value="Implementation">Implementation / Tech Delivery</option>
              <option value="Solutions">Solutions Implementation</option>
              <option value="Technical Operations">Technical Operations</option>
              <option value="Automation">Automation / Workflows</option>
              <option value="AI Operations">AI Operations / Systems</option>
              <option value="CRM/GTM">CRM / GTM Systems</option>
              <option value="Revenue Systems">Revenue Systems</option>
              <option value="Technical Account">Technical Account</option>
              <option value="Adjacent Stretch">Adjacent Stretch</option>
            </select>
          </div>

          {/* Pay Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500">Pay:</span>
            <select
              value={payFilter}
              onChange={(e) => setPayFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 text-xs font-medium rounded-lg px-2.5 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="ALL">All Pay Ranges</option>
              <option value="PUBLISHED">Published Salary Only</option>
              <option value="MEETS_60K">Meets Base Pay Floor (₹120,000/mo or $25/hr)</option>
              <option value="UNKNOWN">Unspecified Salary</option>
            </select>
          </div>

          {/* Exclude Applied Toggle */}
          <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 select-none">
            <input
              type="checkbox"
              checked={excludeApplied}
              onChange={(e) => setExcludeApplied(e.target.checked)}
              className="rounded text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5"
            />
            <span className="text-xs font-medium text-slate-700">Exclude Applied (Quarantine)</span>
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

      {isLoading ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-3 shadow-sm">
          <div className="inline-block animate-spin text-emerald-600">
            <RotateCcw className="w-6 h-6" />
          </div>
          <p className="text-xs font-semibold text-slate-500">Loading confirmed India Remote vacancies...</p>
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-3 shadow-sm">
          <Globe2 className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="text-sm font-bold text-slate-800">No matching vacancies found</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Try adjusting your search query, selecting "All Families", or including already-applied jobs.
          </p>
          <button
            onClick={handleClearFilters}
            className="px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg shadow-sm hover:bg-emerald-500 transition-colors"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1 text-xs text-slate-500 font-semibold">
            <span>Showing {jobs.length} confirmed India remote vacancies</span>
            <span>Sorted by Match Score</span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {jobs.map((job) => {
              const score = job.score?.overall_score ?? 0;
              const fit = job.farhan_fit ?? 'REVIEW';
              const appState = job.application_state ?? (job.application?.status ? job.application.status : 'NEW');
              const evidence = job.india_evidence || job.eligibility?.evidence_quote || job.eligibility?.reasoning;

              return (
                <div
                  key={job.id}
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
                        <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-medium">
                          {job.role_family || 'Implementation / Delivery'}
                        </span>
                        {job.location_restrictions && (
                          <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono text-[11px]">
                            {job.location_restrictions}
                          </span>
                        )}
                        <span className="text-slate-400">• Source: {job.source_adapter}</span>
                      </div>
                    </div>

                    {/* Three Clean Dimensions Badges */}
                    <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                      {/* Dimension 1: Remote India */}
                      <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1">
                        <Globe2 className="w-3 h-3 text-emerald-600" />
                        Remote: Confirmed
                      </span>

                      {/* Dimension 2: Farhan Fit */}
                      <span
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
                        Fit: {fit} ({score}%)
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
                        App: {appState}
                      </span>
                    </div>
                  </div>

                  {/* India Evidence Box */}
                  {evidence && (
                    <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-3 text-xs text-emerald-900 flex items-start gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                      <div className="space-y-0.5 leading-relaxed">
                        <span className="font-bold text-emerald-950">India Remote Evidence: </span>
                        <span className="italic font-serif">"{evidence}"</span>
                      </div>
                    </div>
                  )}

                  {/* Farhan Match / Review Reasoning */}
                  {job.qualification_reason && (
                    <div className="text-xs text-slate-600 flex items-start gap-2">
                      <span className="font-semibold text-slate-800 flex-shrink-0">Fit Evaluation:</span>
                      <span className="text-slate-600">{job.qualification_reason}</span>
                    </div>
                  )}

                  {/* Card Bottom Controls */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                    <div className="flex items-center gap-3 text-slate-500">
                      {job.salary_published ? (
                        <span className="font-semibold text-emerald-700 flex items-center gap-1">
                          <DollarSign className="w-3.5 h-3.5" />
                          {job.salary_currency} {job.salary_min?.toLocaleString()} - {job.salary_max?.toLocaleString()} {job.salary_period}
                        </span>
                      ) : (
                        <span className="text-slate-400">Salary unlisted</span>
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
                        href={job.source_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
                      >
                        Official Post
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
