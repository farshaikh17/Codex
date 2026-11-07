import React from 'react';
import { Job, EligibilityClassification } from '../types';
import { 
  CheckCircle2, 
  XCircle, 
  HelpCircle, 
  Search, 
  Bookmark, 
  Building, 
  SlidersHorizontal,
  ChevronRight,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
  RotateCcw,
  History as HistoryIcon,
  AlertTriangle
} from 'lucide-react';

interface JobTableProps {
  jobs: Job[];
  totalJobsCount?: number;
  currentPage?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onResetFilters?: () => void;
  onSelectJob: (job: Job) => void;
  onSaveJob: (jobId: string, e: React.MouseEvent) => void;
  onDismissJob?: (jobId: string, e: React.MouseEvent) => void;
  search: string;
  setSearch: (s: string) => void;
  eligibilityFilter: string;
  setEligibilityFilter: (e: string) => void;
  minScore: number;
  setMinScore: (score: number) => void;
  workplaceFilter: string;
  setWorkplaceFilter: (w: string) => void;
  sourceFilter?: string;
  setSourceFilter?: (s: string) => void;
  sortBy: string;
  setSortBy: (s: string) => void;
  isLoading: boolean;
}

export const JobTable: React.FC<JobTableProps> = ({
  jobs,
  totalJobsCount,
  currentPage = 1,
  pageSize = 50,
  onPageChange,
  onResetFilters,
  onSelectJob,
  onSaveJob,
  onDismissJob,
  search,
  setSearch,
  eligibilityFilter,
  setEligibilityFilter,
  minScore,
  setMinScore,
  workplaceFilter,
  setWorkplaceFilter,
  sourceFilter = 'ALL',
  setSourceFilter,
  sortBy,
  setSortBy,
  isLoading
}) => {
  const renderEligibilityBadge = (classification: EligibilityClassification) => {
    switch (classification) {
      case 'ELIGIBLE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Eligible
          </span>
        );
      case 'INELIGIBLE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="w-3.5 h-3.5 text-rose-600" />
            Ineligible
          </span>
        );
      case 'UNKNOWN':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <HelpCircle className="w-3.5 h-3.5 text-amber-600" />
            Unknown
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Search & Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          {/* Keyword Search */}
          <div className="relative w-full md:flex-1 md:min-w-[18rem]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search job title, company, tech stack, or location..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
            />
          </div>

          {/* Quick Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-xs font-medium">
              {(['ALL', 'ELIGIBLE', 'UNKNOWN', 'INELIGIBLE'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setEligibilityFilter(tab)}
                  className={`px-3 py-1.5 min-h-[32px] rounded-md transition-all text-xs ${
                    eligibilityFilter === tab
                      ? 'bg-white text-slate-900 shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab === 'ALL' ? 'All India Statuses' : tab === 'ELIGIBLE' ? 'India: Eligible' : tab === 'INELIGIBLE' ? 'India: Ineligible' : 'India: Unknown'}
                </button>
              ))}
            </div>

            {/* Workplace Select */}
            <select
              aria-label="Filter by workplace type"
              value={workplaceFilter}
              onChange={(e) => setWorkplaceFilter(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-700 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="ALL">All Workplaces</option>
              <option value="REMOTE_GLOBAL">Remote (Global)</option>
              <option value="REMOTE_RESTRICTED">Remote (Restricted)</option>
              <option value="HYBRID">Hybrid</option>
              <option value="ONSITE">Onsite</option>
            </select>

            {/* Source Adapter Filter */}
            {setSourceFilter && (
              <select
                aria-label="Filter by data source"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-700 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="ALL">All Sources</option>
                <option value="fixture">Synthetic Fixtures</option>
                <option value="greenhouse">Greenhouse Feeds</option>
                <option value="lever">Lever Feeds</option>
                  <option value="jobicy">Jobicy — multiple employers</option>
                  <option value="remotive">Remotive — multiple employers</option>
                  <option value="hnjobs">Startup announcements</option>
              </select>
            )}

            {/* Sort Select */}
            <select
              aria-label="Sort jobs by"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-1.5 min-h-[32px] text-xs text-slate-700 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="score_desc">Match Score (High to Low)</option>
              <option value="date_desc">Latest Discovered</option>
              <option value="title_asc">Job Title (A-Z)</option>
              <option value="company_asc">Company (A-Z)</option>
            </select>

            {onResetFilters && (
              <button
                type="button"
                onClick={onResetFilters}
                title="Reset all filters to default"
                className="px-3 py-1.5 min-h-[32px] rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                <span>Reset Filters</span>
              </button>
            )}
          </div>
        </div>

        {/* Min Score Slider & Quick Shortcuts */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100 text-xs text-slate-600">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 font-medium text-slate-700">
              <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-600" />
              <span>Min Match Score:</span>
            </div>
            <input
              aria-label="Minimum match score slider"
              type="range"
              min={0}
              max={90}
              step={10}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="w-32 accent-emerald-600 cursor-pointer"
            />
            <span className="font-mono font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              {minScore}%
            </span>

            {/* Quick High-Match Shortcut */}
            <button
              onClick={() => setMinScore(minScore === 70 ? 0 : 70)}
              className={`px-2 py-1 rounded text-[11px] font-semibold flex items-center gap-1 transition-colors border ${
                minScore === 70
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              <span>High Match (≥70%)</span>
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">
              {totalJobsCount !== undefined 
                ? `Showing ${jobs.length} of ${totalJobsCount} matching jobs (Page ${currentPage})`
                : `Showing ${jobs.length} jobs`}
            </span>
          </div>
        </div>
      </div>

      {/* Discovery Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-500">
            <div className="animate-spin w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full mx-auto mb-2" />
            Loading job listings...
          </div>
        ) : jobs.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Search className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="font-medium text-slate-700">No jobs match your filter criteria.</p>
            <p className="text-xs text-slate-400 mt-1">Try lowering the match score or clearing the search keyword.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Job Title & Company</th>
                  <th className="py-3 px-4">Qualification & Override</th>
                  <th className="py-3 px-4">India Eligibility</th>
                  <th className="py-3 px-4">Explainable Match Score</th>
                  <th className="py-3 px-4">Salary (Published)</th>
                  <th className="py-3 px-4">Workplace</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {jobs.map((job) => {
                  const isSaved = job.application?.status === 'SAVED';
                  const isApplied = job.application?.status === 'APPLIED';
                  const feedbackRating = job.feedback?.rating;

                  return (
                    <tr
                      key={job.id}
                      data-job-id={job.id}
                      onClick={() => onSelectJob(job)}
                      className="hover:bg-slate-50/80 cursor-pointer transition-colors group"
                    >
                      {/* Title & Company */}
                      <td className="py-3 px-4 max-w-xs">
                        <div className="font-semibold text-slate-900 group-hover:text-emerald-700 transition-colors flex items-center gap-2">
                          {job.title}
                          {job.strategy_lane && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold border ${
                              job.strategy_lane === 'STRONGEST_FIT'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                : job.strategy_lane === 'BRIDGE'
                                ? 'bg-teal-50 text-teal-800 border-teal-300'
                                : job.strategy_lane === 'DREAM'
                                ? 'bg-purple-50 text-purple-800 border-purple-300'
                                : 'bg-slate-100 text-slate-600 border-slate-300'
                            }`}>
                              {job.strategy_lane === 'STRONGEST_FIT' ? 'STRONGEST' : job.strategy_lane}
                            </span>
                          )}
                          {isApplied && (
                            <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-mono font-medium border border-blue-200">
                              Applied
                            </span>
                          )}
                          {isSaved && !isApplied && (
                            <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-mono font-medium border border-amber-200">
                              Saved
                            </span>
                          )}
                          {!job.is_active && (
                            <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono font-medium border border-slate-300">
                              Delisted
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                          <Building className="w-3 h-3 text-slate-400" />
                          <span>{job.company}</span>
                          {job.company_headquarters && (
                            <>
                              <span>•</span>
                              <span className="text-slate-400 truncate">{job.company_headquarters}</span>
                            </>
                          )}
                          <span>•</span>
                          <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                            job.source_adapter === 'fixture'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold'
                          }`}>
                              {job.source_adapter === 'fixture' ? 'Synthetic' : job.source_adapter === 'hnjobs' ? 'Startup announcement — unverified' : ['jobicy','remotive'].includes(job.source_adapter) ? `${job.source_adapter === 'jobicy' ? 'Jobicy' : 'Remotive'} — unverified` : 'Employer feed'}
                          </span>
                        </div>
                      </td>

                      {/* Qualification Status & Override Marker */}
                      <td className="py-3 px-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-bold border ${
                              job.qualification_status === 'READY'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                : job.qualification_status === 'STRETCH_READY'
                                ? 'bg-blue-50 text-blue-800 border-blue-300'
                                : job.qualification_status === 'INELIGIBLE'
                                ? 'bg-rose-50 text-rose-800 border-rose-300'
                                : 'bg-amber-50 text-amber-800 border-amber-300'
                            }`}>
                              {job.qualification_status}
                            </span>
                            {job.manual_override_status && (
                              <span 
                                title={`Manual Override: ${job.manual_override_status}\nReason: ${job.manual_override_reason || 'Manual candidate decision'}`}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-300 cursor-help"
                              >
                                <HistoryIcon className="w-3 h-3 text-purple-600" />
                                OVERRIDDEN
                              </span>
                            )}
                            {job.assessment_conflict && (
                              <span 
                                title="Unresolved Assessment Conflict: Stored as READY/STRETCH but algorithm evaluates score 0 / NOT_FIT. Human decision preserved."
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 cursor-help"
                              >
                                <AlertTriangle className="w-3 h-3 text-amber-600" />
                                CONFLICT
                              </span>
                            )}
                          </div>
                          {job.qualification_reason && (
                            <div className="text-[11px] text-slate-500 truncate max-w-[200px]" title={job.qualification_reason}>
                              {job.qualification_reason}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Eligibility */}
                      <td className="py-3 px-4">
                        <div className="space-y-1">
                          {renderEligibilityBadge(job.eligibility.classification)}
                          <div className="text-[11px] text-slate-500 truncate max-w-[200px]" title={job.eligibility.reason ?? undefined}>
                            {job.eligibility.reason}
                          </div>
                        </div>
                      </td>

                      {/* Match Score & Explainability Indicator */}
                      <td className="py-3 px-4">
                        <div className="space-y-1 w-32">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-bold text-slate-900 font-mono flex items-center gap-1">
                              {job.score.overall_score}%
                              {feedbackRating === 'THUMBS_UP' || feedbackRating === 'UP' ? (
                                <span title="Boosted (+15) by user" className="text-emerald-600">
                                  <ThumbsUp className="w-3 h-3 inline" />
                                </span>
                              ) : feedbackRating === 'THUMBS_DOWN' || feedbackRating === 'DOWN' ? (
                                <span title="Downranked (-40) by user" className="text-rose-600">
                                  <ThumbsDown className="w-3 h-3 inline" />
                                </span>
                              ) : null}
                            </span>
                            <span className="text-[10px] text-slate-400">Match</span>
                          </div>
                          <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                job.score.overall_score >= 80
                                  ? 'bg-emerald-500'
                                  : job.score.overall_score >= 60
                                  ? 'bg-blue-500'
                                  : 'bg-amber-500'
                              }`}
                              style={{ width: `${job.score.overall_score}%` }}
                            />
                          </div>
                          <div className="text-[10px] text-slate-400 flex items-center justify-between">
                            <span>{job.score.score_breakdown?.seniority_assessment?.job_seniority || 'Mid'}</span>
                            <span>{job.score.score_breakdown?.experience_assessment?.status === 'MET' ? 'Exp ✓' : 'Exp ○'}</span>
                          </div>
                        </div>
                      </td>

                      {/* Salary */}
                      <td className="py-3 px-4">
                        {job.salary_published ? (
                          <div className="text-xs font-medium text-slate-800">
                            <span className="text-emerald-700 font-semibold">{job.salary_raw_text}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 italic">
                            Not Disclosed
                          </span>
                        )}
                      </td>

                      {/* Workplace */}
                      <td className="py-3 px-4">
                        <span className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded font-mono">
                          {job.workplace_type.replace('_', ' ')}
                        </span>
                        {job.location_restrictions && (
                          <div className="text-[11px] text-slate-400 truncate max-w-[140px] mt-0.5" title={job.location_restrictions}>
                            {job.location_restrictions}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {onDismissJob && (
                            <button
                              onClick={(e) => onDismissJob(job.id, e)}
                              title="Dismiss / Mark Irrelevant (Remove from review queue)"
                              className="min-h-[32px] min-w-[32px] flex items-center justify-center p-1.5 rounded border border-slate-200 bg-white text-slate-400 hover:text-rose-600 hover:border-rose-300 hover:bg-rose-50 transition-colors"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={(e) => onSaveJob(job.id, e)}
                            title={isSaved ? "Saved" : "Save job"}
                            className={`min-h-[32px] min-w-[32px] flex items-center justify-center p-1.5 rounded border transition-colors ${
                              isSaved
                                ? 'bg-amber-50 border-amber-300 text-amber-600'
                                : 'bg-white border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <Bookmark className="w-3.5 h-3.5" fill={isSaved ? "currentColor" : "none"} />
                          </button>

                          <button
                            onClick={() => onSelectJob(job)}
                            className="min-h-[32px] min-w-[32px] flex items-center justify-center p-1.5 bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-600 rounded transition-colors"
                            title="View Inspection Details"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Server-Driven Pagination Bar */}
        {totalJobsCount !== undefined && totalJobsCount > 0 && (
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              Showing <span className="font-semibold text-slate-800">{(currentPage - 1) * pageSize + 1}</span> to <span className="font-semibold text-slate-800">{Math.min(currentPage * pageSize, totalJobsCount)}</span> of <span className="font-semibold text-slate-800">{totalJobsCount}</span> total jobs
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => onPageChange && onPageChange(currentPage - 1)}
                className="px-3 py-1.5 min-h-[32px] rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous Page
              </button>
              <span className="text-xs text-slate-600 font-mono px-2">
                Page {currentPage} of {Math.ceil(totalJobsCount / pageSize)}
              </span>
              <button
                type="button"
                disabled={currentPage >= Math.ceil(totalJobsCount / pageSize)}
                onClick={() => onPageChange && onPageChange(currentPage + 1)}
                className="px-3 py-1.5 min-h-[32px] rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next Page
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
