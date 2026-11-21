// Plan U10: one person's applications, in three groups. One tap changes the stage; the note sits inline; Saved ones can be removed;
// waiting ones carry a follow-up date. Nothing here is told to the employer.
import React, { useEffect, useState } from 'react';
import { Job, ApplicationStatus } from '../types';
import { fetchApplications, fetchFollowUps, setFollowUp, FollowUp } from '../api';
import { followUpState } from '../jobHelpers';
import { STAGES, stageWord, SAVED_GROUP, WAITING_GROUP, FINISHED_GROUP, placeText, employerName } from './format';
import { postingUrl, btnPlain, btnPrimary, titleLink } from './JobCard';

interface Props {
  candidateId: string;
  name: string;
  refreshKey: number;
  todayIndia: string;
  onOpen: (job: Job) => void;
  onPosting: (job: Job) => void;
  onStage: (job: Job, status: ApplicationStatus, notes: string | undefined, clearNotes: boolean) => Promise<boolean>;
  onRemove: (job: Job) => Promise<boolean>;
  toast: (message: string) => void;
  busy?: Record<string, boolean>;
}

const Item: React.FC<Props & { job: Job; followUp?: FollowUp; onFollowUp: (job: Job, date: string | null) => void }> = ({ job, followUp, onFollowUp, onOpen, onPosting, onStage, onRemove, todayIndia, busy = {} }) => {
  const a = job.application!;
  const [note, setNote] = useState(a.notes || '');
  const [typed, setTyped] = useState(false);
  // the stage shown at once (tenth-man review: it snapped back while the save was on its way, so people chose it again)
  const [shown, setShown] = useState<string>(a.status);
  useEffect(() => setShown(a.status), [a.status]);
  useEffect(() => { if (!typed) setNote(a.notes || ''); }, [a.notes]);   // eslint-disable-line react-hooks/exhaustive-deps
  const wait = !!busy[job.id];
  const url = postingUrl(job);
  const waiting = WAITING_GROUP.includes(a.status);
  const due = followUpState(followUp?.follow_up_at, todayIndia);
  const noteChanged = note !== (a.notes || '');
  return (
    <li data-job-id={job.id} data-testid="application" className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
      <div>
        <h3 className="text-base font-semibold text-slate-900 leading-snug break-words">
          <a href={`#job-${encodeURIComponent(job.id)}`} onClick={(e) => { e.preventDefault(); onOpen(job); }} className={titleLink}>{job.title}</a>
        </h3>
        <p className="text-sm text-slate-600 break-words">{employerName(job.company)} · {placeText(job)}</p>
      </div>
      <label className="block text-sm text-slate-700">Where are you with this job?
        <select aria-label={`Stage for ${job.title}`} value={shown} disabled={wait}
          onChange={async (e) => { const v = e.target.value; setShown(v); if (!(await onStage(job, v as ApplicationStatus, undefined, false))) setShown(a.status); }}
          className="mt-1 block w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-base bg-white">
          {STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          {!STAGES.some(([k]) => k === shown) && <option value={shown}>{stageWord(shown) || shown}</option>}
        </select>
      </label>
      {waiting && (
        <label className="block text-sm text-slate-700">Follow up on
          <input type="date" aria-label={`Follow-up date for ${job.title}`} value={followUp?.follow_up_at || ''} onChange={(e) => onFollowUp(job, e.target.value || null)}
            className="mt-1 block w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-base" />
          {due.key !== 'none' && <span className={`block mt-1 font-semibold ${due.key === 'overdue' || due.key === 'today' ? 'text-amber-800' : 'text-slate-700'}`}>{due.label}</span>}
        </label>
      )}
      <label className="block text-sm text-slate-700">Your note
        <textarea aria-label={`Note for ${job.title}`} rows={2} maxLength={2000} value={note} onChange={(e) => { setNote(e.target.value); setTyped(true); }} className="mt-1 block w-full rounded-xl border border-slate-300 p-3 text-base" />
      </label>
      <div className="flex flex-wrap gap-3">
        {noteChanged && <button type="button" disabled={wait} className={btnPrimary} onClick={async () => { if (await onStage(job, a.status as ApplicationStatus, note, !note.trim() && !!(a.notes || '').trim())) setTyped(false); }}>
          {!note.trim() && (a.notes || '').trim() ? 'Clear note' : 'Save note'}</button>}
        {url && <a href={url} target="_blank" rel="noopener noreferrer" onClick={() => onPosting(job)} className={btnPlain}>Open posting</a>}
        {SAVED_GROUP.includes(a.status) && <button type="button" className={btnPlain} onClick={() => onRemove(job)}>Remove</button>}
      </div>
    </li>
  );
};

export const ApplicationsView: React.FC<Props> = (props) => {
  const { candidateId, name, refreshKey, toast } = props;
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    Promise.all([fetchApplications(candidateId), fetchFollowUps(candidateId)])
      .then(([j, f]) => { if (live) { setJobs(j || []); setFollowUps(f); setError(''); } })
      .catch(() => { if (live) { setJobs([]); setError('Could not load your applications. Check the connection and try again.'); } });
    return () => { live = false; };
  }, [candidateId, refreshKey]);
  const onFollowUp = async (job: Job, date: string | null) => {
    try { await setFollowUp(job.id, candidateId, date); setFollowUps(await fetchFollowUps(candidateId)); toast(date ? 'Follow-up date saved' : 'Follow-up date cleared'); }
    catch (e: any) { toast(e?.message || 'Could not save the date'); }
  };
  const group = (title: string, statuses: string[], testid: string, empty: string) => {
    const list = (jobs || []).filter((j) => j.application && statuses.includes(j.application.status));
    return (
      <section aria-label={title} data-testid={testid} className="space-y-3">
        <h3 className="text-lg font-bold text-slate-900">{title} ({list.length})</h3>
        {list.length ? <ul className="space-y-3">{list.map((j) => <Item key={j.id} {...props} job={j} followUp={followUps.find((f) => f.job_id === j.id)} onFollowUp={onFollowUp} />)}</ul>
          : <p className="text-base text-slate-600">{empty}</p>}
      </section>
    );
  };
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-slate-900">{name}'s applications</h2>
      <p className="text-sm text-slate-600">This is your own record; the employer isn't told.</p>
      {error && <p role="alert" className="text-base text-rose-800">{error}</p>}
      {jobs === null ? <p className="text-base text-slate-600">Loading…</p> : <>
        {group('Saved, not applied', SAVED_GROUP, 'group-saved', 'Tap Save on any job to keep it here.')}
        {group('Applied, waiting', WAITING_GROUP, 'group-waiting', 'Nothing yet. After you apply, tap "Yes, I applied" and it shows here.')}
        {group('Finished', FINISHED_GROUP, 'group-finished', 'Nothing finished yet.')}
      </>}
    </div>
  );
};
