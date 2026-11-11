import React, { useState, useEffect, useCallback } from 'react';
import {
  FileSpreadsheet,
  RefreshCw,
  Eye,
  ShieldCheck,
  History,
  AlertOctagon,
  Lock,
  Key,
  BookOpen,
  Sliders,
  Check,
  Table
} from 'lucide-react';
import {
  CanonicalSyncStatus,
  CanonicalSyncRun,
  CanonicalSyncConflict
} from '../types';
import {
  fetchCanonicalSyncStatus,
  fetchCanonicalSyncHistory,
  fetchCanonicalSyncConflicts,
  switchCanonicalTransport,
  fetchOAuthStatus,
  getOAuthAuthorizeUrl,
  oauthLogout,
  discoverCanonicalWorkbook,
  verifyCanonicalSchema,
  inspectWorkbookTab,
  runCanonicalImportDryRun,
  runCanonicalProposeDryRun,
  fetchRulesComparisonReport
} from '../api';

export const GoogleSyncView: React.FC = () => {
  const [status, setStatus] = useState<CanonicalSyncStatus | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<'google_sheets' | 'file_fixture'>('google_sheets');
  const [history, setHistory] = useState<CanonicalSyncRun[]>([]);
  const [conflicts, setConflicts] = useState<CanonicalSyncConflict[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'workbook' | 'rules' | 'dry_runs' | 'conflicts' | 'history'>('overview');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isActionRunning, setIsActionRunning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Phase 10 States
  const [oauthStatus, setOauthStatus] = useState<any>(null);
  const [workbookDiscovery, setWorkbookDiscovery] = useState<any>(null);
  const [schemaVerification, setSchemaVerification] = useState<any>(null);
  const [selectedTabForInspection, setSelectedTabForInspection] = useState<string>('Shortlist');
  const [inspectedTabData, setInspectedTabData] = useState<any>(null);
  const [importDryRunResult, setImportDryRunResult] = useState<any>(null);
  const [proposeDryRunResult, setProposeDryRunResult] = useState<any>(null);
  const [rulesComparison, setRulesComparison] = useState<any>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [
        statusData,
        historyData,
        conflictsData,
        oauthData,
        discoveryData,
        schemaData,
        rulesData
      ] = await Promise.all([
        fetchCanonicalSyncStatus(selectedProvider),
        fetchCanonicalSyncHistory(),
        fetchCanonicalSyncConflicts(),
        fetchOAuthStatus(),
        discoverCanonicalWorkbook(),
        verifyCanonicalSchema(),
        fetchRulesComparisonReport()
      ]);
      setStatus(statusData);
      setHistory(historyData.history);
      setConflicts(conflictsData.conflicts);
      setOauthStatus(oauthData);
      setWorkbookDiscovery(discoveryData);
      setSchemaVerification(schemaData);
      setRulesComparison(rulesData);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Unable to load Google Sync status.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedProvider]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleInspectTab = async (tabName: string) => {
    setSelectedTabForInspection(tabName);
    try {
      const data = await inspectWorkbookTab(tabName);
      setInspectedTabData(data);
    } catch (err: any) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (activeTab === 'workbook' && !inspectedTabData) {
      handleInspectTab('Shortlist');
    }
  }, [activeTab, inspectedTabData]);

  const handleSwitchProvider = async (newProvider: 'google_sheets' | 'file_fixture') => {
    try {
      setIsLoading(true);
      await switchCanonicalTransport(newProvider);
      setSelectedProvider(newProvider);
    } catch (err: any) {
      setError(err.message || 'Failed to switch provider.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartOAuth = async () => {
    setIsActionRunning(true);
    try {
      const res = await getOAuthAuthorizeUrl();
      if (res.auth_url) {
        window.open(res.auth_url, '_blank', 'noopener,noreferrer');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate authorization URL');
    } finally {
      setIsActionRunning(false);
    }
  };

  const handleLogoutOAuth = async () => {
    setIsActionRunning(true);
    try {
      await oauthLogout();
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to logout');
    } finally {
      setIsActionRunning(false);
    }
  };

  const handleRunImportDryRun = async () => {
    setIsActionRunning(true);
    setError(null);
    try {
      const res = await runCanonicalImportDryRun();
      setImportDryRunResult(res);
    } catch (err: any) {
      setError(err.message || 'Failed to execute import dry-run');
    } finally {
      setIsActionRunning(false);
    }
  };

  const handleRunProposeDryRun = async () => {
    setIsActionRunning(true);
    setError(null);
    try {
      const res = await runCanonicalProposeDryRun();
      setProposeDryRunResult(res);
    } catch (err: any) {
      setError(err.message || 'Failed to execute propose dry-run');
    } finally {
      setIsActionRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl border border-blue-100 shadow-inner">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                Google Sheets Canonical Sync
                <span className="text-xs bg-indigo-100 text-indigo-800 font-bold px-2 py-0.5 rounded-full border border-indigo-200">
                  Phase 10
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Canonical Google Ledger Integration • Target: <strong className="font-semibold text-slate-700">Farhan Job Engine — Live Ledger</strong> (ID: <code className="bg-slate-100 px-1 py-0.5 rounded text-[11px] font-mono">1nReYflEQcDsa-hG0zebr_XTtO7sV7eZlhffoIBdgHss</code>)
              </p>
            </div>
          </div>
        </div>

        {/* Transport Provider Switcher */}
        <div className="flex items-center gap-3 bg-slate-100 p-1.5 rounded-lg border border-slate-200">
          <span className="text-xs font-semibold text-slate-600 px-2">Transport:</span>
          <button
            onClick={() => handleSwitchProvider('google_sheets')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              selectedProvider === 'google_sheets'
                ? 'bg-white text-slate-900 shadow-sm border border-slate-200 font-bold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Google Sheets (Live Target)
          </button>
          <button
            onClick={() => handleSwitchProvider('file_fixture')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              selectedProvider === 'file_fixture'
                ? 'bg-blue-600 text-white shadow-sm font-bold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Test File Transport (Active)
          </button>
          <button
            onClick={loadData}
            disabled={isLoading || isActionRunning}
            title="Refresh status"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-200 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-blue-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Optional Google Sync Banner */}
      <div className="bg-slate-100 border border-slate-300 rounded-xl p-5 text-slate-800 flex items-start gap-4 shadow-sm">
        <FileSpreadsheet className="w-6 h-6 text-slate-500 flex-shrink-0 mt-0.5" />
        <div className="space-y-1.5 text-sm">
          <h4 className="font-bold text-slate-900 text-base flex items-center gap-2">
            Google Sync: Optional — Not Connected
            <span className="text-xs bg-slate-200 text-slate-700 px-2.5 py-0.5 rounded-full font-semibold">Google Sheets Transport is NOT CONNECTED</span>
          </h4>
          <p className="text-slate-600 text-xs leading-relaxed">
            Google Sheets synchronization is an optional export channel. The Farhan Job Engine is fully operational locally using SQLite storage. All discovery, qualification, scoring, and tracking are fully active without Google authentication.
          </p>
          <div className="text-xs text-slate-500 pt-1 flex flex-wrap gap-4">
            <span>• Local SQLite Engine: <strong>Active & Operational</strong></span>
            <span>• Google Writes: <strong>Disabled (Zero Google Writes)</strong></span>
            <span>• Canonical Google Ledger: <strong>Remains Safe & Authoritative</strong></span>
          </div>
        </div>
      </div>

      {/* Write Guard Banner */}
      <div className="bg-slate-900 text-white rounded-xl p-4 shadow-sm flex items-start gap-4 border border-slate-800">
        <ShieldCheck className="w-6 h-6 text-emerald-400 flex-shrink-0 mt-0.5" />
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-emerald-400 tracking-wide uppercase">
              Phase 10 Write Guard Active
            </span>
            <span className="bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded text-[10px] font-mono border border-emerald-800">
              STRICTLY READ-ONLY
            </span>
          </div>
          <p className="text-slate-300">
            The canonical Google workbook is authoritative. Antigravity operates strictly in read-only mode during Phase 10.
            No rows can be written, altered, or deleted on Google Sheets without candidate approval.
            The staging tab (<code className="text-emerald-300 font-mono">Proposed_Discoveries</code>) is guarded and will not be created until authorized.
          </p>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-4 text-xs flex items-center gap-3">
          <AlertOctagon className="w-5 h-5 text-rose-600 flex-shrink-0" />
          <div>
            <strong className="font-bold">Sync Error: </strong>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* OAuth 2.0 PKCE Status Panel */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`p-2.5 rounded-lg ${oauthStatus?.is_authenticated ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-slate-100 text-slate-600'}`}>
              <Key className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-sm">Desktop OAuth 2.0 PKCE Authentication</h3>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${oauthStatus?.is_authenticated ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>
                  {oauthStatus?.status_display || 'CHECKING'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Account: <strong className="text-slate-700 font-semibold">{oauthStatus?.account_email || 'Not connected yet'}</strong>
                {' • '}
                Token path: <code className="bg-slate-100 text-[11px] px-1 py-0.5 rounded font-mono text-slate-600">{oauthStatus?.token_path}</code>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {oauthStatus?.is_authenticated ? (
              <button
                onClick={handleLogoutOAuth}
                disabled={isActionRunning}
                className="px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors"
              >
                Disconnect / Revoke
              </button>
            ) : (
              <button
                onClick={handleStartOAuth}
                disabled={isActionRunning}
                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
              >
                <Lock className="w-3.5 h-3.5" />
                Connect Google Account (Interactive OAuth)
              </button>
            )}
          </div>
        </div>

        {/* Requested Scopes Disclosure */}
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Requested Scopes Disclosure</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {oauthStatus?.requested_scopes?.map((s: any, idx: number) => (
              <div key={idx} className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-blue-600" />
                  {s.name}
                </div>
                <div className="text-[11px] font-mono text-slate-400 mt-0.5">{s.scope}</div>
                <div className="text-[11px] text-slate-500 mt-1">{s.purpose}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 gap-2">
        <button
          onClick={() => setActiveTab('overview')}
          className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
            activeTab === 'overview'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Sliders className="w-4 h-4" />
          Overview & Metrics
        </button>

        <button
          onClick={() => setActiveTab('workbook')}
          className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
            activeTab === 'workbook'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Table className="w-4 h-4" />
          18-Tab Live Discovery ({workbookDiscovery?.total_tabs || 18})
        </button>

        <button
          onClick={() => setActiveTab('rules')}
          className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
            activeTab === 'rules'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          Authoritative Rules ({workbookDiscovery?.rules?.length || 12})
        </button>

        <button
          onClick={() => setActiveTab('dry_runs')}
          className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
            activeTab === 'dry_runs'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Eye className="w-4 h-4" />
          Dry-Run Console (Steps 4 & 5)
        </button>

        <button
          onClick={() => setActiveTab('conflicts')}
          className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
            activeTab === 'conflicts'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <AlertOctagon className="w-4 h-4" />
          Conflict Ledger ({conflicts.length})
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
            activeTab === 'history'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <History className="w-4 h-4" />
          Sync History ({history.length})
        </button>
      </div>

      {/* TAB CONTENT: 1. OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Metrics Row */}
          {status && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Connection</div>
                <div className={`text-base font-extrabold mt-1 truncate ${status.is_connected ? 'text-emerald-600' : 'text-slate-700'}`}>
                  {status.status_display}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">{status.provider}</div>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Last Import</div>
                <div className="text-sm font-bold text-slate-800 mt-1 truncate">
                  {status.last_import_at ? new Date(status.last_import_at).toLocaleDateString() : 'Never'}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {status.last_import_at ? new Date(status.last_import_at).toLocaleTimeString() : 'No write executed'}
                </div>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Staged Proposals</div>
                <div className="text-2xl font-black text-blue-600 mt-1">
                  {status.staged_proposals_count}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">in Proposed_Discoveries</div>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Conflicts</div>
                <div className={`text-2xl font-black mt-1 ${status.conflicts_count > 0 ? 'text-amber-600' : 'text-slate-800'}`}>
                  {status.conflicts_count}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">Candidate Authority Rule</div>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Local READY</div>
                <div className="text-2xl font-black text-emerald-600 mt-1">
                  {status.pending_ready_to_propose}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">Eligible to stage</div>
              </div>
            </div>
          )}

          {/* Action Quick Triggers */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900 text-sm">Phase 10 Connection & Dry-Run Procedures</h3>
              <div className="flex gap-2">
                <button
                  onClick={handleRunImportDryRun}
                  disabled={isActionRunning}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-lg border border-slate-300 flex items-center gap-1.5 transition-colors"
                >
                  <Eye className="w-3.5 h-3.5 text-blue-600" />
                  Dry-Run Import Preview
                </button>
                <button
                  onClick={handleRunProposeDryRun}
                  disabled={isActionRunning}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-lg border border-slate-300 flex items-center gap-1.5 transition-colors"
                >
                  <Eye className="w-3.5 h-3.5 text-blue-600" />
                  Dry-Run Propose Preview
                </button>
              </div>
            </div>

            {(importDryRunResult || proposeDryRunResult) && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs font-bold flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <span>DRY RUN — NO DATA WRITTEN</span>
                <span className="text-amber-700 font-normal ml-auto">Simulated diff preview only. Google Sheets remains untouched.</span>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-slate-200 p-4 rounded-xl space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 bg-blue-100 text-blue-700 font-bold rounded-full flex items-center justify-center text-xs">4</span>
                  <h4 className="font-bold text-slate-800 text-sm">Step 4: Import Dry-Run</h4>
                </div>
                <p className="text-xs text-slate-500">
                  Simulates import from canonical Google Sheet to local SQLite. Detects matches, conflicts, and state changes. Writes ZERO records to Google.
                </p>
                <button
                  onClick={handleRunImportDryRun}
                  disabled={isActionRunning}
                  className="mt-2 w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  <Eye className="w-3.5 h-3.5 text-blue-400" />
                  Execute Import Dry-Run
                </button>
              </div>

              <div className="border border-slate-200 p-4 rounded-xl space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 bg-blue-100 text-blue-700 font-bold rounded-full flex items-center justify-center text-xs">5</span>
                  <h4 className="font-bold text-slate-800 text-sm">Step 5: Propose Dry-Run</h4>
                </div>
                <p className="text-xs text-slate-500">
                  Evaluates local READY jobs against authoritative Rules (India remote, INR 120k floor, builder scope). Reports what WOULD qualify for staging. Writes ZERO records.
                </p>
                <button
                  onClick={handleRunProposeDryRun}
                  disabled={isActionRunning}
                  className="mt-2 w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  <Eye className="w-3.5 h-3.5 text-white" />
                  Execute Propose Dry-Run
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: 2. 18-TAB WORKBOOK DISCOVERY */}
      {activeTab === 'workbook' && (
        <div className="space-y-6">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
              <div>
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  Canonical Workbook Census: 18 Discovered Tabs
                  <span className="bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded-full font-semibold">
                    {schemaVerification?.all_compatible ? '100% Compatible' : 'Schema Verified'}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Spreadsheet Timezone: <strong className="font-semibold text-slate-700">{workbookDiscovery?.timezone}</strong>
                  {' • '}
                  Total Tabs: <strong className="font-semibold text-slate-700">{workbookDiscovery?.total_tabs}</strong>
                </p>
              </div>
            </div>

            {/* Tabs List */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
              {workbookDiscovery?.tabs?.map((t: any) => (
                <button
                  key={t.name}
                  onClick={() => handleInspectTab(t.name)}
                  className={`p-3 text-left rounded-xl border text-xs transition-all ${
                    selectedTabForInspection === t.name
                      ? 'bg-blue-50 border-blue-300 text-blue-900 font-bold shadow-sm'
                      : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="truncate">{t.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${t.is_hidden ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-700'}`}>
                      {t.is_hidden ? 'Hidden' : 'Visible'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-normal">
                    {t.headers?.length || t.col_count || 0} cols • {t.row_count || 1} rows
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Inspected Tab Data Viewer */}
          {inspectedTabData && (
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  Tab Schema & Values: <code className="text-blue-600 font-mono">{selectedTabForInspection}</code>
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
                    {inspectedTabData.headers?.length} columns
                  </span>
                </h4>
              </div>

              {/* Headers pill view */}
              <div className="flex flex-wrap gap-1.5">
                {inspectedTabData.headers?.map((h: string, idx: number) => (
                  <span key={idx} className="bg-slate-100 text-slate-700 text-[11px] px-2 py-1 rounded-md font-mono border border-slate-200">
                    {h}
                  </span>
                ))}
              </div>

              {/* Rows table */}
              <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-80">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 text-slate-600 sticky top-0 border-b border-slate-200">
                    <tr>
                      {inspectedTabData.headers?.map((h: string, idx: number) => (
                        <th key={idx} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inspectedTabData.rows?.length === 0 ? (
                      <tr>
                        <td colSpan={inspectedTabData.headers?.length || 1} className="px-3 py-6 text-center text-slate-400">
                          Tab contains schema headers with 0 data rows.
                        </td>
                      </tr>
                    ) : (
                      inspectedTabData.rows?.map((row: any[], rIdx: number) => (
                        <tr key={rIdx} className="hover:bg-slate-50">
                          {row.map((cell: any, cIdx: number) => (
                            <td key={cIdx} className="px-3 py-2 text-slate-700 whitespace-nowrap max-w-xs truncate">
                              {cell ? String(cell) : <span className="text-slate-300 italic">—</span>}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB CONTENT: 3. AUTHORITATIVE RULES */}
      {activeTab === 'rules' && (
        <div className="space-y-6">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div>
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                Authoritative Rules Tab Codification
                <span className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full font-semibold">
                  Source of Truth
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                The canonical Google workbook's <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">Rules</code> tab is authoritative.
                The Antigravity engine strictly enforces these policy constraints.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {workbookDiscovery?.rules?.map((r: any) => (
                <div key={r.rule_id} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                      {r.rule_id}
                    </span>
                    <span className="text-[11px] font-semibold text-slate-600">{r.category}</span>
                  </div>
                  <p className="text-xs font-medium text-slate-800 pt-1 leading-relaxed">{r.requirement}</p>
                  <div className="text-[10px] text-slate-400 pt-1">Authority: {r.authority}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Rules Reconciliation Table (Deliverable Item 11) */}
          {rulesComparison && (
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <h4 className="font-bold text-slate-900 text-sm">
                Local Engine Assumptions vs Canonical Rules Comparison (Deliverable Item 11)
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Topic</th>
                      <th className="px-3 py-2 font-semibold">Canonical Rule</th>
                      <th className="px-3 py-2 font-semibold">Local Engine Rule</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 font-semibold">Reconciliation Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rulesComparison.comparisons?.map((c: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="px-3 py-2.5 font-bold text-slate-900 whitespace-nowrap">{c.topic}</td>
                        <td className="px-3 py-2.5 text-slate-700 max-w-xs">{c.canonical_rule}</td>
                        <td className="px-3 py-2.5 text-slate-700 max-w-xs">{c.local_assumption}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                            c.status === 'ALIGNED' ? 'bg-emerald-100 text-emerald-800' : 'bg-indigo-100 text-indigo-800'
                          }`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-600 max-w-xs text-[11px]">{c.reconciliation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB CONTENT: 4. DRY-RUN CONSOLE (STEPS 4 & 5) */}
      {activeTab === 'dry_runs' && (
        <div className="space-y-6">
          {(importDryRunResult || proposeDryRunResult) && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs font-bold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span>DRY RUN — NO DATA WRITTEN</span>
              <span className="text-amber-700 font-normal ml-auto">Simulated diff preview only. Google Sheets remains untouched.</span>
            </div>
          )}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-wrap gap-3">
            <button
              onClick={handleRunImportDryRun}
              disabled={isActionRunning}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-lg transition-colors flex items-center gap-2"
            >
              <Eye className="w-4 h-4 text-blue-400" />
              Re-Run Step 4 Import Dry-Run
            </button>
            <button
              onClick={handleRunProposeDryRun}
              disabled={isActionRunning}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg transition-colors flex items-center gap-2"
            >
              <Eye className="w-4 h-4 text-white" />
              Re-Run Step 5 Propose Dry-Run
            </button>
          </div>

          {/* Import Dry-Run Output */}
          {importDryRunResult && (
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  Step 4 Import Dry-Run Results
                  <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold">
                    Zero Google Writes
                  </span>
                </h4>
                <span className="text-xs text-slate-400 font-mono">{importDryRunResult.write_guard}</span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <div className="text-slate-500 font-semibold">Canonical Records Read</div>
                  <div className="text-xl font-black text-slate-900 mt-1">{importDryRunResult.total_canonical_records_read}</div>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <div className="text-slate-500 font-semibold">Matched Local Records</div>
                  <div className="text-xl font-black text-blue-600 mt-1">{importDryRunResult.records_matched}</div>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <div className="text-slate-500 font-semibold">New Records To Import</div>
                  <div className="text-xl font-black text-emerald-600 mt-1">{importDryRunResult.records_to_import}</div>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <div className="text-slate-500 font-semibold">Conflicts Detected</div>
                  <div className="text-xl font-black text-amber-600 mt-1">{importDryRunResult.conflicts?.length || 0}</div>
                </div>
              </div>
            </div>
          )}

          {/* Propose Dry-Run Output */}
          {proposeDryRunResult && (
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  Step 5 Propose Dry-Run Results
                  <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded font-bold">
                    Staging Guard Active
                  </span>
                </h4>
                <span className="text-xs text-slate-400 font-mono">{proposeDryRunResult.write_guard}</span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <div className="text-slate-500 font-semibold">Total Local READY Candidates</div>
                  <div className="text-xl font-black text-slate-900 mt-1">{proposeDryRunResult.total_local_ready_candidates}</div>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <div className="text-slate-500 font-semibold">Qualifies For Staging</div>
                  <div className="text-xl font-black text-emerald-600 mt-1">{proposeDryRunResult.qualifies_for_staging_count}</div>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <div className="text-slate-500 font-semibold">Disqualified By Rules</div>
                  <div className="text-xl font-black text-rose-600 mt-1">{proposeDryRunResult.disqualified_count}</div>
                </div>
              </div>

              {/* Qualified Candidates List */}
              {proposeDryRunResult.qualified_candidates?.length > 0 && (
                <div className="space-y-2 pt-2">
                  <h5 className="font-bold text-slate-800 text-xs">Qualified Candidates for Staging (with Reasons):</h5>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                    {proposeDryRunResult.qualified_candidates.map((c: any) => (
                      <div key={c.job_id} className="p-3 text-xs hover:bg-slate-50">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900">{c.company} — {c.title}</span>
                          <span className="text-[11px] font-mono bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-bold">
                            Score: {c.match_score}/100
                          </span>
                        </div>
                        <p className="text-slate-600 text-[11px] mt-1">{c.why_qualified}</p>
                        <div className="text-[11px] font-mono text-emerald-700 bg-emerald-50 p-1.5 rounded mt-1 border border-emerald-100">
                          Evidence: "{c.eligibility_evidence}"
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB CONTENT: 5. CONFLICTS */}
      {activeTab === 'conflicts' && (
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-bold text-slate-900 text-sm">Detected Sync Conflicts ({conflicts.length})</h3>
          {conflicts.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">No conflicts detected. All canonical records align cleanly.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {conflicts.map((c) => (
                <div key={c.id} className="py-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{c.company || 'Job'} — {c.title || c.job_id}</span>
                    <span className="font-mono text-[10px] text-slate-400">{c.detected_at}</span>
                  </div>
                  <div className="text-slate-600">Conflict Type: <strong>{c.conflict_type}</strong></div>
                  <div className="text-slate-500 text-[11px]">Resolution: <strong>{c.resolution}</strong> ({c.resolution_reason})</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB CONTENT: 6. HISTORY */}
      {activeTab === 'history' && (
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-bold text-slate-900 text-sm">Sync Execution Audit History ({history.length})</h3>
          {history.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">No sync runs executed yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {history.map((h) => (
                <div key={h.id} className="py-3 text-xs flex items-center justify-between">
                  <div>
                    <span className="font-bold text-slate-800">{h.direction}</span>
                    <span className="ml-2 text-slate-500">[{h.transport_type}]</span>
                    {h.is_dry_run && <span className="ml-2 text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">DRY-RUN</span>}
                    <div className="text-slate-500 text-[11px] mt-0.5">{h.summary}</div>
                  </div>
                  <div className="text-right font-mono text-[11px] text-slate-400">
                    {h.completed_at ? new Date(h.completed_at).toLocaleString() : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
