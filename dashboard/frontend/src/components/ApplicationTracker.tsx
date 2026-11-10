import React, { useState, useEffect } from 'react';
import { Job, ApplicationStatus, CohortMetrics, ApplicationHistoryRecord } from '../types';
import { fetchCohortMetrics, fetchApplicationHistory, fetchFollowUps, setFollowUp, isOperatorAuthenticated } from '../api';
import { followUpState } from '../jobHelpers';
import { 
  BookmarkCheck, 
  Building, 
  Clock, 
  ChevronRight,
  Filter,
  History,
  Calendar,
  X,
  User,
  Tag
} from 'lucide-react';

interface ApplicationTrackerProps {
  candidateId: string;
  jobs: Job[];
  onSelectJob: (job: Job) => void;
}

export const ApplicationTracker: React.FC<ApplicationTrackerProps> = ({
  candidateId,
  jobs,
  onSelectJob
}) => {
  const [filterStage, setFilterStage] = useState<string>('ALL');
  const [cohortMetrics, setCohortMetrics] = useState<CohortMetrics | null>(null);
  const [historyJob, setHistoryJob] = useState<Job | null>(null);
  const [historyRecords, setHistoryRecords] = useState<ApplicationHistoryRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  const [followUps, setFollowUps] = useState<Record<string, string>>({});
  const [followUpError, setFollowUpError] = useState<string>('');
  const operator = isOperatorAuthenticated();
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    let current = true;
    setFollowUps({});
    if (operator) fetchFollowUps(candidateId).then((items) => { if (current) setFollowUps(Object.fromEntries(items.map((f) => [f.job_id, f.follow_up_at]))); });
    return () => { current = false; };
  }, [candidateId, operator]);

  const changeFollowUp = async (jobId: string, value: string) => {
    setFollowUpError('');
    try {
      await setFollowUp(jobId, candidateId, value || null);
      setFollowUps((prev) => { const next = { ...prev }; if (value) next[jobId] = value; else delete next[jobId]; return next; });
    } catch (e: any) { setFollowUpError(e?.message || 'Could not save the follow-up date'); }
  };
  const overdueCount = Object.values(followUps).filter((d) => followUpState(d, today).key === 'overdue').length;

  useEffect(() => {
    let current = true;
    setCohortMetrics(null);
    fetchCohortMetrics(candidateId)
      .then((m) => { if (current) setCohortMetrics(m); })
      .catch((err) => console.error('Failed to load cohort metrics', err));
    return () => { current = false; };
  }, [candidateId]);

  const openHistoryModal = async (job: Job, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistoryJob(job);
    setLoadingHistory(true);
    try {
      const res = await fetchApplicationHistory(job.id, job.candidate_id);
      setHistoryRecords(res.history);
    } catch {
      setHistoryRecords([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const trackedJobs = jobs.filter((j) => j.application !== null);
  const filteredTracked = trackedJobs.filter((j) => {
    if (filterStage === 'ALL') return true;
    return j.application?.status === filterStage;
  });

  const getStageBadge = (status: ApplicationStatus) => {
    switch (status) {
      case 'SAVED':
        return <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-xs font-semibold">Saved</span>;
      case 'REVIEWING':
        return <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-xs font-semibold">In Review</span>;
      case 'APPLIED':
        return <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs font-semibold">Applied</span>;
      case 'SCREENING':
        return <span className="bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded text-xs font-semibold">Screening</span>;
      case 'INTERVIEWING':
        return <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-xs font-semibold">Interviewing</span>;
      case 'OFFER':
        return <span className="bg-emerald-600 text-white px-2 py-0.5 rounded text-xs font-semibold">Offer Extended</span>;
      case 'REJECTED':
        return <span className="bg-rose-100 text-rose-800 px-2 py-0.5 rounded text-xs font-semibold">Rejected</span>;
      case 'WITHDRAWN':
        return <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-xs font-semibold">Withdrawn</span>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      {/* Cohort Funnel Summary Card */}
      {cohortMetrics && cohortMetrics.current_cohort && (
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-emerald-600" />
              <h3 className="font-bold text-slate-900 text-sm">
                Weekly Cohort Ledger (America/New_York)
              </h3>
              <span className="bg-emerald-50 text-emerald-800 font-mono text-xs font-semibold px-2.5 py-0.5 rounded-full border border-emerald-200">
                Current: {cohortMetrics.current_cohort.cohort_id}
              </span>
            </div>
            <p className="text-xs text-slate-500 font-mono">
              Window: {cohortMetrics.current_cohort.week_start_ny} to {cohortMetrics.current_cohort.week_end_ny}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2">
            {(cohortMetrics.cohort_funnel || []).slice(0, 1).map((item) => (
              <React.Fragment key={item.cohort_id}>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-center">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Discovered</div>
                  <div className="text-lg font-bold text-slate-800 font-mono">{item.total_discovered}</div>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-center">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Qualified READY</div>
                  <div className="text-lg font-bold text-emerald-700 font-mono">{item.ready_count}</div>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-center">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Applied</div>
                  <div className="text-lg font-bold text-blue-700 font-mono">{item.applied_count}</div>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-center">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Interviewing</div>
                  <div className="text-lg font-bold text-indigo-700 font-mono">{item.interviewing_count}</div>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-center">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Rejected</div>
                  <div className="text-lg font-bold text-rose-700 font-mono">{item.rejected_count}</div>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Header and Stage Filter */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <BookmarkCheck className="w-5 h-5 text-emerald-600" />
            Application Pipeline Tracker
          </h2>
          <p className="text-xs text-slate-500">Track and manage every stage of your job applications with full audit history</p>
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            aria-label="Filter by stage"
            value={filterStage}
            onChange={(e) => setFilterStage(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-700 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
          >
            <option value="ALL">All Stages ({trackedJobs.length})</option>
            <option value="SAVED">Saved</option>
            <option value="REVIEWING">In Review</option>
            <option value="SCREENING">Screening</option>
            <option value="WITHDRAWN">Withdrawn</option>
            <option value="APPLIED">Applied (manually recorded)</option>
            <option value="INTERVIEWING">Interviewing</option>
            <option value="OFFER">Offer</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
      </div>

      {operator && overdueCount > 0 && (
        <div role="status" className="p-3 bg-rose-50 border border-rose-200 text-rose-900 text-xs rounded-xl font-medium">
          {overdueCount} follow-up{overdueCount === 1 ? ' is' : 's are'} overdue. Contact those employers yourself, then set a new date or clear it.
        </div>
      )}
      {followUpError && <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-900 text-xs rounded-xl">{followUpError}</div>}

      {/* Tracked List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">
        {filteredTracked.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <BookmarkCheck className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="font-medium text-slate-700">No applications in this stage.</p>
            <p className="text-xs text-slate-400 mt-1">Explore the Discovery tab and click "Save" to add jobs here.</p>
          </div>
        ) : (
          filteredTracked.map((job) => (
            <div
              key={job.id}
              onClick={() => onSelectJob(job)}
              className="p-4 hover:bg-slate-50/80 cursor-pointer transition-colors flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-900">{job.title}</span>
                  {getStageBadge(job.application!.status)}
                  {job.application?.applied_cohort && (
                    <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-mono font-medium">
                      Cohort: {job.application.applied_cohort}
                    </span>
                  )}
                  {job.discovered_cohort && !job.application?.applied_cohort && (
                    <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-mono font-medium">
                      Discovered: {job.discovered_cohort}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Building className="w-3.5 h-3.5 text-slate-400" />
                  <span>{job.company}</span>
                  <span>•</span>
                  <span>Eligibility: {job.eligibility.classification}</span>
                  <span>•</span>
                  <span>Relevance: {job.score.overall_score}%</span>
                </div>
                {job.application?.notes && (
                  <p className="text-xs text-slate-600 bg-slate-50 px-2 py-1 rounded border border-slate-200 inline-block font-sans">
                    Notes: {job.application.notes}
                  </p>
                )}
                {job.application?.status === 'REJECTED' && (
                  <div className="text-xs text-rose-700 bg-rose-50 px-2.5 py-1 rounded border border-rose-200 mt-1">
                    <span className="font-semibold">Reason:</span> {job.application.rejection_reason_category} ({job.application.rejection_stage})
                    {job.application.rejection_notes && ` - "${job.application.rejection_notes}"`}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 self-end md:self-center">
                {job.application?.applied_at && (
                  <div className="text-[11px] text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Applied: {new Date(job.application.applied_at).toLocaleDateString()}
                  </div>
                )}
                {operator && (() => {
                  const st = followUpState(followUps[job.id], today);
                  const tone = st.key === 'overdue' ? 'bg-rose-100 text-rose-900' : st.key === 'today' ? 'bg-amber-100 text-amber-900' : st.key === 'soon' ? 'bg-sky-100 text-sky-900' : 'bg-slate-100 text-slate-800';
                  return (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <label className="text-[11px] text-slate-700 flex items-center gap-1">
                        <span>Follow up</span>
                        <input type="date" value={followUps[job.id] || ''} onChange={(e) => changeFollowUp(job.id, e.target.value)}
                          className="border border-slate-300 rounded px-1.5 py-1 text-xs text-slate-800 bg-white" aria-label={`Follow-up date for ${job.title} at ${job.company}`} />
                      </label>
                      {st.key !== 'none' && <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${tone}`}>{st.label}</span>}
                    </div>
                  );
                })()}
                <button
                  type="button"
                  onClick={(e) => openHistoryModal(job, e)}
                  title="View complete application audit timeline"
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-800 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <History className="w-3.5 h-3.5 text-slate-500" />
                  <span>History</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSelectJob(job)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-700 text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
                >
                  <span>Inspect</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Application History Modal */}
      {historyJob && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <History className="w-5 h-5 text-emerald-600" />
                  Application Stage History
                </h3>
                <p className="text-xs text-slate-500">{historyJob.title} • {historyJob.company}</p>
              </div>
              <button
                onClick={() => setHistoryJob(null)}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 overflow-y-auto flex-1 space-y-3">
              {loadingHistory ? (
                <div className="text-center py-8 text-xs text-slate-400">Loading audit history...</div>
              ) : historyRecords.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-400">No previous transitions recorded.</div>
              ) : (
                historyRecords.map((rec, idx) => (
                  <div key={rec.id || idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                        <span className="font-mono text-slate-500">{rec.previous_status || 'NONE'}</span>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-emerald-700 font-bold">{rec.new_status}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {new Date(rec.changed_at).toLocaleString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-slate-500">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3 text-slate-400" />
                        {rec.actor}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1 font-mono text-[10px]">
                        <Tag className="w-3 h-3 text-slate-400" />
                        {rec.source}
                      </span>
                    </div>

                    {rec.rejection_reason_category && (
                      <div className="bg-rose-50 border border-rose-200 p-2 rounded text-rose-700 text-[11px]">
                        <strong>Rejection Reason:</strong> {rec.rejection_reason_category}
                      </div>
                    )}

                    {rec.notes && (
                      <div className="text-slate-600 italic bg-white p-2 rounded border border-slate-100 text-[11px]">
                        "{rec.notes}"
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setHistoryJob(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
