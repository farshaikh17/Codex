import {
  Job,
  CandidateProfile,
  AnalyticsData,
  ApplicationStatus,
  ResumeImportResult,
  JobSource,
  WeeklyMetrics,
  IndiaRemoteSummary,
  IndiaRemoteResult,
  QualificationAuditRecord,
  QualificationStatus,
  ApplicationHistoryRecord,
  SyncConflict,
  ActivityLog,
  CohortMetrics,
  BackupRecord,
  AutomationConfig,
  AutomationStatus,
  AutomationRun,
  UrlCheckRecord,
  DiscoveryFunnelMetrics,
  SourceScorecardItem,
  CanonicalSyncStatus,
  CanonicalSyncPreview,
  CanonicalSyncResult,
  CanonicalSyncRun,
  CanonicalSyncConflict,
  DashboardOverviewData,
  CandidateStrategyMetrics,
  CandidateDashboardCard,
  PaginatedJobsResult
} from './types';

const API_BASE = '/api';

export function getSessionAuthKey(): string | null {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    return window.sessionStorage.getItem('admin_session_key');
  }
  return null;
}

export function setSessionAuthKey(key: string): void {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    window.sessionStorage.setItem('admin_session_key', key.trim());
  }
}

export function clearSessionAuthKey(): void {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    window.sessionStorage.removeItem('admin_session_key');
  }
}

export function isOperatorAuthenticated(): boolean {
  return Boolean(getSessionAuthKey());
}


export const OPERATOR_AUTH_EVENT = 'operator-auth-required';

// ---- Share links (read-only client view) ----------------------------------------------------------------------------
// A share link looks like https://<site>/#view=<token>&candidate=<id>. The part after '#' never reaches the server or its
// logs; it is read once, kept for this browser tab only, and removed from the address bar.
const VIEW_KEY = 'client_view_token', VIEW_CANDIDATE = 'client_view_candidate';
export function captureShareLink(): void {
  if (typeof window === 'undefined') return;
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const token = h.get('view'), cand = h.get('candidate');
  if (token && /^v1_[0-9a-f]{48}$/.test(token) && cand && /^[a-z][a-z0-9_]{2,39}$/.test(cand)) {
    try { window.sessionStorage.setItem(VIEW_KEY, token); window.sessionStorage.setItem(VIEW_CANDIDATE, cand); } catch {}
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}
export function getShareView(): { token: string; candidate: string } | null {
  try {
    const token = window.sessionStorage.getItem(VIEW_KEY), candidate = window.sessionStorage.getItem(VIEW_CANDIDATE);
    return token && candidate ? { token, candidate } : null;
  } catch { return null; }
}
export function clearShareView(): void {
  try { window.sessionStorage.removeItem(VIEW_KEY); window.sessionStorage.removeItem(VIEW_CANDIDATE); } catch {}
}

/** Public pages are read-only for visitors. A read sends no key unless the operator has unlocked; a write without a
 *  key never leaves the browser, it asks for the operator unlock instead. */
export async function authedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  const token = getSessionAuthKey();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const view = getShareView();
  if (view && !token && (method === 'GET' || method === 'HEAD')) headers.set('X-View-Token', view.token);
  const isWrite = method !== 'GET' && method !== 'HEAD';
  if (isWrite && !token && !headers.has('Authorization')) {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('operator-auth-required', { detail: { status: 401, write: true, hadKey: false, url: typeof input === 'string' ? input : input.toString() } }));
    throw new Error('Operator sign-in is required to change records.');
  }

  const response = await fetch(input, { ...init, headers });

  if ((response.status === 401 || response.status === 403) && typeof window !== 'undefined') {
    // write: ask for the unlock window. read: only matters when a stored key was refused (rotated/expired).
    window.dispatchEvent(new CustomEvent('operator-auth-required', { detail: { status: response.status, write: isWrite, hadKey: Boolean(token), url: typeof input === 'string' ? input : input.toString() } }));
  }
  return response;
}

