export type EligibilityClassification = 'ELIGIBLE' | 'INELIGIBLE' | 'UNKNOWN';
export type EpistemicStatus = 'VERIFIED_FACT' | 'INFERRED' | 'UNKNOWN';
export type WorkplaceType = 'REMOTE_GLOBAL' | 'REMOTE_RESTRICTED' | 'HYBRID' | 'ONSITE' | 'UNKNOWN';
export type ApplicationStatus = 'SAVED' | 'REVIEWING' | 'APPLIED' | 'SCREENING' | 'INTERVIEWING' | 'OFFER' | 'REJECTED' | 'WITHDRAWN';
export type QualificationStatus = 'DISCOVERED' | 'NEEDS_REVIEW' | 'READY' | 'READY_HIGH' | 'STRETCH_READY' | 'INELIGIBLE' | 'HOLD' | 'CLOSED' | 'APPLIED';

export interface IndiaRemoteSummary {
  total_confirmed: number;
  ready_count: number;
  stretch_count: number;
  review_count: number;
  not_fit_count: number;
  applied_count: number;
}

export interface SkillMatchDetail {
  skill: string;
  canonical: string;
  matched_as: string;
  importance: 'PRIMARY' | 'SECONDARY';
  evidence: string;
}

export interface SeniorityAssessment {
  job_seniority: string;
  candidate_seniority: string;
  seniority_status: string;
  seniority_fit_score: number;
}

export interface ExperienceAssessment {
  status: string;
  score: number;
  min_years_required: number | null;
  max_years_required: number | null;
  candidate_years: number;
  evidence_quote: string | null;
  explanation: string;
}

export interface HardRequirementsAssessment {
  disqualified_by_keyword: boolean;
  disqualifier_hit: string | null;
  is_ineligible_geo: boolean;
  passes_all_hard_requirements: boolean;
}

export interface FeedbackModifierAssessment {
  status: string;
  adjustment: number;
}

export interface ScoreBreakdown {
  matched_primary_skills: string[];
  missing_primary_skills: string[];
  matched_secondary_skills: string[];
  missing_secondary_skills: string[];
  primary_ratio: number;
  secondary_ratio: number;
  role_matched: boolean;
  matched_role_name: string | null;
  calculation_formula: string;
  skill_matches_detailed?: SkillMatchDetail[];
  extra_job_skills?: string[];
  seniority_assessment?: SeniorityAssessment;
  experience_assessment?: ExperienceAssessment;
  hard_requirements?: HardRequirementsAssessment;
  feedback_modifier?: FeedbackModifierAssessment;
}

export interface JobEligibility {
  classification: EligibilityClassification;
  epistemic_status: EpistemicStatus;
  evidence_quote: string | null;
  reasoning: string;
  detected_hiring_model: string;
}

export interface JobScore {
  overall_score: number;
  skill_score: number;
  role_score: number;
  score_breakdown: ScoreBreakdown;
}

export interface JobFeedback {
  rating: 'UP' | 'DOWN' | 'THUMBS_UP' | 'THUMBS_DOWN';
  notes: string | null;
  tags: string[];
  updated_at: string;
}

export interface ApplicationRecord {
  id: string;
  candidate_id?: string;
  status: ApplicationStatus;
  applied_at: string | null;
  applied_cohort?: string | null;
  application_channel?: string | null;
  resume_version?: string | null;
  cover_letter_path?: string | null;
  notes?: string | null;
  rejection_stage?: string | null;
  rejection_reason_category?: string | null;
  rejection_notes?: string | null;
}

