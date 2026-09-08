import React from 'react';
import { Globe3D } from './Globe3D.tsx';
import { Radio, Users, ShieldCheck, Zap, Lock, Volume2, Video, ArrowRight } from 'lucide-react';
import { ServerStats } from '../types.ts';

interface LandingHeroProps {
  onStartRandomTalk: () => void;
  onExploreRooms: () => void;
  stats: ServerStats;
}

export const LandingHero: React.FC<LandingHeroProps> = ({
  onStartRandomTalk,
  onExploreRooms,
  stats,
}) => {
  return (
    <div className="relative min-h-[calc(100vh-4rem)] min-h-[calc(100dvh-4rem)] flex flex-col justify-between overflow-hidden">
      {/* 3D Earth WebGL Canvas Background - touch-action friendly so mobile users can scroll freely */}
      <div className="absolute inset-0 z-0 pointer-events-none sm:pointer-events-auto">
        <Globe3D interactive={true} pulseCount={10} />
        {/* Subtle radial vignettes */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#07080c] via-transparent to-[#07080c]/60 pointer-events-none" />
        <div className="absolute inset-0 bg-radial-[at_center] from-transparent via-[#07080c]/40 to-[#07080c] pointer-events-none" />
      </div>

      {/* Foreground Hero Content */}
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 sm:pt-20 pb-12 sm:pb-16 flex-1 flex flex-col justify-center items-center text-center">
        {/* Futuristic Status Pill */}
        <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 rounded-full bg-white/[0.05] border border-white/10 backdrop-blur-md mb-6 sm:mb-8 text-xs sm:text-sm text-slate-300 max-w-[95%]">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shrink-0" />
          <span className="font-mono text-cyan-300 shrink-0">Global Peer Mesh</span>
          <span className="text-slate-500 hidden xs:inline">•</span>
          <span className="truncate hidden xs:inline">Instant WebRTC Connections</span>
        </div>

        {/* Hero Title with Display Typography */}
        <h1 className="text-3xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-tight font-display text-white max-w-5xl leading-[1.08] sm:leading-[1.05]">
          TALK TO <br />
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-violet-400 via-cyan-300 to-white">
            SOMEONE NEW.
          </span>
        </h1>

        {/* Hero Subtitle */}
        <p className="mt-4 sm:mt-6 text-base sm:text-xl md:text-2xl text-slate-300 max-w-2xl font-light leading-relaxed px-2">
          No accounts. No profiles. Just real-time voice and video conversations with strangers around the world.
        </p>

        {/* Main CTAs */}
        <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row items-center gap-3 sm:gap-4 w-full sm:w-auto max-w-sm sm:max-w-none">
          <button
            onClick={onStartRandomTalk}
            className="w-full sm:w-auto px-6 sm:px-8 py-3.5 sm:py-4 rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 text-white font-bold text-sm sm:text-lg tracking-wide shadow-2xl shadow-violet-600/30 active:scale-[0.98] transition-all flex items-center justify-center gap-2.5 sm:gap-3 border border-violet-400/40 group cursor-pointer"
          >
            <Radio className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-200 group-hover:scale-110 transition-transform animate-pulse" />
            <span>START RANDOM TALK</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>

          <button
            onClick={onExploreRooms}
            className="w-full sm:w-auto px-6 sm:px-8 py-3.5 sm:py-4 rounded-2xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 hover:text-white font-semibold text-sm sm:text-lg tracking-wide backdrop-blur-xl border border-white/10 active:scale-[0.98] transition-all flex items-center justify-center gap-2.5 sm:gap-3 cursor-pointer"
          >
            <Users className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
            <span>EXPLORE ROOMS</span>
          </button>
        </div>

        {/* Micro feature pills */}
        <div className="mt-8 sm:mt-12 flex flex-wrap items-center justify-center gap-3 sm:gap-6 text-xs sm:text-sm text-slate-400">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <ShieldCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400" />
            <span>100% Anonymous</span>
          </div>
          <span className="text-slate-700 hidden sm:inline">•</span>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400" />
            <span>Real-time Audio</span>
          </div>
          <span className="text-slate-700 hidden sm:inline">•</span>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Video className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-violet-400" />
            <span>HD Peer Video</span>
          </div>
          <span className="text-slate-700 hidden sm:inline">•</span>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Lock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400" />
            <span>No Data Stored</span>
          </div>
        </div>
      </div>

      {/* Feature Section Grid */}
      <div className="relative z-10 border-t border-white/5 bg-[#07080c]/80 backdrop-blur-xl py-8 sm:py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            <div className="p-5 sm:p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-violet-500/30 transition-colors">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-400 mb-3 sm:mb-4">
                <Zap className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <h2 className="text-base sm:text-lg font-bold font-display text-white mb-1">NO ACCOUNT</h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Jump in instantly. No email, no password, no phone number. Just your session.
              </p>
            </div>

            <div className="p-5 sm:p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-cyan-500/30 transition-colors">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-3 sm:mb-4">
                <Radio className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <h2 className="text-base sm:text-lg font-bold font-display text-white mb-1">REAL CONVERSATIONS</h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Meet someone completely new. Direct WebRTC audio/video with automated matchmaking.
              </p>
            </div>

            <div className="p-5 sm:p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-emerald-500/30 transition-colors">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-3 sm:mb-4">
                <Lock className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <h2 className="text-base sm:text-lg font-bold font-display text-white mb-1">PRIVATE BY DESIGN</h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                No database. No permanent profile. In-memory temporary state that dissolves on exit.
              </p>
            </div>

            <div className="p-5 sm:p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-purple-500/30 transition-colors">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-3 sm:mb-4">
                <Users className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <h2 className="text-base sm:text-lg font-bold font-display text-white mb-1">CREATE ROOMS</h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Start your own group spaces (3 to 20 participants) with image sharing and host controls.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
