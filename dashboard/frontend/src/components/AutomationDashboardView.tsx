import React, { useState, useEffect } from 'react';
import { AutomationConfig, AutomationStatus, AutomationRun, UrlCheckRecord } from '../types';
import { 
  fetchAutomationStatus, 
  updateAutomationConfig, 
  pauseAutomation, 
  resumeAutomation, 
  triggerAutomation, 
  fetchAutomationRuns, 
  fetchUrlChecks, 
  verifyReadyUrls 
} from '../api';
import { 
  Cpu, 
  Play, 
  Pause, 
  RefreshCw, 
  CheckCircle2, 
  Clock, 
  Activity, 
  Zap, 
  Globe, 
  Server
} from 'lucide-react';

interface AutomationDashboardViewProps {
  onRefreshData?: () => void;
}

export const AutomationDashboardView: React.FC<AutomationDashboardViewProps> = ({ onRefreshData }) => {
  const [config, setConfig] = useState<AutomationConfig | null>(null);
  const [autoStatus, setAutoStatus] = useState<AutomationStatus | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [urlChecks, setUrlChecks] = useState<UrlCheckRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isTriggering, setIsTriggering] = useState<boolean>(false);
  const [isVerifyingUrls, setIsVerifyingUrls] = useState<boolean>(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'runs' | 'url_checks' | 'settings'>('runs');

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [statusRes, runsRes, urlRes] = await Promise.all([
        fetchAutomationStatus(),
        fetchAutomationRuns(20),
        fetchUrlChecks(25)
      ]);
      setConfig(statusRes.config);
      setAutoStatus(statusRes);
      setRuns(runsRes.runs);
      setUrlChecks(urlRes.checks);
    } catch (err: any) {
      console.error('Failed to load automation status', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // The cron runs one work unit every 2 minutes, so refreshing faster shows nothing new; skip refreshes while the tab is hidden.
    const interval = setInterval(() => { if (document.visibilityState === 'visible') loadData(); }, 120000);
    return () => clearInterval(interval);
  }, []);

  const handleTogglePause = async () => {
    if (!config) return;
    setActionNotice(null);
    try {
      if (config.is_enabled) {
        const res = await pauseAutomation();
        setConfig(res.config);
        setActionNotice('Background scheduler paused. No automatic jobs will be triggered.');
      } else {
        const res = await resumeAutomation();
        setConfig(res.config);
        setActionNotice('Background scheduler resumed and active.');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to toggle pause state');
    }
  };

  const handleTriggerRun = async () => {
    setIsTriggering(true);
    setActionNotice(null);
    try {
      const res = await triggerAutomation(false);
      setActionNotice(
        `Cloud batch result: ${res.summary.jobs_seen} seen, ${res.summary.jobs_new} new, ${res.summary.jobs_unchanged} unchanged (${res.summary.duration_ms}ms)`
      );
      await loadData();
      if (onRefreshData) onRefreshData();
    } catch (err: any) {
      setActionNotice(`Run failed: ${err.message}`);
    } finally {
      setIsTriggering(false);
    }
  };

  const handleVerifyUrls = async () => {
    setIsVerifyingUrls(true);
    setActionNotice(null);
    try {
      const res = await verifyReadyUrls();
      setActionNotice(
        `URL verification finished: ${res.result.urls_checked} checked, ${res.result.dead_urls_found} dead/expired URLs detected.`
      );
      await loadData();
      if (onRefreshData) onRefreshData();
    } catch (err: any) {
      setActionNotice(`URL check failed: ${err.message}`);
    } finally {
      setIsVerifyingUrls(false);
    }
  };

  const handleChangeInterval = async (intervalSec: number) => {
    try {
      const res = await updateAutomationConfig({ interval_seconds: intervalSec });
      setConfig(res.config);
      setActionNotice(`Scheduler interval updated to ${intervalSec / 60} minutes.`);
    } catch (err: any) {
      alert(err.message || 'Failed to update interval');
    }
  };

  const latestRun = runs.length > 0 ? runs[0] : null;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Activity className="w-6 h-6 text-emerald-600" />
              Cloud Discovery & Execution Monitor
            </h2>
            {config && (
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                !config.is_enabled
                  ? 'bg-amber-100 text-amber-800 border border-amber-200'
                  : config.status === 'RUNNING'
                  ? 'bg-blue-100 text-blue-800 animate-pulse border border-blue-200'
                  : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  !config.is_enabled ? 'bg-amber-500' : config.status === 'RUNNING' ? 'bg-blue-500' : 'bg-emerald-500'
                }`} />
                {config.status === 'RUNNING' ? 'RUNNING CYCLE' : !config.is_enabled ? 'SCHEDULER PAUSED' : 'ACTIVE / IDLE'}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Public job boards, startup announcements and direct employer feeds. New employers can enter automatically; source coverage is not the whole job market.
            {autoStatus?.coverage && <span className="block mt-2 font-semibold">{autoStatus.coverage.multi_employer_sources} broader source streams · {autoStatus.coverage.direct_employer_sources} direct employer feeds · {autoStatus.coverage.employers_discovered} employers discovered through broader feeds</span>}
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={loadData}
            disabled={isLoading}
            className="p-2 text-slate-500 hover:text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors shadow-sm"
            title="Refresh Monitoring Data"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-600' : ''}`} />
          </button>

          {config && (
            <button
              onClick={handleTogglePause}
              className={`px-3.5 py-2 text-xs font-semibold rounded-xl border flex items-center gap-1.5 transition-colors ${
                config.is_enabled
                  ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                  : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
              }`}
            >
              {config.is_enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{config.is_enabled ? 'Pause Scheduler' : 'Resume Scheduler'}</span>
            </button>
          )}

          <button
            onClick={handleVerifyUrls}
            disabled={true} title="Bulk URL verification is unavailable; discovery fetches official posting details."
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-1.5 transition-colors shadow-sm disabled:opacity-50"
          >
            <Globe className={`w-3.5 h-3.5 ${isVerifyingUrls ? 'animate-spin text-emerald-600' : 'text-slate-500'}`} />
            <span>{isVerifyingUrls ? 'Verifying...' : 'Verify URLs'}</span>
          </button>

          <button
            onClick={handleTriggerRun}
            disabled={isTriggering}
            className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <Zap className={`w-3.5 h-3.5 ${isTriggering ? 'animate-spin' : ''}`} />
            <span>{isTriggering ? 'Processing Batch...' : 'Run Next Batch'}</span>
          </button>
        </div>
      </div>

      {/* Operating Schedules & Execution Status Card */}
      <div className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-800 shadow-md">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                config?.is_enabled
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              }`}>
                <span className={`w-2 h-2 rounded-full ${config?.is_enabled ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                {config?.is_enabled ? 'AUTOMATION ACTIVE' : 'AUTOMATION INACTIVE'}
              </span>
              <span className="text-slate-400 text-xs">Current Run Status: <strong className="text-slate-200 font-mono">{autoStatus?.current_run_status || config?.status || 'IDLE'}</strong></span>
            </div>
            <h3 className="text-lg font-bold text-slate-100 mt-1">Cloud Discovery Automation</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-mono bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700">
              Server startup: <strong className="text-slate-200">PC not required</strong>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-4 text-xs">
          <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[11px] mb-1">Last Discovery Run</span>
            <span className="font-mono font-semibold text-slate-200">
              {autoStatus?.last_discovery_run ? new Date(autoStatus.last_discovery_run.started_at).toLocaleTimeString() : 'Pending'}
            </span>
          </div>
          <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[11px] mb-1">Last Successful Run</span>
            <span className="font-mono font-semibold text-emerald-300">
              {autoStatus?.last_successful_run ? new Date(autoStatus.last_successful_run.started_at).toLocaleTimeString() : 'None recorded'}
            </span>
          </div>
          <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[11px] mb-1">Next Scheduled Discovery</span>
            <span className="font-mono font-semibold text-teal-300">
              {autoStatus?.next_scheduled_discovery || 'Every 2 minutes'}
            </span>
          </div>
          <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[11px] mb-1">Last Weekly Refresh</span>
            <span className="font-mono font-semibold text-slate-200">
              {autoStatus?.last_weekly_refresh ? new Date(autoStatus.last_weekly_refresh.started_at).toLocaleDateString() : 'Continuous rotation'}
            </span>
          </div>
          <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[11px] mb-1">Discovery Schedule</span>
            <span className="font-mono font-semibold text-blue-300">One small work unit every 2 minutes</span>
          </div>
          <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[11px] mb-1">Last Error</span>
            <span className={`font-mono font-semibold ${autoStatus?.last_error ? 'text-rose-300' : 'text-slate-400'}`}>
              {autoStatus?.last_error ? autoStatus.last_error.slice(0, 30) : 'None'}
            </span>
          </div>
        </div>
      </div>

      {/* Action Notice */}
      {actionNotice && (
        <div className="p-4 bg-blue-50 border border-blue-200 text-blue-900 text-xs rounded-xl flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* Real-time Status & Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Scheduler Cadence */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span className="font-semibold uppercase tracking-wider">Schedule Interval</span>
            <Clock className="w-4 h-4 text-slate-400" />
          </div>
          <div className="flex items-center justify-between">
            <div className="text-xl font-bold font-mono text-slate-900">
              {config ? `${config.interval_seconds / 60}m` : '60m'}
            </div>
            <select disabled title="Fixed free-tier work interval" value={config?.interval_seconds || 120}
              onChange={(e) => handleChangeInterval(Number(e.target.value))}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-slate-50 font-medium"
            >
              <option value="900">Every 15 min</option>
              <option value="1800">Every 30 min</option>
              <option value="120">Every 2 min</option><option value="3600">Every 1 hr (Default)</option>
              <option value="7200">Every 2 hr</option>
              <option value="21600">Every 6 hr</option>
              <option value="86400">Every 24 hr</option>
            </select>
          </div>
          <div className="text-[11px] text-slate-400 font-mono pt-1">
            Next Run: {config?.next_run_at ? new Date(config.next_run_at).toLocaleTimeString() : 'Pending trigger'}
          </div>
        </div>

        {/* Card 2: Last Successful Run */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span className="font-semibold uppercase tracking-wider">Last Run Result</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-xl font-bold font-mono ${latestRun?.status === 'SUCCESS' ? 'text-emerald-700' : 'text-slate-800'}`}>
              {latestRun?.status || 'No runs yet'}
            </span>
            {latestRun && (
              <span className="text-xs text-slate-400 font-mono">
                ({latestRun.duration_ms}ms)
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-400 font-mono pt-1">
            {latestRun ? new Date(latestRun.started_at).toLocaleTimeString() : 'Never'} • {latestRun?.jobs_new || 0} new jobs
          </div>
        </div>

        {/* Card 3: Measured Resource Usage */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span className="font-semibold uppercase tracking-wider">Resource Footprint</span>
            <Cpu className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-xl font-bold font-mono text-indigo-900">
            {'Not measured'}
          </div>
          <div className="text-[11px] text-slate-500 font-mono pt-1">
            Work is bounded by source, posting and daily limits.
          </div>
        </div>

        {/* Card 4: URL Verification Health */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span className="font-semibold uppercase tracking-wider">READY URLs Alive</span>
            <Globe className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-xl font-bold font-mono text-slate-900">
            {latestRun?.urls_checked ? `${latestRun.urls_checked - latestRun.dead_urls_found} / ${latestRun.urls_checked}` : 'Not measured'}
          </div>
          <div className="text-[11px] text-slate-400 font-mono pt-1">
            Dead URLs: <strong className={latestRun?.dead_urls_found ? 'text-rose-600 font-bold' : 'text-emerald-700 font-bold'}>{latestRun?.dead_urls_found || 0}</strong>
          </div>
        </div>
      </div>

      {/* Host Architecture & Reliability Disclosure */}
      <div className="p-4 bg-slate-100 rounded-xl border border-slate-200 text-xs text-slate-700 space-y-1.5">
        <div className="flex items-center gap-2 font-bold text-slate-900">
          <Server className="w-4 h-4 text-slate-600" />
          <span>Host Architecture & Continuous Execution Notice</span>
        </div>
        <p className="text-slate-600 leading-relaxed">
          The cloud scheduler runs on Cloudflare Workers and saves its progress in D1. 
          Your computer and the local Python server can be off. 
          Discovery runs on Cloudflare while your PC is off. Each scheduled tick processes one small batch within fixed daily limits. New matches stay in review until eligibility, pay and requirements are checked.
          No paid cloud hosting, third-party schedulers, or external AI credits are used.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('runs')}
          className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'runs'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Execution History ({runs.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('url_checks')}
          className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'url_checks'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Application URL Checks ({urlChecks.length})</span>
        </button>
      </div>

      {/* Tab 1: Execution Runs History */}
      {activeTab === 'runs' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">
          {runs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No automation cycles recorded yet. Click "Run Cycle Now" to trigger the first run.
            </div>
          ) : (
            runs.map((r) => (
              <div key={r.id} className="p-4 hover:bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-800">Cycle #{r.id}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                      r.status === 'SUCCESS'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : r.status === 'PARTIAL_SUCCESS'
                        ? 'bg-amber-50 text-amber-800 border border-amber-200'
                        : 'bg-rose-50 text-rose-800 border border-rose-200'
                    }`}>
                      {r.status}
                    </span>
                    <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                      {r.run_type}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 font-mono">
                    <span>Duration: {r.duration_ms}ms</span>
                    <span>•</span>
                    <span>Sources: {r.sources_polled}</span>
                    <span>•</span>
                    <span className="text-emerald-700 font-bold">+{r.jobs_new} new</span>
                    <span>•</span>
                    <span>{r.jobs_unchanged} unchanged</span>
                    <span>•</span>
                    <span>CPU: {r.cpu_user_seconds}s</span>
                    <span>•</span>
                    <span>Cloud work unit</span>
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 font-mono self-end sm:self-auto">
                  {new Date(r.started_at).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab 2: URL Reachability Checks */}
      {activeTab === 'url_checks' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">
          {urlChecks.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No application URL checks performed yet. Click "Verify URLs" to test READY vacancy links.
            </div>
          ) : (
            urlChecks.map((u) => (
              <div key={u.id} className="p-4 hover:bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">{u.title || u.job_id}</span>
                    {u.company && <span className="text-slate-500">({u.company})</span>}
                    {u.is_alive ? (
                      <span className="bg-emerald-50 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-200">
                        HTTP {u.http_status || 200} Alive
                      </span>
                    ) : (
                      <span className="bg-rose-50 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded border border-rose-200">
                        HTTP {u.http_status || 'Dead'} ({u.error_message || 'Unreachable'})
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 truncate max-w-xl">
                    {u.url}
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 font-mono self-end sm:self-auto flex items-center gap-2">
                  <span>{u.latency_ms}ms</span>
                  <span>•</span>
                  <span>{new Date(u.checked_at).toLocaleTimeString()}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