export interface Job {
  assessment_conflict?: boolean;
  provenance?: string;
  id: string;
  title: string;
  company: string;
  company_url: string | null;
  company_headquarters: string | null;
  source_adapter: string;
  source_url: string;
  original_posting_url: string | null;
  employment_type: string;
  workplace_type: WorkplaceType;
  location_restrictions: string | null;
  description: string;
  required_skills: string[];
  salary_published: boolean;
  salary_currency: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_period: string | null;
  salary_raw_text: string | null;
  discovered_at: string;
  last_verified_at: string | null;
  is_active: boolean;
  expired_at?: string | null;
  source_id?: string | null;
  qualification_status?: QualificationStatus;
  qualification_reason?: string | null;
  qualified_at?: string | null;
  discovered_cohort?: string | null;
  canonical_url_hash?: string | null;
  duplicate_of?: string | null;
  last_reverified_at?: string | null;
  manual_override_status?: string | null;
  manual_override_reason?: string | null;
  is_potentially_relevant?: boolean;
  retrieval_stage?: 'RELEVANT' | 'EXCLUDED_ROLE' | 'LOW_KEYWORD_OVERLAP';
  retrieval_reasons?: string[];
  eligibility: JobEligibility;
  score: JobScore;
  feedback?: JobFeedback | null;
  application: ApplicationRecord | null;
  // Multi-Candidate Strategy Lane
  strategy_lane?: 'STRONGEST_FIT' | 'BRIDGE' | 'DREAM' | 'NOT_FIT';
  candidate_id?: string;
  // 3 Explicit Dimensions
  remote_from_india?: 'CONFIRMED' | 'UNKNOWN' | 'NO';
  farhan_fit?: 'READY' | 'STRETCH' | 'REVIEW' | 'NOT_FIT';
  application_state?: 'NEW' | 'SAVED' | 'APPLIED' | 'INTERVIEW' | 'REJECTED' | 'WITHDRAWN';
  india_evidence?: string | null;
  review_reason?: string | null;
  role_family?: string | null;
}

export type StrategyLane = 'STRONGEST_FIT' | 'BRIDGE' | 'DREAM' | 'NOT_FIT';

export interface CandidateStrategyDistribution {
  strongest_fit: number;
  bridge: number;
  dream: number;
}

export interface CandidateStrategyMetrics {
  candidate_id: string;
  target_distribution: CandidateStrategyDistribution;
  actual_discovery_distribution: CandidateStrategyDistribution;
  actual_ready_distribution: CandidateStrategyDistribution;
  ready_count: number;
  stretch_count: number;
  review_count: number;
  applied_count: number;
  total_inventory: number;
}

export interface CandidateDashboardCard {
  candidate_id: string;
  full_name: string;
  education?: string;
  current_location?: string;
  ready_count: number;
  stretch_count: number;
  review_count: number;
  applied_count: number;
  application_records?: number;
  display_title?: string;
  education_short?: string;
  summary_line?: string;
  pay_line?: string;
  counts_scope?: string;
  target_distribution: CandidateStrategyDistribution;
  actual_discovery_distribution: CandidateStrategyDistribution;
  actual_ready_distribution: CandidateStrategyDistribution;
}

export interface DashboardOverviewData {
  farhan: CandidateDashboardCard;
  sana: CandidateDashboardCard;
  total_jobs_tracked: number;
  active_jobs_count: number;
  automation_status: string;
}

export interface CandidateProfile {
  id: string;
  full_name: string;
  education?: string;
  current_location: string;
  citizenship: string;
  primary_timezone: string;
  target_roles: string[];
  primary_skills: string[];
  secondary_skills: string[];
  acceptable_hiring_models: string[];
  min_acceptable_salary_usd: number | null;
  min_fixed_monthly_inr: number | null;
  preferred_inr_range?: string | null;
  notice_period_days?: number | null;
  location_preferences?: string[];
  relocation_interest?: boolean;
  work_authorization?: string[];
  profile_basis: string;
  disqualifying_keywords: string[];
  total_years_experience?: number;
  years_basis?: string;
  display_title?: string;
  education_short?: string;
  summary_line?: string;
  pay_line?: string;
  employment_history?: { role: string; employer: string; from: string; to: string | null; note?: string }[];
  target_seniorities?: string[];
  raw_resume_text?: string | null;
  qualification_threshold?: number;
  /** true when this is the public summary (read-only; operator-only fields are absent) */
  public_view?: boolean;
}

export interface QualificationAuditRecord {
  id: number;
  job_id: string;
  previous_status: string;
  new_status: string;
  reason: string;
  reviewer: string;
  created_at: string;
}

export interface WeeklyMetrics {
  weekly_research_target: number;
  new_qualified_this_week: number;
  still_open_ready_inventory: number;
  ready_inventory?: number;
  stretch_ready_inventory?: number;
  total_apply_worthy?: number;
  target_progress_percentage: number;
  qualification_threshold: number;
  timezone: string;
  current_week_start_ny: string;
  current_week_end_ny: string;
  now_ny: string;
  status_distribution: Record<string, number>;
  disclaimer: string;
}

