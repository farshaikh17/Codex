import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Job, CandidateProfile, AnalyticsData, ApplicationStatus, WeeklyMetrics, IndiaRemoteSummary } from './types';
import { 
  fetchJobs, fetchApplications, 
  fetchProfile, 
  updateProfile, 
  updateApplication, 
  fetchAnalytics, 
  reloadSyntheticFixtures,
  fetchWeeklyMetrics,
  fetchIndiaRemoteSummary,
  overrideJobQualification,
  isOperatorAuthenticated,
  logoutOperator,
  checkStoredOperatorKey
} from './api';
import { PilotView } from './components/PilotView';
import { Navbar, NavTab } from './components/Navbar';
import { JobTable } from './components/JobTable';
import { JobDetailModal } from './components/JobDetailModal';
import { ApplicationTracker } from './components/ApplicationTracker';
import { ProfileModal } from './components/ProfileModal';
import { AnalyticsView } from './components/AnalyticsView';
import { SourcesView } from './components/SourcesView';
import { ReadyDashboardView } from './components/ReadyDashboardView';
import { AutomationDashboardView } from './components/AutomationDashboardView';
import { GoogleSyncView } from './components/GoogleSyncView';
import { IndiaRemoteView } from './components/IndiaRemoteView';
import { DashboardOverview } from './components/DashboardOverview';
import { AuthModal } from './components/AuthModal';