/** Reads that only the operator may see (audit trails, run logs, sync and backup surfaces). A visitor gets an empty,
 *  clearly flagged result and no request is made. */
const restricted = <T extends object>(empty: T): T & { restricted: true } => ({ ...empty, restricted: true as const });


export async function verifyOperatorKey(key: string): Promise<{ status: string; role: string }> {
  const res = await fetch(`${API_BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: key.trim() })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Authentication failed');
  }
  const data = await res.json();
  setSessionAuthKey(key.trim());
  return data;
}

/** One check of the stored key per page load, before any data requests are fanned out. A stale key then costs a
 *  single refused attempt instead of one per parallel request. Returns 'ok', 'none', 'rejected' or 'locked'. */
let verifiedKey: string | null = null;
export async function checkStoredOperatorKey(): Promise<'ok' | 'none' | 'rejected' | 'locked' | 'unknown'> {
  const key = getSessionAuthKey();
  if (!key) return 'none';
  if (verifiedKey === key) return 'ok';
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
  } catch { return 'unknown'; }                       // network failure: keep the key, load the public view
  if (res.status === 429) return 'locked';
  if (res.status === 401 || res.status === 403) { clearSessionAuthKey(); verifiedKey = null; return 'rejected'; }
  if (!res.ok) return 'unknown';                      // a server hiccup must not sign the operator out
  verifiedKey = key;
  return 'ok';
}

export function logoutOperator(): void {
  verifiedKey = null;
  clearSessionAuthKey();
}

function getAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extraHeaders };
  const sessionKey = getSessionAuthKey();
  if (sessionKey) {
    headers['Authorization'] = `Bearer ${sessionKey}`;
  }
  return headers;
}

export async function fetchApplications(candidateId?: string): Promise<Job[]> {
  const url = candidateId ? `${API_BASE}/applications?candidate_id=${encodeURIComponent(candidateId)}` : `${API_BASE}/applications`;
  const res = await authedFetch(url);
  if (!res.ok) throw new Error('Unable to load tracker');
  return (await res.json()).applications;
}

export async function fetchPilot(): Promise<any> {
  if (!isOperatorAuthenticated()) return restricted({ available: false }) as any;
  const res = await authedFetch(`${API_BASE}/pilot`);
  if (!res.ok) throw new Error('Unable to load pilot');
  return res.json();
}

export async function fetchDashboardOverview(): Promise<DashboardOverviewData> {
  const res = await authedFetch(`${API_BASE}/dashboard/overview`);
  if (!res.ok) throw new Error('Failed to fetch dashboard overview');
  return res.json();
}

export async function fetchCandidateStrategy(candidateId: string): Promise<CandidateStrategyMetrics> {
  const res = await authedFetch(`${API_BASE}/candidates/${candidateId}/strategy`);
  if (!res.ok) throw new Error('Failed to fetch candidate strategy');
  return res.json();
}

export async function fetchCandidateDashboard(candidateId: string): Promise<CandidateDashboardCard> {
  const res = await authedFetch(`${API_BASE}/candidates/${candidateId}/dashboard`);
  if (!res.ok) throw new Error('Failed to fetch candidate dashboard');
  return res.json();
}

export async function fetchJobs(params?: {
  search?: string;
  eligibility?: string;
  min_score?: number;
  workplace_type?: string;
  application_status?: string;
  feedback_rating?: string;
  source_adapter?: string;
  qualification_status?: string;
  sort_by?: string;
  exclude_applied?: boolean;
  exclude_dismissed?: boolean;
  show_historical?: boolean;
  india_remote?: string;
  farhan_fit?: string;
  application_state?: string;
  role_family?: string;
  pay_filter?: string;
  candidate_id?: string;
  strategy_lane?: string;
  page?: number;
  limit?: number;
  offset?: number;
}): Promise<PaginatedJobsResult> {
  const query = new URLSearchParams();
  if (params?.search) query.append('search', params.search);
  if (params?.eligibility && params.eligibility !== 'ALL') query.append('eligibility', params.eligibility);
  if (params?.min_score !== undefined && params.min_score > 0) query.append('min_score', params.min_score.toString());
  if (params?.workplace_type && params.workplace_type !== 'ALL') query.append('workplace_type', params.workplace_type);
  if (params?.application_status && params.application_status !== 'ALL') query.append('application_status', params.application_status);
  if (params?.feedback_rating && params.feedback_rating !== 'ALL') query.append('feedback_rating', params.feedback_rating);
  if (params?.source_adapter && params.source_adapter !== 'ALL') query.append('source_adapter', params.source_adapter);
  if (params?.qualification_status && params.qualification_status !== 'ALL') query.append('qualification_status', params.qualification_status);
  if (params?.sort_by) query.append('sort_by', params.sort_by);
  if (params?.exclude_applied !== undefined) query.append('exclude_applied', String(params.exclude_applied));
  if (params?.exclude_dismissed !== undefined) query.append('exclude_dismissed', String(params.exclude_dismissed));
  if (params?.show_historical !== undefined) query.append('show_historical', String(params.show_historical));
  if (params?.india_remote && params.india_remote !== 'ALL') query.append('india_remote', params.india_remote);
  if (params?.farhan_fit && params.farhan_fit !== 'ALL') query.append('farhan_fit', params.farhan_fit);
  if (params?.application_state && params.application_state !== 'ALL') query.append('application_state', params.application_state);
  if (params?.role_family && params.role_family !== 'ALL') query.append('role_family', params.role_family);
  if (params?.pay_filter && params.pay_filter !== 'ALL') query.append('pay_filter', params.pay_filter);
  if (params?.candidate_id) query.append('candidate_id', params.candidate_id);
  if (params?.strategy_lane && params.strategy_lane !== 'ALL') query.append('strategy_lane', params.strategy_lane);
  
  const limit = params?.limit || 50;
  const offset = params?.offset !== undefined ? params.offset : (params?.page ? (params.page - 1) * limit : 0);
  query.append('limit', String(limit));
  query.append('offset', String(offset));

  const res = await authedFetch(`${API_BASE}/jobs?${query.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch jobs');
  const data = await res.json();
  return {
    count: data.count || (data.jobs ? data.jobs.length : 0),
    total: data.total !== undefined ? data.total : (data.count || (data.jobs ? data.jobs.length : 0)),
    limit: data.limit || limit,
    offset: data.offset || offset,
    status_counts: data.status_counts,
    jobs: data.jobs || []
  };
}

export async function fetchIndiaRemoteSummary(candidateId?: string): Promise<IndiaRemoteSummary> {
  const url = candidateId ? `${API_BASE}/india-remote/summary?candidate_id=${encodeURIComponent(candidateId)}` : `${API_BASE}/india-remote/summary`;
  const res = await authedFetch(url);
  if (!res.ok) throw new Error('Failed to fetch India Remote summary');
  return res.json();
}

export async function fetchIndiaRemoteJobs(params?: {
  farhan_fit?: string;
  role_family?: string;
  pay_filter?: string;
  search?: string;
  exclude_applied?: boolean;
  sort_by?: string;
  candidate_id?: string;
  limit?: number;
  offset?: number;
}): Promise<IndiaRemoteResult> {
  const query = new URLSearchParams();
  if (params?.candidate_id) query.append('candidate_id', params.candidate_id);
  if (params?.farhan_fit && params.farhan_fit !== 'ALL') query.append('farhan_fit', params.farhan_fit);
  if (params?.role_family && params.role_family !== 'ALL') query.append('role_family', params.role_family);
  if (params?.pay_filter && params.pay_filter !== 'ALL') query.append('pay_filter', params.pay_filter);
  if (params?.search) query.append('search', params.search);
  if (params?.exclude_applied !== undefined) query.append('exclude_applied', String(params.exclude_applied));
  if (params?.sort_by) query.append('sort_by', params.sort_by);
  query.append('limit', String(params?.limit ?? 25));
  query.append('offset', String(params?.offset ?? 0));

  const res = await authedFetch(`${API_BASE}/india-remote/jobs?${query.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch India Remote jobs');
  const data = await res.json();
  return {
    jobs: data.jobs || [],
    total: typeof data.total === 'number' ? data.total : (data.jobs || []).length,
    count: data.count ?? (data.jobs || []).length,
    limit: data.limit ?? (params?.limit ?? 25),
    offset: data.offset ?? (params?.offset ?? 0),
    facets: data.facets,
  };
}

export async function fetchJobDetail(jobId: string, candidateId?: string): Promise<Job> {
  const url = candidateId ? `${API_BASE}/jobs/${encodeURIComponent(jobId)}?candidate_id=${encodeURIComponent(candidateId)}` : `${API_BASE}/jobs/${encodeURIComponent(jobId)}`;
  const res = await authedFetch(url);
  if (!res.ok) throw new Error('Failed to fetch job detail');
  return res.json();
}

export async function fetchJobExplanation(jobId: string, candidateId?: string): Promise<any> {
  const url = candidateId ? `${API_BASE}/jobs/${encodeURIComponent(jobId)}/explanation?candidate_id=${encodeURIComponent(candidateId)}` : `${API_BASE}/jobs/${encodeURIComponent(jobId)}/explanation`;
  const res = await authedFetch(url);
  if (!res.ok) throw new Error('Failed to fetch job explanation');
  return res.json();
}

export async function submitJobFeedback(
  jobId: string,
  payload: { rating: 'UP' | 'DOWN' | 'CLEAR' | 'RESET'; notes?: string; tags?: string[] },
  candidateId?: string
): Promise<Job> {
  const res = await authedFetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/feedback`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ...payload, candidate_id: candidateId })
  });
  if (!res.ok) throw new Error('Failed to submit job feedback');
  const data = await res.json();
  return data.job;
}

