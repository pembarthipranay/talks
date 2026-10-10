import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Database,
  Activity,
  Clock,
  Users,
  Search,
  RefreshCw,
  Trash2,
  Download,
  Copy,
  Check,
  ExternalLink,
  ShieldAlert,
  X,
  Radio,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  CheckCircle2,
  Server,
  KeyRound,
  AlertCircle,
} from 'lucide-react';
import { CallSessionRecord } from '../types.ts';
import {
  subscribeToSessions,
  saveSessionEnd,
  deleteSessionRecord,
  clearAllSessionRecords,
  fetchRealtimeSessions,
  verifyAdminKey,
  FIREBASE_CONFIG,
  testFirestoreConnection,
} from '../services/firebase.ts';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ isOpen, onClose }) => {
  const [sessions, setSessions] = useState<CallSessionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<'all' | 'random_talk' | 'private_room' | 'public_room'>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'active' | 'completed'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [inspectedSession, setInspectedSession] = useState<CallSessionRecord | null>(null);

  const [dbStatus, setDbStatus] = useState<{ ok: boolean; message: string }>({
    ok: true,
    message: 'Connecting to Cloud Firestore...',
  });

  // Admin access gate state
  const [adminKey, setAdminKey] = useState<string>(() => sessionStorage.getItem('rt_admin_passcode') || '');
  const [isUnlocked, setIsUnlocked] = useState<boolean>(() => Boolean(sessionStorage.getItem('rt_admin_passcode')));
  const [pinInput, setPinInput] = useState('');
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [currentTime, setCurrentTime] = useState(Date.now());

  // Live timer for active sessions calculation
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Subscribe to real-time Cloud Firestore updates when open and unlocked
  useEffect(() => {
    if (!isOpen || !isUnlocked) return;

    testFirestoreConnection().then(setDbStatus);

    setIsLoading(true);
    const unsubscribe = subscribeToSessions((records) => {
      setSessions(records);
      setIsLoading(false);
      setLastRefreshedAt(new Date());
    }, adminKey);

    return () => {
      unsubscribe();
    };
  }, [isOpen, isUnlocked, adminKey]);

  // Robust manual refresh handler
  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [connStatus, freshSessions] = await Promise.all([
        testFirestoreConnection(),
        fetchRealtimeSessions(adminKey),
      ]);
      setDbStatus(connStatus);
      setSessions(freshSessions);
      const now = new Date();
      setLastRefreshedAt(now);
      setRefreshNotice(`Refreshed ${freshSessions.length} live sessions at ${now.toLocaleTimeString()}`);
      setTimeout(() => setRefreshNotice(null), 3000);
    } catch (err) {
      console.error('Manual refresh error:', err);
      setRefreshNotice('Refresh failed. Please check network connection.');
      setTimeout(() => setRefreshNotice(null), 3500);
    } finally {
      setTimeout(() => setIsRefreshing(false), 300);
    }
  }, [adminKey]);

  // Admin passcode submission handler
  const handleUnlockSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!pinInput.trim()) {
      setPinError('Please enter the administrator key.');
      return;
    }

    setIsVerifyingPin(true);
    setPinError(null);

    try {
      const isValid = await verifyAdminKey(pinInput.trim());
      if (isValid) {
        const key = pinInput.trim();
        sessionStorage.setItem('rt_admin_passcode', key);
        setAdminKey(key);
        setIsUnlocked(true);
        setPinInput('');
      } else {
        setPinError('Incorrect administrator key. Access denied.');
      }
    } catch (err) {
      setPinError('Verification failed. Please try again.');
    } finally {
      setIsVerifyingPin(false);
    }
  };

  // Lock admin session
  const handleLockPanel = () => {
    sessionStorage.removeItem('rt_admin_passcode');
    setAdminKey('');
    setIsUnlocked(false);
    setSessions([]);
  };

  // Copy helper
  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Force end an active session
  const handleForceEndSession = async (sessionId: string, startedAtStr: string) => {
    try {
      const elapsed = Math.round((Date.now() - new Date(startedAtStr).getTime()) / 1000);
      await saveSessionEnd(sessionId, Math.max(1, elapsed));
      await handleManualRefresh();
    } catch (err) {
      console.error('Failed to end session:', err);
    }
  };

  // Delete a session record
  const handleDeleteSession = async (sessionId: string) => {
    if (confirm(`Delete session "${sessionId}" from database?`)) {
      await deleteSessionRecord(sessionId, adminKey);
      await handleManualRefresh();
    }
  };

  // Clear all database records
  const handleClearAll = async () => {
    if (confirm('Are you sure you want to clear all real-time session records? This will delete all logged calls from Cloud Firestore.')) {
      await clearAllSessionRecords(adminKey);
      await handleManualRefresh();
    }
  };

  // Export records as JSON
  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(sessions, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `randomtalks-sessions-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Filtered sessions (only genuine real-time sessions)
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      const matchesSearch =
        searchQuery === '' ||
        s.sessionId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.roomId && s.roomId.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (s.participants && s.participants.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesType = selectedType === 'all' || s.type === selectedType;
      const matchesStatus = selectedStatus === 'all' || s.status === selectedStatus;

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [sessions, searchQuery, selectedType, selectedStatus]);

  // Aggregate metrics
  const stats = useMemo(() => {
    const total = sessions.length;
    const active = sessions.filter((s) => s.status === 'active').length;
    const completed = sessions.filter((s) => s.status === 'completed').length;
    const totalSeconds = sessions.reduce((acc, s) => {
      if (s.status === 'active') {
        const liveSec = Math.max(0, Math.round((currentTime - new Date(s.startedAt).getTime()) / 1000));
        return acc + liveSec;
      }
      return acc + (s.durationSeconds || 0);
    }, 0);

    const avgSeconds = total > 0 ? Math.round(totalSeconds / total) : 0;

    return { total, active, completed, totalSeconds, avgSeconds };
  }, [sessions, currentTime]);

  // Format seconds to hh:mm:ss or mm:ss
  const formatDuration = (totalSeconds: number) => {
    if (totalSeconds < 0 || isNaN(totalSeconds)) return '00:00';
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return (
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
        ' ' +
        d.toLocaleDateString([], { month: 'short', day: 'numeric' })
      );
    } catch {
      return isoString;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200">
      {/* 1. ADMIN LOCK SCREEN (If not authenticated) */}
      {!isUnlocked ? (
        <div className="relative w-full max-w-md bg-[#0c101d] border border-white/15 rounded-3xl p-6 sm:p-8 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-violet-600 via-indigo-500 to-cyan-500" />
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex flex-col items-center text-center mt-2">
            <div className="p-4 rounded-2xl bg-violet-600/20 border border-violet-500/30 text-violet-400 mb-4 shadow-lg shadow-violet-900/20">
              <Lock className="w-8 h-8" />
            </div>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold bg-violet-500/20 text-violet-300 border border-violet-500/30 mb-2 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" />
              ADMINISTRATOR ONLY
            </span>
            <h2 className="text-xl font-bold font-display text-white tracking-wide">
              Admin Access Authentication
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-xs">
              Access to real-time call telemetry and Firestore database records is strictly restricted to platform administrators.
            </p>
          </div>

          <form onSubmit={handleUnlockSubmit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300">
                Administrator Security Passcode
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value);
                    if (pinError) setPinError(null);
                  }}
                  placeholder="Enter administrator passcode..."
                  autoFocus
                  className="w-full px-4 py-3 pr-11 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 font-mono transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {pinError && (
              <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs flex items-center gap-2 animate-in fade-in">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{pinError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isVerifyingPin || !pinInput.trim()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 disabled:opacity-50 text-white font-semibold text-sm transition-all shadow-lg shadow-violet-600/25 flex items-center justify-center gap-2 cursor-pointer"
            >
              {isVerifyingPin ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <>
                  <Unlock className="w-4 h-4" />
                  <span>Unlock Admin Panel</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-500">
            <span>Project: {FIREBASE_CONFIG.projectId}</span>
            <span>Zero dummy data • Real-time logs</span>
          </div>
        </div>
      ) : (
        /* 2. UNLOCKED ADMIN PANEL (Authorized Administrator View) */
        <div className="relative w-full max-w-6xl max-h-[92vh] flex flex-col bg-[#0b0e17] border border-white/10 rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
          {/* Header Bar */}
          <div className="p-4 sm:p-6 border-b border-white/10 flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-violet-950/40 via-[#0d1222] to-cyan-950/30">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-violet-600/20 border border-violet-500/30 text-violet-400">
                <Database className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg sm:text-xl font-bold font-display text-white tracking-wide">
                    ADMIN DATABASE PANEL
                  </h2>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Real-Time Cloud Firestore
                  </span>
                </div>
                <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                  Live session telemetry, duration metrics & caller IDs • Project:{' '}
                  <span className="font-mono text-slate-300">{FIREBASE_CONFIG.projectId}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Working Manual Refresh Button */}
              <button
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                className="px-3 py-2 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 active:scale-95 text-violet-200 hover:text-white border border-violet-500/30 transition-all text-xs font-semibold flex items-center gap-2 cursor-pointer shadow-sm disabled:opacity-50"
                title="Immediately reload real-time data from Cloud Firestore"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
                <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
              </button>

              <a
                href={`https://console.cloud.google.com/firestore/databases/${FIREBASE_CONFIG.firestoreDatabaseId || '(default)'}/data/panel/sessions?project=${FIREBASE_CONFIG.projectId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 transition-colors text-xs flex items-center gap-1.5"
                title="Open Google Cloud Firestore Console in browser"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span className="hidden sm:inline font-medium">Cloud Console</span>
              </a>

              {/* Lock / Log Out Button */}
              <button
                onClick={handleLockPanel}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-amber-300 border border-white/10 transition-colors text-xs flex items-center gap-1.5"
                title="Lock panel and require passcode"
              >
                <Lock className="w-4 h-4" />
                <span className="hidden sm:inline font-medium">Lock</span>
              </button>

              <button
                onClick={onClose}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white border border-white/10 transition-colors"
                aria-label="Close Admin Panel"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Refresh Notification Banner */}
          {refreshNotice && (
            <div className="px-4 sm:px-6 py-2 bg-emerald-500/20 border-b border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between animate-in fade-in">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="font-semibold">{refreshNotice}</span>
              </span>
              <span className="text-[11px] font-mono text-emerald-400/80">Firestore Cache Bypassed</span>
            </div>
          )}

          {/* Database Status & Last Refreshed Bar */}
          <div className="px-4 sm:px-6 py-2.5 bg-white/[0.02] border-b border-white/5 flex flex-wrap items-center justify-between text-xs text-slate-400 gap-2">
            <div className="flex items-center gap-2">
              <Server className="w-3.5 h-3.5 text-cyan-400" />
              <span>Database:</span>
              <span className="font-mono text-cyan-300 bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-800/40">
                {FIREBASE_CONFIG.firestoreDatabaseId || 'default'}
              </span>
              <span className="text-slate-600 hidden sm:inline">|</span>
              <span className="text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {dbStatus.message}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400">
              <span className="flex items-center gap-1 text-slate-400">
                <Clock className="w-3 h-3 text-slate-500" />
                Last refreshed: <b className="text-slate-200">{lastRefreshedAt.toLocaleTimeString()}</b>
              </span>
              <span className="text-slate-600 hidden sm:inline">|</span>
              <span className="text-slate-500 hidden sm:inline">
                Collection: <b className="text-slate-300 font-mono">/sessions/{'{sessionId}'}</b>
              </span>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 custom-scrollbar">
            {/* Key Metrics Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex flex-col justify-between">
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-xs font-medium">TOTAL REAL SESSIONS</span>
                  <Database className="w-4 h-4 text-violet-400" />
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono">
                  {stats.total}
                </div>
                <span className="text-[11px] text-slate-500 mt-1">Recorded in database</span>
              </div>

              <div className="p-4 rounded-2xl bg-white/[0.03] border border-emerald-500/20 flex flex-col justify-between bg-emerald-950/10">
                <div className="flex items-center justify-between text-emerald-300 mb-2">
                  <span className="text-xs font-medium">LIVE ONGOING</span>
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </span>
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-emerald-400 font-mono">
                  {stats.active}
                </div>
                <span className="text-[11px] text-emerald-500/80 mt-1">Active calls right now</span>
              </div>

              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex flex-col justify-between">
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-xs font-medium">TOTAL CALL TIME</span>
                  <Clock className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="text-xl sm:text-2xl font-extrabold text-cyan-300 font-mono">
                  {formatDuration(stats.totalSeconds)}
                </div>
                <span className="text-[11px] text-slate-500 mt-1">Cumulative call time</span>
              </div>

              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex flex-col justify-between">
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-xs font-medium">AVG DURATION</span>
                  <Activity className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-xl sm:text-2xl font-extrabold text-amber-300 font-mono">
                  {formatDuration(stats.avgSeconds)}
                </div>
                <span className="text-[11px] text-slate-500 mt-1">Per conversation</span>
              </div>
            </div>

            {/* Action & Filter Toolbar */}
            <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between p-3 rounded-2xl bg-white/[0.02] border border-white/10">
              {/* Search Input */}
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search by session ID, room code, or participant..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 text-xs sm:text-sm focus:outline-none focus:border-violet-500 transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value as any)}
                  aria-label="Filter by call type"
                  className="px-3 py-2 rounded-xl bg-[#141824] border border-white/10 text-slate-200 text-xs focus:outline-none focus:border-violet-500"
                >
                  <option value="all">All Types</option>
                  <option value="random_talk">1-on-1 Random Talk</option>
                  <option value="private_room">Private Rooms</option>
                  <option value="public_room">Public Rooms</option>
                </select>

                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value as any)}
                  aria-label="Filter by status"
                  className="px-3 py-2 rounded-xl bg-[#141824] border border-white/10 text-slate-200 text-xs focus:outline-none focus:border-violet-500"
                >
                  <option value="all">All Statuses</option>
                  <option value="active">Active Only</option>
                  <option value="completed">Completed Only</option>
                </select>

                <button
                  onClick={handleExportJson}
                  disabled={sessions.length === 0}
                  className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-40 text-slate-300 text-xs font-medium flex items-center gap-1.5 border border-white/10 transition-colors"
                  title="Export database dump"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export JSON</span>
                </button>

                <button
                  onClick={handleClearAll}
                  disabled={sessions.length === 0}
                  className="px-3 py-2 rounded-xl bg-red-950/30 hover:bg-red-900/40 text-red-400 hover:text-red-300 text-xs font-medium flex items-center gap-1.5 border border-red-800/30 transition-colors"
                  title="Clear all records"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Clear Logs</span>
                </button>
              </div>
            </div>

            {/* Sessions Table */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.01] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/[0.03] text-slate-400 font-mono uppercase tracking-wider text-[11px]">
                      <th className="py-3 px-4 font-semibold">Session ID</th>
                      <th className="py-3 px-4 font-semibold">Type</th>
                      <th className="py-3 px-4 font-semibold">Participants</th>
                      <th className="py-3 px-4 font-semibold">Started At</th>
                      <th className="py-3 px-4 font-semibold">Duration</th>
                      <th className="py-3 px-4 font-semibold">Status</th>
                      <th className="py-3 px-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {filteredSessions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-500">
                          {isLoading ? (
                            <div className="flex flex-col items-center justify-center gap-2">
                              <RefreshCw className="w-5 h-5 animate-spin text-violet-400" />
                              <span>Loading live session records from Cloud Firestore...</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto">
                              <Database className="w-8 h-8 text-slate-600 mb-1" />
                              <p className="text-sm text-slate-400 font-semibold">No real-time sessions found</p>
                              <p className="text-xs text-slate-500 leading-relaxed">
                                Real-time session data is generated automatically when users start a 1-on-1 conversation or enter a room.
                              </p>
                              <button
                                onClick={handleManualRefresh}
                                className="mt-2 px-3 py-1.5 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/30 text-xs font-medium flex items-center gap-1.5 transition-colors"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                <span>Check for New Calls</span>
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : (
                      filteredSessions.map((session) => {
                        const isActive = session.status === 'active';
                        const liveElapsed = isActive
                          ? Math.max(0, Math.round((currentTime - new Date(session.startedAt).getTime()) / 1000))
                          : session.durationSeconds || 0;

                        return (
                          <tr
                            key={session.id}
                            className="hover:bg-white/[0.02] transition-colors group"
                          >
                            {/* Session ID */}
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-violet-300 font-semibold truncate max-w-[150px] sm:max-w-[200px]">
                                  {session.sessionId}
                                </span>
                                <button
                                  onClick={() => handleCopyId(session.sessionId)}
                                  className="text-slate-500 hover:text-white transition-colors p-1"
                                  title="Copy Session ID"
                                >
                                  {copiedId === session.sessionId ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                              {session.roomId && (
                                <div className="text-[10px] text-slate-500 font-mono">
                                  Room: {session.roomId}
                                </div>
                              )}
                            </td>

                            {/* Type */}
                            <td className="py-3 px-4">
                              {session.type === 'random_talk' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/20 text-violet-300 border border-violet-500/30">
                                  <Radio className="w-3 h-3 text-violet-400" />
                                  1-on-1 Random
                                </span>
                              ) : session.type === 'private_room' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                                  <Lock className="w-3 h-3 text-cyan-400" />
                                  Private Room
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                  <Users className="w-3 h-3 text-emerald-400" />
                                  Public Room
                                </span>
                              )}
                            </td>

                            {/* Participants */}
                            <td className="py-3 px-4 text-slate-400 max-w-[160px] truncate">
                              <div className="flex items-center gap-1.5">
                                <Users className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                <span className="truncate">{session.participants || `${session.participantCount || 2} Users`}</span>
                              </div>
                            </td>

                            {/* Start Time */}
                            <td className="py-3 px-4 font-mono text-[11px] text-slate-400">
                              {formatDate(session.startedAt)}
                            </td>

                            {/* Duration (Live Ticker or Final) */}
                            <td className="py-3 px-4">
                              <span
                                className={`font-mono font-bold text-xs px-2 py-0.5 rounded ${
                                  isActive
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse'
                                    : 'bg-white/5 text-slate-300'
                                }`}
                              >
                                {formatDuration(liveElapsed)}
                              </span>
                            </td>

                            {/* Status */}
                            <td className="py-3 px-4">
                              {isActive ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                                  Active Now
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                                  Completed
                                </span>
                              )}
                            </td>

                            {/* Actions */}
                            <td className="py-3 px-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => setInspectedSession(session)}
                                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                                  title="Inspect Raw Document"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>

                                {isActive && (
                                  <button
                                    onClick={() => handleForceEndSession(session.sessionId, session.startedAt)}
                                    className="px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[10px] font-semibold border border-amber-500/30 transition-colors"
                                    title="Force End Call"
                                  >
                                    End
                                  </button>
                                )}

                                <button
                                  onClick={() => handleDeleteSession(session.sessionId)}
                                  className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors"
                                  title="Delete document from database"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Footer info bar */}
          <div className="p-3 sm:p-4 border-t border-white/10 bg-[#090c14] flex flex-wrap items-center justify-between text-xs text-slate-500 gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Database state: synchronized with Cloud Firestore database rules</span>
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              Showing {filteredSessions.length} of {sessions.length} real sessions
            </div>
          </div>
        </div>
      )}

      {/* Raw Document Inspection Modal */}
      {inspectedSession && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative w-full max-w-xl bg-[#0e121e] border border-white/15 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-violet-400" />
                <h3 className="text-sm font-bold font-mono text-white">
                  /sessions/{inspectedSession.sessionId}
                </h3>
              </div>
              <button
                onClick={() => setInspectedSession(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <pre className="p-4 rounded-xl bg-black/60 border border-white/10 text-emerald-400 font-mono text-xs overflow-x-auto max-h-[350px] custom-scrollbar">
              {JSON.stringify(inspectedSession, null, 2)}
            </pre>

            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => handleCopyId(JSON.stringify(inspectedSession, null, 2))}
                className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-mono flex items-center gap-1.5 border border-white/10"
              >
                <Copy className="w-3.5 h-3.5" />
                Copy JSON Payload
              </button>
              <button
                onClick={() => setInspectedSession(null)}
                className="px-4 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