export const App: React.FC = () => {
  const [activeTab, changeActiveTab] = useState<NavTab>('dashboard');
  const [candidateId, setCandidateId] = useState('farhan_shaikh');
  const setActiveTab = (tab: NavTab) => {
    if (tab === 'farhan' || tab === 'sana') {
      const nextCandidate = tab === 'sana' ? 'sana_ansari' : 'farhan_shaikh';
      if(nextCandidate !== candidateId) { setJobs([]); setTrackedJobs([]); setSelectedJob(null); setAnalytics(null); setWeeklyMetrics(null); setIndiaRemoteSummary(null); setTotalJobsCount(0); setStatusCounts({ READY: 0, STRETCH_READY: 0, NEEDS_REVIEW: 0, INELIGIBLE: 0, HOLD: 0 }); setProfile(null); }
      setCandidateId(nextCandidate);
    }
    changeActiveTab(tab);
  };
  const [jobs, setJobs] = useState<Job[]>([]);
  const [totalJobsCount, setTotalJobsCount] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize] = useState<number>(50);
  const [statusCounts, setStatusCounts] = useState<{ READY: number; STRETCH_READY: number; NEEDS_REVIEW: number; INELIGIBLE: number; HOLD: number }>({
    READY: 0,
    STRETCH_READY: 0,
    NEEDS_REVIEW: 0,
    INELIGIBLE: 0,
    HOLD: 0
  });
  const [trackedJobs, setTrackedJobs] = useState<Job[]>([]);
  const [weeklyMetrics, setWeeklyMetrics] = useState<WeeklyMetrics | null>(null);
  const [indiaRemoteSummary, setIndiaRemoteSummary] = useState<IndiaRemoteSummary | null>(null);
  const requestId = useRef(0);
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  

  // Global auth event listener for automatic modal trigger on 401/403
  const [authOpen, setAuthOpen] = useState<boolean>(false);
  const [isOperator, setIsOperator] = useState<boolean>(isOperatorAuthenticated());
  useEffect(() => {
    const handleAuthRequired = () => {
      // The Worker answered 401/403: the key is missing, wrong or rotated. Drop it and ask again.
      logoutOperator();
      setIsOperator(false);
      setAuthOpen(true);
    };
    window.addEventListener('operator-auth-required', handleAuthRequired);
    return () => window.removeEventListener('operator-auth-required', handleAuthRequired);
  }, []);

  // Filters
  const [search, setSearch] = useState<string>('');
  const [eligibilityFilter, setEligibilityFilter] = useState<string>('ALL');
  const [minScore, setMinScore] = useState<number>(0);
  const [workplaceFilter, setWorkplaceFilter] = useState<string>('ALL');
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<string>('score_desc');
  const [selectedLane, setSelectedLane] = useState<string>('ALL');

  // Reset pagination to page 1 whenever search, filters, or candidate change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, eligibilityFilter, minScore, workplaceFilter, sourceFilter, sortBy, selectedLane, candidateId]);

  const loadData = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setIsLoading(true);
    setError(null);
    // Check the stored key once before fanning out parallel requests: a stale key then costs one refused attempt, not seven.
    const session = await checkStoredOperatorKey();
    if (currentRequest !== requestId.current) return;
    if (session !== 'ok') {
      setIsLoading(false);
      setIsOperator(false);
      if (session === 'locked') setError('Too many failed attempts from this address. Try again in a few minutes.');
      setAuthOpen(true);
      return;
    }
    setIsOperator(true);
    try {
      const candidateForFetch = candidateId;
      const [paginatedResult, profileData, analyticsData, trackerData, metricsData, irSummaryData] = await Promise.all([
        fetchJobs({
          search,
          eligibility: eligibilityFilter,
          min_score: minScore,
          workplace_type: workplaceFilter,
          source_adapter: sourceFilter,
          sort_by: sortBy,
          exclude_applied: true,
          candidate_id: candidateForFetch,
          strategy_lane: selectedLane !== 'ALL' ? selectedLane : undefined,
          exclude_dismissed: true,
          page: currentPage,
          limit: pageSize
        }),
        fetchProfile(candidateForFetch),
        fetchAnalytics(candidateForFetch), 
        fetchApplications(candidateForFetch),
        fetchWeeklyMetrics(candidateForFetch).catch(() => null),
        fetchIndiaRemoteSummary(candidateForFetch).catch(() => null)
      ]);
      if (currentRequest !== requestId.current) return;
      setJobs(paginatedResult.jobs);
      setTotalJobsCount(paginatedResult.total);
      if (paginatedResult.status_counts) {
        setStatusCounts(paginatedResult.status_counts);
      }
      
      setTrackedJobs(trackerData);
      setProfile(profileData);
      setAnalytics(analyticsData);
      if (metricsData) setWeeklyMetrics(metricsData);
      if (irSummaryData) setIndiaRemoteSummary(irSummaryData);
    } catch (err: any) {
      if (currentRequest !== requestId.current) return;
      console.error(err);
      setError('Unable to connect to Career Job Engine backend. Please ensure the API service is reachable.');
    } finally {
      if (currentRequest === requestId.current) setIsLoading(false);
    }
  }, [search, eligibilityFilter, minScore, workplaceFilter, sourceFilter, sortBy, selectedLane, activeTab, candidateId, currentPage, pageSize]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Quick save toggle
  
  const handleResetFilters = () => {
    setSearch('');
    setEligibilityFilter('ALL');
    setMinScore(0);
    setWorkplaceFilter('ALL');
    setSourceFilter('ALL');
    setSortBy('score_desc');
    setSelectedLane('ALL');
    setCurrentPage(1);
  };

  const handleQuickSaveJob = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;

    const newStatus: ApplicationStatus = job.application?.status === 'SAVED' ? 'WITHDRAWN' : 'SAVED';
    try {
      await updateApplication({ job_id: jobId, status: newStatus, candidate_id: candidateId });
      await loadData();
    } catch { setError("Unable to save this job. Please retry."); }
  };

  const handleDismissJob = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      // Mark as INELIGIBLE with audit reason so it immediately leaves the review queue
      await overrideJobQualification(jobId, 'INELIGIBLE', 'Dismissed by reviewer: Irrelevant role', 'Candidate', candidateId);
      // Optimistically remove from visible list and reload fresh state
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      await loadData();
    } catch {
      setError("Unable to dismiss job. Please retry.");
    }
  };



  // Full application update from detail modal
  const handleUpdateApplication = async (payload: {
    job_id: string;
    status: ApplicationStatus;
    notes?: string;
    rejection_stage?: string;
    rejection_reason_category?: string;
    rejection_notes?: string;
  }) => {
    const updated = await updateApplication({...payload, candidate_id: candidateId});
    setSelectedJob(prev => (prev ? updated : null));
    await loadData();
  };

  // Candidate profile update
  const handleUpdateProfile = async (updated: CandidateProfile) => {
    const res = await updateProfile(updated);
    setProfile(res);
    await loadData();
  };

  // Fixture reload
  const handleReloadFixtures = async () => {
    try {
      await reloadSyntheticFixtures();
      await loadData();
    } catch { setError("Unable to reload test jobs. Please retry."); }
  };

  const savedCount = trackedJobs.length;
  const readyCount = weeklyMetrics?.ready_inventory ?? jobs.filter((j) => j.farhan_fit === 'READY' || j.qualification_status === 'READY').length;
  const indiaRemoteCount = indiaRemoteSummary?.total_confirmed ?? 0;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        savedCount={savedCount}
        readyCount={readyCount}
        indiaRemoteCount={indiaRemoteCount}
        onReloadFixtures={handleReloadFixtures}
        isLoading={isLoading}
        pilotActive={activeTab === 'pilot'}
        isOperator={isOperator}
        onOpenAuth={() => setAuthOpen(true)}
        
        
      />
      <AuthModal
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthChange={(authed) => {
          setIsOperator(authed);
          if (authed) loadData();
        }}
      />


      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'pilot' ? <PilotView /> : error ? (
          <div className="p-6 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm">
            <h3 className="font-bold text-base mb-1">Backend Connection Notice</h3>
            <p>{error}</p>
            <p className="mt-2 text-xs font-mono bg-rose-100 p-2 rounded">
              uvicorn backend.main:app --port 8000
            </p>
            <button className="mt-3 underline" onClick={loadData}>Retry connection</button>
          </div>
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <DashboardOverview
                isOperator={isOperator}
                onSelectCandidate={(cid) => setActiveTab(cid === 'farhan_shaikh' ? 'farhan' : 'sana')}
                onOpenAutomation={() => setActiveTab('automation')}
                onOpenApplications={() => setActiveTab('tracker')}
              />
            )}

            {(activeTab === 'farhan' || activeTab === 'sana' || activeTab === 'discovery') && (
              <div className="space-y-6">
                {/* Candidate Workspace Header */}
                <div className={`p-5 rounded-xl border flex flex-col md:flex-row md:items-center md:justify-between gap-4 shadow-sm ${
                  candidateId === 'sana_ansari'
                    ? 'bg-amber-950/20 border-amber-800/40 text-amber-200'
                    : 'bg-blue-950/20 border-blue-800/40 text-blue-200'
                }`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono uppercase tracking-wider px-2 py-0.5 rounded font-semibold bg-white/10">
                        {profile && profile.id === candidateId ? `${profile.full_name} Workspace` : 'Loading workspace'}
                      </span>
                      <span className="text-xs text-slate-400">•</span>
                      <span className="text-xs text-slate-300">
                        {profile && profile.id === candidateId ? (profile.education_short || '') : ''}
                      </span>
                    </div>
                    <h2 className="text-xl font-bold text-white mt-1">
                      {profile && profile.id === candidateId ? (profile.display_title || '') : ''}
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {profile && profile.id === candidateId
                        ? `${profile.summary_line || ''} ${profile.location_preferences && profile.location_preferences.length ? 'Location preferences: ' + profile.location_preferences.join(', ') + '.' : ''} ${profile.pay_line || ''}`
                        : ''}
                    </p>
                  </div>

                  {/* Strategy Lane Selector Pills */}
                  <div className="flex flex-wrap items-center gap-1.5 bg-slate-900/80 p-1.5 rounded-lg border border-slate-800">
                    <button
                      onClick={() => setSelectedLane('ALL')}
                      className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                        selectedLane === 'ALL'
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      ALL LANES
                    </button>
                    <button
                      onClick={() => setSelectedLane('STRONGEST_FIT')}
                      className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                        selectedLane === 'STRONGEST_FIT'
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      STRONGEST FIT ({candidateId === 'sana_ansari' ? '20%' : '70%'})
                    </button>
                    <button
                      onClick={() => setSelectedLane('BRIDGE')}
                      className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                        selectedLane === 'BRIDGE'
                          ? 'bg-teal-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      BRIDGE ({candidateId === 'sana_ansari' ? '30%' : '20%'})
                    </button>
                    <button
                      onClick={() => setSelectedLane('DREAM')}
                      className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                        selectedLane === 'DREAM'
                          ? 'bg-purple-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      DREAM ({candidateId === 'sana_ansari' ? '50%' : '10%'})
                    </button>
                  </div>
                </div>

                {/* Executive Funnel Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div
                    onClick={() => setActiveTab('india-remote')}
                    className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm hover:border-teal-400 hover:shadow-md cursor-pointer transition-all"
                  >
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Confirmed Eligible</div>
                    <div className="text-2xl font-black text-teal-700 font-mono mt-0.5">{indiaRemoteSummary?.total_confirmed ?? 0}</div>
                    <div className="text-[11px] text-teal-600 font-semibold mt-0.5">Explore Queue →</div>
                  </div>

                  <div
                    onClick={() => setActiveTab('ready')}
                    className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm hover:border-emerald-400 hover:shadow-md cursor-pointer transition-all"
                  >
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Ready to Apply</div>
                    <div className="text-2xl font-black text-emerald-700 font-mono mt-0.5">{statusCounts.READY}</div>
                    <div className="text-[11px] text-emerald-600 font-semibold mt-0.5">View READY →</div>
                  </div>

                  <div
                    onClick={() => setActiveTab('ready')}
                    className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm hover:border-blue-400 hover:shadow-md cursor-pointer transition-all"
                  >
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Stretch Matches</div>
                    <div className="text-2xl font-black text-blue-700 font-mono mt-0.5">{statusCounts.STRETCH_READY}</div>
                    <div className="text-[11px] text-blue-600 font-semibold mt-0.5">View Stretch →</div>
                  </div>

                  <div
                    onClick={() => setActiveTab('ready')}
                    className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm hover:border-amber-400 hover:shadow-md cursor-pointer transition-all"
                  >
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Needs Review</div>
                    <div className="text-2xl font-black text-amber-700 font-mono mt-0.5">{statusCounts.NEEDS_REVIEW}</div>
                    <div className="text-[11px] text-amber-600 font-semibold mt-0.5">Operator Audit →</div>
                  </div>

                  <div
                    onClick={() => setActiveTab('tracker')}
                    className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm hover:border-purple-400 hover:shadow-md cursor-pointer transition-all"
                  >
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Applications</div>
                    <div className="text-2xl font-black text-purple-700 font-mono mt-0.5">{savedCount}</div>
                    <div className="text-[11px] text-purple-600 font-semibold mt-0.5">Track Pipeline →</div>
                  </div>
                </div>

                <JobTable
                  jobs={jobs}
                  totalJobsCount={totalJobsCount}
                  currentPage={currentPage}
                  pageSize={pageSize}
                  onPageChange={(p) => setCurrentPage(p)}
                  onResetFilters={handleResetFilters}
                  onSelectJob={(j) => setSelectedJob(j)}
                  onSaveJob={handleQuickSaveJob}
                  onDismissJob={handleDismissJob}
                  search={search}
                  setSearch={setSearch}
                  eligibilityFilter={eligibilityFilter}
                  setEligibilityFilter={setEligibilityFilter}
                  minScore={minScore}
                  setMinScore={setMinScore}
                  workplaceFilter={workplaceFilter}
                  setWorkplaceFilter={setWorkplaceFilter}
                  sourceFilter={sourceFilter}
                  setSourceFilter={setSourceFilter}
                  sortBy={sortBy}
                  setSortBy={setSortBy}
                  isLoading={isLoading}
                />
              </div>
            )}

            {activeTab === 'india-remote' && (
              <IndiaRemoteView
                candidateId={candidateId}
                onSelectJob={(j) => setSelectedJob(j)}
                onRefreshGlobal={loadData}
              />
            )}

            {activeTab === 'ready' && (
              <ReadyDashboardView
                key={`${candidateId}-${selectedJob?.qualification_status || ''}`}
                candidateId={candidateId}
                onSelectJob={(j) => setSelectedJob(j)}
                onViewTracker={() => setActiveTab('tracker')}
              />
            )}

            {activeTab === 'tracker' && (
              <ApplicationTracker
                key={candidateId}
                candidateId={candidateId}
                jobs={trackedJobs}
                onSelectJob={(j) => setSelectedJob(j)}
              />
            )}

            {activeTab === 'analytics' && (
              <AnalyticsView key={candidateId} analytics={analytics} candidateId={candidateId} />
            )}

            {activeTab === 'profile' && profile && (
              <ProfileModal
                key={profile.id}
                profile={profile}
                onUpdate={handleUpdateProfile}
              />
            )}

            {activeTab === 'sources' && (
              <SourcesView onSyncComplete={loadData} />
            )}

            {activeTab === 'automation' && (
              <AutomationDashboardView onRefreshData={loadData} />
            )}

            {activeTab === 'google-sync' && (
              <GoogleSyncView />
            )}
          </>
        )}
      </main>

      {/* Detail Inspection Modal Drawer */}
      {selectedJob && <JobDetailModal
        key={`${candidateId}-${selectedJob.id}`}
        job={{ ...selectedJob, candidate_id: candidateId }}
        onClose={() => setSelectedJob(null)}
        onUpdateApplication={handleUpdateApplication}
        onJobUpdated={async (updatedJob) => {
          setSelectedJob(prev => (prev ? { ...updatedJob, candidate_id: candidateId } : null));
          await loadData();
        }}
      />}

      <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        Farhan Job Engine MVP • Cloudflare D1 Database • Free Dependencies • No Paid APIs
      </footer>

      {/* Operator Auth Sign-in / Logout Modal */}
      
    </div>
  );
};