export async function fetchProfile(candidateId?: string): Promise<CandidateProfile> {
  const url = candidateId ? `${API_BASE}/profile?candidate_id=${encodeURIComponent(candidateId)}` : `${API_BASE}/profile`;
  const res = await authedFetch(url);
  if (!res.ok) throw new Error('Failed to fetch profile');
  const data = await res.json();
  // The public summary omits operator-only fields; give the arrays a safe default so screens never fail on them.
  return { disqualifying_keywords: [], acceptable_hiring_models: [], primary_skills: [], secondary_skills: [], target_roles: [], ...data };
}

export async function updateProfile(profile: CandidateProfile, candidateId?: string): Promise<CandidateProfile> {
  const targetCid = candidateId || profile.id;
  const res = await authedFetch(`${API_BASE}/profile?candidate_id=${encodeURIComponent(targetCid)}`, {
    method: 'PUT',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(profile)
  });
  if (!res.ok) throw new Error('Failed to update profile');
  return res.json();
}

export async function importResume(rawText: string, applyToProfile: boolean = false): Promise<ResumeImportResult> {
  const res = await authedFetch(`${API_BASE}/profile/import-resume`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ raw_text: rawText, apply_to_profile: applyToProfile })
  });
  if (!res.ok) throw new Error('Failed to parse resume');
  return res.json();
}

