// Plan U6: one job card, the same on Today, the full list and the hidden list. Phone first: 16 px title, 14 px text,
// three 44 px buttons with 12 px gaps (U14).
import React from 'react';
import { Job } from '../types';
import { placeText, foundText, stageWord, employerName } from './format';

import { postingUrl } from '../jobHelpers';
export { postingUrl } from '../jobHelpers';

export const btn = 'min-h-[44px] px-3 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-slate-900';
export const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
export const btnPlain = `${btn} bg-white text-slate-800 border border-slate-300 hover:bg-slate-50`;
// The chosen one of a row of plain buttons. Built from `btn`, not by adding colours to btnPlain: two Tailwind colour classes on one element are
// decided by stylesheet order, and btnPlain's bg-white won, so the chosen "All" read white on white (live QA 17 Nov).
// A card title's link: one line is a 44 px tap target (22 px line + 11 px above and below), and the padding is taken back by an equal negative
// margin, so a title that wraps never runs into the line below it (site QA 21 Nov: min-h-[44px] -my-2.5 pulled a 2-line title 5 px into the
// company line).
export const titleLink = 'hover:underline break-words inline-block py-[11px] -my-[11px]';
export const btnChosen = `${btn} bg-slate-900 text-white border border-slate-900 hover:bg-slate-800`;

interface Props {
  job: Job;
  onOpen: (job: Job) => void;           // the panel
  onPosting: (job: Job) => void;        // "Open posting" was tapped (for "Did you apply?")
  onSave?: (job: Job) => void;
  onHide?: (job: Job) => void;
  onRestore?: (job: Job) => void;       // hidden list
  isNew?: boolean;
}

export const JobCard: React.FC<Props> = ({ job, onOpen, onPosting, onSave, onHide, onRestore, isNew }) => {
  const url = postingUrl(job);
  const stage = job.application?.status;
  const saved = stage === 'SAVED' || stage === 'REVIEWING';
  const meta = [employerName(job.company), placeText(job), foundText(job.discovered_at)].filter(Boolean).join(' · ');
  return (
    <article data-job-id={job.id} data-testid="job-card" className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-start gap-2">
        <h3 className="text-base font-semibold text-slate-900 leading-snug flex-1 min-w-0">
          <a href={`#job-${encodeURIComponent(job.id)}`} onClick={(e) => { e.preventDefault(); onOpen(job); }} className={titleLink}>{job.title}</a>
        </h3>
        {isNew && <span className="shrink-0 text-sm font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-full px-2">New</span>}
      </div>
      <p className="text-sm text-slate-600 mt-1 break-words">{meta}</p>
      {job.why_line && <p className="text-sm text-slate-800 mt-1.5" data-testid="why-line">{job.why_line}</p>}
      {!!job.more_places && <p className="text-sm text-slate-600 mt-1 break-words" data-testid="more-places">+{job.more_places} more place{job.more_places === 1 ? '' : 's'}{job.other_places?.length ? `: ${job.other_places.join(' · ')}` : ''}</p>}
      {stage && <p className="text-sm font-semibold mt-1.5 text-emerald-800" data-testid="card-state">{saved ? (stage === 'REVIEWING' ? 'Saved · preparing' : 'Saved') : stageWord(stage)}</p>}
      <div className="mt-3 flex flex-wrap gap-3">
        {url
          ? <a href={url} target="_blank" rel="noopener noreferrer" onClick={() => onPosting(job)} aria-label={`Open posting: ${job.title}`} className={btnPrimary}>Open posting</a>
          : <span className={`${btnPlain} text-slate-500 cursor-default`}>No link available</span>}
        {onSave && (
          <button type="button" onClick={() => onSave(job)} aria-pressed={saved} aria-label={`${saved ? 'Saved' : 'Save'}: ${job.title}`} className={saved ? `${btn} bg-emerald-50 text-emerald-900 border border-emerald-300` : btnPlain}>
            {saved ? 'Saved ✓' : 'Save'}
          </button>
        )}
        {onHide && <button type="button" onClick={() => onHide(job)} aria-label={`Not for me: ${job.title}`} className={btnPlain}>Not for me</button>}
        {onRestore && <button type="button" onClick={() => onRestore(job)} aria-label={`Restore: ${job.title}`} className={btnPlain}>Restore</button>}
      </div>
    </article>
  );
};