export interface ResumeImportResult {
  status: 'parsed_preview' | 'applied';
  parsed: {
    full_name: string;
    seniority: string;
    total_years_experience: number;
    detected_skills: string[];
    primary_skills: string[];
    secondary_skills: string[];
    detected_roles: string[];
    suggested_profile: Partial<CandidateProfile>;
  };
  suggested_profile?: Partial<CandidateProfile>;
  updated_profile?: CandidateProfile;
}

export interface AnalyticsData {
  total_jobs: number;
  eligibility_counts: {
    ELIGIBLE: number;
    INELIGIBLE: number;
    UNKNOWN: number;
  };
  application_counts: Record<string, number>;
  feedback_counts?: Record<string, number>;
  average_match_score: number;
  salary_transparency_rate: number;
}

export interface JobSource {
  id: string;
  name: string;
  adapter_type: 'fixture' | 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters' | 'workable';
  organization_slug: string;
  feed_url: string;
  documentation_url: string;
  permitted_method: string;
  rate_limit_policy: string;
  careers_url?: string | null;
  india_hiring_evidence?: string | null;
  is_active: number | boolean;
  is_live_approved: number | boolean;
  last_polled_at?: string;
  last_status: 'SUCCESS' | 'ERROR' | 'IDLE' | 'RATE_LIMITED';
  last_error?: string;
  last_latency_ms: number;
  total_jobs_fetched: number;
  active_jobs_count: number;
  live_job_count?: number;
}

export interface DiscoveryFunnelMetrics {
  candidate_id?: string;
  scope?: string;
  as_of?: string;
  stretch_ready_jobs?: number;
  total_employers: number;
  scanned_employers: number;
  total_scanned_jobs: number;
  potentially_relevant_jobs: number;
  retrieval_stages: Record<string, number>;
  geographic_eligibility: {
    ELIGIBLE: number;
    UNKNOWN: number;
    INELIGIBLE: number;
  };
  eligible_score_distribution: {
    high_match_70_plus: number;
    moderate_match_50_69: number;
    low_match_under_50: number;
  };
  ready_jobs: number;
  applications: {
    total: number;
    breakdown: Record<string, number>;
  };
  conversion_rates: {
    relevance_rate_pct: number;
    eligibility_rate_pct: number;
    qualification_rate_pct: number;
    overall_funnel_efficiency_pct: number;
  };
}

export interface SourceScorecardItem {
  source_id: string;
  source_name: string;
  adapter_type: string;
  organization_slug: string;
  feed_url: string | null;
  monitored?: boolean;
  last_success_at?: string | null;
  consecutive_failures?: number;
  careers_url?: string | null;
  india_hiring_evidence?: string | null;
  is_active: boolean;
  is_live_approved: boolean;
  last_polled_at?: string | null;
  last_status: string;
  last_error?: string | null;
  last_latency_ms: number | null;
  total_jobs: number;
  relevant_jobs: number;
  eligible_jobs: number;
  unknown_jobs: number;
  ineligible_jobs: number;
  high_match_jobs: number;
  ready_jobs: number;
  applications_count: number;
  interviews_count: number;
  rejections_count: number;
  conversion_pct: number;
}

export interface ApplicationHistoryRecord {
  id: number;
  candidate_id?: string;
  job_id: string;
  application_id?: string;
  previous_status: string | null;
  new_status: string;
  stage?: string;
  rejection_stage?: string | null;
  rejection_reason_category?: string | null;
  rejection_notes?: string | null;
  notes?: string | null;
  actor: string;
  source: string;
  recorded_at?: string;
  changed_at: string;
}

export interface SyncConflict {
  id: number;
  job_id: string;
  source_id?: string | null;
  detected_at: string;
  conflict_type: string;
  local_state: Record<string, any>;
  remote_state: Record<string, any>;
  resolution_applied: string;
  resolved_at: string;
}

export interface ActivityLog {
  id: number;
  timestamp: string;
  action_type: string;
  entity_type: string;
  entity_id: string;
  details?: Record<string, any>;
}

export interface CohortItem {
  cohort_id: string;
  total_discovered: number;
  ready_count: number;
  review_count: number;
  ineligible_count: number;
  active_count: number;
  closed_count: number;
  total_tracked: number;
  applied_count: number;
  interviewing_count: number;
  offer_count: number;
  rejected_count: number;
  application_conversion_rate: number;
}

