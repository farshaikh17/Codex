import React, { useState, useEffect, useRef } from 'react';
import { isQuickScreen } from '../quickScreen';
import { peopleSearchLinks, skillGaps, isAutoShortlisted, withoutAutoMark } from '../jobHelpers';
import { sourceWord, whyText } from './JobTable';
import { Job, ApplicationStatus, QualificationStatus, QualificationAuditRecord } from '../types';
import { submitJobFeedback, fetchJobFeedback, canUseTracker, isTrackerOpen, overrideJobQualification, fetchQualificationAudit, fetchApplicationHistory } from '../api';
import { ApplicationHistoryRecord } from '../types';
import { 
  X, 
  CheckCircle2, 
  XCircle, 
  HelpCircle, 
  ExternalLink, 
  Building, 
  MapPin, 
  Calendar, 
  Bookmark, 
  Briefcase,
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
  Sparkles,
  ShieldAlert,
  GraduationCap,
  Clock,
  ShieldCheck,
  History
} from 'lucide-react';

interface JobDetailModalProps {
  job: Job;
  onClose: () => void;
  onUpdateApplication: (payload: {
    job_id: string;
    status: ApplicationStatus;
    notes?: string;
    rejection_stage?: string;
    rejection_reason_category?: string;
    rejection_notes?: string;
  }) => Promise<void>;
  onJobUpdated?: (updatedJob: Job) => void;
  profileSkills?: string[];   // the candidate's listed skills, for the "what the posting asks that the profile does not list" note
}

