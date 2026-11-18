// Plan U9: one job, in plain words. On top what a person needs to decide (title, employer, place, why, Open the posting);
// their own progress next; everything else folded under "How this was scored".
import React, { useEffect, useState } from 'react';
import { useDialogFocus } from './useDialogFocus';
import { Job, ApplicationStatus } from '../types';
import { fetchJobFeedback } from '../api';
import { peopleSearchLinks, skillGaps, withoutAutoMark } from '../jobHelpers';
import { whyText } from '../components/JobTable';
import { placeText, foundText, STAGES, indiaWords, sourceText } from './format';
import { postingUrl, btn, btnPlain, btnPrimary } from './JobCard';

interface Props {
  job: Job;
  profileSkills?: string[];
  onClose: () => void;
  onPosting: (job: Job) => void;
  onHide: (job: Job) => void;
  onGoodMatch: (job: Job, on: boolean) => Promise<void>;
  onStage: (job: Job, status: ApplicationStatus, notes: string | undefined, clearNotes: boolean) => Promise<boolean>;
  busy?: boolean;   // a write for this job is on its way: the controls wait
}

const payText = (job: Job) => {
  if (!job.salary_published) return 'Pay: not stated';
  if (job.salary_raw_text) return `Pay: ${job.salary_raw_text}`;
  const f = (n?: number | null) => (n ? Number(n).toLocaleString('en-IN') : '');
  const range = [f(job.salary_min), f(job.salary_max)].filter(Boolean).join(' – ');
  return range ? `Pay: ${job.salary_currency || ''} ${range}${job.salary_period ? ' a ' + String(job.salary_period).toLowerCase().replace(/ly$/, '') : ''}`.trim() : 'Pay: not stated';
};
const levelText = (job: Job) => {
  const s = job.score?.breakdown?.seniority_assessment;
  if (!s || !s.job_seniority || !s.candidate_seniority) return null;
  if (s.job_seniority === s.candidate_seniority) return 'Level: at your level';
  const order = ['ENTRY', 'JUNIOR', 'MID', 'SENIOR', 'LEAD', 'PRINCIPAL', 'DIRECTOR', 'EXECUTIVE'];
  const a = order.indexOf(String(s.job_seniority).toUpperCase()), b = order.indexOf(String(s.candidate_seniority).toUpperCase());
  if (a < 0 || b < 0) return null;
  return a < b ? 'Level: a bit junior for you' : 'Level: a bit senior for you';
};

