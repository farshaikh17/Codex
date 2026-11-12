import React from 'react';
import { BarChart3, BookmarkCheck, RefreshCw, LayoutDashboard, Users, Lock, Unlock, Sliders, Briefcase } from 'lucide-react';

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
  trackerOpen?: boolean;
  onOpenAuth?: () => void;
  /** resold clients this viewer may see (the built-in two have their own buttons) */
  clients?: { id: string; full_name: string }[];
  activeClient?: string | null;
  onSelectClient?: (id: string) => void;
  /** brand set for the public site */
  brand?: string;
  /** a client viewing through a share link: only their own workspace, never other people's */
  viewer?: { name: string; onOpen: () => void } | null;
}

// Same visual language as the public site: navy announcement bar, cream header, serif wordmark, coral for the active item.
const item = (on: boolean) =>
  `px-3 py-1.5 text-sm font-semibold rounded-full transition-colors flex items-center gap-1.5 ${on ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:text-coral-600 hover:bg-white'}`;

export const Navbar: React.FC<NavbarProps> = ({
  activeTab, setActiveTab, savedCount, onReloadFixtures, isLoading, isOperator = false, trackerOpen = false, onOpenAuth, clients = [], activeClient = null, onSelectClient, brand = 'Career Job Engine', viewer = null,
}) => {
  return (
    <header className="sticky top-0 z-40">
      <div className="bg-gradient-to-r from-[#173a4f] to-slate-900 text-white text-xs font-semibold px-4 py-2 flex items-center justify-between gap-3">
        <span>Daily-screened job dashboards · <span className="text-[#F5C451]">{isOperator ? 'Operator mode: changes enabled' : trackerOpen ? 'Tracker open: save, track and rate jobs without signing in' : 'Read-only view'}</span></span>
        <a href="/" className="hidden sm:inline text-white/80 hover:text-white">← Website</a>
      </div>
      <div className="bg-slate-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap gap-3 items-center justify-between">
          <a href="/" title="Back to the website" className="flex items-center gap-3 hover:opacity-90">
            <span className="w-9 h-9 rounded-full grid place-items-center text-white shadow-sm" style={{ background: 'radial-gradient(circle at 30% 30%, #F5A35C, #E4572E 70%)' }}>
              <Briefcase className="w-4 h-4" />
            </span>
            <span>
              <span className="block font-serif text-lg font-semibold text-slate-900 leading-tight">{brand}</span>
              <span className="block text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500">{viewer ? `${viewer.name}'s dashboard` : 'Client dashboards'}</span>
            </span>
          </a>

          <nav className="flex flex-wrap items-center gap-1 max-w-full" aria-label="Dashboard">
            {viewer ? (
              <button aria-label="My jobs" onClick={viewer.onOpen} className={item(['farhan', 'sana', 'client', 'discovery'].includes(activeTab))}>
                <Briefcase className="w-4 h-4" /><span>My jobs</span>
              </button>
            ) : <>
            <button aria-label="Dashboard" onClick={() => setActiveTab('dashboard')} className={item(activeTab === 'dashboard')}>
              <LayoutDashboard className="w-4 h-4" /><span>Dashboard</span>
            </button>
            <button aria-label="Farhan" onClick={() => setActiveTab('farhan')} className={item(activeTab === 'farhan')}>
              <Users className="w-4 h-4" /><span>Farhan</span>
            </button>
            <button aria-label="Sana" onClick={() => setActiveTab('sana')} className={item(activeTab === 'sana')}>
              <Users className="w-4 h-4" /><span>Sana</span>
            </button>
            {clients.length > 0 && (
              <label className={`${item(activeTab === 'client')} pr-1`}>
                <span className="sr-only">Client workspace</span>
                <Users className="w-4 h-4" />
                <select data-testid="client-select" aria-label="Client workspace" value={activeTab === 'client' && activeClient ? activeClient : ''}
                  onChange={(e) => e.target.value && onSelectClient?.(e.target.value)}
                  className="appearance-none bg-transparent font-semibold text-sm outline-none cursor-pointer max-w-[11rem] pr-1">
                  <option value="" disabled>{clients.length === 1 ? "Client ▾" : `Clients (${clients.length}) ▾`}</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </select>
              </label>
            )}
            </>}
            <button aria-label="Applications" onClick={() => setActiveTab('tracker')} className={item(activeTab === 'tracker')}>
              <BookmarkCheck className="w-4 h-4" /><span>Applications</span>
              {savedCount > 0 && <span className={`ml-0.5 text-xs px-1.5 rounded-full font-mono ${activeTab === 'tracker' ? 'bg-white/20' : 'bg-slate-200'}`}>{savedCount}</span>}
            </button>
            {!viewer && <button aria-label="Settings" title="Candidate profile" onClick={() => setActiveTab('profile')} className={item(activeTab === 'profile')}>
              <Sliders className="w-4 h-4" /><span className="hidden sm:inline">Profile</span>
            </button>}
            {isOperator && (
              <button aria-label="Manage clients" onClick={() => setActiveTab('clients')} className={item(activeTab === 'clients')}>
                <Users className="w-4 h-4" /><span>Manage clients</span>
              </button>
            )}
            <span className="h-6 w-px bg-slate-200 mx-1 hidden sm:block" />
            <button aria-label="Analytics" title="Funnel analytics" onClick={() => setActiveTab('analytics')}
              className={`p-2 rounded-full transition-colors ${activeTab === 'analytics' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-coral-600 hover:bg-white'}`}>
              <BarChart3 className="w-4 h-4" />
            </button>
            <button onClick={onReloadFixtures} disabled={isLoading} title="Sync / Refresh"
              className="p-2 text-slate-500 hover:text-coral-600 hover:bg-white rounded-full transition-colors disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-600' : ''}`} />
            </button>
            <button
              aria-label={isOperator ? 'Operator mode on: records can be changed' : 'Viewing only. Operator sign-in is needed to change records'}
              onClick={onOpenAuth}
              title={isOperator ? 'Operator mode on (click to sign out)' : 'Viewing only (click for operator sign-in)'}
              className="p-2 text-slate-500 hover:text-coral-600 hover:bg-white rounded-full transition-colors"
            >
              {isOperator ? <Unlock className="w-4 h-4 text-emerald-600" /> : <Lock className="w-4 h-4 text-amber-600" />}
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
};