export async function updateApplication(payload: {
  candidate_id?: string;
  job_id: string;
  status: ApplicationStatus;
  notes?: string;
  rejection_stage?: string;
  rejection_reason_category?: string;
  rejection_notes?: string;
}): Promise<Job> {
  const res = await authedFetch(`${API_BASE}/applications`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Failed to update application');
  return res.json();
}

export async function fetchAnalytics(candidateId?: string): Promise<AnalyticsData> {
  const url = candidateId ? `${API_BASE}/analytics?candidate_id=${encodeURIComponent(candidateId)}` : `${API_BASE}/analytics`;
  const res = await authedFetch(url);
  if (!res.ok) throw new Error('Failed to fetch analytics');
  return res.json();
}

export async function reloadSyntheticFixtures(): Promise<void> {
  const res = await authedFetch(`${API_BASE}/fixtures/reload`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to reload fixtures');
}

export async function fetchSources(): Promise<{ count: number; sources: JobSource[] }> {
  const res = await authedFetch(`${API_BASE}/sources`);
  if (!res.ok) throw new Error('Failed to fetch job sources');
  return res.json();
}

export async function syncSource(sourceId: string, live: boolean = false): Promise<any> {
  const res = await authedFetch(`${API_BASE}/sources/${encodeURIComponent(sourceId)}/sync`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ live })
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to sync source');
  }
  return res.json();
}

