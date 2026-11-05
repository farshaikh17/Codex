import React, { useState, useEffect } from 'react';
import { JobSource, BackupRecord, SyncConflict, ActivityLog } from '../types';
import { 
  fetchSources, 
  syncSource, 
  updateSourceApproval, 
  fetchBackups, 
  createDatabaseBackup, 
  restoreDatabaseBackup, 
  fetchSyncConflicts, 
  fetchActivityLogs 
} from '../api';
import { 
  Radio, 
  ShieldCheck, 
  RefreshCw, 
  ExternalLink, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Lock,
  Layers,
  Database,
  History,
  Archive,
  RotateCcw,
  AlertOctagon,
  FileCheck
} from 'lucide-react';

interface SourcesViewProps {
  onSyncComplete?: () => void;
}

export const SourcesView: React.FC<SourcesViewProps> = ({ onSyncComplete }) => {
  const [subTab, setSubTab] = useState<'feeds' | 'backups' | 'audit'>('feeds');
  const [sources, setSources] = useState<JobSource[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Backup state
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [restoringFile, setRestoringFile] = useState<string | null>(null);

  // Conflicts and audit logs
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);

  const loadSources = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchSources();
      setSources(data.sources);
    } catch (err: any) {
      setErrorMessage(err.message || 'Unable to load registered sources.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadBackups = async () => {
    try {
      const res = await fetchBackups();
      setBackups(res.backups);
    } catch (err: any) {
      console.error('Failed to load backups', err);
    }
  };

  const loadAuditData = async () => {
    try {
      const [conflictsRes, logsRes] = await Promise.all([
        fetchSyncConflicts(),
        fetchActivityLogs()
      ]);
      setConflicts(conflictsRes.conflicts || []);
      setActivityLogs(logsRes.activity_logs || (logsRes as any).logs || []);
    } catch (err: any) {
      console.error('Failed to load audit data', err);
    }
  };

  useEffect(() => {
    loadSources();
    loadBackups();
    loadAuditData();
  }, []);

  const handleToggleApproval = async (source: JobSource) => {
    const nextApproved = !Boolean(source.is_live_approved);
    setErrorMessage(null);
    try {
      await updateSourceApproval(source.id, nextApproved);
      setActionMessage(`Updated approval for '${source.name}': ${nextApproved ? 'Approved' : 'Revoked'}`);
      await loadSources();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update source approval.');
    }
  };

  const handleSyncSource = async (source: JobSource) => {
    setSyncingId(source.id);
    setErrorMessage(null);
    setActionMessage(null);
    try {
      const isLive = Boolean(source.is_live_approved);
      const res = await syncSource(source.id, isLive);
      setActionMessage(
        `Synced '${source.name}': ${res.jobs_seen} seen, ${res.jobs_new} new, ${res.jobs_updated} updated, ${res.jobs_expired} expired (${res.duration_ms}ms).`
      );
      await loadSources();
      await loadAuditData();
      if (onSyncComplete) onSyncComplete();
    } catch (err: any) {
      setErrorMessage(err.message || `Sync failed for '${source.name}'.`);
      await loadSources();
    } finally {
      setSyncingId(null);
    }
  };

  const handleCreateBackup = async () => {
    setIsCreatingBackup(true);
    setErrorMessage(null);
    setActionMessage(null);
    try {
      const res = await createDatabaseBackup();
      setActionMessage(`Transactional SQLite backup created: ${res.backup.filename} (${(res.backup.size_bytes / 1024).toFixed(1)} KB)`);
      await loadBackups();
      await loadAuditData();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create database backup.');
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleRestoreBackup = async (filename: string) => {
    if (!window.confirm(`Are you sure you want to restore ${filename}? A pre-restore safety snapshot will be created automatically before replacing the database.`)) {
      return;
    }
    setRestoringFile(filename);
    setErrorMessage(null);
    setActionMessage(null);
    try {
      await restoreDatabaseBackup(filename);
      setActionMessage(`Database restored successfully from ${filename}. Pre-restore backup archived.`);
      await loadSources();
      await loadBackups();
      await loadAuditData();
      if (onSyncComplete) onSyncComplete();
    } catch (err: any) {
      setErrorMessage(err.message || `Failed to restore ${filename}`);
    } finally {
      setRestoringFile(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Radio className="w-6 h-6 text-emerald-600" />
            Job Sync, Access Control & Database Integrity
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Manage ATS feeds, transactional SQLite backups, conflict resolution, and data safety.
          </p>
        </div>

        {/* Tab Controls & Refresh */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setSubTab('feeds')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
                subTab === 'feeds' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Feeds ({sources.length})</span>
            </button>
            <button
              onClick={() => { setSubTab('backups'); loadBackups(); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
                subTab === 'backups' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Backups ({backups.length})</span>
            </button>
            <button
              onClick={() => { setSubTab('audit'); loadAuditData(); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
                subTab === 'audit' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Sync Conflicts ({conflicts.length})</span>
            </button>
          </div>

          <button
            onClick={() => { loadSources(); loadBackups(); loadAuditData(); }}
            disabled={isLoading}
            className="p-2 text-slate-500 hover:text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors"
            title="Refresh Registry and Logs"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Status Messages */}
      {actionMessage && (
        <div className="p-4 bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded-xl flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Subtab 1: ATS Sources */}
      {subTab === 'feeds' && (
        <div className="space-y-4">
          <div className="p-4 bg-emerald-50/70 border border-emerald-200/80 rounded-xl flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-emerald-950 space-y-1">
              <p className="font-semibold text-emerald-900">Zero-Scraping & Ethical Discovery Safeguards</p>
              <p className="text-emerald-800 leading-relaxed">
                All discovery adapters strictly target official, public employer ATS APIs (Greenhouse Harvest, Lever Postings) or offline synthetic test fixtures. 
                No logins, credentials, CAPTCHA bypasses, or rate limit evasions are ever attempted. All candidate data and evaluation remain 100% local.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sources.map((source) => {
              const isApproved = Boolean(source.is_live_approved);
              const isSyncing = syncingId === source.id;
              const isFixture = source.adapter_type === 'fixture';

              return (
                <div
                  key={source.id}
                  className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4 hover:border-slate-300 transition-colors flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-slate-900 text-base">{source.name}</h3>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded font-semibold uppercase bg-slate-100 text-slate-700">
                            {source.adapter_type}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">{source.id}</p>
                      </div>

                      <div>
                        {source.last_status === 'SUCCESS' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Healthy{typeof source.last_latency_ms === 'number' ? ` (${source.last_latency_ms}ms)` : ' (latency not measured)'}
                          </span>
                        ) : source.last_status === 'ERROR' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 px-2.5 py-1 rounded-full border border-rose-200">
                            <XCircle className="w-3.5 h-3.5" />
                            Error
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            Idle
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 text-xs bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <div>
                        <span className="font-semibold text-slate-700">Permitted Method:</span>{' '}
                        <span className="text-slate-600 font-mono text-[11px]">{source.permitted_method}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-700">Rate Limit Policy:</span>{' '}
                        <span className="text-slate-600">{source.rate_limit_policy}</span>
                      </div>
                      <div className="truncate">
                        <span className="font-semibold text-slate-700">Feed URL:</span>{' '}
                        <span className="text-slate-500 font-mono text-[11px] select-all">{source.feed_url}</span>
                      </div>
                      <div className="pt-1 flex items-center gap-3">
                        {source.careers_url && (
                          <a
                            href={source.careers_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-700 hover:text-emerald-800 font-medium inline-flex items-center gap-1 text-[11px] underline"
                          >
                            <span>Careers Page</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        <a
                          href={source.documentation_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-600 hover:text-slate-900 font-medium inline-flex items-center gap-1 text-[11px] underline"
                        >
                          <span>Official API Docs</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      {source.india_hiring_evidence && (
                        <div className="pt-1.5 border-t border-slate-200/60">
                          <span className="font-semibold text-slate-700 block text-[11px]">India Footprint Evidence:</span>
                          <span className="text-slate-600 text-[11px] leading-relaxed">{source.india_hiring_evidence}</span>
                        </div>
                      )}
                    </div>

                    {source.last_error && (
                      <div className="p-2.5 bg-rose-50 border border-rose-200 rounded text-[11px] text-rose-700 font-mono">
                        {source.last_error}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 pt-1">
                      <div className="flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-slate-400" />
                        <span>Active Postings: <strong>{source.live_job_count || source.active_jobs_count || 0}</strong></span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-400 text-[11px]">
                        <Clock className="w-3 h-3" />
                        <span>Last Synced: {source.last_polled_at ? new Date(source.last_polled_at).toLocaleTimeString() : 'Never'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                    {isFixture ? (
                      <span className="text-xs font-semibold text-emerald-800 bg-emerald-50 px-2 py-1 rounded border border-emerald-200 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Always Permitted (Offline)
                      </span>
                    ) : (
                      <button
                        onClick={() => handleToggleApproval(source)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors border ${
                          isApproved
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                        }`}
                      >
                        {isApproved ? (
                          <>
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Live Polling Approved</span>
                          </>
                        ) : (
                          <>
                            <Lock className="w-3.5 h-3.5 text-amber-600" />
                            <span>Approval Required</span>
                          </>
                        )}
                      </button>
                    )}

                    <button
                      onClick={() => handleSyncSource(source)}
                      disabled={isSyncing}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                      <span>{isSyncing ? 'Syncing...' : 'Sync Source'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Subtab 2: Backups & Disaster Recovery */}
      {subTab === 'backups' && (
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Archive className="w-5 h-5 text-emerald-600" />
                Transactional SQLite Backups
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Atomic page copies created via the SQLite Online Backup API. Safe during active read/write transactions.
              </p>
            </div>

            <button
              onClick={handleCreateBackup}
              disabled={isCreatingBackup}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-sm flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              <Database className="w-4 h-4" />
              <span>{isCreatingBackup ? 'Creating Backup...' : 'Create Backup Now'}</span>
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">
            {backups.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No backup archives found in the local <code>backups/</code> directory.
              </div>
            ) : (
              backups.map((b) => (
                <div key={b.filename} className="p-4 flex items-center justify-between gap-4 hover:bg-slate-50">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-800">{b.filename}</span>
                      {b.is_valid ? (
                        <span className="bg-emerald-50 text-emerald-700 text-[10px] font-semibold px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
                          <FileCheck className="w-3 h-3" /> Integrity OK
                        </span>
                      ) : (
                        <span className="bg-rose-50 text-rose-700 text-[10px] font-semibold px-2 py-0.5 rounded border border-rose-200">
                          Corrupt
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-3">
                      <span>Size: {(b.size_bytes / 1024).toFixed(1)} KB</span>
                      <span>•</span>
                      <span>Created: {new Date(b.created_at).toLocaleString()}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleRestoreBackup(b.filename)}
                    disabled={restoringFile === b.filename}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-amber-50 hover:text-amber-800 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${restoringFile === b.filename ? 'animate-spin' : ''}`} />
                    <span>{restoringFile === b.filename ? 'Restoring...' : 'Restore'}</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Subtab 3: Sync Conflicts & Audit Log */}
      {subTab === 'audit' && (
        <div className="space-y-4">
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
            <AlertOctagon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-950 space-y-1">
              <p className="font-semibold text-amber-900">Candidate Authority Rule</p>
              <p className="text-amber-800 leading-relaxed">
                When external employer feeds remove or alter job listings for which you have already submitted an application or scheduled interviews, 
                your local application record is strictly preserved. Ingestion will never overwrite your application status, interview notes, or rejection logs.
              </p>
            </div>
          </div>

          {/* Sync Conflicts Table */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Detected Synchronization Conflicts ({conflicts.length})
            </h3>
            {conflicts.length === 0 ? (
              <p className="text-xs text-slate-400 py-3">No conflicting data states detected between remote feeds and candidate records.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {conflicts.map((c) => (
                  <div key={c.id} className="py-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-slate-800">{c.job_id}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{new Date(c.detected_at).toLocaleString()}</span>
                    </div>
                    <div className="text-slate-600">Type: <span className="font-semibold text-rose-700">{c.conflict_type}</span></div>
                    <div className="text-emerald-700 bg-emerald-50 px-2 py-1 rounded text-[11px] font-mono">
                      Resolution: {c.resolution_applied}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Activity Logs */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <History className="w-4 h-4 text-emerald-600" />
              System Activity Logs (Recent {activityLogs.length})
            </h3>
            {activityLogs.length === 0 ? (
              <p className="text-xs text-slate-400 py-3">No activity logged yet.</p>
            ) : (
              <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
                {activityLogs.map((log) => (
                  <div key={log.id} className="py-2.5 text-xs flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800 font-mono text-[11px]">{log.action_type}</span>
                        <span className="text-slate-400 text-[10px]">•</span>
                        <span className="text-slate-600 font-mono text-[11px]">{log.entity_type}: {log.entity_id}</span>
                      </div>
                      {log.details && (
                        <div className="text-[11px] text-slate-500 font-mono truncate max-w-xl">
                          {JSON.stringify(log.details)}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