export const JobDetailModal: React.FC<JobDetailModalProps> = ({
  job: initialJob,
  onClose,
  onUpdateApplication,
  onJobUpdated,
  profileSkills
}) => {
  const [job, setJob] = useState<Job>(initialJob);
  const [status, setStatus] = useState<ApplicationStatus>(job.application?.status || 'SAVED');
  const [notes, setNotes] = useState<string>(job.application?.notes || '');
  const [rejectionStage, setRejectionStage] = useState<string>(job.application?.rejection_stage || 'RESUME_SCREEN');
  const [rejectionReason, setRejectionReason] = useState<string>(job.application?.rejection_reason_category || 'LOCATION_VISA_BARRIER');
  const [rejectionNotes, setRejectionNotes] = useState<string>(job.application?.rejection_notes || '');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState('');
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [activeEvidenceSkill, setActiveEvidenceSkill] = useState<string | null>(null);

  // Manual Override state
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState<QualificationStatus>((job.qualification_status as QualificationStatus) || 'READY');
  const [overrideReason, setOverrideReason] = useState('');
  const [isSubmittingOverride, setIsSubmittingOverride] = useState(false);
  const [auditTrail, setAuditTrail] = useState<QualificationAuditRecord[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const [appHistory, setAppHistory] = useState<ApplicationHistoryRecord[]>([]);
  const [isLoadingAppHistory, setIsLoadingAppHistory] = useState(false);
  const [showAppHistory, setShowAppHistory] = useState(false);

  const loadAuditHistory = async () => {
    setIsLoadingAudit(true);
    try {
      const res = await fetchQualificationAudit(job.id, job.candidate_id || '');
      setAuditTrail(res.audit_trail);
    } catch {
      setAuditTrail([]);
    } finally {
      setIsLoadingAudit(false);
    }
  };

  const loadAppHistory = async () => {
    setIsLoadingAppHistory(true);
    try {
      const res = await fetchApplicationHistory(job.id, job.candidate_id);
      setAppHistory(res.history || []);
    } catch {
      setAppHistory([]);
    } finally {
      setIsLoadingAppHistory(false);
    }
  };

  const handleOpenOverride = () => {
    setOverrideStatus((job.qualification_status as QualificationStatus) || 'READY');
    setOverrideReason('');
    setShowOverrideDialog(true);
    loadAuditHistory();
  };

  const handleSaveOverride = async () => {
    if (!overrideReason.trim()) return;
    setIsSubmittingOverride(true);
    try {
      await overrideJobQualification(job.id, overrideStatus, overrideReason.trim(), 'Candidate', job.candidate_id || '');
      const updatedJob: Job = {
        ...job,
        qualification_status: overrideStatus,
        farhan_fit: overrideStatus === 'READY' ? 'READY' : overrideStatus === 'STRETCH_READY' ? 'STRETCH' : overrideStatus === 'NEEDS_REVIEW' ? 'REVIEW' : 'NOT_FIT',
        manual_override_status: overrideStatus,
        manual_override_reason: overrideReason.trim(),
        qualification_reason: `Manual override by operator: ${overrideReason.trim()}`
      };
      setJob(updatedJob);
      if (onJobUpdated) onJobUpdated(updatedJob);
      setShowOverrideDialog(false);
    } catch (err: any) {
      alert(err.message || 'Failed to record override');
    } finally {
      setIsSubmittingOverride(false);
    }
  };

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setJob(initialJob); }, [initialJob]);
  // The thumbs rating is stored per job (private, operator only): load it when the panel opens so a reload shows what was chosen.
  useEffect(() => {
    if (!canUseTracker()) return;
    let current = true;
    fetchJobFeedback(initialJob.id, initialJob.candidate_id).then((f) => { if (current && f) setJob((j) => ({ ...j, feedback: f as any })); }).catch(() => {});
    return () => { current = false; };
  }, [initialJob.id, initialJob.candidate_id]);
  // The draft stage and notes reset only when the job changes or its SAVED values change, not on every fresh copy of the job (a thumbs click, a list refresh):
  // typed notes were wiped by those.
  useEffect(() => {
    setStatus(initialJob.application?.status || 'SAVED');
    setNotes(initialJob.application?.notes || '');
  }, [initialJob.id, initialJob.application?.status, initialJob.application?.notes]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const elements = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, a[href]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [onClose]);

  const handleSaveStatus = async () => {
    setSaveError('');
    setIsSaving(true);
    try {
      await onUpdateApplication({
        job_id: job.id,
        status,
        notes,
        rejection_stage: status === 'REJECTED' ? rejectionStage : undefined,
        rejection_reason_category: status === 'REJECTED' ? rejectionReason : undefined,
        rejection_notes: status === 'REJECTED' ? rejectionNotes : undefined,
      });
    } catch {
      setSaveError("Could not save. Your edits are still here; please retry.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleFeedback = async (rating: 'UP' | 'DOWN' | 'CLEAR') => {
    setFeedbackLoading(true);
    try {
      const updated = await submitJobFeedback(job.id, { rating }, job.candidate_id);
      setJob(updated);
      if (onJobUpdated) onJobUpdated(updated);
    } catch (err) {
      console.error("Feedback error", err);
    } finally {
      setFeedbackLoading(false);
    }
  };

  const breakdown = job.score.breakdown ?? job.score.score_breakdown;
  const detailedSkillMatches = breakdown?.skill_matches_detailed || [];
  const seniorityAssessment = breakdown?.seniority_assessment;
  const experienceAssessment = breakdown?.experience_assessment;
  const hardRequirements = breakdown?.hard_requirements;
  const feedbackModifier = breakdown?.feedback_modifier;
  // A discovery row has only the quick screen (matched skills, no seniority/experience/coverage). Showing the full panel's defaults for it
  // ("no skills", "0% primary", "no explicit minimum") contradicted the list, so those parts are replaced by what the screen really knows.
  const quickScreen = isQuickScreen(breakdown);
  const quickSkills = breakdown?.matched_skills || [];
  const gaps = skillGaps(job.description || '', profileSkills);
  const people = peopleSearchLinks(job.company || '');

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Job inspection" className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-start justify-between bg-slate-50/50">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                {job.id}
              </span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                {job.source_adapter.toUpperCase()} ADAPTER
              </span>
              {job.discovered_cohort && (
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                  COHORT {job.discovered_cohort}
                </span>
              )}
              {job.canonical_url_hash && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-500" title={`Canonical Hash: ${job.canonical_url_hash}`}>
                  #{job.canonical_url_hash.slice(0, 8)}
                </span>
              )}
              <span className="text-[11px] text-amber-700 font-semibold px-2 py-0.5 rounded bg-amber-50 border border-amber-200">
                {job.source_adapter === 'fixture' ? 'SYNTHETIC FIXTURE' : ['jobicy','remotive','hnjobs'].includes(job.source_adapter) ? 'PUBLIC LISTING — EMPLOYER NOT VERIFIED' : `FOUND ON ${sourceWord(job.source_adapter).toUpperCase()} — REVIEW REQUIRED`}
              </span>
            </div>
            <h2 className="text-xl font-bold text-slate-900">{job.title}</h2>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
              <span className="flex items-center gap-1 font-medium text-slate-700">
                <Building className="w-3.5 h-3.5" />
                {job.company}
              </span>
              {job.company_headquarters && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {job.company_headquarters}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                Discovered: {new Date(job.discovered_at).toLocaleDateString()}
              </span>
            </div>
          </div>
          <button
            aria-label="Close job inspection" onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-6">

          {/* Section 0: Strict READY-to-Apply Qualification Card */}
          <div className={`p-4 rounded-xl border ${
            job.qualification_status === 'READY'
              ? 'bg-emerald-50/50 border-emerald-300'
              : job.qualification_status === 'NEEDS_REVIEW'
              ? 'bg-amber-50/50 border-amber-300'
              : job.qualification_status === 'INELIGIBLE'
              ? 'bg-rose-50/50 border-rose-300'
              : 'bg-slate-50 border-slate-300'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-700" />
                <h3 className="font-bold text-sm text-slate-900">
                  Application Qualification: <span className="font-mono font-extrabold">{job.qualification_status || 'DISCOVERED'}</span>
                </h3>
              </div>
              <button
                onClick={handleOpenOverride}
                className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 flex items-center gap-1.5 shadow-sm transition-colors self-start sm:self-auto"
              >
                <History className="w-3.5 h-3.5 text-slate-500" />
                Override / Audit Trail
              </button>
            </div>

            <p className="text-xs text-slate-700 mb-2 leading-relaxed">
              <strong className="text-slate-900">Reason:</strong> {job.qualification_reason ? whyText(withoutAutoMark(job.qualification_reason)) : 'Under review against qualification criteria.'}
            </p>

            {job.manual_override_status && (
              <div className="p-2 bg-purple-50 rounded-lg border border-purple-200 text-xs mb-2">
                <span className="font-bold text-purple-900 block">Candidate Override Active:</span>
                <span className="text-purple-800 italic">"{job.manual_override_reason}"</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 pt-2 border-t border-slate-200/60">
              {job.qualified_at && (
                <span>Qualified at: {new Date(job.qualified_at).toLocaleString()}</span>
              )}
              {job.last_reverified_at && (
                <span>Last reverified: {new Date(job.last_reverified_at).toLocaleTimeString()}</span>
              )}
              <span className="ml-auto text-emerald-800 font-medium" data-testid="status-source">{!job.manual_override_status && isAutoShortlisted(job.qualification_reason) ? 'Shortlisted by the daily screen (moves back to To review if it stops qualifying)' : 'Recorded qualification status'}</span>
            </div>
          </div>

          {/* Section 1: Remote-India Eligibility Card */}
          <div className={`p-4 rounded-xl border ${
            job.eligibility.classification === 'ELIGIBLE' 
              ? 'bg-emerald-50/40 border-emerald-200' 
              : job.eligibility.classification === 'INELIGIBLE' 
              ? 'bg-rose-50/40 border-rose-200' 
              : 'bg-amber-50/40 border-amber-200'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {job.eligibility.classification === 'ELIGIBLE' && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
                {job.eligibility.classification === 'INELIGIBLE' && <XCircle className="w-5 h-5 text-rose-600" />}
                {job.eligibility.classification === 'UNKNOWN' && <HelpCircle className="w-5 h-5 text-amber-600" />}
                <h3 className="font-bold text-sm text-slate-900">
                  India Remote Posting Scope: {job.eligibility.classification}
                </h3>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded font-semibold bg-white border border-slate-200 text-slate-700">
                {job.eligibility.classification === 'UNKNOWN' ? 'UNCONFIRMED' : 'POSTING TEXT ONLY'}
              </span>
            </div>

            <p className="text-xs text-slate-700 mb-2 leading-relaxed">
              {job.eligibility.reason}
            </p>

            {job.eligibility.evidence_text && job.eligibility.evidence_text !== job.eligibility.reason && (
              <div className="mt-2 p-2.5 bg-white rounded-lg border border-slate-200 text-xs">
                <span className="font-semibold text-slate-500 uppercase text-[10px] block mb-1">
                  Recorded basis (automated screen of the posting text):
                </span>
                <p className="text-slate-800 text-[11px] bg-slate-50 p-2 rounded border-l-2 border-emerald-500">
                  {job.eligibility.evidence_text}
                </p>
              </div>
            )}

            <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <span className="font-medium text-slate-500">Hiring model evidence:</span>
              <span className="font-mono bg-white px-2 py-0.5 rounded border border-slate-200 text-[11px]">
                {(job.eligibility.detected_hiring_model || 'UNKNOWN').replace(/_/g, ' ')}
              </span>
            </div>
          </div>

          {/* Section 2: Phase 3 Explainable Candidate Relevance Score Card */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-emerald-600" />
                <h3 className="font-bold text-sm text-slate-900">Explainable Match Score Breakdown</h3>
              </div>
              <div className="flex items-center gap-3">
                {/* User Feedback Buttons */}
                <div className="flex items-center bg-white border border-slate-200 rounded-lg p-0.5 shadow-sm">
                  <button
                    onClick={() => handleFeedback(job.feedback?.rating === 'THUMBS_UP' || job.feedback?.rating === 'UP' ? 'CLEAR' : 'UP')}
                    disabled={feedbackLoading}
                    title="Thumbs Up: a good match. Similar jobs move a little higher."
                    aria-pressed={job.feedback?.rating === 'THUMBS_UP' || job.feedback?.rating === 'UP'}
                    className={`px-2.5 py-1 text-xs rounded flex items-center gap-1 transition-colors ${
                      job.feedback?.rating === 'THUMBS_UP' || job.feedback?.rating === 'UP'
                        ? 'bg-emerald-100 text-emerald-800 font-bold'
                        : 'text-slate-600 hover:text-emerald-700 hover:bg-slate-50'
                    }`}
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    <span>Good match</span>
                  </button>
                  <button
                    onClick={() => handleFeedback(job.feedback?.rating === 'THUMBS_DOWN' || job.feedback?.rating === 'DOWN' ? 'CLEAR' : 'DOWN')}
                    disabled={feedbackLoading}
                    title="Thumbs Down: not for me. Hides this job (you can undo it); similar jobs move a little lower."
                    aria-pressed={job.feedback?.rating === 'THUMBS_DOWN' || job.feedback?.rating === 'DOWN'}
                    className={`px-2.5 py-1 text-xs rounded flex items-center gap-1 transition-colors ${
                      job.feedback?.rating === 'THUMBS_DOWN' || job.feedback?.rating === 'DOWN'
                        ? 'bg-rose-100 text-rose-800 font-bold'
                        : 'text-slate-600 hover:text-rose-700 hover:bg-slate-50'
                    }`}
                  >
                    <ThumbsDown className="w-3.5 h-3.5" />
                    <span>Not for me</span>
                  </button>
                  {job.feedback && (
                    <button
                      onClick={() => handleFeedback('CLEAR')}
                      disabled={feedbackLoading}
                      title="Reset Feedback"
                      className="px-1.5 py-1 text-xs text-slate-400 hover:text-slate-700 rounded"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <div className="text-right pl-2">
                  <span className="text-2xl font-black font-mono text-emerald-700">
                    {job.score.overall_score}%
                  </span>
                  <span className="text-[11px] text-slate-500 block -mt-1 font-medium">Relevance</span>
                </div>
              </div>
            </div>

            {/* Feedback & Disqualifier Notice */}
            {feedbackModifier && feedbackModifier.adjustment !== 0 && (
              <div className={`p-2 rounded-lg text-xs flex items-center gap-2 ${
                feedbackModifier.adjustment > 0 ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}>
                <Sparkles className="w-4 h-4 flex-shrink-0" />
                <span>
                  {feedbackModifier.adjustment > 0 ? '+15 Ranking Bonus' : '-40 Ranking Penalty'} applied via your personal feedback.
                </span>
              </div>
            )}

            {hardRequirements && !hardRequirements.passes_all_hard_requirements && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 flex-shrink-0" />
                <span>
                  {hardRequirements.disqualified_by_keyword 
                    ? `Hard requirement flag triggered: "${hardRequirements.disqualifier_hit}". Overall score capped at 10.`
                    : 'Classified as geographically INELIGIBLE. Match score capped at 10.'}
                </span>
              </div>
            )}

            {quickScreen && (
              <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-2 text-xs" data-testid="quick-screen">
                <div className="font-semibold text-slate-700">Quick screen <span className="font-normal text-slate-500">(full review not done yet)</span></div>
                <div>
                  <span className="text-slate-500 block mb-1">Skills found in the posting:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {quickSkills.length > 0
                      ? quickSkills.map((k) => <span key={k} className="px-2 py-0.5 rounded font-mono text-[11px] bg-emerald-100 text-emerald-800">✓ {k}</span>)
                      : <span className="text-slate-400 italic">None of the stored skills were found in the text</span>}
                  </div>
                </div>
                <p className="text-slate-500">Seniority, years required and skill coverage are not assessed yet, so they are not shown instead of being guessed.</p>
              </div>
            )}

            {/* Explainability Grid: Seniority + Experience */}
            {!quickScreen && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {/* Seniority Assessment */}
              <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-1">
                <div className="flex items-center justify-between text-slate-500 font-medium">
                  <span className="flex items-center gap-1 text-slate-700">
                    <GraduationCap className="w-3.5 h-3.5 text-blue-600" />
                    Seniority Alignment
                  </span>
                  <span className="font-mono text-[11px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                    {seniorityAssessment?.seniority_fit_score ?? 100}% Fit
                  </span>
                </div>
                <div className="text-slate-800 font-semibold flex items-center gap-1.5">
                  <span>Job: {seniorityAssessment?.job_seniority || 'MID'}</span>
                  <span className="text-slate-400">vs</span>
                  <span>Target: {seniorityAssessment?.candidate_seniority || 'SENIOR'}</span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Role Match: {breakdown?.role_matched ? `✓ ${breakdown.matched_role_name}` : '○ Cross-domain alignment'}
                </div>
              </div>

              {/* Experience Assessment */}
              <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-1">
                <div className="flex items-center justify-between text-slate-500 font-medium">
                  <span className="flex items-center gap-1 text-slate-700">
                    <Clock className="w-3.5 h-3.5 text-amber-600" />
                    Experience Requirement
                  </span>
                  <span className={`font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded ${
                    experienceAssessment?.status === 'MET' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {experienceAssessment?.status || 'MET'}
                  </span>
                </div>
                <div className="text-slate-800 font-semibold">
                  {experienceAssessment?.min_years_required ? `${experienceAssessment.min_years_required}+ yrs required` : 'No explicit minimum'} (Candidate: {experienceAssessment?.candidate_years ? `${experienceAssessment.candidate_years} yrs` : 'documented in brief'})
                </div>
                {experienceAssessment?.evidence_quote && (
                  <p className="text-[10px] text-slate-500 italic truncate" title={experienceAssessment.evidence_quote}>
                    "{experienceAssessment.evidence_quote}"
                  </p>
                )}
              </div>
            </div>
            )}

            {/* Skills Alignment & Evidence Quotations */}
            {!quickScreen && (
            <div className="space-y-3 pt-2 text-xs">
              <div>
                <span className="font-semibold text-slate-700 block mb-1">
                  Matched Skills (Click any skill to view verbatim quotation from posting):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {detailedSkillMatches.length > 0 ? (
                    detailedSkillMatches.map((m) => (
                      <button
                        key={m.skill}
                        onClick={() => setActiveEvidenceSkill(activeEvidenceSkill === m.skill ? null : m.skill)}
                        className={`px-2 py-0.5 rounded font-mono text-[11px] transition-all flex items-center gap-1 ${
                          activeEvidenceSkill === m.skill
                            ? 'bg-emerald-600 text-white font-bold shadow-sm'
                            : m.importance === 'PRIMARY'
                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                        }`}
                      >
                        <span>✓ {m.skill}</span>
                        {m.canonical !== m.skill && <span className="opacity-70 text-[10px]">({m.canonical})</span>}
                      </button>
                    ))
                  ) : (
                    <span className="text-slate-400 italic">No specific required skills matched</span>
                  )}
                </div>

                {/* Verbatim Snippet Drawer */}
                {activeEvidenceSkill && (
                  <div className="mt-2 p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-lg animate-in fade-in duration-150">
                    <span className="font-semibold text-emerald-900 text-[11px] block mb-1">
                      Evidence Citation for "{activeEvidenceSkill}":
                    </span>
                    <blockquote className="font-mono text-[11px] text-slate-800 bg-white p-2 rounded border border-emerald-200">
                      {detailedSkillMatches.find(m => m.skill === activeEvidenceSkill)?.evidence || 'Mentioned in posting text.'}
                    </blockquote>
                  </div>
                )}
              </div>

              {/* Missing Skills */}
              {breakdown?.missing_primary_skills && breakdown.missing_primary_skills.length > 0 && (
                <div>
                  <span className="font-medium text-slate-500 block mb-1">Unmatched Candidate Primary Skills:</span>
                  <div className="flex flex-wrap gap-1">
                    {breakdown.missing_primary_skills.map((s) => (
                      <span key={s} className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono text-[11px]">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 text-[11px] text-slate-400 border-t border-slate-200 flex items-center justify-between">
                <span>Model: {breakdown?.calculation_formula || 'Deterministic Multi-Factor Scorer'}</span>
                <span>Skills Ratio: {Math.round((breakdown?.primary_ratio || 0) * 100)}% Primary</span>
              </div>
            </div>
            )}
          </div>

          {/* Section 3: Compensation & Employment Structure */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-white border border-slate-200 rounded-lg">
              <span className="text-slate-500 font-medium block mb-1">Published Compensation:</span>
              {job.salary_published ? (
                <div className="font-semibold text-emerald-700 text-sm">
                  {job.salary_raw_text}
                </div>
              ) : (
                <div className="text-slate-400 italic">
                  Not Disclosed in Posting
                </div>
              )}
            </div>

            <div className="p-3 bg-white border border-slate-200 rounded-lg">
              <span className="text-slate-500 font-medium block mb-1">Employment Type:</span>
              <div className="font-semibold text-slate-800">
                {job.employment_type || 'Unknown employment type'} ({(job.workplace_type || 'UNKNOWN').replace(/_/g, ' ')})
              </div>
            </div>
          </div>

          {/* Skill gap: what the posting names (from a fixed list of skills) against what the profile lists. A note to think about, not a verdict. */}
          {gaps.asked.length > 0 && (
            <div data-testid="skill-gaps">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">Skills the posting names</h4>
              <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-2 text-xs">
                {gaps.have.length > 0 && (
                  <div>
                    <span className="text-slate-700 block mb-1">Already on the profile:</span>
                    <div className="flex flex-wrap gap-1.5">{gaps.have.map((k) => <span key={k} className="px-2 py-0.5 rounded font-mono text-[11px] bg-emerald-100 text-emerald-900">✓ {k}</span>)}</div>
                  </div>
                )}
                {gaps.missing.length > 0 && (
                  <div>
                    <span className="text-slate-700 block mb-1">Not on the profile (worth a look before applying):</span>
                    <div className="flex flex-wrap gap-1.5">{gaps.missing.map((k) => <span key={k} className="px-2 py-0.5 rounded font-mono text-[11px] bg-amber-100 text-amber-900">{k}</span>)}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* People: ready-made searches the candidate opens and uses personally; nothing is sent from here. */}
          {people.length > 0 && (
            <div data-testid="people-links">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">Find people at {job.company}</h4>
              <div className="flex flex-wrap gap-2">
                {people.map((l) => (
                  <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer" title={l.hint}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5">
                    {l.label}<ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                ))}
              </div>
              <p className="text-xs text-slate-600 mt-1.5">Opens a LinkedIn search in a new tab. Reaching out is up to you.</p>
            </div>
          )}

          {/* Section 4: Full Job Description */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">
              Full Job Description
            </h4>
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700 whitespace-pre-line leading-relaxed font-sans max-h-60 overflow-y-auto">
              {job.description}
            </div>
          </div>

          {/* Section 5: Application Pipeline Management */}
          <div className="p-4 bg-white border-2 border-emerald-500/20 rounded-xl space-y-3">
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Bookmark className="w-4 h-4 text-emerald-600" />
              Manage Application Pipeline
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">Pipeline Stage:</label>
                <select aria-label="Pipeline stage"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ApplicationStatus)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="SAVED">Saved for Review</option>
                  <option value="REVIEWING">In Review</option>
                  <option value="APPLIED">Applied (Manual Submission)</option>
                  <option value="SCREENING">Screening Call</option>
                  <option value="INTERVIEWING">Technical Interviews</option>
                  <option value="OFFER">Offer Extended</option>
                  <option value="REJECTED">Rejected / Closed</option>
                  <option value="WITHDRAWN">Withdrawn</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">{isTrackerOpen() ? 'Notes (anyone with the link to this site can read these):' : 'Private Candidate Notes:'}</label>
                <input
                  type="text"
                  aria-label="Private candidate notes" placeholder="e.g. Applied via email, tailored resume v2..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>

            {/* Rejection Specifics if status is REJECTED */}
            {status === 'REJECTED' && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg space-y-2 text-xs">
                <span className="font-semibold text-rose-800 block">Rejection Outcome Tracking:</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-slate-600 block">Rejection Stage:</label>
                    <select
                      value={rejectionStage}
                      onChange={(e) => setRejectionStage(e.target.value)}
                      className="w-full border border-rose-300 rounded px-2 py-1 text-xs bg-white"
                    >
                      <option value="RESUME_SCREEN">Resume Screen</option>
                      <option value="INITIAL_CALL">Recruiter / Initial Call</option>
                      <option value="TECHNICAL_TEST">Technical Assignment</option>
                      <option value="FINAL_ROUND">Final Round Interview</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-600 block">Primary Reason Category:</label>
                    <select
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      className="w-full border border-rose-300 rounded px-2 py-1 text-xs bg-white"
                    >
                      <option value="LOCATION_VISA_BARRIER">Location / Legal Barrier</option>
                      <option value="TECH_STACK_GAP">Tech Stack Gap</option>
                      <option value="COMPENSATION_MISMATCH">Compensation Mismatch</option>
                      <option value="HEADCOUNT_FROZEN">Headcount Frozen / Role Cancelled</option>
                      <option value="GHOSTED">Ghosted / No Reply</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-slate-600 block">Rejection Feedback Notes:</label>
                  <input
                    type="text"
                    placeholder="Specific feedback received..."
                    value={rejectionNotes}
                    onChange={(e) => setRejectionNotes(e.target.value)}
                    className="w-full border border-rose-300 rounded px-2 py-1 text-xs bg-white"
                  />
                </div>
              </div>
            )}

            <p className="text-xs text-slate-500">Pipeline stages are manual records. Applied does not verify employer receipt.</p>
            {saveError && <p role="alert" className="text-xs text-rose-700">{saveError}</p>}
            {/* Application Stage History View */}
            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-slate-600 uppercase flex items-center gap-1">
                  <History className="w-3 h-3 text-slate-500" />
                  Application Stage History ({job.candidate_id || 'Candidate'})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (!showAppHistory) loadAppHistory();
                    setShowAppHistory(!showAppHistory);
                  }}
                  className="text-[11px] text-emerald-700 hover:text-emerald-900 font-semibold underline"
                >
                  {showAppHistory ? 'Hide History' : 'View History'}
                </button>
              </div>

              {showAppHistory && (
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5 mb-2 text-xs">
                  {isLoadingAppHistory ? (
                    <span className="text-slate-400 italic">Loading application history...</span>
                  ) : appHistory.length === 0 ? (
                    <span className="text-slate-400 italic">No previous application transitions recorded for this job.</span>
                  ) : (
                    <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                      {appHistory.map((h) => (
                        <div key={h.id} className="p-2 bg-white rounded border border-slate-200 text-[10px]">
                          <div className="flex justify-between font-bold text-slate-700">
                            <span>{h.previous_status || 'NONE'} → {h.new_status}</span>
                            <span className="text-slate-400 font-normal">{h.changed_at || h.recorded_at}</span>
                          </div>
                          {h.notes && <p className="text-slate-600 mt-0.5">Notes: "{h.notes}"</p>}
                          {h.rejection_stage && (
                            <p className="text-rose-600 mt-0.5">
                              Rejection: {h.rejection_stage} ({h.rejection_reason_category}) {h.rejection_notes && `- "${h.rejection_notes}"`}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleSaveStatus}
                disabled={isSaving}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
              >
                {isSaving ? 'Updating...' : 'Update Pipeline Status'}
              </button>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs">
          <div className="text-slate-400">
            Source URL: <span className="font-mono truncate max-w-[200px] inline-block">{job.source_url}</span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={job.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 font-medium"
            >
              <span>Visit Source Posting</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* Manual Override Sub-dialog */}
        {showOverrideDialog && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl border border-slate-200 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Override Qualification Status
                </h4>
                <button 
                  onClick={() => setShowOverrideDialog(false)}
                  className="text-slate-400 hover:text-slate-700 font-bold text-sm"
                >
                  ✕
                </button>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Target Qualification Status:</label>
                <select
                  value={overrideStatus}
                  onChange={(e) => setOverrideStatus(e.target.value as QualificationStatus)}
                  className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                >
                  <option value="READY">READY (Approve for Application)</option>
                  <option value="NEEDS_REVIEW">NEEDS_REVIEW (Keep Uncertain)</option>
                  <option value="INELIGIBLE">INELIGIBLE (Exclude Role)</option>
                  <option value="CLOSED">CLOSED (Delisted / Closed)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Candidate Justification (Required):</label>
                <textarea
                  rows={3}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="State the verified evidence justifying this status change..."
                  className="w-full text-xs border border-slate-300 rounded-lg p-2.5"
                />
              </div>

              <div className="pt-2 border-t border-slate-100">
                <span className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Audit Trail History:</span>
                {isLoadingAudit ? (
                  <span className="text-xs text-slate-400">Loading audit history...</span>
                ) : auditTrail.length === 0 ? (
                  <span className="text-xs text-slate-400 italic">No previous manual overrides on record.</span>
                ) : (
                  <div className="max-h-28 overflow-y-auto space-y-1.5 pr-1">
                    {auditTrail.map((entry) => (
                      <div key={entry.id} className="p-2 rounded bg-slate-50 border border-slate-200 text-[10px]">
                        <div className="flex justify-between font-bold text-slate-700">
                          <span>{entry.previous_status} → {entry.new_status}</span>
                          <span className="text-slate-400 font-normal">{entry.created_at}</span>
                        </div>
                        <p className="text-slate-600 italic">"{entry.reason}"</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  onClick={() => setShowOverrideDialog(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveOverride}
                  disabled={isSubmittingOverride || overrideReason.trim().length < 3}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors"
                >
                  {isSubmittingOverride ? 'Saving...' : 'Save Override'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
