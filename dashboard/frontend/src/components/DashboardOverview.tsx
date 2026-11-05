import React, { useState, useEffect } from 'react';
import { Users, Zap, ArrowRight, Activity, FileText } from 'lucide-react';
import { fetchDashboardOverview } from '../api';
import { DashboardOverviewData } from '../types';

interface DashboardOverviewProps {
  isOperator: boolean;
  onSelectCandidate: (candidateId: 'farhan_shaikh' | 'sana_ansari') => void;
  onOpenAutomation: () => void;
  onOpenApplications: () => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  isOperator,
  onSelectCandidate,
  onOpenAutomation,
  onOpenApplications
}) => {
  const [data, setData] = useState<DashboardOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Private data is requested only while the operator session is unlocked, and again after every unlock.
    let current = true;
    if (!isOperator) { setData(null); setError(null); setLoading(false); return; }
    setLoading(true); setError(null);
    fetchDashboardOverview()
      .then(res => { if (current) { setData(res); setLoading(false); } })
      .catch(err => { if (current) { setError(err.message || 'Failed to load dashboard overview'); setLoading(false); } });
    return () => { current = false; };
  }, [isOperator]);

  if (!isOperator) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-400">
        <p className="text-sm">The dashboard is locked. Use the lock button in the top bar to enter the operator key.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-400">
        <Activity className="w-8 h-8 animate-spin text-emerald-400 mb-3" />
        <p className="text-sm">Loading Multi-Candidate Career Engine Telemetry...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 text-center text-rose-400 bg-rose-950/20 rounded-xl border border-rose-800/40">
        <p className="font-semibold mb-2">Error Loading Dashboard</p>
        <p className="text-xs text-rose-300">{error || 'Unknown error'}</p>
      </div>
    );
  }

  const farhan = data.farhan;
  const sana = data.sana;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono uppercase tracking-wider bg-emerald-500/10 text-emerald-400 px-2.5 py-0.5 rounded-full border border-emerald-500/20 font-semibold">
              Production Multi-Candidate Architecture
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs text-slate-400">Cloudflare D1 Ledger</span>
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Career Job Engine</h2>
          <p className="text-sm text-slate-400 mt-1">
            Independent qualification pipelines per candidate, with candidate-scoped data and one shared operator key.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onOpenAutomation}
            className="flex items-center gap-2 text-xs font-medium px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            <Activity className="w-4 h-4 text-emerald-400" />
            <span>Automation: <strong className="text-emerald-400 font-mono">{data.automation_status}</strong></span>
          </button>
        </div>
      </div>

      {/* Two Candidate Command Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Candidate 1: Farhan Shaikh */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between hover:border-slate-700 transition-colors shadow-sm">
          <div>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold text-white">{farhan.full_name}</h3>
                  <span className="text-[11px] font-mono bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20">
                    {farhan.education_short || ''}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {farhan.summary_line || ''}
                </p>
                <p className="text-[11px] text-emerald-400 font-medium mt-0.5">
                  {farhan.pay_line || ''} • Target Strategy: {farhan.target_distribution?.strongest_fit} / {farhan.target_distribution?.bridge} / {farhan.target_distribution?.dream}
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Users className="w-6 h-6" />
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-4 gap-2.5 mb-6 text-center">
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
                <div className="text-xl font-bold text-emerald-400 font-mono">{farhan.ready_count}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 mt-0.5">READY</div>
              </div>
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
                <div className="text-xl font-bold text-teal-300 font-mono">{farhan.stretch_count}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 mt-0.5">STRETCH</div>
              </div>
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
                <div className="text-xl font-bold text-amber-400 font-mono">{farhan.review_count}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 mt-0.5">REVIEW</div>
              </div>
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
                <div className="text-xl font-bold text-blue-400 font-mono">{farhan.applied_count}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 mt-0.5">APPLIED</div>
              </div>
            </div>

            {/* Strategy Allocation Bars */}
            <div className="space-y-3 bg-slate-950/40 p-4 rounded-lg border border-slate-800/60 mb-6">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                <span>Strategy Lane Allocation</span>
                <span className="text-[11px] font-normal text-slate-400">Target vs Actual READY</span>
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Strongest Fit (Target: {farhan.target_distribution?.strongest_fit ?? 70}%)</span>
                  <span className="font-mono text-emerald-400 font-semibold">{farhan.actual_ready_distribution?.strongest_fit ?? 0}%</span>
                </div>
                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div className="bg-emerald-500 h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, farhan.actual_ready_distribution?.strongest_fit ?? 0)}%` }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Bridge (Target: {farhan.target_distribution?.bridge ?? 20}%)</span>
                  <span className="font-mono text-teal-400 font-semibold">{farhan.actual_ready_distribution?.bridge ?? 0}%</span>
                </div>
                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div className="bg-teal-500 h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, farhan.actual_ready_distribution?.bridge ?? 0)}%` }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Dream (Target: {farhan.target_distribution?.dream ?? 10}%)</span>
                  <span className="font-mono text-purple-400 font-semibold">{farhan.actual_ready_distribution?.dream ?? 0}%</span>
                </div>
                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div className="bg-purple-500 h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, farhan.actual_ready_distribution?.dream ?? 0)}%` }} />
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={() => onSelectCandidate('farhan_shaikh')}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition-colors shadow-sm"
          >
            <span>Open Farhan's Workspace</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Candidate 2: Sana Ansari */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between hover:border-slate-700 transition-colors shadow-sm">
          <div>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold text-white">{sana.full_name}</h3>
                  <span className="text-[11px] font-mono bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded border border-amber-500/20">
                    {sana.education_short || ''}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {sana.summary_line || ''}
                </p>
                <p className="text-[11px] text-amber-400 font-medium mt-0.5">
                  {sana.pay_line || ''} • Target Strategy: {sana.target_distribution?.strongest_fit} / {sana.target_distribution?.bridge} / {sana.target_distribution?.dream}
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Zap className="w-6 h-6" />
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-4 gap-2.5 mb-6 text-center">
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
                <div className="text-xl font-bold text-emerald-400 font-mono">{sana.ready_count}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 mt-0.5">READY</div>
              </div>
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
                <div className="text-xl font-bold text-teal-300 font-mono">{sana.stretch_count}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 mt-0.5">STRETCH</div>
              </div>
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
                <div className="text-xl font-bold text-amber-400 font-mono">{sana.review_count}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 mt-0.5">REVIEW</div>
              </div>
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
                <div className="text-xl font-bold text-blue-400 font-mono">{sana.applied_count}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 mt-0.5">APPLIED</div>
              </div>
            </div>

            {/* Strategy Allocation Bars */}
            <div className="space-y-3 bg-slate-950/40 p-4 rounded-lg border border-slate-800/60 mb-6">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                <span>Strategy Lane Allocation</span>
                <span className="text-[11px] font-normal text-slate-400">Target vs Actual READY</span>
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Strongest Fit (Target: {sana.target_distribution?.strongest_fit ?? 20}%)</span>
                  <span className="font-mono text-emerald-400 font-semibold">{sana.actual_ready_distribution?.strongest_fit ?? 0}%</span>
                </div>
                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div className="bg-emerald-500 h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, sana.actual_ready_distribution?.strongest_fit ?? 0)}%` }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Bridge (Target: {sana.target_distribution?.bridge ?? 30}%)</span>
                  <span className="font-mono text-teal-400 font-semibold">{sana.actual_ready_distribution?.bridge ?? 0}%</span>
                </div>
                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div className="bg-teal-500 h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, sana.actual_ready_distribution?.bridge ?? 0)}%` }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Dream (Target: {sana.target_distribution?.dream ?? 50}%)</span>
                  <span className="font-mono text-purple-400 font-semibold">{sana.actual_ready_distribution?.dream ?? 0}%</span>
                </div>
                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div className="bg-purple-500 h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, sana.actual_ready_distribution?.dream ?? 0)}%` }} />
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={() => onSelectCandidate('sana_ansari')}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium text-sm transition-colors shadow-sm"
          >
            <span>Open Sana's Workspace</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Global System Inventory Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
        <div className="flex items-center gap-6">
          <div>
            <span className="text-slate-500 uppercase tracking-wider text-[10px] block">Total Tracked Inventory</span>
            <span className="text-base font-bold text-white font-mono">{(data.total_jobs_tracked ?? 0).toLocaleString()} Stored Listings</span>
          </div>
          <div className="h-8 w-px bg-slate-800" />
          <div>
            <span className="text-slate-500 uppercase tracking-wider text-[10px] block">Active Vacancies</span>
            <span className="text-base font-bold text-emerald-400 font-mono">{(data.active_jobs_count ?? 0).toLocaleString()} Active</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onOpenApplications}
            className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors flex items-center gap-1.5"
          >
            <FileText className="w-3.5 h-3.5 text-blue-400" />
            <span>Applications Tracker</span>
          </button>
        </div>
      </div>
    </div>
  );
};