export async function updateSourceApproval(sourceId: string, approved: boolean): Promise<any> {
  const res = await authedFetch(`${API_BASE}/sources/${encodeURIComponent(sourceId)}/approval`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ approved })
  });
  if (!res.ok) throw new Error('Failed to update source approval');
  return res.json();
}

export async function fetchSourceLogs(sourceId: string): Promise<any> {
  if (!isOperatorAuthenticated()) return restricted({ logs: [] }) as any;
  const res = await authedFetch(`${API_BASE}/sources/${encodeURIComponent(sourceId)}/logs`);
  if (!res.ok) throw new Error('Failed to fetch source logs');
  return res.json();
}

export async function fetchWeeklyMetrics(candidateId?: string): Promise<WeeklyMetrics> {
  const url = candidateId ? `${API_BASE}/qualification/metrics?candidate_id=${encodeURIComponent(candidateId)}` : `${API_BASE}/qualification/metrics`;
  const res = await authedFetch(url);
  if (!res.ok) throw new Error('Failed to fetch weekly qualification metrics');
  return res.json();
}

export async function reverifyReadyJobs(): Promise<{
  status: string;
  result: {
    total_reverified: number;
    retained_ready: number;
    demoted_count: number;
    reverified_at: string;
  };
}> {
  const res = await authedFetch(`${API_BASE}/qualification/reverify`, {
    method: 'POST',
    headers: getAuthHeaders()
  });
  if (!res.ok) throw new Error('Failed to reverify READY jobs');
  return res.json();
}

export async function overrideJobQualification(
  jobId: string,
  status: QualificationStatus,
  reason: string,
  reviewer: string = 'Candidate',
  candidateId: string
): Promise<any> {
  const res = await authedFetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/qualification-override`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ status, reason, reviewer, candidate_id: candidateId })
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.detail || 'Failed to record manual qualification override');
  }
  return res.json();
}

export async function fetchQualificationAudit(jobId: string, candidateId: string): Promise<{
  job_id: string;
  count: number;
  audit_trail: QualificationAuditRecord[];
}> {
  if (!isOperatorAuthenticated()) return restricted({ job_id: '', count: 0, audit_trail: [] }) as any;
  const res = await authedFetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/qualification-audit?candidate_id=${encodeURIComponent(candidateId)}`);
  if (!res.ok) throw new Error('Failed to fetch qualification audit history');
  return res.json();
}

export async function fetchApplicationHistory(jobId: string, candidateId?: string): Promise<{
  job_id: string;
  count: number;
  history: ApplicationHistoryRecord[];
}> {
  const url = candidateId ? `${API_BASE}/applications/${encodeURIComponent(jobId)}/history?candidate_id=${encodeURIComponent(candidateId)}` : `${API_BASE}/applications/${encodeURIComponent(jobId)}/history`;
  if (!isOperatorAuthenticated()) return restricted({ job_id: '', count: 0, history: [] }) as any;
  const res = await authedFetch(url);
  if (!res.ok) throw new Error('Failed to fetch application history');
  return res.json();
}

export async function fetchCohortMetrics(candidateId?: string): Promise<CohortMetrics> {
  const url = candidateId ? `${API_BASE}/cohorts/metrics?candidate_id=${encodeURIComponent(candidateId)}` : `${API_BASE}/cohorts/metrics`;
  const res = await authedFetch(url);
  if (!res.ok) throw new Error('Failed to fetch cohort metrics');
  return res.json();
}

