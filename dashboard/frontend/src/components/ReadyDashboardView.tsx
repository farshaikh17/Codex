import React, { useState, useEffect } from 'react';
import { Job, WeeklyMetrics, CandidateProfile, QualificationStatus, QualificationAuditRecord } from '../types';
import { 
  fetchJobs, 
  fetchWeeklyMetrics, 
  reverifyReadyJobs, 
  overrideJobQualification, 
  fetchQualificationAudit, 
  fetchProfile, 
  updateProfile 
} from '../api';
import { 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  ExternalLink, 
  ShieldCheck, 
  Sliders, 
  History, 
  ArrowRight, 
  Building, 
  Search, 
  Info, 
  Sparkles, 
  Globe2
} from 'lucide-react';

interface ReadyDashboardViewProps {
  candidateId: string;
  onSelectJob: (job: Job) => void;
  onViewTracker?: () => void;
}

const PAGE_SIZE = 25;

export const ReadyDashboardView: React.FC<ReadyDashboardViewProps> = ({ candidateId, onSelectJob, onViewTracker }) => {
  const [metrics, setMetrics] = useState<WeeklyMetrics | null>(null);
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [counts, setCounts] = useState<{ READY: number; STRETCH_READY: number; NEEDS_REVIEW: number; ALL: number } | null>(null);
  const [possibleRemoteTotal, setPossibleRemoteTotal] = useState<number | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [activeTab, setActiveTab] = useState<'READY' | 'STRETCH' | 'APPLY_WORTHY' | 'NEEDS_REVIEW' | 'POSSIBLE_REMOTE' | 'ALL'>('READY');
  const [reviewSubFilter, setReviewSubFilter] = useState<'ALL' | 'FIT' | 'INDIA_SCOPE' | 'PAY'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [thresholdInput, setThresholdInput] = useState<number>(70);
  const [isUpdatingThreshold, setIsUpdatingThreshold] = useState(false);
  const [isReverifying, setIsReverifying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Manual Override State
  const [overrideJob, setOverrideJob] = useState<Job | null>(null);
  const [overrideStatus, setOverrideStatus] = useState<QualificationStatus>('READY');
  const [overrideReason, setOverrideReason] = useState('');
  const [isSubmittingOverride, setIsSubmittingOverride] = useState(false);
  const [auditTrail, setAuditTrail] = useState<QualificationAuditRecord[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  // The selected tab, review sub-filter, search and page are all answered by the server. The browser never filters a partial collection.
  const tabQuery = (tab: typeof activeTab, sub: typeof reviewSubFilter) => {
    const q: Record<string, any> = { candidate_id: candidateId, sort_by: 'score_desc', exclude_applied: true, exclude_dismissed: true };
    if (tab === 'READY') q.farhan_fit = 'READY';
    else if (tab === 'STRETCH') q.farhan_fit = 'STRETCH';
    else if (tab === 'APPLY_WORTHY') q.qualification_status = 'APPLY_WORTHY';
    else if (tab === 'NEEDS_REVIEW') {
      q.farhan_fit = 'REVIEW';
      if (sub === 'INDIA_SCOPE') q.eligibility = 'UNKNOWN';
      else if (sub === 'FIT') q.eligibility = 'ELIGIBLE';
      else if (sub === 'PAY') q.pay_filter = 'UNPUBLISHED';
    } else if (tab === 'POSSIBLE_REMOTE') { q.eligibility = 'UNKNOWN'; q.min_score = 60; }
    return q;
  };

  const listSeq = React.useRef(0);
  const loadList = async () => {
    const seq = ++listSeq.current;
    setIsLoading(true);
    try {
      const res = await fetchJobs({ ...tabQuery(activeTab, reviewSubFilter), search: searchQuery || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
      if (seq !== listSeq.current) return;
      setJobs(res.jobs); setTotal(res.total);
    } catch (err: any) {
      if (seq !== listSeq.current) return;
      setNotification({ type: 'error', message: err.message || 'Failed to load qualification pipeline data.' });
    } finally {
      if (seq === listSeq.current) setIsLoading(false);
    }
  };

  // Tab counts come from the same server-side scope as the lists (applied and dismissed jobs excluded), so a tab's number is its list's total.
  const countSeq = React.useRef(0);
  const loadCounts = async () => {
    const seq = ++countSeq.current;
    try {
      const base = { candidate_id: candidateId, exclude_applied: true, exclude_dismissed: true, limit: 1 };
      const [all, remote] = await Promise.all([fetchJobs(base), fetchJobs({ ...base, eligibility: 'UNKNOWN', min_score: 60 })]);
      if (seq !== countSeq.current) return;
      const sc: Record<string, number> = all.status_counts || {};
      setCounts({ READY: sc.READY || 0, STRETCH_READY: sc.STRETCH_READY || 0, NEEDS_REVIEW: sc.NEEDS_REVIEW || 0, ALL: all.total });
      setPossibleRemoteTotal(remote.total);
    } catch { /* the tab labels simply stay without a number */ }
  };

  const chromeSeq = React.useRef(0);
  const loadChrome = () => {
    const seq = ++chromeSeq.current;
    const fresh = () => seq === chromeSeq.current;
    fetchWeeklyMetrics(candidateId).then(data => { if (fresh()) setMetrics(data); }).catch(() => {});
    fetchProfile(candidateId).then(data => {
      if (!fresh()) return;
      setProfile(data);
      setThresholdInput(data.qualification_threshold ?? (candidateId === 'sana_ansari' ? 60 : 70));
    }).catch(() => {});
  };

  const loadData = async () => { loadChrome(); loadCounts(); await loadList(); };

  useEffect(() => {
    setMetrics(null); setProfile(null); setJobs([]); setCounts(null); setPossibleRemoteTotal(null); setPage(0); setSearchInput(''); setSearchQuery('');
    loadChrome(); loadCounts();
  }, [candidateId]);

  useEffect(() => { loadList(); }, [candidateId, activeTab, reviewSubFilter, searchQuery, page]);

  // Typing does not query on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setSearchQuery(searchInput.trim()); setPage(0); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // If the list shrank under the current page, step back to the last page that exists.
  useEffect(() => {
    const last = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
    if (total > 0 && jobs.length === 0 && page > last) setPage(last);
  }, [total, jobs.length, page]);

  const chooseTab = (tab: typeof activeTab) => { setActiveTab(tab); setPage(0); };


  const handleUpdateThreshold = async () => {
    if (!profile) return;
    setIsUpdatingThreshold(true);
    setNotification(null);
    try {
      const updated = await updateProfile({
        ...profile,
        qualification_threshold: Number(thresholdInput)
      });
      setProfile(updated);
      setNotification({
        type: 'success',
        message: `Qualification threshold updated to ${updated.qualification_threshold}%. Jobs re-evaluated.`
      });
      await loadData();
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to update threshold.' });
    } finally {
      setIsUpdatingThreshold(false);
    }
  };

  const handleReverify = async () => {
    setIsReverifying(true);
    setNotification(null);
    try {
      const res = await reverifyReadyJobs();
      setNotification({
        type: 'info',
        message: `Reverification complete: ${res.result.retained_ready} retained as READY, ${res.result.demoted_count} demoted.`
      });
      await loadData();
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Reverification failed.' });
    } finally {
      setIsReverifying(false);
    }
  };

  const openOverrideModal = async (job: Job) => {
    setOverrideJob(job);
    setOverrideStatus((job.qualification_status as QualificationStatus) || 'READY');
    setOverrideReason('');
    setIsLoadingAudit(true);
    try {
      const auditRes = await fetchQualificationAudit(job.id, candidateId);
      setAuditTrail(auditRes.audit_trail);
    } catch {
      setAuditTrail([]);
    } finally {
      setIsLoadingAudit(false);
    }
  };

  const submitOverride = async () => {
    if (!overrideJob || !overrideReason.trim()) return;
    setIsSubmittingOverride(true);
    try {
      await overrideJobQualification(overrideJob.id, overrideStatus, overrideReason.trim(), 'Candidate', candidateId);
      setNotification({
        type: 'success',
        message: `Job '${overrideJob.title}' moved to ${overrideStatus}.`
      });
      setOverrideJob(null);
      await loadData();
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Override failed.' });
    } finally {
      setIsSubmittingOverride(false);
    }
  };

  // Tab numbers count the whole queue for this candidate (applied and dismissed jobs excluded), ignoring the search box and the review sub-filter.
  // The list's own total, in the range line under it, is what the current search and sub-filter leave.
  const readyCount = counts?.READY;
  const stretchCount = counts?.STRETCH_READY;
  const applyWorthyCount = counts ? counts.READY + counts.STRETCH_READY : undefined;
  const reviewCount = counts?.NEEDS_REVIEW;
  const num = (n: number | null | undefined) => (n === null || n === undefined ? '…' : n);
  const filteredJobs = jobs;   // already the server's answer for this tab, filter, search and page
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const firstShown = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastShown = Math.min(total, page * PAGE_SIZE + jobs.length);

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {notification && (
        <div className={`p-4 rounded-xl border flex items-center justify-between text-sm ${
          notification.type === 'success' 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
            : notification.type === 'error'
            ? 'bg-rose-50 border-rose-200 text-rose-800'
            : 'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          <span>{notification.message}</span>
          <button 
            onClick={() => setNotification(null)}
            className="text-xs font-semibold underline ml-4 hover:opacity-75"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-gradient-to-r from-emerald-900 to-slate-900 text-white p-6 rounded-2xl shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="bg-emerald-500/20 text-emerald-300 text-xs px-2.5 py-0.5 rounded-full font-mono border border-emerald-500/30 font-semibold flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              RECORDED QUALIFICATION STATUS
            </span>
            <span className="text-slate-400 text-xs">Sunday–Saturday America/New_York</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">READY-to-Apply Shortlist</h1>
          <p className="text-slate-300 text-sm mt-1 max-w-2xl leading-relaxed">
            READY is the qualification status recorded for a job. It is not recomputed on this page, and the stored score is shown beside it. Where the score does not support the status, the card says so instead of changing either.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleReverify}
            disabled={isReverifying}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow transition-colors"
            title="Re-check the READY jobs to see whether they are still open"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isReverifying ? 'animate-spin' : ''}`} />
            {isReverifying ? 'Reverifying...' : 'Reverify READY Jobs'}
          </button>
          <button
            onClick={loadData}
            disabled={isLoading}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Weekly Research Target & Inventory Metrics */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Target Progress Bar */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm md:col-span-2 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Weekly Research Target
                </span>
                <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  {metrics.new_qualified_this_week} / {metrics.weekly_research_target} Qualified
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden border border-slate-200">
                <div 
                  className="bg-emerald-600 h-full rounded-full transition-all duration-500" 
                  style={{ width: `${Math.min(100, (metrics.new_qualified_this_week / metrics.weekly_research_target) * 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2">
                <span>Progress: {metrics.target_progress_percentage}%</span>
                <span>Window: {metrics.current_week_start_ny.split(' ')[0]} to {metrics.current_week_end_ny.split(' ')[0]} ET</span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-start gap-1.5 text-[11px] text-slate-500 leading-tight">
              <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
              <span>{metrics.disclaimer}</span>
            </div>
          </div>

          {/* Still-Open Apply-Worthy Inventory */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Open READY Inventory
            </span>
            <div className="my-2">
              <div className="text-3xl font-extrabold text-slate-900 font-mono">
                {metrics.still_open_ready_inventory}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[11px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full">
                  {metrics.ready_inventory ?? num(readyCount)} READY
                </span>
                <span className="text-[11px] font-bold text-blue-800 bg-blue-100 border border-blue-300 px-2 py-0.5 rounded-full">
                  {metrics.stretch_ready_inventory ?? num(stretchCount)} STRETCH
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Open vacancies at the last check</span>
              {onViewTracker && (
                <button
                  onClick={onViewTracker}
                  className="text-emerald-700 hover:text-emerald-800 font-semibold underline"
                >
                  View Tracker
                </button>
              )}
            </div>
          </div>

          {/* Qualification Threshold Setting */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Min Match Threshold
              </span>
              <Sliders className="w-4 h-4 text-slate-400" />
            </div>
            <div className="my-2 flex items-center gap-2">
              <input 
                type="number"
                min="0"
                max="100"
                value={thresholdInput}
                onChange={(e) => setThresholdInput(Math.max(0, Math.min(100, Number(e.target.value))))}
                className="w-20 text-2xl font-bold font-mono text-slate-900 border border-slate-300 rounded-lg px-2.5 py-1 text-center focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <span className="text-slate-400 font-bold">%</span>
              <button
                onClick={handleUpdateThreshold}
                disabled={isUpdatingThreshold || thresholdInput === metrics.qualification_threshold}
                className="ml-auto px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-lg text-xs font-bold transition-colors"
              >
                {isUpdatingThreshold ? 'Saving...' : 'Apply'}
              </button>
            </div>
            <span className="text-[11px] text-slate-400">
              Score ≥ {metrics.qualification_threshold}% required for READY
            </span>
          </div>
        </div>
      )}

      {/* Tabs and Search Controls */}
      <div className="space-y-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
          {/* View Mode Tabs */}
          <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-xl w-full md:w-auto">
            <button
              onClick={() => chooseTab('READY')}
              className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                activeTab === 'READY'
                  ? 'bg-white text-emerald-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              READY to Apply ({num(readyCount)})
            </button>
            <button
              onClick={() => chooseTab('STRETCH')}
              className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                activeTab === 'STRETCH'
                  ? 'bg-white text-blue-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              Stretch ({num(stretchCount)})
            </button>
            <button
              onClick={() => chooseTab('APPLY_WORTHY')}
              className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                activeTab === 'APPLY_WORTHY'
                  ? 'bg-white text-teal-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
              All Apply-Worthy ({num(applyWorthyCount)})
            </button>
            <button
              onClick={() => chooseTab('NEEDS_REVIEW')}
              className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                activeTab === 'NEEDS_REVIEW'
                  ? 'bg-white text-amber-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
              Needs Review ({num(reviewCount)})
            </button>
            <button
              onClick={() => chooseTab('POSSIBLE_REMOTE')}
              className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                activeTab === 'POSSIBLE_REMOTE'
                  ? 'bg-white text-indigo-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Search className="w-3.5 h-3.5 text-indigo-600" />
              Unverified location, score 60+ ({num(possibleRemoteTotal)})
            </button>
            <button
              onClick={() => chooseTab('ALL')}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'ALL'
                  ? 'bg-white text-slate-900 shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All open ({num(counts?.ALL)})
            </button>
          </div>

          {/* Search Input */}
          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search title, company, description..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50/50"
            />
          </div>
        </div>

        {/* Needs Review Sub-filters */}
        {activeTab === 'NEEDS_REVIEW' && (
          <div className="bg-amber-50/70 border border-amber-200 p-3 rounded-xl flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold text-amber-900 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
              Review Filter:
            </span>
            <button
              onClick={() => { setReviewSubFilter('ALL'); setPage(0); }}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                reviewSubFilter === 'ALL'
                  ? 'bg-amber-200 text-amber-900 shadow-sm'
                  : 'text-amber-700 hover:bg-amber-100'
              }`}
            >
              All Review Cases
            </button>
            <button
              onClick={() => { setReviewSubFilter('FIT'); setPage(0); }}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                reviewSubFilter === 'FIT'
                  ? 'bg-amber-200 text-amber-900 shadow-sm'
                  : 'text-amber-700 hover:bg-amber-100'
              }`}
            >
              Location stated, review for fit
            </button>
            <button
              onClick={() => { setReviewSubFilter('INDIA_SCOPE'); setPage(0); }}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                reviewSubFilter === 'INDIA_SCOPE'
                  ? 'bg-amber-200 text-amber-900 shadow-sm'
                  : 'text-amber-700 hover:bg-amber-100'
              }`}
            >
              Location unverified
            </button>
            <button
              onClick={() => { setReviewSubFilter('PAY'); setPage(0); }}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                reviewSubFilter === 'PAY'
                  ? 'bg-amber-200 text-amber-900 shadow-sm'
                  : 'text-amber-700 hover:bg-amber-100'
              }`}
            >
              Salary not published
            </button>
          </div>
        )}
      </div>

      {/* Job Cards List */}
      <div className="space-y-4">
        {(searchQuery || (activeTab === 'NEEDS_REVIEW' && reviewSubFilter !== 'ALL')) && (
          <div className="text-[11px] text-slate-500 px-1" data-testid="ready-narrowed">
            {total} {total === 1 ? 'job matches' : 'jobs match'} your {searchQuery ? 'search' : 'review filter'}; the tab numbers above count the whole queue.
          </div>
        )}
        {filteredJobs.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 shadow-sm">
            <CheckCircle2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-800">No jobs in this category</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              {searchQuery
                ? 'No postings match this search in the selected category.'
                : activeTab === 'READY'
                ? 'No job currently has the recorded status READY (jobs you have applied to are not shown).'
                : 'No postings in this category.'}
            </p>
          </div>
        ) : (
          filteredJobs.map((job) => {
            const qStatus = job.qualification_status || 'DISCOVERED';
            const isReady = qStatus === 'READY';
            const isFixture = job.source_adapter === 'fixture';
            const score = job.score?.overall_score || 0;
            const sourceUrl = job.source_url || job.original_posting_url || '';

            return (
              <div 
                key={job.id} 
                data-job-id={job.id}
                className={`bg-white rounded-2xl border p-5 shadow-sm transition-all hover:shadow-md ${
                  isReady ? 'border-emerald-200 bg-gradient-to-r from-emerald-50/20 to-white' : 'border-slate-200'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  {/* Job Details */}
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      {/* 3 Explicit Dimensions */}
                      {/* Dimension 1: Remote India */}
                      <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 border ${
                        job.remote_from_india === 'CONFIRMED'
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                          : job.remote_from_india === 'NO'
                          ? 'bg-rose-100 text-rose-800 border-rose-300'
                          : 'bg-amber-100 text-amber-800 border-amber-300'
                      }`}>
                        <Globe2 className="w-3 h-3 text-emerald-600" />
                        India eligibility: {({ CONFIRMED: 'eligible per posting text', NO: 'ruled out by posting text', UNKNOWN: 'not established' } as Record<string, string>)[job.remote_from_india ?? 'UNKNOWN'] ?? 'not established'}
                      </span>

                      {/* Dimension 2: Farhan Fit */}
                      <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 border ${
                        qStatus === 'READY' || job.farhan_fit === 'READY'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                          : qStatus === 'STRETCH_READY' || job.farhan_fit === 'STRETCH'
                          ? 'bg-blue-50 text-blue-800 border-blue-300'
                          : qStatus === 'INELIGIBLE' || job.farhan_fit === 'NOT_FIT'
                          ? 'bg-slate-100 text-slate-700 border-slate-300'
                          : 'bg-amber-50 text-amber-800 border-amber-300'
                      }`}>
                        {qStatus === 'READY' && <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                        {qStatus === 'STRETCH_READY' && <Sparkles className="w-3 h-3 text-blue-600" />}
                        Status: {job.farhan_fit ?? qStatus}
                      </span>

                      {/* Dimension 3: Application State */}
                      <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                        App: {job.application_state ?? (job.application?.status ? job.application.status : 'NEW')}
                      </span>

                      {/* Score Badge */}
                      <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${
                        score >= 70 ? 'bg-emerald-100 text-emerald-800' :
                        score >= 60 ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'
                      }`}>
                        Match: {score}%
                      </span>

                      {/* Adapter Pill */}
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                        {job.source_adapter}
                      </span>
                      {isFixture ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                          Synthetic Fixture
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                          Real Employer Listing
                        </span>
                      )}

                      {/* Manual Override Indicator */}
                      {job.manual_override_status && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-1">
                          <History className="w-3 h-3" />
                          Candidate Override
                        </span>
                      )}
                    </div>

                    <h2 
                      onClick={() => onSelectJob(job)}
                      className="text-lg font-bold text-slate-900 cursor-pointer hover:text-emerald-700 transition-colors"
                    >
                      {job.title}
                    </h2>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 mt-1">
                      <span className="font-semibold text-slate-800 flex items-center gap-1">
                        <Building className="w-3.5 h-3.5 text-slate-400" />
                        {job.company}
                      </span>
                      {job.location_restrictions && (
                        <span>Location: {job.location_restrictions}</span>
                      )}
                      {job.salary_published && job.salary_min && job.salary_max && (
                        <span className="text-emerald-700 font-mono font-medium">
                          ${job.salary_min.toLocaleString()} - ${job.salary_max.toLocaleString()} {job.salary_currency}
                        </span>
                      )}
                      <span className="text-slate-400">
                        Discovered: {new Date(job.discovered_at).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Qualification Reason & Evidence */}
                    <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                      <div className="flex items-start gap-1.5">
                        <span className="font-bold text-slate-700 shrink-0">Qualification Reason:</span>
                        <span className="text-slate-600">{job.qualification_reason || 'Evaluated against qualification criteria.'}</span>
                      </div>
                      {(job.eligibility?.reason || job.eligibility?.evidence_text) && (
                        <div className="flex items-start gap-1.5 text-[11px] text-slate-700 bg-white p-2 rounded border border-slate-200">
                          <span className="font-bold text-slate-500 uppercase text-[9px] shrink-0 mt-0.5">Eligibility basis:</span>
                          <span>{job.eligibility?.reason || job.eligibility?.evidence_text}</span>
                        </div>
                      )}
                      {job.assessment_conflict && job.assessment_conflict_reason && (
                        <div className="flex items-start gap-1.5 text-[11px] text-amber-900 bg-amber-50 p-2 rounded border border-amber-200">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                          <span>{job.assessment_conflict_reason}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions Column */}
                  <div className="flex flex-col gap-2 shrink-0 md:w-52">
                    {/* Official Employer Application Link */}
                    {sourceUrl && sourceUrl.startsWith('http') ? (
                      <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition-colors text-center"
                        title="Opens official employer posting in new tab. No automatic applications are ever submitted."
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open Official Listing
                      </a>
                    ) : (
                      <span className="px-3 py-2 bg-slate-100 text-slate-400 rounded-xl text-xs font-medium text-center">
                        No Application URL
                      </span>
                    )}

                    {['READY', 'READY_HIGH', 'STRETCH_READY'].includes(qStatus) && (
                      <button
                        onClick={() => { setOverrideJob(job); setOverrideStatus('NEEDS_REVIEW'); setOverrideReason('Moved out of READY for further review.'); setAuditTrail([]); }}
                        className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-xl text-xs font-medium"
                      >Move to review</button>
                    )}
                    {qStatus === 'NEEDS_REVIEW' && (
                      <button
                        onClick={async () => {
                          try {
                            await overrideJobQualification(job.id, 'INELIGIBLE', 'Dismissed by reviewer: Irrelevant role', 'Candidate', candidateId);
                            setNotification({ type: 'info', message: `Dismissed '${job.title}'. Removed from review queue.` });
                            await loadData();
                          } catch (err: any) {
                            setNotification({ type: 'error', message: err.message || 'Failed to dismiss job.' });
                          }
                        }}
                        className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 rounded-xl text-xs font-medium"
                      >Dismiss / Irrelevant</button>
                    )}
                    {/* Manual Override Action */}
                    <button
                      onClick={() => openOverrideModal(job)}
                      className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <History className="w-3.5 h-3.5 text-slate-500" />
                      Override & Audit
                    </button>

                    {/* View Details Modal */}
                    <button
                      onClick={() => onSelectJob(job)}
                      className="px-3.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 font-medium flex items-center justify-center gap-1 transition-colors"
                    >
                      Inspect Explanations
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between pt-2 text-xs">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || isLoading}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-semibold disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-slate-500 font-semibold" data-testid="ready-range">Showing {firstShown}–{lastShown} of {total} · page {page + 1} of {lastPage + 1}</span>
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

      {/* Manual Override Modal Dialog */}
      {overrideJob && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-mono text-slate-500">MANUAL REVIEW WORKFLOW</span>
                <h3 className="text-base font-bold text-slate-900">Override Qualification Status</h3>
              </div>
              <button
                onClick={() => setOverrideJob(null)}
                className="text-slate-400 hover:text-slate-700 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <span className="text-xs font-semibold text-slate-500 block mb-0.5">Role & Company:</span>
                <p className="text-sm font-bold text-slate-900">{overrideJob.title} — {overrideJob.company}</p>
                <p className="text-xs text-slate-500 mt-1">Current status: <span className="font-mono font-bold">{overrideJob.qualification_status}</span></p>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  New Status:
                </label>
                <select
                  value={overrideStatus}
                  onChange={(e) => setOverrideStatus(e.target.value as QualificationStatus)}
                  className="w-full text-xs border border-slate-300 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="READY">READY (Qualify for Application)</option>
                  <option value="NEEDS_REVIEW">NEEDS_REVIEW (Unconfirmed / Ambiguous)</option>
                  <option value="INELIGIBLE">INELIGIBLE (Excluded or Unsuited)</option>
                  <option value="CLOSED">CLOSED (Vacancy Filled/Delisted)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Candidate Justification (Required for Audit Trail):
                </label>
                <textarea
                  rows={3}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="e.g. Verified directly with hiring lead that Indian contractors are accepted under B2B agreement..."
                  className="w-full text-xs border border-slate-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {/* Immutable Audit Trail List */}
              <div className="pt-3 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-600 block mb-2 flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-slate-500" />
                  Historical Audit Trail ({auditTrail.length} records):
                </span>
                {isLoadingAudit ? (
                  <span className="text-xs text-slate-400">Loading audit history...</span>
                ) : auditTrail.length === 0 ? (
                  <span className="text-xs text-slate-400 italic">No previous manual overrides recorded for this job.</span>
                ) : (
                  <div className="max-h-36 overflow-y-auto space-y-2 pr-1">
                    {auditTrail.map((entry) => (
                      <div key={entry.id} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px]">
                        <div className="flex items-center justify-between font-semibold text-slate-800">
                          <span>{entry.previous_status} → {entry.new_status}</span>
                          <span className="text-[10px] text-slate-400">{entry.created_at}</span>
                        </div>
                        <p className="text-slate-600 mt-1 italic">"{entry.reason}"</p>
                        <span className="text-[10px] text-slate-400 block mt-0.5">Reviewer: {entry.reviewer}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5">
              <button
                onClick={() => setOverrideJob(null)}
                className="px-4 py-2 text-xs text-slate-600 hover:text-slate-900 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={submitOverride}
                disabled={isSubmittingOverride || overrideReason.trim().length < 3}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors shadow"
              >
                {isSubmittingOverride ? 'Recording Override...' : 'Confirm & Record Audit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
