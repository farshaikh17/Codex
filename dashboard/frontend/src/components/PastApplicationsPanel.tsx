import React, { useEffect, useState } from 'react';
import { History, Trash2 } from 'lucide-react';
import { PastApplication, fetchPastApplications, addPastApplication, deletePastApplication } from '../api';

const OUTCOMES = [['REJECTED', 'Rejected'], ['NO_RESPONSE', 'No response'], ['APPLIED', 'Applied, waiting'], ['WITHDRAWN', 'Withdrawn']] as const;

// Applications made outside the dashboard. Each daily discovery run labels new jobs from an employer listed here as
// "rejected before"; nothing is hidden and nothing is sent anywhere.
export const PastApplicationsPanel: React.FC<{ candidateId: string }> = ({ candidateId }) => {
  const [rows, setRows] = useState<PastApplication[]>([]);
  const [form, setForm] = useState({ company: '', role: '', outcome: 'REJECTED', decided_on: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => fetchPastApplications(candidateId).then(setRows).catch(() => setError('Could not load the list.'));
  useEffect(() => { setRows([]); load(); }, [candidateId]);
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (!form.company.trim()) { setError('Company is required.'); return; }
    setBusy(true);
    try {
      await addPastApplication({ candidate_id: candidateId, company: form.company.trim(), role: form.role.trim() || undefined, outcome: form.outcome, decided_on: form.decided_on || undefined });
      setForm({ company: '', role: '', outcome: 'REJECTED', decided_on: '' }); await load();
    } catch (err: any) { setError(err?.message || 'Could not save.'); } finally { setBusy(false); }
  };
  const remove = async (id: number) => { try { await deletePastApplication(id); await load(); } catch { setError('Could not delete.'); } };
  return (
    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3 text-sm" data-testid="past-applications">
      <div className="flex items-center gap-2">
        <History className="w-5 h-5 text-emerald-600" />
        <div>
          <h3 className="text-sm font-bold text-slate-900">Applications made outside the dashboard</h3>
          <p className="text-xs text-slate-500">New jobs from an employer marked "Rejected" here are labelled "rejected before" in the next daily discovery. Nothing is hidden.</p>
        </div>
      </div>
      <form onSubmit={add} className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
        <input aria-label="Company" placeholder="Company" value={form.company} maxLength={120} onChange={(e) => setForm({ ...form, company: e.target.value })} className="sm:col-span-2 border border-slate-300 rounded-lg px-3 py-2" />
        <input aria-label="Role" placeholder="Role (optional)" value={form.role} maxLength={160} onChange={(e) => setForm({ ...form, role: e.target.value })} className="border border-slate-300 rounded-lg px-3 py-2" />
        <select aria-label="Outcome" value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })} className="border border-slate-300 rounded-lg px-3 py-2">
          {OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input aria-label="Date" type="date" value={form.decided_on} onChange={(e) => setForm({ ...form, decided_on: e.target.value })} className="border border-slate-300 rounded-lg px-3 py-2" />
        <button type="submit" disabled={busy} className="sm:col-span-5 sm:justify-self-end bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-2 rounded-lg disabled:opacity-50">{busy ? 'Saving…' : 'Add'}</button>
      </form>
      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
      {rows.length ? (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.id} className="py-2 flex items-center justify-between gap-3">
              <span><span className="font-semibold text-slate-800">{r.company}</span>{r.role ? <span className="text-slate-500"> · {r.role}</span> : null}
                <span className="ml-2 text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">{OUTCOMES.find(([v]) => v === r.outcome)?.[1] || r.outcome}</span>
                {r.decided_on ? <span className="ml-2 text-xs text-slate-400">{r.decided_on}</span> : null}</span>
              <button type="button" aria-label={`Delete ${r.company}`} onClick={() => remove(r.id)} className="text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-slate-400">None recorded yet.</p>}
    </div>
  );
};