export async function fetchSyncConflicts(): Promise<{ count: number; conflicts: SyncConflict[] }> {
  if (!isOperatorAuthenticated()) return restricted({ count: 0, conflicts: [] }) as any;
  const res = await authedFetch(`${API_BASE}/sync/conflicts`);
  if (!res.ok) throw new Error('Failed to fetch sync conflicts');
  return res.json();
}

export async function fetchActivityLogs(): Promise<{ count: number; activity_logs: ActivityLog[] }> {
  if (!isOperatorAuthenticated()) return restricted({ count: 0, activity_logs: [] }) as any;
  const res = await authedFetch(`${API_BASE}/sync/activity-logs`);
  if (!res.ok) throw new Error('Failed to fetch activity logs');
  return res.json();
}

export async function fetchBackups(): Promise<{ count: number; backups: BackupRecord[] }> {
  if (!isOperatorAuthenticated()) return restricted({ count: 0, backups: [] }) as any;
  const res = await authedFetch(`${API_BASE}/backups`);
  if (!res.ok) throw new Error('Failed to fetch database backups');
  return res.json();
}

export async function createDatabaseBackup(): Promise<{ status: string; backup: BackupRecord }> {
  const res = await authedFetch(`${API_BASE}/backups/create`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to create database backup');
  return res.json();
}

export async function restoreDatabaseBackup(filename: string): Promise<{ status: string; result: any }> {
  const res = await authedFetch(`${API_BASE}/backups/restore`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ filename })
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to restore database backup');
  }
  return res.json();
}

export async function fetchAutomationStatus(): Promise<AutomationStatus> {
  const res = await authedFetch(`${API_BASE}/automation/status`);
  if (!res.ok) throw new Error('Failed to fetch automation status');
  return res.json();
}

export async function updateAutomationConfig(payload: {
  is_enabled?: boolean;
  interval_seconds?: number;
  verify_urls?: boolean;
  reverify_inventory?: boolean;
}): Promise<{ status: string; config: AutomationConfig }> {
  const res = await authedFetch(`${API_BASE}/automation/config`, {
    method: 'PUT',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Failed to update automation configuration');
  return res.json();
}

export async function pauseAutomation(): Promise<{ status: string; config: AutomationConfig }> {
  const res = await authedFetch(`${API_BASE}/automation/pause`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to pause automation');
  return res.json();
}

export async function resumeAutomation(): Promise<{ status: string; config: AutomationConfig }> {
  const res = await authedFetch(`${API_BASE}/automation/resume`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to resume automation');
  return res.json();
}

export async function triggerAutomation(live: boolean = false): Promise<{ status: string; summary: any }> {
  const res = await authedFetch(`${API_BASE}/automation/trigger`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ live })
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to trigger automation run');
  }
  return res.json();
}

export async function fetchAutomationRuns(limit: number = 20): Promise<{ count: number; runs: AutomationRun[] }> {
  if (!isOperatorAuthenticated()) return restricted({ count: 0, runs: [] }) as any;
  const res = await authedFetch(`${API_BASE}/automation/runs?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch automation execution runs');
  return res.json();
}

export async function fetchUrlChecks(limit: number = 30): Promise<{ count: number; checks: UrlCheckRecord[] }> {
  if (!isOperatorAuthenticated()) return restricted({ count: 0, checks: [] }) as any;
  const res = await authedFetch(`${API_BASE}/automation/url-checks?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch URL checks');
  return res.json();
}

export async function verifyReadyUrls(): Promise<{ status: string; result: any }> {
  const res = await authedFetch(`${API_BASE}/automation/verify-urls`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to verify READY application URLs');
  return res.json();
}

export async function fetchDiscoveryFunnel(candidateId: string): Promise<DiscoveryFunnelMetrics> {
  const res = await authedFetch(`${API_BASE}/analytics/discovery?candidate_id=${encodeURIComponent(candidateId)}`);
  if (!res.ok) throw new Error('Failed to fetch discovery funnel metrics');
  return res.json();
}

export async function fetchSourcesEffectiveness(candidateId: string): Promise<{ candidate_id?: string; sources: SourceScorecardItem[] }> {
  const res = await authedFetch(`${API_BASE}/analytics/sources-effectiveness?candidate_id=${encodeURIComponent(candidateId)}`);
  if (!res.ok) throw new Error('Failed to fetch source effectiveness scorecard');
  return res.json();
}

// ---------------------------------------------------------------------------
// Google Sheets Canonical Sync APIs
// ---------------------------------------------------------------------------

export async function fetchCanonicalSyncStatus(provider?: 'google_sheets' | 'file_fixture'): Promise<CanonicalSyncStatus> {
  const url = provider ? `${API_BASE}/canonical-sync/status?provider=${provider}` : `${API_BASE}/canonical-sync/status`;
  const res = await authedFetch(url);
  if (!res.ok) throw new Error('Failed to fetch canonical sync status');
  return res.json();
}

export async function previewCanonicalSync(direction: 'IMPORT' | 'PROPOSE', provider?: 'google_sheets' | 'file_fixture'): Promise<CanonicalSyncPreview> {
  const res = await authedFetch(`${API_BASE}/canonical-sync/preview`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ direction, provider })
  });
  if (!res.ok) throw new Error('Failed to generate sync preview');
  return res.json();
}

export async function executeCanonicalImport(dryRun: boolean = false, provider?: 'google_sheets' | 'file_fixture'): Promise<CanonicalSyncResult> {
  const res = await authedFetch(`${API_BASE}/canonical-sync/import`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ dry_run: dryRun, provider })
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to execute canonical import');
  }
  return res.json();
}

