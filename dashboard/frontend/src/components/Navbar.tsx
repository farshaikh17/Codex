import React from 'react';
import { Briefcase, Sliders, BarChart3, BookmarkCheck, RefreshCw, ShieldCheck, Radio, LayoutDashboard, Zap, Users, Lock, Unlock } from 'lucide-react';

export type NavTab = 'dashboard' | 'farhan' | 'sana' | 'client' | 'clients' | 'tracker' | 'discovery' | 'profile' | 'sources' | 'analytics' | 'india-remote' | 'ready' | 'pilot' | 'automation' | 'google-sync';

interface NavbarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  savedCount: number;
  readyCount?: number;
  indiaRemoteCount?: number;
  onReloadFixtures: () => void;
  isLoading: boolean;
  pilotActive?: boolean;
  isOperator?: boolean;
  onOpenAuth?: () => void;
  /** resold clients this viewer may see (the built-in two have their own buttons) */
  clients?: { id: string; full_name: string }[];
  activeClient?: string | null;
  onSelectClient?: (id: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  savedCount,
  readyCount: _readyCount,
  indiaRemoteCount: _indiaRemoteCount,
  onReloadFixtures,
  isLoading,
  pilotActive: _pilotActive,
  isOperator = false,
  onOpenAuth,
  clients = [],
  activeClient = null,
  onSelectClient,
}) => {
  return (
    <header className="bg-slate-900 border-b border-slate-800 text-white sticky top-0 z-40">
      {/* Cloud-Aware Banner */}
      <div className="bg-emerald-500/10 border-b border-emerald-500/20 px-4 py-1.5 text-xs text-emerald-300 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 text-emerald-400" />
          <span>
            <strong className="font-semibold uppercase tracking-wider">Cloud Engine:</strong> Multi-Candidate Career Engine running on Cloudflare Workers &amp; D1. Independent pipelines per candidate.
          </span>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 text-emerald-400/80 text-[11px]">
          <span>Public read-only view • Changes need the operator key</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-16 py-3 flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-600 p-2 rounded-lg text-white shadow-sm shadow-emerald-500/20">
            <Briefcase className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              Career Job Engine
              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-mono font-medium">Multi-Candidate</span>
            </h1>
            <p className="text-xs text-slate-400">{['Farhan', 'Sana', ...clients.map((c) => c.full_name.split(' ')[0])].join(' • ')}</p>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-1 sm:gap-2 max-w-full py-1">
          {/* 1. DASHBOARD */}
          <button
            aria-label="Dashboard"
            onClick={() => setActiveTab('dashboard')}
            className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
              activeTab === 'dashboard'
                ? 'bg-slate-800 text-emerald-400 shadow-sm border border-slate-700'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>DASHBOARD</span>
          </button>

          {/* 2. FARHAN */}
          <button
            aria-label="Farhan"
            onClick={() => setActiveTab('farhan')}
            className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
              activeTab === 'farhan'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-blue-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>FARHAN</span>
          </button>

          {/* 3. SANA */}
          <button
            aria-label="Sana"
            onClick={() => setActiveTab('sana')}
            className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
              activeTab === 'sana'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-amber-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Zap className="w-4 h-4" />
            <span>SANA</span>
          </button>

          {/* resold clients */}
          {clients.map((c) => (
            <button key={c.id} aria-label={c.full_name} data-client-tab={c.id} onClick={() => onSelectClient?.(c.id)}
              className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
                activeTab === 'client' && activeClient === c.id ? 'bg-emerald-600 text-white shadow-sm' : 'text-emerald-300 hover:text-white hover:bg-slate-800/60'}`}>
              <Users className="w-4 h-4" />
              <span>{c.full_name.split(' ')[0].toUpperCase()}</span>
            </button>
          ))}
          {isOperator && (
            <button aria-label="Clients" onClick={() => setActiveTab('clients')}
              className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
                activeTab === 'clients' ? 'bg-slate-800 text-emerald-400 shadow-sm border border-slate-700' : 'text-slate-300 hover:text-white hover:bg-slate-800/60'}`}>
              <Sliders className="w-4 h-4" />
              <span>CLIENTS</span>
            </button>
          )}

          {/* 4. APPLICATIONS */}
          <button
            aria-label="Applications"
            onClick={() => setActiveTab('tracker')}
            className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
              activeTab === 'tracker'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-purple-300 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <BookmarkCheck className="w-4 h-4" />
            <span>APPLICATIONS</span>
            {savedCount > 0 && (
              <span className="ml-1 bg-white/20 text-white text-xs px-1.5 py-0.2 rounded-full font-mono">
                {savedCount}
              </span>
            )}
          </button>

          {/* 5. DISCOVERY / REVIEW */}
          <button
            aria-label="Discovery"
            onClick={() => setActiveTab('discovery')}
            className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
              activeTab === 'discovery'
                ? 'bg-slate-800 text-teal-400 shadow-sm border border-slate-700'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Radio className="w-4 h-4 text-teal-400" />
            <span className="hidden sm:inline">DISCOVERY / REVIEW</span>
          </button>

          {/* 6. SETTINGS */}
          <button
            aria-label="Settings"
            onClick={() => setActiveTab('profile')}
            title="Candidate Profile Settings"
            className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
              activeTab === 'profile'
                ? 'bg-slate-800 text-emerald-400 shadow-sm border border-slate-700'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Sliders className="w-4 h-4 text-emerald-400" />
            <span className="hidden sm:inline">SETTINGS</span>
          </button>

          <div className="h-6 w-px bg-slate-800 mx-1 hidden sm:block" />

          {/* Secondary links */}
          <button
            aria-label="Analytics"
            onClick={() => setActiveTab('analytics')}
            title="Funnel Analytics"
            className={`p-2 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'analytics' ? 'text-emerald-400 bg-slate-800' : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
          </button>

          <button
            onClick={onReloadFixtures}
            disabled={isLoading}
            title="Sync / Refresh"
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>

          <button
            aria-label={isOperator ? 'Operator mode on: records can be changed' : 'Viewing only. Operator sign-in is needed to change records'}
            onClick={onOpenAuth}
            title={isOperator ? 'Operator mode on (click to sign out)' : 'Viewing only (click for operator sign-in)'}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
          >
            {isOperator ? <Unlock className="w-4 h-4 text-emerald-400" /> : <Lock className="w-4 h-4 text-amber-400" />}
          </button>

          </nav>
      </div>
    </header>
  );
};
