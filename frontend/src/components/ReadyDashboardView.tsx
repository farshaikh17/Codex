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

export const ReadyDashboardView: React.FC<ReadyDashboardViewProps> = ({ candidateId, onSelectJob, onViewTracker }) => {
  const [metrics, setMetrics] = useState<WeeklyMetrics | null>(null);
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
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

  const readySeq = React.useRef(0);
  const loadData = async () => {
    const seq = ++readySeq.current;
    const fresh = () => seq === readySeq.current;
    setIsLoading(true);
    try {
      setMetrics(null); setProfile(null); setJobs([]);
      fetchWeeklyMetrics(candidateId).then(data => { if (fresh()) setMetrics(data); }).catch(() => {});
      fetchProfile(candidateId).then(data => {
        if (!fresh()) return;
        setProfile(data);
        setThresholdInput(data.qualification_threshold ?? (candidateId === 'sana_ansari' ? 60 : 70));
      }).catch(() => {});
      
      // Fetch up to 500 jobs for pipeline review
      const paginatedResult = await fetchJobs({
        candidate_id: candidateId,
        sort_by: 'score_desc',
        exclude_applied: true,
        limit: 500
      });
      if (!fresh()) return;
      setJobs(paginatedResult.jobs);
    } catch (err: any) {
      if (!fresh()) return;
      setNotification({ type: 'error', message: err.message || 'Failed to load qualification pipeline data.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [candidateId]);

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

  const readyCount = metrics?.ready_inventory !== undefined 
    ? metrics.ready_inventory 
    : jobs.filter(j => j.farhan_fit === 'READY' || j.qualification_status === 'READY').length;
  const stretchCount = metrics?.stretch_ready_inventory !== undefined 
    ? metrics.stretch_ready_inventory 
    : jobs.filter(j => j.farhan_fit === 'STRETCH' || j.qualification_status === 'STRETCH_READY').length;
  const applyWorthyCount = metrics?.total_apply_worthy !== undefined 
    ? metrics.total_apply_worthy 
    : readyCount + stretchCount;
  const reviewCount = metrics?.status_distribution?.NEEDS_REVIEW !== undefined 
    ? metrics.status_distribution.NEEDS_REVIEW 
    : jobs.filter(j => j.farhan_fit === 'REVIEW' || j.qualification_status === 'NEEDS_REVIEW').length;
  const possibleRemoteCount = jobs.filter(j => 
    (j.remote_from_india === 'UNKNOWN' || j.eligibility?.classification === 'UNKNOWN') && 
    (j.score?.overall_score ?? 0) >= 60
  ).length;

  // Filter jobs based on active tab and search
  const filteredJobs = jobs.filter(j => {
    // Dismissed or irrelevant jobs are excluded from active review/ready queues
    if (j.qualification_status === 'INELIGIBLE' || j.manual_override_status === 'INELIGIBLE' || j.qualification_status === 'CLOSED') {
      return false;
    }
    const isReady = j.qualification_status === 'READY' || j.farhan_fit === 'READY';
    const isStretch = j.qualification_status === 'STRETCH_READY' || j.farhan_fit === 'STRETCH';
    const isReview = j.qualification_status === 'NEEDS_REVIEW' || j.farhan_fit === 'REVIEW';
    const isPossibleRemote = (j.remote_from_india === 'UNKNOWN' || j.eligibility?.classification === 'UNKNOWN') && (j.score?.overall_score ?? 0) >= 60;

    if (activeTab === 'READY' && !isReady) return false;
    if (activeTab === 'STRETCH' && !isStretch) return false;
    if (activeTab === 'APPLY_WORTHY' && !(isReady || isStretch)) return false;
    if (activeTab === 'POSSIBLE_REMOTE' && !isPossibleRemote) return false;
    if (activeTab === 'NEEDS_REVIEW') {
      if (!isReview) return false;
      if (reviewSubFilter === 'FIT') {
        const text = (j.review_reason || '').toLowerCase();
        if (!text.includes('fit:') && !text.includes('threshold') && !text.includes('candidate')) return false;
      } else if (reviewSubFilter === 'INDIA_SCOPE') {
        const text = (j.review_reason || '').toLowerCase();
        if (!text.includes('remote scope') && !text.includes('india') && j.remote_from_india !== 'UNKNOWN') return false;
      } else if (reviewSubFilter === 'PAY') {
        if (j.salary_published) return false;
      }
    }

    if (searchQuery) {
      const term = searchQuery.toLowerCase();
      const matchText = `${j.title} ${j.company} ${j.description} ${j.location_restrictions || ''}`.toLowerCase();
      if (!matchText.includes(term)) return false;
    }
    return true;
  });

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
              STRICT QUALIFICATION GATE
            </span>
            <span className="text-slate-400 text-xs">Sunday–Saturday America/New_York</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">READY-to-Apply Shortlist</h1>
          <p className="text-slate-300 text-sm mt-1 max-w-2xl leading-relaxed">
            A job qualifies as READY strictly when it is a currently open vacancy with a working application URL, affirmative evidence of hiring in India, and meets your qualification threshold.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleReverify}
            disabled={isReverifying}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow transition-colors"
            title="Reverify all currently READY jobs to confirm they remain active and open before presenting"
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
                  {metrics.ready_inventory ?? readyCount} READY
                </span>
                <span className="text-[11px] font-bold text-blue-800 bg-blue-100 border border-blue-300 px-2 py-0.5 rounded-full">
                  {metrics.stretch_ready_inventory ?? stretchCount} STRETCH
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Verified active vacancies</span>
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
              onClick={() => setActiveTab('READY')}
              className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                activeTab === 'READY'
                  ? 'bg-white text-emerald-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              READY to Apply ({readyCount})
            </button>
            <button
              onClick={() => setActiveTab('STRETCH')}
              className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                activeTab === 'STRETCH'
                  ? 'bg-white text-blue-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              Stretch ({stretchCount})
            </button>
            <button
              onClick={() => setActiveTab('APPLY_WORTHY')}
              className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                activeTab === 'APPLY_WORTHY'
                  ? 'bg-white text-teal-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
              All Apply-Worthy ({applyWorthyCount})
            </button>
            <button
              onClick={() => setActiveTab('NEEDS_REVIEW')}
              className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                activeTab === 'NEEDS_REVIEW'
                  ? 'bg-white text-amber-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
              Needs Review ({reviewCount})
            </button>
            <button
              onClick={() => setActiveTab('POSSIBLE_REMOTE')}
              className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                activeTab === 'POSSIBLE_REMOTE'
                  ? 'bg-white text-indigo-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Search className="w-3.5 h-3.5 text-indigo-600" />
              Possible Remote ({possibleRemoteCount})
            </button>
            <button
              onClick={() => setActiveTab('ALL')}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'ALL'
                  ? 'bg-white text-slate-900 shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({jobs.length})
            </button>
          </div>

          {/* Search Input */}
          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search filtered jobs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
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
              onClick={() => setReviewSubFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                reviewSubFilter === 'ALL'
                  ? 'bg-amber-200 text-amber-900 shadow-sm'
                  : 'text-amber-700 hover:bg-amber-100'
              }`}
            >
              All Review Cases
            </button>
            <button
              onClick={() => setReviewSubFilter('FIT')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                reviewSubFilter === 'FIT'
                  ? 'bg-amber-200 text-amber-900 shadow-sm'
                  : 'text-amber-700 hover:bg-amber-100'
              }`}
            >
              Fit & Score Questions
            </button>
            <button
              onClick={() => setReviewSubFilter('INDIA_SCOPE')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                reviewSubFilter === 'INDIA_SCOPE'
                  ? 'bg-amber-200 text-amber-900 shadow-sm'
                  : 'text-amber-700 hover:bg-amber-100'
              }`}
            >
              Unconfirmed India Scope
            </button>
            <button
              onClick={() => setReviewSubFilter('PAY')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                reviewSubFilter === 'PAY'
                  ? 'bg-amber-200 text-amber-900 shadow-sm'
                  : 'text-amber-700 hover:bg-amber-100'
              }`}
            >
              Unlisted Salary
            </button>
          </div>
        )}
      </div>

      {/* Job Cards List */}
      <div className="space-y-4">
        {filteredJobs.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 shadow-sm">
            <CheckCircle2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-800">No jobs in this category</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              {activeTab === 'READY' 
                ? 'No vacancies currently meet all affirmative India-remote criteria and threshold score. Review unconfirmed listings or adjust the threshold.'
                : 'No postings match the current filter.'}
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
                        Remote: {job.remote_from_india ?? (job.eligibility?.classification === 'ELIGIBLE' ? 'CONFIRMED' : 'UNKNOWN')}
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
                        Fit: {job.farhan_fit ?? qStatus}
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
                      {job.eligibility?.evidence_quote && (
                        <div className="flex items-start gap-1.5 font-mono text-[11px] text-slate-700 bg-white p-2 rounded border border-slate-200">
                          <span className="font-bold text-slate-500 uppercase text-[9px] shrink-0 mt-0.5">Evidence:</span>
                          <span className="italic">"{job.eligibility.evidence_quote}"</span>
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
