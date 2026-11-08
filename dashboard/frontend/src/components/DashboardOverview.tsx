import React, { useState, useEffect } from 'react';
import { Users, Zap, ArrowRight, Activity, FileText } from 'lucide-react';
import { fetchDashboardOverview } from '../api';
import { DashboardOverviewData } from '../types';

interface DashboardOverviewProps {
  isOperator: boolean;
  onSelectCandidate: (candidateId: string) => void;
  onOpenAutomation: () => void;
  onOpenApplications: () => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  isOperator,
  onSelectCandidate,
  onOpenApplications
}) => {
  const [data, setData] = useState<DashboardOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Public page: loads for every visitor. Re-fetched when the operator signs in or out so the view matches the session.
    let current = true;
    setLoading(true); setError(null);
    fetchDashboardOverview()
      .then(res => { if (current) { setData(res); setLoading(false); } })
      .catch(err => { if (current) { setError(err.message || 'Failed to load dashboard overview'); setLoading(false); } });
    return () => { current = false; };
  }, [isOperator]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-500">
        <Activity className="w-8 h-8 animate-spin text-emerald-700 mb-3" />
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 text-center text-rose-700 bg-rose-50 rounded-xl border border-rose-200">
        <p className="font-semibold mb-2">The overview could not load</p>
        <p className="text-xs text-rose-600">{error || 'Unknown error'}</p>
      </div>
    );
  }

  const farhan = data.farhan;
  const sana = data.sana;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Today's job search</h2>
        <p className="text-sm text-slate-500 mt-1">
          New jobs are found every day and ranked best first. Open a person to see their list, save the ones worth applying to, and hide the rest.
        </p>
      </div>

      {/* Two Candidate Command Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Candidate 1: Farhan Shaikh */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between hover:border-slate-200 transition-colors shadow-sm">
          <div>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold text-slate-900">{farhan.full_name}</h3>
                  <span className="text-[11px] font-mono bg-blue-500/10 text-blue-700 px-2 py-0.5 rounded border border-blue-500/20">
                    {farhan.education_short || ''}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {farhan.summary_line || ''}
                </p>
                <p className="text-[11px] text-emerald-700 font-medium mt-0.5">
                  {farhan.pay_line || ''}
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-700 border border-blue-500/20">
                <Users className="w-6 h-6" />
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-4 gap-2.5 mb-6 text-center">
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                <div className="text-xl font-bold text-emerald-700 font-mono">{farhan.ready_count}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">Ready to apply</div>
              </div>
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                <div className="text-xl font-bold text-emerald-600 font-mono">{farhan.stretch_count}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">Stretch</div>
              </div>
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                <div className="text-xl font-bold text-amber-700 font-mono">{farhan.review_count}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">To review</div>
              </div>
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                <div className="text-xl font-bold text-blue-700 font-mono">{farhan.applied_count}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">Applied</div>
              </div>
            </div>

          </div>

          <button
            onClick={() => onSelectCandidate('farhan_shaikh')}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-medium text-sm transition-colors shadow-sm"
          >
            <span>Open Farhan's jobs</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Candidate 2: Sana Ansari */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between hover:border-slate-200 transition-colors shadow-sm">
          <div>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold text-slate-900">{sana.full_name}</h3>
                  <span className="text-[11px] font-mono bg-amber-500/10 text-amber-700 px-2 py-0.5 rounded border border-amber-500/20">
                    {sana.education_short || ''}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {sana.summary_line || ''}
                </p>
                <p className="text-[11px] text-amber-700 font-medium mt-0.5">
                  {sana.pay_line || ''}
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-700 border border-amber-500/20">
                <Zap className="w-6 h-6" />
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-4 gap-2.5 mb-6 text-center">
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                <div className="text-xl font-bold text-emerald-700 font-mono">{sana.ready_count}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">Ready to apply</div>
              </div>
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                <div className="text-xl font-bold text-emerald-600 font-mono">{sana.stretch_count}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">Stretch</div>
              </div>
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                <div className="text-xl font-bold text-amber-700 font-mono">{sana.review_count}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">To review</div>
              </div>
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                <div className="text-xl font-bold text-blue-700 font-mono">{sana.applied_count}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">Applied</div>
              </div>
            </div>

          </div>

          <button
            onClick={() => onSelectCandidate('sana_ansari')}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-coral-500 hover:bg-coral-600 text-white font-medium text-sm transition-colors shadow-sm"
          >
            <span>Open Sana's jobs</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Further clients (resold profiles) this viewer may see */}
      {(data.candidates || []).length > 2 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="client-cards">
          {(data.candidates || []).slice(2).map((c) => (
            <button key={c.candidate_id} data-candidate-id={c.candidate_id} onClick={() => onSelectCandidate(c.candidate_id)}
              className="text-left bg-white border border-slate-200 hover:border-emerald-600 rounded-xl p-5 shadow-sm transition-colors">
              <div className="text-lg font-bold text-slate-900">{c.full_name}</div>
              <div className="text-xs text-slate-500 mt-0.5">{c.display_title || ''}</div>
              {c.summary_line && <div className="text-xs text-slate-500 mt-1">{c.summary_line}</div>}
              <div className="grid grid-cols-4 gap-2 mt-4 text-center">
                <div><div className="text-lg font-bold text-emerald-700 font-mono">{c.ready_count}</div><div className="text-[10px] text-slate-500 uppercase">Ready</div></div>
                <div><div className="text-lg font-bold text-emerald-600 font-mono">{c.stretch_count}</div><div className="text-[10px] text-slate-500 uppercase">Stretch</div></div>
                <div><div className="text-lg font-bold text-amber-700 font-mono">{c.review_count}</div><div className="text-[10px] text-slate-500 uppercase">Review</div></div>
                <div><div className="text-lg font-bold text-blue-700 font-mono">{c.applied_count}</div><div className="text-[10px] text-slate-500 uppercase">Applied</div></div>
              </div>
              <div className="mt-4 text-xs font-semibold text-emerald-700 flex items-center gap-1">Open workspace <ArrowRight className="w-3.5 h-3.5" /></div>
            </button>
          ))}
        </div>
      )}

      {/* Global System Inventory Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
        <div className="flex items-center gap-6">
          <div>
            <span className="text-slate-500 uppercase tracking-wider text-[10px] block">Jobs found so far</span>
            <span className="text-base font-bold text-slate-900 font-mono">{(data.total_jobs_tracked ?? 0).toLocaleString()} </span>
          </div>
          <div className="h-8 w-px bg-slate-100" />
          <div>
            <span className="text-slate-500 uppercase tracking-wider text-[10px] block">Still open</span>
            <span className="text-base font-bold text-emerald-700 font-mono">{(data.active_jobs_count ?? 0).toLocaleString()}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onOpenApplications}
            className="px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors flex items-center gap-1.5"
          >
            <FileText className="w-3.5 h-3.5 text-blue-700" />
            <span>My applications</span>
          </button>
        </div>
      </div>
    </div>
  );
};
