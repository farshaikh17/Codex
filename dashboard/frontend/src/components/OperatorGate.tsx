import React, { useEffect, useState } from 'react';
import { checkStoredOperatorKey, verifyOperatorKey, OPERATOR_SIGNED_OUT_EVENT } from '../api';

// Gap fix (13 Nov): the operator screens (/app?operator=1) need the operator key to VIEW, not only to change records. Without a key that the
// server accepts, this plain sign-in prompt is shown and the operator dashboard is not loaded (it makes no request). A client's share link
// (#view=...) does not come here: it keeps its read-only dashboard without a key. Signing out (or a key the server stops accepting) locks it again.
type State = 'checking' | 'locked' | 'open';

export const OperatorGate: React.FC<{ children: () => React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<State>('checking');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.title = 'Operator sign-in';
    let live = true;
    checkStoredOperatorKey().then((r) => {
      if (!live) return;
      if (r === 'ok') setState('open');
      else {
        setState('locked');
        if (r === 'unknown') setError('Could not check the saved key just now (no connection or a server problem). Sign in again.');
        if (r === 'rejected') setError('The saved operator key is no longer accepted. Enter the current key.');
        if (r === 'locked') setError('Too many wrong keys from this network. Try again in 15 minutes.');
      }
    });
    const lock = () => { setState('locked'); setError(null); document.title = 'Operator sign-in'; };
    window.addEventListener(OPERATOR_SIGNED_OUT_EVENT, lock);
    return () => { live = false; window.removeEventListener(OPERATOR_SIGNED_OUT_EVENT, lock); };
  }, []);

  if (state === 'open') return <>{children()}</>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) { setError('Enter the operator key.'); return; }
    setBusy(true); setError(null);
    try { await verifyOperatorKey(key); setKey(''); setState('open'); }
    catch (err: any) { setError(String(err?.message || '') || 'That key was not accepted.'); }
    finally { setBusy(false); }
  };
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <form onSubmit={submit} aria-label="Operator sign-in" data-testid="operator-gate" className="bg-white rounded-2xl border border-slate-200 shadow-sm w-full max-w-sm p-6 space-y-4">
        <h1 className="text-lg font-bold text-slate-900">Operator sign-in</h1>
        <p className="text-sm text-slate-600">The operator screens need the operator key. Looking for your jobs? <a className="text-indigo-700 underline" href="/app">Open your job list</a>.</p>
        {state === 'checking' ? <p className="text-sm text-slate-500" role="status">Checking…</p> : (
          <>
            <label htmlFor="operator-key-input" className="block text-sm font-medium text-slate-800">Operator key</label>
            <input id="operator-key-input" type="password" autoComplete="current-password" value={key} onChange={(e) => setKey(e.target.value)}
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm" />
            {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
            <button type="submit" disabled={busy} className="w-full min-h-[44px] rounded-lg bg-slate-900 text-white text-sm font-semibold disabled:opacity-60">
              {busy ? 'Checking…' : 'Sign in'}
            </button>
          </>
        )}
      </form>
    </main>
  );
};
