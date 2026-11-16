// The site a job seeker uses (plan phase 5): Farhan and Sana open it on a phone, see their jobs, open a posting, and keep track of what they
// applied to. Operator screens are not here; they open with ?operator=1 (plan U8).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Job, ApplicationStatus } from '../types';
import { loadAccessMode, isTrackerOpen, fetchToday, TodayData, fetchJobDetail, fetchProfile, fetchDiscoveryDaily, saveApplication, markJob, unsaveJob, WriteError } from '../api';
import { PEOPLE, CANDIDATE, NAME } from './format';
import { Route, View, parseRoute, routeHash, rememberedPerson, rememberPerson, lastVisitBaseline } from './route';
import { TodayView, AllView, HiddenView, CardActions } from './Lists';
import { ApplicationsView } from './ApplicationsView';
import { JobPanel } from './JobPanel';
import { useDialogFocus } from './useDialogFocus';
import { btn, btnPlain, btnPrimary } from './JobCard';

interface Toast { id: number; message: string; action?: { label: string; run: () => void } }
const PENDING_KEY = 'seeker:asked-apply';

export const SeekerApp: React.FC = () => {
  const [route, setRoute] = useState<Route>(() => {
    const r = parseRoute(window.location.hash);
    if (r.person) return r;
    const p = rememberedPerson();
    return p ? { person: p, view: 'today', jobId: null } : r;
  });
  const underneath = useRef<View>(route.view);
  const pushedPanel = useRef(false);
  // Plan U11: the address follows the screen; Back closes the panel; a reload lands on the same place.
  useEffect(() => {
    const want = routeHash(route);
    if (want && window.location.hash !== want) window.history.replaceState(null, '', window.location.pathname + window.location.search + want);
    const onHash = () => {
      const r = parseRoute(window.location.hash, underneath.current);
      if (!r.jobId) underneath.current = r.view;
      if (!r.jobId) pushedPanel.current = false;
      setRoute(r);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const go = useCallback((r: Route) => {
    if (!r.jobId) underneath.current = r.view;
    if (r.person) rememberPerson(r.person);
    const h = routeHash(r) || '#';
    if (window.location.hash === h) { setRoute(r); return; }
    window.location.hash = h;   // a history entry, so Back returns here
  }, []);
  const person = route.person;
  const candidateId = person ? CANDIDATE[person] : null;

  // Plan U13: ask /api/version first (open tracker or not), then load only the chosen person, once.
  const [ready, setReady] = useState(false);
  const [access, setAccess] = useState<boolean | null>(null);   // true open, false switched off by the server, null not known (no connection)
  useEffect(() => { loadAccessMode().then((open) => { setAccess(open); setReady(true); }); }, []);
  // the answer is kept with the person it is for, so a switch never shows (or keeps waiting on) the other person's list
  const [loaded, setData] = useState<TodayData | null>(null);
  const data = loaded && loaded.candidate_id === candidateId ? loaded : null;
  const [loadError, setLoadError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastRunAt, setLastRunAt] = useState<string | null | undefined>(undefined);
  const baseline = useRef<Record<string, number>>({});
  if (person && baseline.current[person] == null) baseline.current[person] = lastVisitBaseline(person);
  useEffect(() => { if (!ready) return; fetchDiscoveryDaily().then((d) => setLastRunAt(d.last_run_at ?? null)).catch(() => {}); }, [ready]);
  useEffect(() => {
    if (!ready || !candidateId) return;
    let live = true;
    setLoadError('');
    fetchToday(candidateId).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setLoadError(e.message); });
    return () => { live = false; };
  }, [ready, candidateId, refreshKey]);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);
  useEffect(() => { if (person) document.title = `${NAME[person]}'s jobs`; }, [person]);

  // Plan U4: every action says what happened, at the bottom of the screen.
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const say = useCallback((message: string, action?: Toast['action']) => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), message, action });
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }, []);
  const failed = useCallback((e: unknown) => {
    const w = e instanceof WriteError ? e : null;
    if (w && w.status === 409) say(w.message, { label: 'Reload', run: reload });
    else say(w?.message || (access === false ? 'Changes are switched off on this site.' : 'Could not save. Check the connection and try again.'));
  }, [say, reload, access]);

  // the profile's skills, for "Skills the posting names" in the panel (loaded once per person, only when a panel opens)
  const [skills, setSkills] = useState<Record<string, string[]>>({});
  const [panelJob, setPanelJob] = useState<Job | null>(null);
  useEffect(() => {
    if (!ready || !candidateId || !route.jobId) { setPanelJob(null); return; }
    const known = [...(data?.best || []), ...(data?.worth_a_try || []), ...(data?.recent || [])].find((j) => j.id === route.jobId);
    if (known) setPanelJob({ ...known, candidate_id: candidateId });
    let live = true;
    fetchJobDetail(route.jobId, candidateId).then((j) => { if (live && j) setPanelJob({ ...j, why_line: j.why_line || known?.why_line, candidate_id: candidateId }); })
      .catch(() => { if (live && !known) say('This job could not be opened. It may have closed.'); });
    if (!skills[candidateId]) fetchProfile(candidateId).then((p) => setSkills((s) => ({ ...s, [candidateId]: p.primary_skills || [] }))).catch(() => {});
    return () => { live = false; };
  }, [ready, candidateId, route.jobId, refreshKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const openJob = useCallback((job: Job) => { if (!person) return; pushedPanel.current = true; go({ person, view: underneath.current, jobId: job.id }); }, [person, go]);
  const closeJob = useCallback(() => {
    if (!person) return;
    if (pushedPanel.current) window.history.back();
    else go({ person, view: underneath.current, jobId: null });
  }, [person, go]);

  // Plan U7: after "Open posting", coming back to the tab asks "Did you apply?"
  const [asking, setAsking] = useState<Job | null>(null);
  const pending = useRef<Job | null>(null);
  const onPosting = useCallback((job: Job) => {
    pending.current = { ...job, candidate_id: candidateId || job.candidate_id, asked_at: Date.now() } as Job;
    try { window.sessionStorage.setItem(PENDING_KEY, JSON.stringify({ id: job.id, title: job.title, company: job.company, candidate_id: candidateId, application: job.application, asked_at: Date.now() })); } catch { /* fine */ }
  }, [candidateId]);
  useEffect(() => {
    const back = () => {
      if (document.visibilityState !== 'visible') return;
      let job = pending.current;
      if (!job) { try { const s = window.sessionStorage.getItem(PENDING_KEY); if (s) job = JSON.parse(s); } catch { /* fine */ } }
      if (!job) return;
      pending.current = null;
      try { window.sessionStorage.removeItem(PENDING_KEY); } catch { /* fine */ }
      if (Date.now() - Number((job as any).asked_at || 0) > 30 * 60000) return;   // a posting opened long ago: do not ask out of the blue
      if (job.application && !['SAVED', 'REVIEWING'].includes(job.application.status)) return;   // already applied
      setAsking(job);
    };
    // the posting may open in another tab (visibilitychange / focus) or in this one (Back from an in-app browser: pageshow, or a fresh load)
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    window.addEventListener('pageshow', back);
    back();
    return () => { document.removeEventListener('visibilitychange', back); window.removeEventListener('focus', back); window.removeEventListener('pageshow', back); };
  }, []);

  // ---- actions ----
  const cid = (job: Job) => job.candidate_id && Object.values(CANDIDATE).includes(job.candidate_id) ? job.candidate_id : candidateId!;
  // Tenth-man review: two quick changes (or a double tap) from one person must not trip the "changed elsewhere" check. Each write waits for the
  // previous one on the same job, and sends the updated_at the server returned for the last write made here (not the one from the last reload).
  const fresh = useRef<Record<string, string | null>>({});
  const chain = useRef<Record<string, Promise<unknown>>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const queued = <T,>(jobId: string, work: () => Promise<T>): Promise<T> => {
    const prev = chain.current[jobId] || Promise.resolve();
    setBusy((b) => ({ ...b, [jobId]: true }));
    const next = prev.catch(() => {}).then(work);
    chain.current[jobId] = next;
    next.finally(() => { if (chain.current[jobId] === next) { delete chain.current[jobId]; setBusy((b) => { const c = { ...b }; delete c[jobId]; return c; }); } }).catch(() => {});
    return next;
  };
  const setStage = useCallback(async (job: Job, status: ApplicationStatus, notes: string | undefined, clearNotes: boolean): Promise<boolean> => {
    try {
      await queued(job.id, async () => {
        const known = job.id in fresh.current ? fresh.current[job.id] : (job.application ? (job.application.updated_at ?? undefined) : null);
        const saved = await saveApplication({ candidate_id: cid(job), job_id: job.id, status, ...(notes !== undefined ? { notes } : {}), ...(clearNotes ? { clear_notes: true } : {}),
          ...(known !== undefined ? { expected_updated_at: known } : {}) });
        fresh.current[job.id] = saved?.application?.updated_at ?? null;
      });
      say(status === 'SAVED' && !job.application ? 'Saved' : clearNotes ? 'Note cleared' : notes !== undefined && status === job.application?.status ? 'Note saved' : `Saved: ${STAGE_SAY[status] || 'updated'}`);
      reload();
      return true;
    } catch (e) { failed(e); return false; }
  }, [say, failed, reload]);   // eslint-disable-line react-hooks/exhaustive-deps
  const unsave = (job: Job) => queued(job.id, async () => { await unsaveJob(job.id, cid(job)); fresh.current[job.id] = null; });
  const toggleSave = useCallback(async (job: Job) => {
    if (busy[job.id]) return;   // a double tap
    if (job.application && job.application.status === 'SAVED') {
      try { await unsave(job); say('Removed from your applications', { label: 'Undo', run: () => { setStage({ ...job, application: null }, 'SAVED', undefined, false); } }); reload(); }
      catch (e: any) { say(/notes|moved on|changed/i.test(e?.message || '') ? 'This has a note, so it stays. Change it in My applications.' : 'Could not save. Check the connection and try again.'); }
    } else if (job.application && job.application.status === 'REVIEWING') say('This is in Preparing. Change it in My applications.');
    else if (!job.application) await setStage(job, 'SAVED', undefined, false);
  }, [say, reload, setStage, busy]);   // eslint-disable-line react-hooks/exhaustive-deps
  const hide = useCallback(async (job: Job) => {
    try {
      await markJob(job.id, cid(job), 'DOWN');
      const plainSaved = job.application?.status === 'SAVED' && !(job.application.notes || '').trim();
      if (plainSaved) await unsave(job).catch(() => {});
      setData((d) => d && { ...d, best: d.best.filter((j) => j.id !== job.id), worth_a_try: d.worth_a_try.filter((j) => j.id !== job.id), recent: d.recent.filter((j) => j.id !== job.id) });
      say('Hidden', { label: 'Undo', run: async () => { try { await markJob(job.id, cid(job), 'CLEAR'); if (plainSaved) await setStage({ ...job, application: null }, 'SAVED', undefined, false); say('Back on your list'); reload(); } catch (e) { failed(e); } } });
      if (route.jobId === job.id) closeJob();
      reload();
    } catch (e) { failed(e); }
  }, [say, failed, reload, route.jobId, closeJob]);   // eslint-disable-line react-hooks/exhaustive-deps
  const restore = useCallback(async (job: Job) => {
    try { await markJob(job.id, cid(job), 'CLEAR'); say('Back on your list'); reload(); } catch (e) { failed(e); }
  }, [say, failed, reload]);   // eslint-disable-line react-hooks/exhaustive-deps
  const goodMatch = useCallback(async (job: Job, on: boolean) => {
    try { await markJob(job.id, cid(job), on ? 'UP' : 'CLEAR'); say(on ? 'Marked Good match' : 'Good match removed'); } catch (e) { failed(e); throw e; }
  }, [say, failed]);   // eslint-disable-line react-hooks/exhaustive-deps
  const remove = useCallback(async (job: Job) => { await toggleSave(job); return true; }, [toggleSave]);
  const answer = async (choice: 'yes' | 'later' | 'no') => {
    const job = asking; setAsking(null);
    if (!job) return;
    if (choice === 'yes') await setStage(job, 'APPLIED', undefined, false);
    else if (choice === 'later') { if (!job.application) await setStage(job, 'SAVED', undefined, false); else say('Kept in your saved jobs'); }
    else await hide(job);
  };
  const actions: CardActions = { onOpen: openJob, onPosting, onSave: toggleSave, onHide: hide };

  // ---- screens ----
  const counts = data?.counts;
  const topBar = (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200">
      <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-2">
        <div role="group" aria-label="Whose jobs" className="flex rounded-xl border border-slate-300 p-0.5 shrink-0">
          {PEOPLE.map((p) => (
            <button key={p} type="button" aria-pressed={person === p} onClick={() => go({ person: p, view: person && route.view !== 'home' ? route.view : 'today', jobId: null })}
              className={`min-h-[44px] px-2.5 rounded-lg text-sm font-semibold ${person === p ? 'bg-slate-900 text-white' : 'text-slate-700'}`}>{NAME[p]}</button>
          ))}
        </div>
        {person && <>
        <button type="button" onClick={() => go({ person, view: 'today', jobId: null })} aria-current={route.view === 'today' ? 'page' : undefined}
          className={`min-h-[44px] px-2 text-sm font-semibold rounded-lg ${route.view === 'today' ? 'text-slate-900 underline underline-offset-4' : 'text-slate-600'}`}>Today</button>
        <button type="button" onClick={() => go({ person, view: 'applications', jobId: null })} aria-current={route.view === 'applications' ? 'page' : undefined}
          data-testid="my-applications" className={`ml-auto min-h-[44px] px-2 text-sm font-semibold rounded-lg whitespace-nowrap ${route.view === 'applications' ? 'text-slate-900 underline underline-offset-4' : 'text-slate-600'}`}>
          <span className="min-[400px]:hidden">Applications</span><span className="hidden min-[400px]:inline">My applications</span>{counts ? ` (${counts.applications.total})` : ''}
        </button>
        </>}
      </div>
    </header>
  );

  let body: React.ReactNode;
  if (!person) {
    body = (
      <div className="space-y-6 pt-6">
        <h2 className="text-xl font-bold text-slate-900">Whose jobs?</h2>
        <div className="grid gap-3">
          {PEOPLE.map((p) => <button key={p} type="button" onClick={() => go({ person: p, view: 'today', jobId: null })} className={`${btnPrimary} text-lg min-h-[56px]`}>{NAME[p]}</button>)}
        </div>
        <p className="text-base text-slate-600">Your choice is remembered on this phone.</p>
      </div>
    );
  } else if (loadError && !data) {
    body = <div role="alert" className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-base space-y-3"><p>{loadError}</p><button type="button" className={btnPlain} onClick={reload}>Try again</button></div>;
  } else if (route.view === 'applications') {
    body = <ApplicationsView candidateId={candidateId!} name={NAME[person]} refreshKey={refreshKey} todayIndia={counts?.today_india || new Date().toISOString().slice(0, 10)}
      onOpen={openJob} onPosting={onPosting} onStage={setStage} onRemove={remove} toast={say} busy={busy} />;
  } else if (['all', 'best', 'worth', 'good'].includes(route.view)) {
    body = <AllView key={`${candidateId}:${route.view}`} candidateId={candidateId!} which={route.view} total={0} actions={actions} refreshKey={refreshKey} />;
  } else if (route.view === 'hidden') {
    body = <HiddenView key={candidateId} candidateId={candidateId!} actions={actions} onRestore={restore} refreshKey={refreshKey} />;
  } else {
    body = !data ? <p className="text-base text-slate-600 pt-4">Loading {NAME[person]}'s jobs…</p>
      : <TodayView data={data} baseline={baseline.current[person]} lastRunAt={lastRunAt} actions={actions} go={(v) => go({ person, view: v, jobId: null })} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 text-base">
      {topBar}
      <main className="max-w-3xl mx-auto px-4 py-4 pb-28">
        <h1 className="sr-only">{person ? `${NAME[person]}'s jobs` : 'Jobs'}</h1>
        {ready && access === false && !isTrackerOpen() && person && <p className="mb-3 text-sm text-slate-600">Saving and tracking are switched off on this site just now.</p>}
        {body}
      </main>
      {panelJob && person && (
        <JobPanel job={panelJob} profileSkills={skills[candidateId!]} onClose={closeJob} onPosting={onPosting} onHide={hide} onGoodMatch={goodMatch}
          onStage={(job, status, notes, clear) => setStage(job, status, notes, clear)} busy={!!busy[panelJob.id]} />
      )}
      {asking && <AskDialog title={asking.title} company={asking.company} onClose={() => setAsking(null)} onAnswer={answer} />}
      {toast && (
        <div key={toast.id} role="status" aria-live="polite" data-testid="toast" className="fixed bottom-4 inset-x-4 z-[70] mx-auto max-w-md bg-slate-900 text-white rounded-2xl px-4 py-2 flex items-center justify-between gap-3 shadow-lg">
          <span className="text-base">{toast.message}</span>
          <span className="flex gap-3">
            {toast.action && <button type="button" className={`${btn} text-amber-300 underline px-2`} onClick={() => { const a = toast.action!; setToast(null); a.run(); }}>{toast.action.label}</button>}
            <button type="button" aria-label="Dismiss message" className={`${btn} px-2 text-white/80`} onClick={() => setToast(null)}>×</button>
          </span>
        </div>
      )}
    </div>
  );
};

const STAGE_SAY: Record<string, string> = { SAVED: 'saved', REVIEWING: 'preparing', APPLIED: 'you applied', SCREENING: 'first call', INTERVIEWING: 'interviews', OFFER: 'got an offer', REJECTED: "didn't work out", WITHDRAWN: 'you withdrew' };

/** "Did you apply?" after opening a posting: focus stays inside it (Tab / Shift+Tab wrap), Escape or a tap outside closes it. */
const AskDialog: React.FC<{ title: string; company?: string | null; onClose: () => void; onAnswer: (a: 'yes' | 'later' | 'no') => void }> = ({ title, company, onClose, onAnswer }) => {
  const ref = useDialogFocus<HTMLDivElement>(onClose, true);
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40 flex items-end justify-center" onClick={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Did you apply?" onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-3xl rounded-t-2xl p-4 pb-6 space-y-3 outline-none">
        <h2 className="text-lg font-bold text-slate-900">Did you apply?</h2>
        <p className="text-base text-slate-700 break-words">{title}{company ? ` · ${company}` : ''}</p>
        <div className="grid gap-3">
          <button type="button" className={btnPrimary} onClick={() => onAnswer('yes')}>Yes, I applied</button>
          <button type="button" className={btnPlain} onClick={() => onAnswer('later')}>Not yet (keep saved)</button>
          <button type="button" className={btnPlain} onClick={() => onAnswer('no')}>Not for me</button>
        </div>
      </div>
    </div>
  );
};
