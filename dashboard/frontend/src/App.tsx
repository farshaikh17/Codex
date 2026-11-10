import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Job, CandidateProfile, AnalyticsData, ApplicationStatus, WeeklyMetrics, IndiaRemoteSummary } from './types';
import { 
  fetchJobs, fetchApplications, 
  fetchProfile, 
  updateProfile, 
  updateApplication, 
  fetchAnalytics, 
  fetchWeeklyMetrics,
  fetchIndiaRemoteSummary,
  overrideJobQualification,
  isOperatorAuthenticated,
  OPERATOR_AUTH_EVENT,
  logoutOperator,
  checkStoredOperatorKey,
  captureShareLink,
  getShareView,
  clearShareView,
  fetchCandidateList,
  downloadExport,
  fetchBrand,
  unsaveJob,
  CandidateRef
} from './api';
import { ClientsView } from './components/ClientsView';
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
import { OperatorOnlyPanel } from './components/OperatorOnlyPanel';
import { IndiaRemoteView } from './components/IndiaRemoteView';
import { DashboardOverview } from './components/DashboardOverview';
import { AuthModal } from './components/AuthModal';

// A share link (#view=...) is read before the first render, so the first requests already carry it.
captureShareLink();
const BUILTIN = ['farhan_shaikh', 'sana_ansari'];

