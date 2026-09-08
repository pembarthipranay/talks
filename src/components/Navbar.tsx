import React, { useState } from 'react';
import { AppView, ServerStats } from '../types.ts';
import { Radio, Users, Shield, Sparkles, Menu, X, Activity } from 'lucide-react';

interface NavbarProps {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
  stats: ServerStats;
  onOpenPrivacy: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentView,
  onNavigate,
  stats,
  onOpenPrivacy,
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleMobileNav = (view: AppView) => {
    setIsMobileMenuOpen(false);
    onNavigate(view);
  };

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-xl bg-[#07080c]/90 border-b border-white/5 transition-colors">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <div className="flex items-center gap-4 sm:gap-8">
          <button
            onClick={() => onNavigate('landing')}
            className="flex items-center gap-2.5 sm:gap-3 text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded-lg p-1"
          >
            <div className="relative w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-tr from-violet-600 to-cyan-400 p-[1px] flex items-center justify-center shadow-lg shadow-violet-900/30 group-hover:scale-105 transition-transform shrink-0">
              <div className="w-full h-full rounded-full bg-[#090b12] flex items-center justify-center">
                <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-violet-400 animate-pulse" />
              </div>
            </div>
            <div className="flex flex-col">
              <span className="text-base sm:text-lg font-extrabold tracking-wider font-display text-white group-hover:text-violet-300 transition-colors">
                RANDOMTALKS
              </span>
              <span className="text-[9px] tracking-widest uppercase text-slate-400 font-mono -mt-1">
                Voice & Video
              </span>
            </div>
          </button>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-1" aria-label="Main Navigation">
            <button
              onClick={() => onNavigate('random-talk')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                currentView === 'random-talk'
                  ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-violet-400" />
                Random Talk
              </span>
            </button>
            <button
              onClick={() => onNavigate('rooms-discovery')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                currentView === 'rooms-discovery' || currentView === 'room-active'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-cyan-400" />
                Rooms
              </span>
            </button>
            <button
              onClick={onOpenPrivacy}
              className="px-3 py-1.5 rounded-full text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-all"
            >
              <span className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                No-Account Privacy
              </span>
            </button>
          </nav>
        </div>

        {/* Right Action & Global Activity Badge */}
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] text-xs text-slate-300">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="font-mono text-slate-200">{stats.onlineUsers || 1} online</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">{stats.activeRooms} rooms</span>
          </div>

          <button
            onClick={() => onNavigate('random-talk')}
            className="px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold tracking-wide bg-gradient-to-r from-violet-600 to-cyan-500 text-white hover:from-violet-500 hover:to-cyan-400 active:scale-[0.98] transition-all shadow-lg shadow-violet-600/25 flex items-center gap-1.5 sm:gap-2 border border-violet-400/30 shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden xs:inline sm:inline">Start Talking</span>
            <span className="xs:hidden sm:hidden">Talk</span>
          </button>

          {/* Mobile Menu Toggle Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 transition-colors focus:outline-none"
            aria-label="Toggle navigation menu"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer / Dropdown Navigation Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden bg-[#0a0d17]/95 border-b border-white/10 px-4 py-4 space-y-2 backdrop-blur-2xl animate-in slide-in-from-top-2 duration-200">
          <button
            onClick={() => handleMobileNav('random-talk')}
            className={`w-full flex items-center justify-between p-3 rounded-xl text-sm font-medium transition-colors ${
              currentView === 'random-talk'
                ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30'
                : 'text-slate-300 hover:bg-white/5'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Radio className="w-4 h-4 text-violet-400" />
              <span>Random Talk</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300">1-on-1</span>
          </button>

          <button
            onClick={() => handleMobileNav('rooms-discovery')}
            className={`w-full flex items-center justify-between p-3 rounded-xl text-sm font-medium transition-colors ${
              currentView === 'rooms-discovery' || currentView === 'room-active'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-300 hover:bg-white/5'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Users className="w-4 h-4 text-cyan-400" />
              <span>Topic Rooms</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300">
              {stats.activeRooms} live
            </span>
          </button>

          <button
            onClick={() => {
              setIsMobileMenuOpen(false);
              onOpenPrivacy();
            }}
            className="w-full flex items-center justify-between p-3 rounded-xl text-sm font-medium text-slate-300 hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <Shield className="w-4 h-4 text-emerald-400" />
              <span>No-Account Privacy</span>
            </div>
            <span className="text-[10px] font-mono text-emerald-400">0 Data Stored</span>
          </button>

          {/* Mobile Live Activity Strip */}
          <div className="pt-2 border-t border-white/5 flex items-center justify-between text-xs text-slate-400 font-mono px-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>{stats.onlineUsers || 1} online worldwide</span>
            </div>
            <span className="text-[11px] text-slate-500">Anonymous P2P</span>
          </div>
        </div>
      )}
    </header>
  );
};
