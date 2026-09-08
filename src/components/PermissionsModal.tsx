import React, { useState, useEffect, useRef } from 'react';
import { Camera, Mic, MicOff, VideoOff, CheckCircle2, AlertCircle, RefreshCw, X, Sparkles } from 'lucide-react';
import { requestUserMedia, stopMediaStream } from '../services/webrtc.ts';

interface PermissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReadyToStart: (stream: MediaStream) => void;
}

export const PermissionsModal: React.FC<PermissionsModalProps> = ({
  isOpen,
  onClose,
  onReadyToStart,
}) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasCamera, setHasCamera] = useState(false);
  const [hasMic, setHasMic] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);

  const isAcceptedRef = useRef(false);

  const initPermissions = async () => {
    setIsRequesting(true);
    setError(null);

    const res = await requestUserMedia(true, true);
    setIsRequesting(false);

    if (res.error || !res.stream) {
      setError(res.error || 'Failed to access camera or microphone.');
      setHasCamera(false);
      setHasMic(false);
      return;
    }

    setStream(res.stream);
    const vTrack = res.stream.getVideoTracks()[0];
    const aTrack = res.stream.getAudioTracks()[0];

    setHasCamera(Boolean(vTrack && vTrack.enabled));
    setHasMic(Boolean(aTrack && aTrack.enabled));

    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = res.stream;
    }
  };

  useEffect(() => {
    if (isOpen) {
      isAcceptedRef.current = false;
      initPermissions();
    } else {
      // Only tear down stream if modal was closed without being accepted
      if (stream && !isAcceptedRef.current) {
        stopMediaStream(stream);
        setStream(null);
      }
    }
    return () => {
      // On unmount, only stop stream if it was NOT accepted and passed to the caller
      if (stream && !isAcceptedRef.current) {
        stopMediaStream(stream);
      }
    };
  }, [isOpen]);

  // Connect stream to video element whenever stream changes
  useEffect(() => {
    if (videoPreviewRef.current && stream) {
      videoPreviewRef.current.srcObject = stream;
    }
  }, [stream]);

  if (!isOpen) return null;

  const toggleMic = () => {
    if (!stream) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
    }
  };

  const toggleVideo = () => {
    if (!stream) return;
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsVideoOff(!videoTrack.enabled);
    }
  };

  const handleStart = () => {
    if (stream) {
      isAcceptedRef.current = true;
      onReadyToStart(stream);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3.5 sm:p-4 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl sm:rounded-3xl bg-[#0d101a] border border-white/10 shadow-2xl p-5 sm:p-8 overflow-y-auto max-h-[92vh]">
        {/* Glow ambient background */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-cyan-600/10 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-xs font-mono text-violet-300 mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            Device Check
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold font-display text-white">
            Ready to talk?
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Check your camera and microphone preview before meeting a stranger.
          </p>
        </div>

        {/* Camera Preview Container */}
        <div className="relative w-full aspect-video rounded-2xl bg-black/60 border border-white/10 overflow-hidden mb-6 flex items-center justify-center shadow-inner">
          {error ? (
            <div className="p-6 text-center max-w-sm flex flex-col items-center">
              <AlertCircle className="w-10 h-10 text-rose-400 mb-3" />
              <h4 className="text-base font-semibold text-rose-200 mb-1">Access Required</h4>
              <p className="text-xs text-slate-400 mb-4">{error}</p>
              <button
                onClick={initPermissions}
                className="px-4 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-200 text-xs font-medium border border-rose-500/30 flex items-center gap-2 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 animate-spin-reverse" />
                Try Again
              </button>
            </div>
          ) : isRequesting ? (
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin text-violet-400" />
              <span className="text-xs font-mono">Requesting browser permissions...</span>
            </div>
          ) : (
            <>
              <video
                ref={videoPreviewRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover scale-x-[-1] ${isVideoOff ? 'hidden' : 'block'}`}
              />
              {isVideoOff && (
                <div className="flex flex-col items-center gap-2 text-slate-500">
                  <VideoOff className="w-12 h-12" />
                  <span className="text-xs font-mono">Camera is turned off</span>
                </div>
              )}

              {/* In-preview toggles */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
                <button
                  onClick={toggleMic}
                  className={`p-2 rounded-full transition-colors ${
                    isMuted ? 'bg-rose-500/20 text-rose-400' : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
                <button
                  onClick={toggleVideo}
                  className={`p-2 rounded-full transition-colors ${
                    isVideoOff ? 'bg-rose-500/20 text-rose-400' : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                  title={isVideoOff ? 'Turn video on' : 'Turn video off'}
                >
                  {isVideoOff ? <VideoOff className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Hardware Checks Status */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div className="flex items-center gap-2.5">
              <Camera className={`w-4 h-4 ${hasCamera ? 'text-cyan-400' : 'text-slate-500'}`} />
              <span className="text-xs font-medium text-slate-200">Camera</span>
            </div>
            {hasCamera ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <span className="text-[10px] font-mono text-slate-500">Not detected</span>
            )}
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div className="flex items-center gap-2.5">
              <Mic className={`w-4 h-4 ${hasMic ? 'text-violet-400' : 'text-slate-500'}`} />
              <span className="text-xs font-medium text-slate-200">Microphone</span>
            </div>
            {hasMic ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <span className="text-[10px] font-mono text-slate-500">Not detected</span>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 font-medium text-sm transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={!stream || isRequesting}
            className="flex-2 py-3 px-6 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm tracking-wide shadow-lg shadow-violet-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>START MATCHING</span>
          </button>
        </div>
      </div>
    </div>
  );
};