export const App: React.FC = () => {
  const initialShareView = getShareView();
  const [activeTab, changeActiveTab] = useState<NavTab>(initialShareView ? (initialShareView.candidate === 'sana_ansari' ? 'sana' : initialShareView.candidate === 'farhan_shaikh' ? 'farhan' : 'client') : 'dashboard');
  const [candidateId, setCandidateId] = useState(initialShareView?.candidate || 'farhan_shaikh');
  const [candidateList, setCandidateList] = useState<CandidateRef[]>([]);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [brand, setBrand] = useState('Career Job Engine');
  useEffect(() => { fetchBrand().then((b) => { setBrand(b.brand_name); document.title = `Dashboard · ${b.brand_name}`; }); }, []);
  const setActiveTab = (tab: NavTab, clientId?: string) => {
    if (tab === 'farhan' || tab === 'sana' || (tab === 'client' && clientId)) {
      const nextCandidate = tab === 'client' ? clientId! : tab === 'sana' ? 'sana_ansari' : 'farhan_shaikh';
      if(nextCandidate !== candidateId) { setJobs([]); setTrackedJobs([]); setSelectedJob(null); setAnalytics(null); setWeeklyMetrics(null); setIndiaRemoteSummary(null); setTotalJobsCount(0); setStatusCounts({ READY: 0, STRETCH_READY: 0, NEEDS_REVIEW: 0, INELIGIBLE: 0, HOLD: 0 }); setProfile(null); }
      setCandidateId(nextCandidate);
    }
    changeActiveTab(tab);
  };
  const openCandidate = (id: string) => setActiveTab(id === 'farhan_shaikh' ? 'farhan' : id === 'sana_ansari' ? 'sana' : 'client', id);
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
  
  

  // The dashboard is public. The operator unlock exists only for changing records: it opens when a visitor tries to
  // change something, or when the operator chooses it from the top bar. Reads never open it.
  const [authOpen, setAuthOpen] = useState<boolean>(false);
  const [isOperator, setIsOperator] = useState<boolean>(isOperatorAuthenticated());
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [authEpoch, setAuthEpoch] = useState(0);   // bumped when the operator session ends, so operator data is dropped and reloaded publicly
  useEffect(() => {
    const handleAuthRequired = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (d.hadKey) {
        // A stored key was refused (rotated or expired): fall back to the public view and say so.
        logoutOperator();
        setIsOperator(false);
        setProfile(null); setTrackedJobs([]);
        setAuthEpoch((n) => n + 1);
        setSessionNotice('The operator session ended. You are viewing the public dashboard; sign in again to make changes.');
      }
      if (d.write) setAuthOpen(true);
    };
    window.addEventListener(OPERATOR_AUTH_EVENT, handleAuthRequired);
    return () => window.removeEventListener(OPERATOR_AUTH_EVENT, handleAuthRequired);
  }, []);

  // Filters
  const [search, setSearch] = useState<string>('');
  // The job query re-reads every qualification row, so typing waits for a pause instead of querying per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(search), 400); return () => clearTimeout(t); }, [search]);
  const [eligibilityFilter, setEligibilityFilter] = useState<string>('ALL');
  const [minScore, setMinScore] = useState<number>(0);
  const [workplaceFilter, setWorkplaceFilter] = useState<string>('ALL');
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<string>('score_desc');
  const [selectedLane, setSelectedLane] = useState<string>('ALL');

  // Reset pagination to page 1 whenever search, filters, or candidate change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, eligibilityFilter, minScore, workplaceFilter, sourceFilter, sortBy, selectedLane, candidateId]);

  const loadData = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setIsLoading(true);
    setError(null);
    // If an operator key is stored, confirm it once before fanning out (a stale key then costs one refused attempt).
    // Without a key, or with a refused one, the page simply loads in public mode: no unlock window, no error.
    const session = await checkStoredOperatorKey();
    if (session === 'unknown') setSessionNotice('Could not confirm the operator session just now; showing the public view.');
    // These two apply even if a newer load has superseded this one: the stored key is already gone.
    if (session === 'rejected') setSessionNotice('The saved operator key is no longer valid. You are viewing the public dashboard.');
    if (session === 'locked') { logoutOperator(); setSessionNotice('Too many failed sign-in attempts from this address. You are viewing the public dashboard; try signing in again later.'); }
    if (currentRequest !== requestId.current) { if (session !== 'ok') setIsOperator(false); return; }
    setIsOperator(session === 'ok');
    try {
      const candidateForFetch = candidateId;
      const [paginatedResult, profileData, analyticsData, trackerData, metricsData, irSummaryData] = await Promise.all([
        fetchJobs({
          search: debouncedSearch,
          eligibility: eligibilityFilter,
          min_score: minScore,
          workplace_type: workplaceFilter,
          found_on: sourceFilter,
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
  }, [debouncedSearch, eligibilityFilter, minScore, workplaceFilter, sourceFilter, sortBy, selectedLane, candidateId, currentPage, pageSize]);

  const [candidateListLoaded, setCandidateListLoaded] = useState(false);
  const loadCandidates = useCallback(() => { fetchCandidateList().then((l) => { setCandidateList(l); setCandidateListLoaded(true); }).catch(() => setCandidateList([])); }, []);
  useEffect(() => { loadCandidates(); }, [isOperator, authEpoch, loadCandidates]);
  // A revoked or wrong share link: the client is not in the list this link can see. Say so once, drop the link, show the public view.
  const [shareView, setShareView] = useState(initialShareView);
  useEffect(() => {
    if (!shareView || !candidateListLoaded || isOperator) return;
    if (!candidateList.some((c) => c.id === shareView.candidate)) {
      clearShareView(); setShareView(null);
      setSessionNotice('This shared link is no longer valid (it was revoked or is incomplete). Ask the sender for a new link. You are viewing the public dashboard.');
      setCandidateId('farhan_shaikh'); changeActiveTab('dashboard'); setError(null); loadData();
    }
  }, [shareView, candidateList, candidateListLoaded, isOperator]);   // eslint-disable-line react-hooks/exhaustive-deps
  const clientTabs = candidateList.filter((c) => !BUILTIN.includes(c.id)).map((c) => ({ id: c.id, full_name: c.full_name }));
  const viewingName = shareView ? (candidateList.find((c) => c.id === shareView.candidate)?.full_name || shareView.candidate) : null;
  useEffect(() => { if (authEpoch > 0) loadData(); }, [authEpoch]);  // eslint-disable-line react-hooks/exhaustive-deps
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

    try {
      if (job.application?.status === 'SAVED') await unsaveJob(jobId, candidateId);
      else await updateApplication({ job_id: jobId, status: 'SAVED', candidate_id: candidateId });
      await loadData();
    } catch (e: any) { if (!/Operator sign-in/.test(e?.message || '')) setError("Unable to save this job. Please retry."); }
  };

  const handleDismissJob = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      // Mark as INELIGIBLE with audit reason so it immediately leaves the review queue
      await overrideJobQualification(jobId, 'INELIGIBLE', 'Dismissed by reviewer: Irrelevant role', 'Candidate', candidateId);
      // Optimistically remove from visible list and reload fresh state
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      await loadData();
    } catch (e: any) {
      if (!/Operator sign-in/.test(e?.message || '')) setError("Unable to dismiss job. Please retry.");
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

  // The navbar's refresh button: re-read the data. (It used to POST to the retired synthetic-fixture endpoint, which a visitor could not
  // call without the unlock window and which always answers 410 for the operator.)
  const handleReloadFixtures = async () => {
    try { await loadData(); } catch { setError('Unable to refresh. Please retry.'); }
  };

  const savedCount = trackedJobs.length;
  // Same definition as the Dashboard cards (worker: APPLIED, SUBMITTED, INTERVIEWING, OFFER)
  const appliedStageCount = trackedJobs.filter((j) => ['APPLIED', 'SUBMITTED', 'INTERVIEWING', 'OFFER'].includes(String(j.application?.status || ''))).length;
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
        clients={clientTabs}
        activeClient={activeTab === 'client' ? candidateId : null}
        onSelectClient={(id) => setActiveTab('client', id)}
        brand={brand}
        viewer={shareView && !isOperator ? { name: (viewingName || '').split(' ')[0] || 'Your', onOpen: () => openCandidate(shareView.candidate) } : null}
      />
      <AuthModal
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthChange={(authed) => {
          setIsOperator(authed);
          // Signing in loads the operator view; signing out drops operator data at once and reloads the public view.
          if (!authed) { setProfile(null); setTrackedJobs([]); }
          loadData();
        }}
      />


      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <h1 className="sr-only">Career Job Engine dashboard</h1>
        {shareView && !isOperator && (
          <div role="status" data-testid="share-banner" className="mb-4 p-3 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-900 text-sm flex items-start justify-between gap-3">
            <span>Shared read-only view{viewingName ? ` for ${viewingName}` : ''}. Nothing can be changed from this link.</span>
            <button className="underline text-xs shrink-0" onClick={() => { clearShareView(); window.location.reload(); }}>Leave shared view</button>
          </div>
        )}
        {sessionNotice && (
          <div role="status" className="mb-4 p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm flex items-start justify-between gap-3">
            <span>{sessionNotice}</span>
            <button className="underline text-xs shrink-0" onClick={() => setSessionNotice(null)}>Dismiss</button>
          </div>
        )}
        {activeTab === 'pilot' ? (isOperator ? <PilotView /> : <OperatorOnlyPanel what="The pilot snapshot" onUnlock={() => setAuthOpen(true)} />) : error ? (
          <div className="p-6 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm">
            <h3 className="font-bold text-base mb-1">The dashboard could not load</h3>
            <p>{error}</p>
            <button className="mt-3 underline" onClick={loadData}>Retry connection</button>
          </div>
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <DashboardOverview
                isOperator={isOperator}
                onSelectCandidate={openCandidate}
                onOpenAutomation={() => setActiveTab('automation')}
                onOpenApplications={() => setActiveTab('tracker')}
              />
            )}

            {activeTab === 'clients' && (isOperator
              ? <ClientsView onOpenClient={openCandidate} onClientsChanged={loadCandidates} />
              : <OperatorOnlyPanel what="Client management" onUnlock={() => setAuthOpen(true)} />)}

            {(activeTab === 'farhan' || activeTab === 'sana' || activeTab === 'client' || activeTab === 'discovery') && (
              <div className="space-y-6">
                {/* Candidate Workspace Header */}
                <div className={`p-5 rounded-xl border flex flex-col md:flex-row md:items-center md:justify-between gap-4 shadow-sm ${
                  candidateId === 'sana_ansari'
                    ? 'bg-slate-900 border-amber-700/50 text-amber-200'
                    : 'bg-slate-900 border-blue-700/50 text-blue-200'
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
                    <p className="text-xs text-slate-300 mt-0.5">
                      {profile && profile.id === candidateId
                        ? `${profile.summary_line || ''} ${profile.location_preferences && profile.location_preferences.length ? 'Location preferences: ' + profile.location_preferences.join(', ') + '.' : ''} ${profile.pay_line || ''}`
                        : ''}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <button data-testid="export-csv" className="text-xs px-2.5 py-1 rounded border border-white/20 text-slate-200 hover:bg-white/10"
                        onClick={() => { setExportNote(null); downloadExport(candidateId, 'ALL').catch((e) => setExportNote(e.message)); }}>Export CSV</button>
                      <button className="text-xs px-2.5 py-1 rounded border border-white/20 text-slate-200 hover:bg-white/10"
                        onClick={() => { setExportNote(null); downloadExport(candidateId, 'APPLY_WORTHY').catch((e) => setExportNote(e.message)); }}>Export Ready + Stretch</button>
                      {exportNote && <span className="text-xs text-rose-300">{exportNote}</span>}
                    </div>
                  </div>

                </div>

                {/* Executive Funnel Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div
                    onClick={() => setActiveTab('india-remote')}
                    className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm hover:border-teal-400 hover:shadow-md cursor-pointer transition-all"
                  >
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Can apply (confirmed)</div>
                    <div className="text-2xl font-black text-teal-700 font-mono mt-0.5">{indiaRemoteSummary?.total_confirmed ?? 0}</div>
                    <div className="text-[11px] text-teal-600 font-semibold mt-0.5">See these jobs →</div>
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
                    <div className="text-[11px] text-blue-600 font-semibold mt-0.5">Worth a try →</div>
                  </div>

                  <div
                    onClick={() => document.querySelector('[data-testid="job-filters"]')?.scrollIntoView({ behavior: 'smooth' })}
                    className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm hover:border-amber-400 hover:shadow-md cursor-pointer transition-all"
                  >
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">To review</div>
                    <div className="text-2xl font-black text-amber-700 font-mono mt-0.5">{statusCounts.NEEDS_REVIEW}</div>
                    <div className="text-[11px] text-amber-600 font-semibold mt-0.5">In the list below ↓</div>
                  </div>

                  <div
                    onClick={() => setActiveTab('tracker')}
                    className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm hover:border-purple-400 hover:shadow-md cursor-pointer transition-all"
                  >
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Applied</div>
                    <div className="text-2xl font-black text-purple-700 font-mono mt-0.5">{appliedStageCount}</div>
                    <div className="text-[11px] text-purple-600 font-semibold mt-0.5">{savedCount} in tracker →</div>
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
                key={`${profile.id}-${profile.public_view ? 'public' : 'operator'}`}
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

            {activeTab === 'google-sync' && (isOperator
              ? <GoogleSyncView />
              : <OperatorOnlyPanel what="Spreadsheet sync" onUnlock={() => setAuthOpen(true)} />)}
          </>
        )}
      </main>

      {/* Detail Inspection Modal Drawer */}
      {selectedJob && <JobDetailModal
        key={`${candidateId}-${selectedJob.id}`}
        job={{ ...selectedJob, candidate_id: candidateId }}
        onClose={() => setSelectedJob(null)}
        onUpdateApplication={handleUpdateApplication}
        profileSkills={profile && profile.id === candidateId ? profile.primary_skills : undefined}
        onJobUpdated={async (updatedJob) => {
          setSelectedJob(prev => (prev ? { ...updatedJob, candidate_id: candidateId } : null));
          await loadData();
        }}
      />}

      <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        Career Job Engine • Cloudflare Workers + D1 • Free tier • Viewing is public, changes need the operator key
      </footer>

      {/* Operator Auth Sign-in / Logout Modal */}
      
    </div>
  );
};
