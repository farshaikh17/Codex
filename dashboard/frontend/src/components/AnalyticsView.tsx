import React, { useState, useEffect } from 'react';
import { AnalyticsData, DiscoveryFunnelMetrics, SourceScorecardItem } from '../types';
import { fetchDiscoveryFunnel, fetchSourcesEffectiveness } from '../api';
import { 
  BarChart3, 
  CheckCircle2, 
  XCircle, 
  HelpCircle, 
  Filter, 
  TrendingUp, 
  Building2, 
  Sparkles, 
  ExternalLink,
  Target,
  ArrowRight,
  RefreshCw
} from 'lucide-react';

interface AnalyticsViewProps {
  analytics: AnalyticsData | null;
  candidateId: string;
}

const CANDIDATE_LABELS: Record<string, string> = { farhan_shaikh: 'Farhan', sana_ansari: 'Sana' };

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ analytics, candidateId }) => {
  const candidateLabel = CANDIDATE_LABELS[candidateId] || candidateId;
  const [tab, setTab] = useState<'funnel' | 'sources' | 'overview'>('funnel');
  const [funnel, setFunnel] = useState<DiscoveryFunnelMetrics | null>(null);
  const [scorecard, setScorecard] = useState<SourceScorecardItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestSeq = React.useRef(0);

  const loadData = async () => {
    const seq = ++requestSeq.current;
    setIsLoading(true);
    setError(null);
    setFunnel(null);
    setScorecard([]);
    try {
      const [fData, sData] = await Promise.all([
        fetchDiscoveryFunnel(candidateId),
        fetchSourcesEffectiveness(candidateId)
      ]);
      // A slower response for a previously selected candidate must never overwrite the current one.
      if (seq !== requestSeq.current || fData.candidate_id !== candidateId) return;
      setFunnel(fData);
      setScorecard(sData.sources || []);
    } catch (err: any) {
      if (seq === requestSeq.current) setError(err.message || 'Failed to load discovery analytics');
    } finally {
      if (seq === requestSeq.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    return () => { requestSeq.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  // Render loading or view content

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header with Navigation Tabs */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 mb-1">
            <BarChart3 className="w-5 h-5 text-emerald-600" />
            Discovery Coverage & Funnel Analytics
          </h2>
          <p className="text-xs text-slate-500">
            Current active inventory for {candidateLabel}, computed from the database on each load.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setTab('funnel')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
                tab === 'funnel' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Discovery Funnel</span>
            </button>
            <button
              onClick={() => setTab('sources')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
                tab === 'sources' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Source Scorecard ({scorecard.length})</span>
            </button>
            <button
              onClick={() => setTab('overview')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
                tab === 'overview' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Ingestion Overview</span>
            </button>
          </div>

          <button
            onClick={loadData}
            disabled={isLoading}
            className="p-2 text-slate-500 hover:text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors"
            title="Refresh Metrics"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-600' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl">
          {error}
        </div>
      )}

      {/* Tab 1: Discovery Funnel */}
      {tab === 'funnel' && funnel && (
        <div className="space-y-6">
          {/* Conversion Rate KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
              <span className="text-xs text-slate-500 font-medium block">Stage A Relevance Rate</span>
              <span className="text-2xl font-bold font-mono text-blue-700 mt-1 block">
                {funnel.conversion_rates.relevance_rate_pct}%
              </span>
              <span className="text-[11px] text-slate-400">
                {funnel.potentially_relevant_jobs} of {funnel.total_scanned_jobs} vacancies
              </span>
            </div>

            <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
              <span className="text-xs text-slate-500 font-medium block">India Eligibility Rate</span>
              <span className="text-2xl font-bold font-mono text-emerald-700 mt-1 block">
                {funnel.conversion_rates.eligibility_rate_pct}%
              </span>
              <span className="text-[11px] text-slate-400">
                {funnel.geographic_eligibility.ELIGIBLE} affirmative India roles
              </span>
            </div>

            <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
              <span className="text-xs text-slate-500 font-medium block">READY Qualification Rate</span>
              <span className="text-2xl font-bold font-mono text-purple-700 mt-1 block">
                {funnel.conversion_rates.qualification_rate_pct}%
              </span>
              <span className="text-[11px] text-slate-400">
                {funnel.ready_jobs} currently READY
              </span>
            </div>

            <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
              <span className="text-xs text-slate-500 font-medium block">Employers Covered</span>
              <span className="text-2xl font-bold font-mono text-slate-900 mt-1 block">
                {funnel.total_employers}
              </span>
              <span className="text-[11px] text-slate-400">
                Distinct employers in current inventory
              </span>
            </div>
          </div>

          {/* Interactive Multi-Stage Funnel Visualization */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Target className="w-4 h-4 text-emerald-600" />
                Two-Stage Vacancy Funnel Progression
              </h3>
              <span className="text-xs bg-emerald-50 text-emerald-700 font-semibold px-2.5 py-1 rounded-full border border-emerald-200">
                Decoupled Recall & Precision
              </span>
            </div>

            <div className="space-y-4">
              {/* Stage 1: Scanned */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-slate-200 text-slate-700 font-bold flex items-center justify-center text-xs">
                    1
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Total Scanned Vacancies</h4>
                    <p className="text-xs text-slate-500">Unfiltered postings fetched from registered public feeds</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xl font-bold font-mono text-slate-900">{funnel.total_scanned_jobs}</span>
                  <span className="text-xs text-slate-400 block">100% of pipeline</span>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex justify-center -my-2 text-slate-300">
                <ArrowRight className="w-4 h-4 rotate-90" />
              </div>

              {/* Stage 2: Potentially Relevant (Stage A) */}
              <div className="p-4 bg-blue-50/70 rounded-xl border border-blue-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center text-xs">
                    2
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-blue-950">Stage A: Candidate-Target Retrieval</h4>
                    <p className="text-xs text-blue-700">Jobs not marked INELIGIBLE or CLOSED for this candidate</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xl font-bold font-mono text-blue-900">{funnel.potentially_relevant_jobs}</span>
                  <span className="text-xs text-blue-600 font-medium block">
                    {funnel.conversion_rates.relevance_rate_pct}% conversion
                  </span>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex justify-center -my-2 text-slate-300">
                <ArrowRight className="w-4 h-4 rotate-90" />
              </div>

              {/* Stage 3: Geographic Eligibility (Stage B) */}
              <div className="p-4 bg-amber-50/70 rounded-xl border border-amber-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-600 text-white font-bold flex items-center justify-center text-xs">
                    3
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-amber-950">Stage B: India Scope Classification</h4>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[11px] bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded">
                        {funnel.geographic_eligibility.ELIGIBLE} Affirmative India
                      </span>
                      <span className="text-[11px] bg-amber-100 text-amber-800 font-semibold px-2 py-0.5 rounded">
                        {funnel.geographic_eligibility.UNKNOWN} Unknown (Ambiguous)
                      </span>
                      <span className="text-[11px] bg-rose-100 text-rose-800 font-semibold px-2 py-0.5 rounded">
                        {funnel.geographic_eligibility.INELIGIBLE} Ineligible
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xl font-bold font-mono text-amber-950">{funnel.geographic_eligibility.ELIGIBLE}</span>
                  <span className="text-xs text-amber-700 font-medium block">
                    {funnel.conversion_rates.eligibility_rate_pct}% affirmative
                  </span>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex justify-center -my-2 text-slate-300">
                <ArrowRight className="w-4 h-4 rotate-90" />
              </div>

              {/* Stage 4: High Match Score (>= 70%) */}
              <div className="p-4 bg-purple-50/70 rounded-xl border border-purple-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-600 text-white font-bold flex items-center justify-center text-xs">
                    4
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-purple-950">Technical Match Qualification</h4>
                    <p className="text-xs text-purple-700">Skills, seniority, and experience score &ge; 70% threshold</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xl font-bold font-mono text-purple-900">
                    {funnel.eligible_score_distribution.high_match_70_plus}
                  </span>
                  <span className="text-xs text-purple-600 font-medium block">
                    High Match Qualified
                  </span>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex justify-center -my-2 text-slate-300">
                <ArrowRight className="w-4 h-4 rotate-90" />
              </div>

              {/* Stage 5: READY to Apply */}
              <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-300 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white font-bold flex items-center justify-center text-xs">
                    5
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-emerald-950 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-emerald-600" />
                      READY Shortlist ({funnel.ready_jobs})
                    </h4>
                    <p className="text-xs text-emerald-800">
                      Current inventory for {candidateLabel}: <strong>{funnel.ready_jobs} READY</strong>, {funnel.stretch_ready_jobs ?? 0} Stretch Ready and {funnel.applications.total} tracked application records.
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-baseline justify-end gap-1.5">
                    <span className="text-2xl font-bold font-mono text-emerald-700">{funnel.ready_jobs}</span>
                    <span className="text-xs font-semibold text-slate-500 uppercase font-mono">(current)</span>
                  </div>
                  <span className="text-xs text-emerald-700 font-medium block">
                    Active READY in review queue
                  </span>
                  <span className="text-[11px] text-slate-500 block">
                    {funnel.conversion_rates.overall_funnel_efficiency_pct}% overall yield
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Source Scorecard */}
      {tab === 'sources' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Registered Employer ATS Scorecard</h3>
              <p className="text-xs text-slate-500">Per-source tracking of vacancies scanned, relevant roles retrieved, and conversion to READY.</p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 rounded-full text-slate-700">
              {scorecard.length} Employers
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Employer / ATS</th>
                  <th className="py-3 px-3">India Footprint Evidence</th>
                  <th className="py-3 px-3 text-right">Scanned</th>
                  <th className="py-3 px-3 text-right">Relevant</th>
                  <th className="py-3 px-3 text-right">India Scope</th>
                  <th className="py-3 px-3 text-right">Match &ge;70%</th>
                  <th className="py-3 px-3 text-right">READY</th>
                  <th className="py-3 px-3 text-right">Yield</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {scorecard.map((s) => (
                  <tr key={s.source_id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{s.source_name}</span>
                        {s.careers_url && (
                          <a
                            href={s.careers_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-400 hover:text-emerald-600"
                            title="Official Careers Page"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 uppercase font-semibold">
                          {s.adapter_type}
                        </span>
                        <span className="text-[10px] text-slate-400">{s.organization_slug}</span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        {s.monitored === false
                          ? 'Not polled by the Worker (imported by the GitHub collector)'
                          : `Worker poll: ${s.last_status}${s.last_polled_at ? ` at ${s.last_polled_at}` : ''}${s.last_error ? ` - ${s.last_error}` : ''}`}
                      </div>
                    </td>

                    <td className="py-3 px-3 max-w-xs">
                      <p className="text-[11px] text-slate-600 line-clamp-2" title={s.india_hiring_evidence || 'No evidence recorded'}>
                        {s.india_hiring_evidence || '—'}
                      </p>
                    </td>

                    <td className="py-3 px-3 text-right font-mono font-medium">{s.total_jobs}</td>
                    <td className="py-3 px-3 text-right font-mono text-blue-700 font-semibold">{s.relevant_jobs}</td>
                    <td className="py-3 px-3 text-right">
                      <div className="font-mono text-[11px]">
                        <span className="text-emerald-700 font-semibold">{s.eligible_jobs} el</span>
                        <span className="text-slate-300 mx-1">/</span>
                        <span className="text-amber-700">{s.unknown_jobs} unk</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-purple-700 font-semibold">{s.high_match_jobs}</td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700">
                      {s.ready_jobs > 0 ? (
                        <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full text-[11px]">
                          {s.ready_jobs}
                        </span>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-slate-600">
                      {s.conversion_pct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Classic Ingestion Overview */}
      {tab === 'overview' && analytics && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-xs text-slate-500 font-medium block">Total Ingested Jobs</span>
              <span className="text-2xl font-bold font-mono text-slate-900 mt-1 block">
                {analytics.total_jobs}
              </span>
              <span className="text-[11px] text-slate-400">Database Records</span>
            </div>

            <div className="p-4 bg-emerald-50/60 rounded-xl border border-emerald-200">
              <span className="text-xs text-emerald-800 font-medium block">Eligible for India</span>
              <span className="text-2xl font-bold font-mono text-emerald-700 mt-1 block">
                {analytics.eligibility_counts.ELIGIBLE}
              </span>
              <span className="text-[11px] text-emerald-600">
                {Math.round((analytics.eligibility_counts.ELIGIBLE / Math.max(analytics.total_jobs, 1)) * 100)}% of total
              </span>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-xs text-slate-500 font-medium block">Avg Match Score</span>
              <span className="text-2xl font-bold font-mono text-slate-900 mt-1 block">
                {analytics.average_match_score}%
              </span>
              <span className="text-[11px] text-slate-400">Across Candidate Profile</span>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-xs text-slate-500 font-medium block">Salary Transparency</span>
              <span className="text-2xl font-bold font-mono text-slate-900 mt-1 block">
                {analytics.salary_transparency_rate}%
              </span>
              <span className="text-[11px] text-slate-400">Published compensation</span>
            </div>
          </div>

          {/* Remote India Classification */}
          <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
              Remote-India Geographic Classification Breakdown
            </h3>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="flex items-center gap-1.5 font-medium text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Explicit India remote posting scope
                </span>
                <span className="font-mono font-bold text-slate-700">{analytics.eligibility_counts.ELIGIBLE} jobs</span>
              </div>
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${(analytics.eligibility_counts.ELIGIBLE / Math.max(analytics.total_jobs, 1)) * 100}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="flex items-center gap-1.5 font-medium text-amber-700">
                  <HelpCircle className="w-3.5 h-3.5" />
                  Unknown (Ambiguous / Generic Remote)
                </span>
                <span className="font-mono font-bold text-slate-700">{analytics.eligibility_counts.UNKNOWN} jobs</span>
              </div>
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500"
                  style={{ width: `${(analytics.eligibility_counts.UNKNOWN / Math.max(analytics.total_jobs, 1)) * 100}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="flex items-center gap-1.5 font-medium text-rose-700">
                  <XCircle className="w-3.5 h-3.5" />
                  Ineligible (US Only / ITAR / Hybrid Non-India)
                </span>
                <span className="font-mono font-bold text-slate-700">{analytics.eligibility_counts.INELIGIBLE} jobs</span>
              </div>
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-rose-500"
                  style={{ width: `${(analytics.eligibility_counts.INELIGIBLE / Math.max(analytics.total_jobs, 1)) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