export async function executeCanonicalPropose(dryRun: boolean = false, provider?: 'google_sheets' | 'file_fixture'): Promise<CanonicalSyncResult> {
  const res = await authedFetch(`${API_BASE}/canonical-sync/propose`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ dry_run: dryRun, provider })
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to execute proposal staging');
  }
  return res.json();
}

export async function fetchCanonicalSyncHistory(limit: number = 30): Promise<{ count: number; history: CanonicalSyncRun[] }> {
  const res = await authedFetch(`${API_BASE}/canonical-sync/history?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch canonical sync history');
  return res.json();
}

export async function fetchCanonicalSyncConflicts(limit: number = 30): Promise<{ count: number; conflicts: CanonicalSyncConflict[] }> {
  const res = await authedFetch(`${API_BASE}/canonical-sync/conflicts?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch sync conflicts');
  return res.json();
}

export async function switchCanonicalTransport(provider: 'google_sheets' | 'file_fixture'): Promise<{ status: string; active_provider: string }> {
  const res = await authedFetch(`${API_BASE}/canonical-sync/switch-transport`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ provider })
  });
  if (!res.ok) throw new Error('Failed to switch transport provider');
  return res.json();
}

// Phase 10 Real Canonical Google Ledger API Endpoints
export async function fetchOAuthStatus(): Promise<any> {
  const res = await authedFetch(`${API_BASE}/canonical-sync/oauth/status`);
  if (!res.ok) throw new Error('Failed to fetch OAuth status');
  return res.json();
}