// Tenth-man review: the stage saves the moment it is chosen (as in My applications; choosing "I applied" and closing used to save nothing),
// an unsaved job says "Not saved yet", and a note being typed is never replaced by a reload.
export const JobPanel: React.FC<Props> = ({ job, profileSkills, onClose, onPosting, onHide, onGoodMatch, onStage, busy = false }) => {
  const ref = useDialogFocus<HTMLDivElement>(onClose);   // Tab / Shift+Tab stay inside; Escape closes
  const [good, setGood] = useState(false);
  const saved = (job.application?.status as ApplicationStatus) || '';
  const [stage, setStage] = useState<string>(saved);
  const [notes, setNotes] = useState(job.application?.notes || '');
  const [typed, setTyped] = useState(false);
  useEffect(() => { setStage(saved); }, [job.id, saved]);
  useEffect(() => { if (!typed) setNotes(job.application?.notes || ''); }, [job.id, job.application?.notes]);   // eslint-disable-line react-hooks/exhaustive-deps
  const chooseStage = async (next: string) => {
    if (!next || next === saved) return;
    setStage(next);
    const ok = await onStage(job, next as ApplicationStatus, typed ? notes : undefined, false);
    if (ok) setTyped(false); else setStage(saved);
  };
  useEffect(() => {
    let live = true;
    fetchJobFeedback(job.id, job.candidate_id).then((f) => { if (live) setGood(f?.rating === 'UP'); }).catch(() => {});
    return () => { live = false; };
  }, [job.id, job.candidate_id]);

  const url = postingUrl(job);
  const gaps = skillGaps(job.description || '', profileSkills);
  const people = peopleSearchLinks(job.company || '');
  const level = levelText(job);
  const hadNote = !!(job.application?.notes || '').trim();

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Job: ${job.title}`} onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[92vh] sm:rounded-2xl overflow-y-auto outline-none">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between">
          <span className="text-sm text-slate-600">{sourceText(job.source_adapter, job.provenance, job.company)}</span>
          <button type="button" aria-label="Close" onClick={onClose} className={`${btnPlain} px-3`}>Close</button>
        </div>
        <div className="p-4 space-y-5">
          <section>
            <h2 className="text-xl font-bold text-slate-900 leading-snug break-words">{job.title}</h2>
            <p className="text-base text-slate-700 mt-1 break-words">{job.company} · {placeText(job)}</p>
            <p className="text-sm text-slate-600 mt-0.5">{foundText(job.discovered_at)}</p>
            {job.why_line && <p className="text-base text-slate-900 mt-2" data-testid="panel-why">{job.why_line}</p>}
            <div className="mt-3 flex flex-wrap gap-3">
              {url ? <a href={url} target="_blank" rel="noopener noreferrer" onClick={() => onPosting(job)} className={btnPrimary}>Open the posting</a>
                : <span className={`${btnPlain} text-slate-500`}>No link available</span>}
              <button type="button" aria-pressed={good} title="Thumbs Up: a good match. Similar jobs move a little higher."
                onClick={async () => { const next = !good; setGood(next); try { await onGoodMatch(job, next); } catch { setGood(!next); } }}
                className={good ? `${btn} bg-emerald-50 text-emerald-900 border border-emerald-300` : btnPlain}>Good match{good ? ' ✓' : ''}</button>
              {job.qualification_status !== 'APPLIED' && <button type="button" onClick={() => onHide(job)} className={btnPlain}>Not for me</button>}
            </div>
            <p className="text-sm text-slate-600 mt-2">Good match moves similar jobs a little higher; Not for me hides this one (you can undo) and moves similar ones a little lower.</p>
          </section>

          <section className="rounded-2xl border border-slate-200 p-4 space-y-3" aria-label="Your progress on this job">
            <h3 className="text-base font-semibold text-slate-900">Your progress on this job</h3>
            <label className="block text-sm text-slate-700">Where are you with this job?
              <select aria-label="Where are you with this job?" value={stage} disabled={busy} onChange={(e) => chooseStage(e.target.value)}
                className="mt-1 block w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-base bg-white">
                {!saved && <option value="">Not saved yet</option>}
                {STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <span className="block mt-1 text-slate-600">Choosing a stage saves it.</span>
            </label>
            <label className="block text-sm text-slate-700">Your note
              <textarea aria-label="Your note" value={notes} maxLength={2000} onChange={(e) => { setNotes(e.target.value); setTyped(true); }} rows={3}
                placeholder="e.g. sent CV by email, call back Monday" className="mt-1 block w-full rounded-xl border border-slate-300 p-3 text-base" />
            </label>
            <div className="flex flex-wrap gap-3">
              {typed && notes !== (job.application?.notes || '') && notes.trim() && <button type="button" disabled={busy} className={btnPrimary}
                onClick={async () => { if (await onStage(job, (saved || 'SAVED') as ApplicationStatus, notes, false)) setTyped(false); }}>Save note</button>}
              {hadNote && <button type="button" disabled={busy} className={btnPlain}
                onClick={async () => { if (await onStage(job, (saved || 'SAVED') as ApplicationStatus, '', true)) { setNotes(''); setTyped(false); } }}>Clear note</button>}
            </div>
            <p className="text-sm text-slate-600">This is your own record; the employer isn't told.</p>
          </section>

          <details className="rounded-2xl border border-slate-200 p-4 group" data-testid="how-scored">
            <summary className="text-base font-semibold text-slate-900 cursor-pointer min-h-[44px] flex items-center">How this was scored</summary>
            <div className="mt-3 space-y-4 text-sm text-slate-800">
              <div><h4 className="font-semibold">Why it's here</h4><p>{whyText(withoutAutoMark(job.qualification_reason))}</p></div>
              <div><h4 className="font-semibold">What the posting says about location</h4>
                <p>{indiaWords(job.eligibility?.classification)}{job.eligibility?.reason ? ` — ${job.eligibility.reason}` : ''}</p></div>
              <div><h4 className="font-semibold">How well it matches you</h4>
                <p>Match: {Math.round(job.score?.overall_score || 0)} out of 100{(job.score?.breakdown?.matched_skills || []).length ? ` · your skills it names: ${(job.score?.breakdown?.matched_skills || []).join(', ')}` : ''}</p>
                {level && <p>{level}</p>}
                <p>{payText(job)}</p></div>
              {gaps.asked.length > 0 && (
                <div data-testid="skill-gaps">
                  <h4 className="font-semibold">Skills the posting names</h4>
                  {gaps.have.length > 0 && <p>On your profile: {gaps.have.join(', ')}</p>}
                  {gaps.missing.length > 0 && <p>Not on the profile: {gaps.missing.join(', ')} (worth a look if you have them)</p>}
                </div>
              )}
              {people.length > 0 && (
                <div data-testid="people-links">
                  <h4 className="font-semibold">Find people at {job.company}</h4>
                  <ul className="flex flex-wrap gap-3 mt-1">
                    {people.map((p) => <li key={p.label}><a className="underline min-h-[44px] inline-flex items-center" href={p.url} target="_blank" rel="noopener noreferrer" title={p.hint}>{p.label}</a></li>)}
                  </ul>
                </div>
              )}
              {job.description?.trim() ? <div><h4 className="font-semibold">The posting</h4><p className="whitespace-pre-line break-words">{job.description}</p></div> : <p>The source provided no job description.{url ? ' Open the employer posting to check the requirements.' : ''}</p>}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
};
