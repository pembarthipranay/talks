import React from 'react';
import { ShieldCheck, X, EyeOff, Server, Database, Wifi } from 'lucide-react';

interface PrivacyNoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PrivacyNoticeModal: React.FC<PrivacyNoticeModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3.5 sm:p-4 bg-black/85 backdrop-blur-xl animate-in fade-in">
      <div className="relative w-full max-w-lg rounded-2xl sm:rounded-3xl bg-[#0d101a] border border-white/10 shadow-2xl p-5 sm:p-8 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 sm:top-5 sm:right-5 p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xl font-bold font-display text-white">Privacy & Technical Architecture</h3>
            <p className="text-xs text-slate-400">Randomtalks No-Account Guarantee</p>
          </div>
        </div>

        <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
          <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.06] flex items-start gap-3">
            <EyeOff className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white block text-sm mb-0.5">Zero Registration</strong>
              No accounts, email addresses, passwords, phone numbers, or social sign-ins are ever asked or stored. You exist purely as a temporary randomized session identifier.
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.06] flex items-start gap-3">
            <Database className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white block text-sm mb-0.5">Ephemeral In-Memory State</strong>
              There is no persistent SQL or document database. Waiting queues, active pairs, rooms, and text messages live in server memory only during active connections and vanish upon session termination.
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.06] flex items-start gap-3">
            <Server className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white block text-sm mb-0.5">Direct Media Transmission</strong>
              Audio and video streams are transmitted peer-to-peer over WebRTC. No audio recordings or video frames are stored on our servers.
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.06] flex items-start gap-3">
            <Wifi className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white block text-sm mb-0.5">Technical Network Notice</strong>
              In order for browsers to establish direct WebRTC connections across the Internet, STUN/TURN traversal servers and peer network endpoints naturally process temporary IP addresses and packet metadata as required by the fundamental WebRTC/UDP protocols.
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-white/5 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition-all shadow-lg shadow-violet-600/20"
          >
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
};