export async function getOAuthAuthorizeUrl(): Promise<any> {
  const res = await authedFetch(`${API_BASE}/canonical-sync/oauth/authorize-url`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to create authorization URL');
  return res.json();
}

export async function oauthLogout(): Promise<any> {
  const res = await authedFetch(`${API_BASE}/canonical-sync/oauth/logout`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to logout');
  return res.json();
}

export async function discoverCanonicalWorkbook(): Promise<any> {
  const res = await authedFetch(`${API_BASE}/canonical-sync/workbook/discover`);
  if (!res.ok) throw new Error('Failed to discover workbook');
  return res.json();
}

export async function verifyCanonicalSchema(): Promise<any> {
  const res = await authedFetch(`${API_BASE}/canonical-sync/workbook/verify-schema`);
  if (!res.ok) throw new Error('Failed to verify workbook schema');
  return res.json();
}

export async function inspectWorkbookTab(name: string): Promise<any> {
  const res = await authedFetch(`${API_BASE}/canonical-sync/workbook/tab?name=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Failed to inspect tab ${name}`);
  return res.json();
}

export async function runCanonicalImportDryRun(): Promise<any> {
  const res = await authedFetch(`${API_BASE}/canonical-sync/dry-run/import`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to run import dry run');
  return res.json();
}

export async function runCanonicalProposeDryRun(): Promise<any> {
  const res = await authedFetch(`${API_BASE}/canonical-sync/dry-run/propose`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to run propose dry run');
  return res.json();
}

export async function fetchRulesComparisonReport(): Promise<any> {
  const res = await authedFetch(`${API_BASE}/canonical-sync/rules/comparison`);
  if (!res.ok) throw new Error('Failed to fetch rules comparison');
  return res.json();
}







// ---- Clients (operator) and exports ---------------------------------------------------------------------------------
export type ClientSearchProfile = { role_keywords: string[]; avoid_keywords: string[]; location_mode: 'REMOTE_FROM_HOME' | 'HOME_OR_RELOCATE'; home_country: string };
export type ClientRecord = {
  id: string; full_name: string; builtin: boolean; visibility: 'public' | 'private'; display_title: string | null; summary_line: string | null;
  current_location: string | null; primary_timezone: string | null; total_years_experience: number | null; qualification_threshold: number;
  primary_skills: string[]; search_profile: ClientSearchProfile | null; active_share_links: number; jobs_screened: number; apply_worthy: number;
};
export type CandidateRef = { id: string; full_name: string; display_title?: string; builtin?: boolean; visibility?: 'public' | 'private' };

async function jsonOrThrow(res: Response, what: string) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || `${what} failed (${res.status})`);
  return data;
}
export async function fetchCandidateList(): Promise<CandidateRef[]> {
  const res = await authedFetch(`${API_BASE}/candidates`);
  if (!res.ok) throw new Error('Unable to load candidates');
  return res.json();
}
export async function fetchClients(): Promise<ClientRecord[]> {
  return (await jsonOrThrow(await authedFetch(`${API_BASE}/clients`), 'Loading clients')).clients;
}
export async function createClient(body: any): Promise<ClientRecord> {
  return (await jsonOrThrow(await authedFetch(`${API_BASE}/clients`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 'Creating the client')).client;
}
export async function updateClient(id: string, body: any): Promise<ClientRecord> {
  return (await jsonOrThrow(await authedFetch(`${API_BASE}/clients/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 'Saving the client')).client;
}
export async function backfillClient(id: string): Promise<{ inserted: number; more: boolean }> {
  return jsonOrThrow(await authedFetch(`${API_BASE}/clients/${encodeURIComponent(id)}/backfill?limit=200`, { method: 'POST' }), 'Screening jobs');
}
export type ShareLink = { link_id: string; label: string | null; created_at: string; revoked_at: string | null };
export async function fetchShareLinks(id: string): Promise<ShareLink[]> {
  return (await jsonOrThrow(await authedFetch(`${API_BASE}/clients/${encodeURIComponent(id)}/share-links`), 'Loading share links')).share_links;
}
export async function createShareLink(id: string, label: string): Promise<{ token: string; path: string; link_id: string }> {
  return jsonOrThrow(await authedFetch(`${API_BASE}/clients/${encodeURIComponent(id)}/share-links`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) }), 'Creating the link');
}
export async function revokeShareLink(id: string, linkId: string): Promise<void> {
  await jsonOrThrow(await authedFetch(`${API_BASE}/clients/${encodeURIComponent(id)}/share-links/${encodeURIComponent(linkId)}`, { method: 'DELETE' }), 'Revoking the link');
}
/** Downloads the CSV through authedFetch, so the operator key or the share link applies to it like to any other read. */
export async function downloadExport(candidateId: string, qualificationStatus = 'ALL'): Promise<void> {
  const res = await authedFetch(`${API_BASE}/export?candidate_id=${encodeURIComponent(candidateId)}&qualification_status=${encodeURIComponent(qualificationStatus)}`);
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || d.detail || 'Export failed'); }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || `${candidateId}-jobs.csv`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
