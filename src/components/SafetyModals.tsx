import React, { useState } from 'react';
import { ShieldAlert, UserX, X, Check } from 'lucide-react';
import { ReportReason } from '../types.ts';

interface ReportModalProps {
  isOpen: boolean;
  strangerName: string;
  onClose: () => void;
  onSubmit: (reason: ReportReason, details?: string) => void;
}

const REPORT_REASONS: ReportReason[] = [
  'Harassment',
  'Spam',
  'Sexual content',
  'Violence',
  'Hate/abuse',
  'Other',
];

export const ReportModal: React.FC<ReportModalProps> = ({
  isOpen,
  strangerName,
  onClose,
  onSubmit,
}) => {
  const [selectedReason, setSelectedReason] = useState<ReportReason>('Harassment');
  const [details, setDetails] = useState('');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
      <div className="relative w-full max-w-md rounded-3xl bg-[#0d101a] border border-white/10 shadow-2xl p-6 sm:p-8">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xl font-bold font-display text-white">Report User</h3>
            <p className="text-xs text-slate-400">Reporting {strangerName}</p>
          </div>
        </div>

        <p className="text-xs text-slate-300 mb-4">
          Please select the reason for reporting this person. Reporting will disconnect your call and prevent rematching with them during your session.
        </p>

        <div className="space-y-2 mb-4">
          {REPORT_REASONS.map((reason) => (
            <label
              key={reason}
              onClick={() => setSelectedReason(reason)}
              className={`flex items-center justify-between p-3 rounded-xl border text-xs sm:text-sm cursor-pointer transition-all ${
                selectedReason === reason
                  ? 'bg-rose-500/10 border-rose-500/40 text-white font-medium'
                  : 'bg-white/[0.02] border-white/5 text-slate-400 hover:bg-white/[0.05]'
              }`}
            >
              <span>{reason}</span>
              {selectedReason === reason && <Check className="w-4 h-4 text-rose-400" />}
            </label>
          ))}
        </div>

        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Additional details (optional)..."
          maxLength={300}
          rows={2}
          className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500/50 mb-5 resize-none"
        />

        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSubmit(selectedReason, details);
              onClose();
            }}
            className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-lg shadow-rose-600/30"
          >
            Submit Report
          </button>
        </div>
      </div>
    </div>
  );
};

interface BlockModalProps {
  isOpen: boolean;
  strangerName: string;
  onClose: () => void;
  onConfirmBlock: () => void;
}

export const BlockModal: React.FC<BlockModalProps> = ({
  isOpen,
  strangerName,
  onClose,
  onConfirmBlock,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
      <div className="relative w-full max-w-sm rounded-3xl bg-[#0d101a] border border-white/10 shadow-2xl p-6 text-center">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-4">
          <UserX className="w-6 h-6" />
        </div>

        <h3 className="text-xl font-bold font-display text-white mb-2">Block Stranger?</h3>
        <p className="text-xs text-slate-400 mb-6 leading-relaxed">
          Are you sure you want to block <strong className="text-slate-200">{strangerName}</strong>? The current call will end immediately, and you will not be paired with them again for this session.
        </p>

        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirmBlock();
              onClose();
            }}
            className="flex-1 py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition-all shadow-lg shadow-amber-600/30"
          >
            Block & Disconnect
          </button>
        </div>
      </div>
    </div>
  );
};