export interface CohortMetrics {
  current_cohort: {
    cohort_id: string;
    label: string;
    week_start_ny: string;
    week_end_ny: string;
    week_start_iso: string;
    week_end_iso: string;
    sunday_date: string;
  };
  timezone: string;
  cohort_funnel: CohortItem[];
  total_cohorts_tracked: number;
}

export interface BackupRecord {
  filename: string;
  size_bytes: number;
  created_at: string;
  is_valid: boolean;
}

export interface AutomationConfig {
  id: number;
  is_enabled: number | boolean;
  interval_seconds: number;
  verify_urls: number | boolean;
  reverify_inventory: number | boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  status: 'IDLE' | 'RUNNING' | 'PAUSED';
  consecutive_failures: number;
  updated_at: string;
}

export interface AutomationStatus {
  coverage?: { multi_employer_sources: number; direct_employer_sources: number; employers_discovered: number; broad_listings: number };
  config: AutomationConfig;
  latest_run: AutomationRun | null;
  is_active: boolean;
  automation_state: string;
  last_discovery_run: AutomationRun | null;
  last_successful_run: AutomationRun | null;
  next_scheduled_discovery: string;
  last_weekly_refresh: AutomationRun | null;
  current_run_status: string;
  last_error: string | null;
  schedules: {
    discovery: string;
    weekly_refresh: string;
    server_startup: string;
  };
}

export interface AutomationRun {
  id: number;
  run_type: 'SCHEDULED' | 'MANUAL_TRIGGER' | 'URL_VERIFICATION';
  started_at: string;
  completed_at: string | null;
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'ABORTED' | 'RUNNING';
  duration_ms: number;
  sources_polled: number;
  jobs_seen: number;
  jobs_new: number;
  jobs_updated: number;
  jobs_unchanged: number;
  jobs_expired: number;
  ready_reverified: number;
  urls_checked: number;
  dead_urls_found: number;
  cpu_user_seconds: number;
  memory_peak_mb: number;
  error_message?: string | null;
}

export interface UrlCheckRecord {
  id: number;
  job_id: string;
  title?: string;
  company?: string;
  url: string;
  http_status: number | null;
  is_alive: number | boolean;
  latency_ms: number;
  error_message?: string | null;
  checked_at: string;
}

export interface CanonicalSyncStatus {
  is_connected: boolean;
  provider: 'google_sheets' | 'file_fixture';
  status_display: 'CONNECTED' | 'NOT CONNECTED' | 'TEST FIXTURE ACTIVE';
  details: {
    message?: string;
    spreadsheet_id?: string;
    credentials_found?: boolean;
    auth_method_pending?: string;
    master_file?: string;
    staging_file?: string;
    mode?: string;
  };
  last_import_at: string | null;
  last_propose_at: string | null;
  conflicts_count: number;
  pending_ready_to_propose: number;
  staged_proposals_count: number;
}

export interface CanonicalSyncPreview {
  direction: 'IMPORT' | 'PROPOSE';
  is_dry_run: boolean;
  total_canonical_records: number;
  total_local_records: number;
  to_import_new: any[];
  to_update_applications: any[];
  to_propose: any[];
  conflicts: any[];
  warnings: string[];
  unchanged_count: number;
}

export interface CanonicalSyncResult {
  run_id: number;
  direction: 'IMPORT' | 'PROPOSE';
  transport_type: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  is_dry_run: boolean;
  records_seen: number;
  records_imported: number;
  records_updated: number;
  records_proposed: number;
  conflicts_detected: number;
  errors: string[];
  summary: string;
  completed_at: string;
}

export interface CanonicalSyncRun {
  id: number;
  direction: 'IMPORT' | 'PROPOSE';
  transport_type: string;
  is_dry_run: number | boolean;
  status: string;
  records_seen: number;
  records_changed: number;
  conflicts_count: number;
  summary: string;
  details_json?: string;
  started_at: string;
  completed_at: string | null;
}

export interface CanonicalSyncConflict {
  id: number;
  job_id: string;
  title?: string;
  company?: string;
  conflict_type: string;
  local_value: string;
  remote_value: string;
  resolution: string;
  resolution_reason: string;
  detected_at: string;
}



export interface PaginatedJobsResult {
  count: number;
  total: number;
  limit: number;
  offset: number;
  status_counts?: {
    READY: number;
    STRETCH_READY: number;
    NEEDS_REVIEW: number;
    INELIGIBLE: number;
    HOLD: number;
  };
  jobs: Job[];
}
