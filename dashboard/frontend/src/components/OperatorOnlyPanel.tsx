import { Lock } from 'lucide-react';

/** Shown instead of an operator-only screen. Nothing is requested from the server until the operator signs in. */
export function OperatorOnlyPanel({ what, onUnlock }: { what: string; onUnlock: () => void }) {
  return (
    <div className="p-8 rounded-xl border border-slate-200 bg-white text-center text-slate-600">
      <Lock className="w-6 h-6 mx-auto mb-2 text-slate-400" aria-hidden="true" />
      <p className="text-sm font-semibold text-slate-800">{what} is available to the dashboard operator only.</p>
      <p className="text-sm mt-1">Jobs, search, filters, candidates and analytics are open to everyone. This screen needs the operator key.</p>
      <button type="button" onClick={onUnlock} className="mt-4 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold">Operator sign-in</button>
    </div>
  );
}
