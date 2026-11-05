import React, { useState } from 'react';
import { Lock, Unlock, ShieldAlert, KeyRound, LogOut, CheckCircle2 } from 'lucide-react';
import { verifyOperatorKey, logoutOperator, isOperatorAuthenticated } from '../api';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthChange: (authenticated: boolean) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onAuthChange }) => {
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const authenticated = isOperatorAuthenticated();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) {
      setError('Please enter an operator access key.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await verifyOperatorKey(keyInput);
      setSuccess(true);
      setKeyInput('');
      onAuthChange(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 700);
    } catch (err: any) {
      setError(err.message || 'Invalid operator key. Access denied.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logoutOperator();
    onAuthChange(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-in fade-in duration-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-lg ${authenticated ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
              {authenticated ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900">
                {authenticated ? 'Operator Session Active' : 'Unlock Operator Actions'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {authenticated ? 'Signed in to change records' : 'Needed only to change records. Viewing is open to everyone.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 font-bold text-sm p-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {authenticated ? (
          <div className="space-y-4">
            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center gap-2.5 text-xs text-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>Operator session is active. You can review, override, and manage candidate workflows.</span>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
              >
                Close
              </button>
              <button
                id="operator-logout-btn"
                onClick={handleLogout}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log Out / Lock</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="operator-key-input" className="text-xs font-bold text-slate-700 block mb-1.5 flex items-center gap-1">
                <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                Operator Secret Key:
              </label>
              <input
                id="operator-key-input"
                type="password"
                placeholder="Enter operator access key..."
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                className="w-full text-xs border border-slate-300 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                autoFocus
              />
            </div>

            {error && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700">
                <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-700">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>Authentication successful! Unlocking controls...</span>
              </div>
            )}

            <p className="text-[11px] text-slate-400">
              Credentials are validated against the server and never embedded in frontend bundle files.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                id="operator-unlock-submit-btn"
                type="submit"
                disabled={loading || !keyInput.trim()}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>{loading ? 'Verifying...' : 'Unlock Actions'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
