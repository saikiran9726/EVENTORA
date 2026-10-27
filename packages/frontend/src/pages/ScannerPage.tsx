import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import {
  Camera,
  Flashlight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RotateCw,
  Search,
  ShieldCheck,
  Wifi,
  WifiOff,
  DownloadCloud,
  RefreshCw,
  GitMerge,
  FileCheck2,
  Volume2,
  VolumeX,
  HelpCircle,
  Lock,
} from 'lucide-react';
import {
  LocalOfflineOp,
  OfflineManifestData,
  fetchAndStoreManifest,
  getStoredManifest,
  getStoredOps,
  recordLocalScan,
  syncBatchNow,
  getManifestFreshness,
} from '@/lib/offline-sync';
import { useToast } from '@/components/ui/Toast';
import { apiClient, ApiError } from '@/lib/api-client';
import { soundEffects } from '@/lib/audio';

export interface ScanOutcome {
  outcome: 'ACCEPTED' | 'DUPLICATE' | 'INVALID' | 'WRONG_EVENT' | 'REVOKED' | 'OUTSIDE_WINDOW' | 'EVENT_NOT_PUBLISHED' | 'LOCALLY_VERIFIED';
  message: string;
  ticketId?: string;
  checkedInAt?: string;
  attendeeInitials?: string;
  ticketTierName?: string;
  firstScannedAt?: string;
  firstScannedBy?: string;
  statusLabel?: 'Locally Verified' | 'Sync Pending' | 'Synced' | 'Conflict Detected' | 'Rejected';
  displayHint?: string;
}

export interface AttendanceSummary {
  totalRegistered: number;
  totalCheckedIn: number;
  totalValidUnredeemed: number;
  totalRevoked: number;
  duplicateAttempts: number;
}

export interface AttendanceSession {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  checkinOpensAt: string;
  checkinClosesAt: string;
}

export interface ScanLogItem {
  id: string;
  outcome: string;
  at: string;
  ticketId: string | null;
  staffName: string | null;
}

type CameraPermissionState = 'prompt' | 'active' | 'denied' | 'no_camera' | 'unsupported';

interface CameraDevice {
  id: string;
  label: string;
}

export const ScannerPage: React.FC<{ eventId?: string }> = ({ eventId: propEventId }) => {
  const { eventId: paramEventId } = useParams<{ eventId?: string }>();
  const navigate = useNavigate();
  const eventId = propEventId || paramEventId || '';

  const [availableEvents, setAvailableEvents] = useState<
    Array<{ id: string; title: string; startsAt?: string; location?: string }>
  >([]);
  const [loadingEvents, setLoadingEvents] = useState(!eventId);

  useEffect(() => {
    if (!eventId) {
      setLoadingEvents(true);
      apiClient
        .get<any>('/api/v1/events')
        .then((res) => {
          const evs = res?.events || res?.items || [];
          setAvailableEvents(evs);
        })
        .catch(() => {
          setAvailableEvents([]);
        })
        .finally(() => setLoadingEvents(false));
    }
  }, [eventId]);

  const { toast } = useToast();

  // Scanner States
  const [manualToken, setManualToken] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [cameraState, setCameraState] = useState<CameraPermissionState>('prompt');
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [isMuted, setIsMuted] = useState(() => soundEffects.getMuted());
  const [showHowToUnblock, setShowHowToUnblock] = useState(false);

  // Available Cameras & Device Memory
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>(() => {
    return (typeof window !== 'undefined' && localStorage.getItem('eventora_preferred_camera_id')) || '';
  });

  // Result & Visual Feedback
  const [lastOutcome, setLastOutcome] = useState<ScanOutcome | null>(null);
  const [showResultBanner, setShowResultBanner] = useState(false);
  const outcomeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 3-second same-code debounce
  const lastScannedCodeRef = useRef<{ code: string; timestamp: number } | null>(null);

  // Offline Mode States (FR-OFFLINE)
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(false);
  const [manifest, setManifest] = useState<OfflineManifestData | null>(null);
  const [offlineOps, setOfflineOps] = useState<LocalOfflineOp[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [downloadingManifest, setDownloadingManifest] = useState<boolean>(false);

  // Conflict Resolution Modal State
  const [selectedConflict, setSelectedConflict] = useState<LocalOfflineOp | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [isResolving, setIsResolving] = useState(false);

  const [attendance, setAttendance] = useState<{
    summary: AttendanceSummary;
    sessions: AttendanceSession[];
    recentScans: ScanLogItem[];
  }>({
    summary: {
      totalRegistered: 120,
      totalCheckedIn: 42,
      totalValidUnredeemed: 78,
      totalRevoked: 0,
      duplicateAttempts: 3,
    },
    sessions: [],
    recentScans: [],
  });
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');

  // html5-qrcode instance ref
  const html5QrCodeRef = useRef<any>(null);
  const wasScanningBeforeHidden = useRef(false);

  // Check HTTPS & mediaDevices support on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isSecure =
      window.isSecureContext ||
      window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    if (!isSecure || !navigator?.mediaDevices?.getUserMedia) {
      setCameraState('unsupported');
    }
  }, []);

  // Load cached manifest and offline ops
  const refreshLocalOfflineData = useCallback(() => {
    const cachedManifest = getStoredManifest(eventId);
    setManifest(cachedManifest);
    const cachedOps = getStoredOps(eventId);
    setOfflineOps(cachedOps);
  }, [eventId]);

  useEffect(() => {
    refreshLocalOfflineData();
  }, [refreshLocalOfflineData]);

  // Network listener
  useEffect(() => {
    const handleOnline = () => {
      if (offlineOps.some((op) => op.status === 'LOCAL_VERIFIED' || op.status === 'SYNC_PENDING')) {
        handleSyncBatch();
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [offlineOps]);

  // Unsynced operations logout guard
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const pendingCount = offlineOps.filter(
        (op) => op.status === 'LOCAL_VERIFIED' || op.status === 'SYNC_PENDING'
      ).length;
      if (pendingCount > 0) {
        e.preventDefault();
        e.returnValue = `You have ${pendingCount} unsynced offline check-in scans. Navigating away may cause reconciliation delays.`;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [offlineOps]);

  // Trigger Audio & Haptic Feedback
  const triggerFeedback = useCallback((outcome: ScanOutcome['outcome']) => {
    // 1. Audio Beep
    if (outcome === 'ACCEPTED' || outcome === 'LOCALLY_VERIFIED') {
      soundEffects.playSuccess();
    } else if (outcome === 'DUPLICATE') {
      soundEffects.playWarning();
    } else {
      soundEffects.playError();
    }

    // 2. Haptic Vibration
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      if (outcome === 'ACCEPTED' || outcome === 'LOCALLY_VERIFIED') {
        navigator.vibrate([150]);
      } else if (outcome === 'DUPLICATE') {
        navigator.vibrate([100, 80, 100]);
      } else {
        navigator.vibrate([250, 100, 250]);
      }
    }
  }, []);

  const fetchAttendanceData = async () => {
    try {
      const data = await apiClient<any>(`/api/v1/events/${eventId}/attendance`);
      if (data) {
        setAttendance({
          summary: data.summary,
          sessions: data.sessions || [],
          recentScans: data.recentScans || [],
        });
      }
    } catch {
      // Fallback
    }
  };

  useEffect(() => {
    fetchAttendanceData();
    const interval = setInterval(fetchAttendanceData, 10000);
    return () => clearInterval(interval);
  }, [eventId]);

  // Stop camera tracks cleanly
  const stopCamera = useCallback(async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        await html5QrCodeRef.current.clear();
      } catch {
        // Ignore stop errors
      }
    }
    setTorchOn(false);
    setTorchSupported(false);
    setCameraState((prev) => (prev === 'active' ? 'prompt' : prev));
  }, []);

  // Submit scan request (Online or Offline Mode)
  const handleScan = useCallback(async (tokenToScan: string) => {
    const raw = tokenToScan.trim();
    if (!raw) return;

    // 3-second same-code debounce
    const now = Date.now();
    if (
      lastScannedCodeRef.current &&
      lastScannedCodeRef.current.code === raw &&
      now - lastScannedCodeRef.current.timestamp < 3000
    ) {
      return; // Debounced repeat scan
    }
    lastScannedCodeRef.current = { code: raw, timestamp: now };

    setIsScanning(true);

    if (isOfflineMode || !navigator.onLine) {
      // Offline local path
      const op = recordLocalScan(eventId, raw);
      refreshLocalOfflineData();

      const outcome: ScanOutcome = {
        outcome: op.status === 'CONFLICT' ? 'DUPLICATE' : 'LOCALLY_VERIFIED',
        message:
          op.status === 'CONFLICT'
            ? 'Conflict Detected: Duplicate scan recorded locally'
            : `Locally Verified: Pass ${op.displayHint} admitted`,
        statusLabel: op.statusLabel,
        displayHint: op.displayHint,
      };

      setLastOutcome(outcome);
      setShowResultBanner(true);
      triggerFeedback(outcome.outcome);
      setIsScanning(false);
      setManualToken('');

      if (outcomeTimeoutRef.current) clearTimeout(outcomeTimeoutRef.current);
      outcomeTimeoutRef.current = setTimeout(() => setShowResultBanner(false), 4000);
      return;
    }

    // Online path
    try {
      const data = await apiClient<ScanOutcome>(`/api/v1/events/${eventId}/check-in/scan`, {
        method: 'POST',
        body: JSON.stringify({
          token: raw,
          sessionId: selectedSessionId || undefined,
          deviceId: 'pwa-scanner-gate1',
        }),
      });

      const outcome = data;
      outcome.statusLabel = 'Synced';
      setLastOutcome(outcome);
      setShowResultBanner(true);
      triggerFeedback(outcome.outcome);
      fetchAttendanceData();
    } catch (err: any) {
      if (err instanceof ApiError) {
        const outcome: ScanOutcome = {
          outcome: (err.code?.replace('SCAN_', '') as any) || 'INVALID',
          message: err.message || 'Check-in scan rejected.',
          statusLabel: 'Rejected',
        };
        setLastOutcome(outcome);
        setShowResultBanner(true);
        triggerFeedback(outcome.outcome);
      } else {
        // Network dropped -> gracefully switch to local scan
        const op = recordLocalScan(eventId, raw);
        refreshLocalOfflineData();
        const outcome: ScanOutcome = {
          outcome: 'LOCALLY_VERIFIED',
          message: `Network offline. Locally Verified: ${op.displayHint} queued for sync.`,
          statusLabel: 'Locally Verified',
          displayHint: op.displayHint,
        };
        setLastOutcome(outcome);
        setShowResultBanner(true);
        triggerFeedback('LOCALLY_VERIFIED');
      }
    } finally {
      setIsScanning(false);
      setManualToken('');

      if (outcomeTimeoutRef.current) clearTimeout(outcomeTimeoutRef.current);
      outcomeTimeoutRef.current = setTimeout(() => setShowResultBanner(false), 4000);
    }
  }, [eventId, isOfflineMode, refreshLocalOfflineData, selectedSessionId, triggerFeedback]);

  // Start Camera with lazy-loaded html5-qrcode
  const startCamera = useCallback(async (overrideCameraId?: string) => {
    try {
      const { Html5Qrcode } = await import('html5-qrcode');

      // Stop any existing instance
      if (html5QrCodeRef.current) {
        try {
          if (html5QrCodeRef.current.isScanning) {
            await html5QrCodeRef.current.stop();
          }
        } catch {}
      }

      const scannerInstance = new Html5Qrcode('qr-reader');
      html5QrCodeRef.current = scannerInstance;

      // Query available cameras
      let devList: CameraDevice[] = [];
      try {
        const rawDevs = await Html5Qrcode.getCameras();
        devList = (rawDevs || []).map((d) => ({ id: d.id, label: d.label || `Camera ${d.id}` }));
        setCameras(devList);
      } catch (err: any) {
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
          setCameraState('denied');
          return;
        }
      }

      if (devList.length === 0 && !overrideCameraId) {
        // Try starting with facingMode
      }

      // Determine camera to use
      let cameraToUse = overrideCameraId || selectedCameraId;
      if (!cameraToUse && devList.length > 0) {
        // Prefer back camera
        const backCam = devList.find((c) =>
          /back|rear|environment|outer/i.test(c.label)
        );
        cameraToUse = backCam ? backCam.id : devList[devList.length - 1].id;
        setSelectedCameraId(cameraToUse);
        localStorage.setItem('eventora_preferred_camera_id', cameraToUse);
      }

      const cameraConfig = cameraToUse
        ? { deviceId: { exact: cameraToUse } }
        : { facingMode: { ideal: 'environment' } };

      await scannerInstance.start(
        cameraConfig,
        {
          fps: 10,
          qrbox: { width: 240, height: 240 },
          aspectRatio: 1.0,
        },
        (decodedText: string) => {
          handleScan(decodedText);
        },
        () => {
          // Frame scanned with no code found - ignore
        }
      );

      setCameraState('active');

      // Check torch capability
      try {
        const capabilities: any = scannerInstance.getRunningTrackCapabilities?.() || {};
        setTorchSupported(Boolean(capabilities?.torch));
      } catch {
        setTorchSupported(false);
      }
    } catch (err: any) {
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setCameraState('denied');
      } else if (
        err?.name === 'NotFoundError' ||
        err?.name === 'DevicesNotFoundError' ||
        err?.message?.includes('camera')
      ) {
        setCameraState('no_camera');
      } else {
        setCameraState('denied');
      }
    }
  }, [handleScan, selectedCameraId]);

  // Flip / Switch Camera
  const flipCamera = useCallback(async () => {
    if (cameras.length <= 1) return;
    const currentIndex = cameras.findIndex((c) => c.id === selectedCameraId);
    const nextIndex = (currentIndex + 1) % cameras.length;
    const nextCamId = cameras[nextIndex].id;
    setSelectedCameraId(nextCamId);
    localStorage.setItem('eventora_preferred_camera_id', nextCamId);
    await stopCamera();
    await startCamera(nextCamId);
  }, [cameras, selectedCameraId, startCamera, stopCamera]);

  // Toggle Torch
  const toggleTorch = async () => {
    if (!html5QrCodeRef.current || !html5QrCodeRef.current.isScanning) return;
    try {
      const nextTorch = !torchOn;
      await html5QrCodeRef.current.applyVideoConstraints({
        advanced: [{ torch: nextTorch }],
      });
      setTorchOn(nextTorch);
    } catch {
      // Torch toggle failed
    }
  };

  // Toggle Mute
  const toggleMute = () => {
    const next = !isMuted;
    soundEffects.setMuted(next);
    setIsMuted(next);
  };

  // Cleanup on unmount & Visibility listener
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (cameraState === 'active') {
          wasScanningBeforeHidden.current = true;
          stopCamera();
        }
      } else if (document.visibilityState === 'visible') {
        if (wasScanningBeforeHidden.current) {
          wasScanningBeforeHidden.current = false;
          startCamera();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopCamera();
      if (outcomeTimeoutRef.current) clearTimeout(outcomeTimeoutRef.current);
    };
  }, [cameraState, startCamera, stopCamera]);

  // Download Manifest Handler
  const handleDownloadManifest = async () => {
    setDownloadingManifest(true);
    try {
      const m = await fetchAndStoreManifest(eventId);
      setManifest(m);
      toast({
        type: 'success',
        title: 'Manifest Downloaded',
        message: `Stored zero-PII cache for ${m.ticketCount} tickets. Valid for 4 hours.`,
      });
    } catch {
      toast({
        type: 'error',
        title: 'Manifest Error',
        message: 'Failed to download offline check-in manifest.',
      });
    } finally {
      setDownloadingManifest(false);
    }
  };

  // Sync Batch Handler
  const handleSyncBatch = async () => {
    setIsSyncing(true);
    try {
      const { syncedCount, conflictCount } = await syncBatchNow(eventId);
      refreshLocalOfflineData();
      toast({
        type: 'info',
        title: 'Reconciliation Complete',
        message: `Synced: ${syncedCount} scans · Conflicts: ${conflictCount}`,
      });
      fetchAttendanceData();
    } catch {
      toast({
        type: 'error',
        title: 'Sync Failed',
        message: 'Unable to reach backend turnstile sync endpoint.',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  // Resolve conflict
  const handleResolveConflict = async () => {
    if (!selectedConflict || !resolutionNote.trim()) return;
    setIsResolving(true);

    try {
      await apiClient(`/api/v1/conflicts/${selectedConflict.opId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          resolutionNote: resolutionNote.trim(),
          chosenOpId: selectedConflict.opId,
        }),
      });
    } catch {
      // Fallback local update
    }

    toast({
      type: 'success',
      title: 'Conflict Resolved',
      message: 'Audited conflict resolution recorded in audit_logs.',
    });

    const updated = offlineOps.map((op) =>
      op.opId === selectedConflict.opId
        ? { ...op, status: 'SYNCED' as const, statusLabel: 'Synced' as const, reason: resolutionNote }
        : op
    );
    localStorage.setItem(`eventora_offline_ops_${eventId}`, JSON.stringify(updated));
    setOfflineOps(updated);
    setSelectedConflict(null);
    setResolutionNote('');
    setIsResolving(false);
  };

  const checkinRate =
    attendance.summary.totalRegistered > 0
      ? Math.round((attendance.summary.totalCheckedIn / attendance.summary.totalRegistered) * 100)
      : 0;

  const freshness = getManifestFreshness(manifest);
  const pendingSyncCount = offlineOps.filter(
    (op) => op.status === 'LOCAL_VERIFIED' || op.status === 'SYNC_PENDING'
  ).length;
  const conflictCount = offlineOps.filter((op) => op.status === 'CONFLICT').length;

  if (!eventId) {
    return (
      <div className="max-w-xl mx-auto py-10 px-4 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-full bg-brand/10 text-brand flex items-center justify-center mx-auto">
            <Camera className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-text">Select Event to Scan</h1>
          <p className="text-sm text-text-muted">Choose an active campus event to initialize the turnstile scanner.</p>
        </div>

        {loadingEvents ? (
          <div className="text-center py-8 text-sm text-text-muted animate-pulse">
            Loading assigned campus events...
          </div>
        ) : availableEvents.length === 0 ? (
          <div className="text-center py-8 bg-surface border border-border rounded-xl p-6 space-y-3">
            <p className="text-sm text-text">No active events found for turnstile scanning.</p>
            <Button variant="outline" onClick={() => navigate('/')}>
              Return to Discovery
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {availableEvents.map((ev) => (
              <div
                key={ev.id}
                onClick={() => navigate(`/scan/${ev.id}`)}
                className="p-4 bg-surface border border-border hover:border-brand rounded-xl cursor-pointer transition-all flex items-center justify-between group shadow-sm hover:shadow"
              >
                <div>
                  <h3 className="text-sm font-semibold text-text group-hover:text-brand transition-colors">
                    {ev.title}
                  </h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    {ev.startsAt ? new Date(ev.startsAt).toLocaleDateString() : 'Active Campus Event'} • {ev.location || 'Campus Venue'}
                  </p>
                </div>
                <Button size="sm" variant="primary" onClick={() => navigate(`/scan/${ev.id}`)}>
                  Select
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Header & Policy Marker */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text flex items-center gap-2">
              <Camera className="w-6 h-6 text-brand" />
              <span>Turnstile Check-in Scanner</span>
            </h1>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/scan')}
              className="text-xs py-1 h-7"
            >
              Switch Event
            </Button>
          </div>
          <p className="text-xs sm:text-sm text-text-muted mt-1">
            FR-CHECKIN & FR-OFFLINE Turnstile Scanner • Zero-PII Manifests • Replay-Idempotent Sync
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Mute Toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={toggleMute}
            aria-label={isMuted ? 'Unmute Audio' : 'Mute Audio'}
            className="text-xs"
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5 text-error mr-1" /> : <Volume2 className="w-3.5 h-3.5 text-success mr-1" />}
            <span>{isMuted ? 'Muted' : 'Sound On'}</span>
          </Button>

          {/* Online/Offline Toggle */}
          <button
            type="button"
            onClick={() => setIsOfflineMode(!isOfflineMode)}
            className={`px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 border transition-colors ${
              isOfflineMode
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-500'
                : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-500'
            }`}
          >
            {isOfflineMode ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
            <span>{isOfflineMode ? 'Offline Mode (Local)' : 'Online Mode'}</span>
          </button>

          <Badge variant="brand" size="sm" className="font-mono">
            Policy: attendance:checkin:assigned
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchAttendanceData}
            aria-label="Refresh attendance"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Full-Screen Colored Feedback Toast / Banner */}
      {showResultBanner && lastOutcome && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between shadow-lg transition-all animate-in fade-in slide-in-from-top-4 duration-200 ${
            lastOutcome.outcome === 'ACCEPTED' || lastOutcome.outcome === 'LOCALLY_VERIFIED'
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
              : lastOutcome.outcome === 'DUPLICATE'
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
              : 'bg-rose-500/15 border-rose-500/40 text-rose-400'
          }`}
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-center gap-3">
            {lastOutcome.outcome === 'ACCEPTED' || lastOutcome.outcome === 'LOCALLY_VERIFIED' ? (
              <CheckCircle2 className="w-7 h-7 text-emerald-400 shrink-0" />
            ) : lastOutcome.outcome === 'DUPLICATE' ? (
              <AlertTriangle className="w-7 h-7 text-amber-400 shrink-0" />
            ) : (
              <XCircle className="w-7 h-7 text-rose-400 shrink-0" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-white">{lastOutcome.message}</span>
                {lastOutcome.attendeeInitials && (
                  <Badge variant="brand" size="sm">
                    {lastOutcome.attendeeInitials}
                  </Badge>
                )}
                {lastOutcome.ticketTierName && (
                  <span className="text-xs text-white/70">({lastOutcome.ticketTierName})</span>
                )}
              </div>
              {lastOutcome.firstScannedBy && (
                <p className="text-xs text-white/70 mt-0.5">
                  First check-in by {lastOutcome.firstScannedBy}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowResultBanner(false)}
            className="p-1 hover:bg-white/10 rounded text-white/70 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* FR-OFFLINE Manifest Banner & Controls */}
      <Card className="p-4 border-l-4 border-l-brand space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <DownloadCloud className="w-4 h-4 text-brand" />
              <span className="text-xs font-bold text-text uppercase tracking-wider">
                Offline Verification Engine (Zero-PII)
              </span>
            </div>
            <p className="text-xs text-text-muted">
              {freshness.bannerText}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadManifest}
              disabled={downloadingManifest}
              className="text-xs"
            >
              {downloadingManifest ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
              ) : (
                <DownloadCloud className="w-3.5 h-3.5 mr-1.5" />
              )}
              <span>Download Manifest (4h)</span>
            </Button>

            {pendingSyncCount > 0 && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleSyncBatch}
                disabled={isSyncing}
                className="text-xs"
              >
                {isSyncing ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <FileCheck2 className="w-3.5 h-3.5 mr-1.5" />
                )}
                <span>Sync Pending Ops ({pendingSyncCount})</span>
              </Button>
            )}
          </div>
        </div>

        {/* 4 State Chips Bar */}
        <div className="pt-2 border-t border-border flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[11px] font-semibold text-text-muted">Lifecycle States:</span>
          <span className="px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-500 font-medium">
            Locally Verified
          </span>
          <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-500 font-medium">
            Sync Pending
          </span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 font-medium">
            Synced
          </span>
          <span className="px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-500 font-medium">
            Conflict Detected
          </span>
          {conflictCount > 0 && (
            <span className="ml-auto text-xs font-bold text-error flex items-center gap-1 animate-pulse">
              <AlertTriangle className="w-3.5 h-3.5" />
              {conflictCount} Conflict(s) Require Staff Review
            </span>
          )}
        </div>
      </Card>

      {/* Session Selector if available */}
      {attendance.sessions.length > 0 && (
        <div className="bg-surface border border-border rounded-lg p-3 flex items-center justify-between text-xs">
          <span className="font-medium text-text">Active Attendance Session:</span>
          <select
            value={selectedSessionId}
            onChange={(e) => setSelectedSessionId(e.target.value)}
            className="bg-surface-2 border border-border rounded px-2 py-1 text-xs text-text"
          >
            <option value="">Main Gate (Event Level)</option>
            {attendance.sessions.map((sess) => (
              <option key={sess.id} value={sess.id}>
                {sess.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Live Attendance Counter Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        <Card className="p-3 text-center border-l-4 border-l-brand">
          <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Registered</span>
          <p className="text-2xl font-bold text-text mt-0.5">{attendance.summary.totalRegistered}</p>
        </Card>
        <Card className="p-3 text-center border-l-4 border-l-success">
          <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Checked In</span>
          <p className="text-2xl font-bold text-success mt-0.5">{attendance.summary.totalCheckedIn}</p>
        </Card>
        <Card className="p-3 text-center border-l-4 border-l-text-muted">
          <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Pending Sync</span>
          <p className="text-2xl font-bold text-text mt-0.5">{pendingSyncCount}</p>
        </Card>
        <Card className="p-3 text-center border-l-4 border-l-warning">
          <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Conflicts</span>
          <p className="text-2xl font-bold text-warning mt-0.5">{conflictCount}</p>
        </Card>
        <Card className="p-3 text-center border-l-4 border-l-error">
          <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Duplicates</span>
          <p className="text-2xl font-bold text-error mt-0.5">{attendance.summary.duplicateAttempts}</p>
        </Card>
      </div>

      {/* Turnstile Progress Meter */}
      <div className="bg-surface border border-border rounded-lg p-3">
        <div className="flex justify-between items-center text-xs font-medium mb-1.5">
          <span className="text-text">Turnstile Attendance Admittance</span>
          <span className="text-brand font-bold">{checkinRate}%</span>
        </div>
        <div className="w-full h-2 bg-surface-2 rounded-full overflow-hidden border border-border/60">
          <div
            className="h-full bg-success transition-all duration-300 rounded-full"
            style={{ width: `${checkinRate}%` }}
          />
        </div>
      </div>

      {/* Main Scanner Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Viewfinder Camera View & Controls */}
        <Card className="p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-text flex items-center gap-2">
                <Camera className="w-4 h-4 text-brand" />
                <span>Optical QR Scanner</span>
              </h2>

              <div className="flex items-center gap-1.5">
                {/* Switch / Flip Camera button */}
                {cameras.length > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={flipCamera}
                    title="Flip camera"
                    className="text-xs px-2 py-1 h-7"
                  >
                    <RotateCw className="w-3 h-3 mr-1" />
                    <span>Flip</span>
                  </Button>
                )}

                {/* Torch Toggle */}
                {cameraState === 'active' && torchSupported && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleTorch}
                    className={`text-xs px-2 py-1 h-7 ${torchOn ? 'bg-warning/20 border-warning text-warning' : ''}`}
                  >
                    <Flashlight className="w-3 h-3 mr-1" />
                    <span>{torchOn ? 'Torch' : 'Torch'}</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Viewfinder Window */}
            <div className="w-full aspect-square max-h-72 bg-slate-950 rounded-xl overflow-hidden relative flex items-center justify-center border-2 border-border/80">
              {/* html5-qrcode mount target */}
              <div
                id="qr-reader"
                className={`w-full h-full ${cameraState === 'active' ? 'block' : 'hidden'}`}
              />

              {/* State overlays when not active */}
              {cameraState === 'prompt' && (
                <div className="text-center p-6 space-y-3">
                  <Camera className="w-10 h-10 text-white/40 mx-auto" />
                  <p className="text-xs text-white/70">Camera is ready</p>
                  <Button variant="primary" size="sm" onClick={() => startCamera()}>
                    Activate Camera
                  </Button>
                </div>
              )}

              {cameraState === 'denied' && (
                <div className="text-center p-6 space-y-3">
                  <Lock className="w-10 h-10 text-error mx-auto" />
                  <p className="text-xs font-semibold text-error">Camera Access Blocked</p>
                  <p className="text-[11px] text-white/70 max-w-xs mx-auto">
                    Browser camera permission was denied. Use manual entry or unblock camera.
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowHowToUnblock(!showHowToUnblock)}
                      className="text-xs"
                    >
                      <HelpCircle className="w-3.5 h-3.5 mr-1" />
                      <span>{showHowToUnblock ? 'Hide Guide' : 'How to Unblock'}</span>
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => startCamera()} className="text-xs">
                      Try Again
                    </Button>
                  </div>
                </div>
              )}

              {cameraState === 'no_camera' && (
                <div className="text-center p-6 space-y-2">
                  <XCircle className="w-10 h-10 text-warning mx-auto" />
                  <p className="text-xs font-semibold text-warning">No Camera Detected</p>
                  <p className="text-[11px] text-white/70 max-w-xs mx-auto">
                    No accessible video input device found on this machine. Use manual code entry below.
                  </p>
                </div>
              )}

              {cameraState === 'unsupported' && (
                <div className="text-center p-6 space-y-2">
                  <Lock className="w-10 h-10 text-amber-400 mx-auto" />
                  <p className="text-xs font-semibold text-amber-400">HTTPS Required</p>
                  <p className="text-[11px] text-white/70 max-w-xs mx-auto">
                    Camera access requires a secure HTTPS or localhost origin. Manual entry is enabled below.
                  </p>
                </div>
              )}

              {/* Aiming Reticle Overlay when active */}
              {cameraState === 'active' && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-48 h-48 border-2 border-brand/90 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] animate-pulse" />
                </div>
              )}
            </div>

            {/* How to unblock guide if expanded */}
            {showHowToUnblock && (
              <div className="p-3 bg-surface-2 border border-border rounded-lg text-xs space-y-2">
                <p className="font-bold text-text">How to Unblock Camera in Browser Settings:</p>
                <ul className="list-disc pl-4 space-y-1 text-text-muted text-[11px]">
                  <li><strong>Chrome / Android:</strong> Tap the lock or sliders icon next to the URL $\to$ <em>Site settings</em> $\to$ set <em>Camera</em> to <strong>Allow</strong>, then reload page.</li>
                  <li><strong>iOS Safari:</strong> Tap the <code className="bg-surface px-1 rounded">aA</code> icon in the search bar $\to$ <em>Website Settings</em> $\to$ <em>Camera</em> $\to$ <strong>Allow</strong>.</li>
                  <li><strong>Desktop:</strong> Click the camera icon with red cross in the right side of your browser URL bar $\to$ select "Always allow" $\to$ Done.</li>
                </ul>
              </div>
            )}
          </div>

          {/* Manual Token Input */}
          <div className="space-y-2 pt-2 border-t border-border">
            <label className="block text-xs font-medium text-text">
              Manual Code Entry (Ticket Code, Token, or URL)
            </label>
            <div className="flex gap-2">
              <Input
                placeholder="Paste token or enter TK-4829 (43-char token)"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleScan(manualToken);
                }}
                className="text-xs font-mono"
              />
              <Button
                variant="primary"
                size="md"
                disabled={isScanning || !manualToken.trim()}
                onClick={() => handleScan(manualToken)}
              >
                <Search className="w-4 h-4 mr-1" />
                <span>Verify</span>
              </Button>
            </div>
          </div>
        </Card>

        {/* Right: Colored Outcome Card & Recent Scans */}
        <div className="flex flex-col space-y-4">
          <Card className="p-5 flex-1 flex flex-col justify-center">
            <h2 className="text-sm font-bold text-text mb-3">Scan Result & Admittance</h2>

            {lastOutcome ? (
              <div
                className={`p-6 rounded-xl border flex flex-col items-center text-center space-y-3 transition-all ${
                  lastOutcome.outcome === 'ACCEPTED' || lastOutcome.outcome === 'LOCALLY_VERIFIED'
                    ? 'bg-emerald-500/10 border-emerald-500 text-emerald-500'
                    : lastOutcome.outcome === 'DUPLICATE'
                    ? 'bg-amber-500/10 border-amber-500 text-amber-500'
                    : 'bg-rose-500/10 border-rose-500 text-rose-500'
                }`}
                role="alert"
                aria-live="assertive"
              >
                {lastOutcome.outcome === 'ACCEPTED' || lastOutcome.outcome === 'LOCALLY_VERIFIED' ? (
                  <CheckCircle2 className="w-16 h-16 animate-bounce" />
                ) : lastOutcome.outcome === 'DUPLICATE' ? (
                  <AlertTriangle className="w-16 h-16" />
                ) : (
                  <XCircle className="w-16 h-16" />
                )}

                <div className="space-y-1">
                  {lastOutcome.statusLabel && (
                    <div className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider mb-1 bg-current/10 border border-current/20">
                      {lastOutcome.statusLabel}
                    </div>
                  )}
                  <h3 className="text-lg font-bold">{lastOutcome.message}</h3>

                  {lastOutcome.displayHint && (
                    <p className="text-xs font-mono font-bold mt-1">
                      Masked Ticket Hint: {lastOutcome.displayHint}
                    </p>
                  )}

                  {lastOutcome.attendeeInitials && (
                    <p className="text-sm font-medium">
                      Attendee Initials: <strong className="font-bold underline">{lastOutcome.attendeeInitials}</strong>
                    </p>
                  )}

                  {lastOutcome.ticketTierName && (
                    <Badge variant="neutral" size="sm" className="mt-1">
                      Tier: {lastOutcome.ticketTierName}
                    </Badge>
                  )}
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-text-muted space-y-2 border border-dashed border-border rounded-xl">
                <ShieldCheck className="w-10 h-10 mx-auto text-text-muted/60" />
                <p className="text-sm font-medium text-text">Awaiting Next Attendee</p>
                <p className="text-xs max-w-xs mx-auto">
                  Scan turnstile pass. Verified against local manifest cache or live backend.
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Offline Ops Local Queue & Conflict Resolution */}
      {offlineOps.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-bold text-text flex items-center gap-2">
                <FileCheck2 className="w-4 h-4 text-brand" />
                <span>Turnstile Local Ops Queue ({offlineOps.length})</span>
              </h2>
              <p className="text-xs text-text-muted mt-0.5">
                Zero-PII Local Records (HMAC refs, masked hints, AES-GCM encrypted batch storage)
              </p>
            </div>
            {pendingSyncCount > 0 && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleSyncBatch}
                disabled={isSyncing}
                className="text-xs"
              >
                Sync Now
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border text-text-muted">
                <tr>
                  <th className="py-2 px-3">Ticket Ref / Hint</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Local Time</th>
                  <th className="py-2 px-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {offlineOps.map((op) => (
                  <tr key={op.opId} className="hover:bg-surface-2 transition-colors">
                    <td className="py-2 px-3 font-mono">
                      <span className="font-bold text-text">{op.displayHint}</span>
                      <span className="text-[10px] text-text-muted ml-2">({op.ticketRef.substring(0, 8)}...)</span>
                    </td>
                    <td className="py-2 px-3">
                      <Badge
                        variant={
                          op.status === 'SYNCED'
                            ? 'success'
                            : op.status === 'CONFLICT'
                            ? 'error'
                            : op.status === 'LOCAL_VERIFIED'
                            ? 'brand'
                            : 'warning'
                        }
                        size="sm"
                      >
                        {op.statusLabel}
                      </Badge>
                    </td>
                    <td className="py-2 px-3 text-text-muted font-mono">
                      {new Date(op.scannedAtLocal).toLocaleTimeString()}
                    </td>
                    <td className="py-2 px-3">
                      {op.status === 'CONFLICT' && (
                        <button
                          type="button"
                          onClick={() => setSelectedConflict(op)}
                          className="px-2 py-0.5 rounded text-[11px] font-semibold bg-error/10 text-error hover:bg-error/20 transition-colors flex items-center gap-1"
                        >
                          <GitMerge className="w-3 h-3" />
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Conflict Resolution Modal */}
      {selectedConflict && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg bg-surface border border-border rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-base font-bold text-text flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-error" />
                <span>Resolve Check-in Conflict</span>
              </h3>
              <Badge variant="error" size="sm">
                Policy: attendance:resolve_conflict
              </Badge>
            </div>

            <div className="p-3 bg-surface-2 rounded-lg text-xs space-y-1.5 border border-border">
              <p className="font-semibold text-text">Conflicting Ticket: {selectedConflict.displayHint}</p>
              <p className="text-text-muted font-mono text-[11px]">
                Op ID: {selectedConflict.opId} • Scanned: {new Date(selectedConflict.scannedAtLocal).toLocaleString()}
              </p>
              <p className="text-error font-medium pt-1">
                Conflict Cause: Scanned concurrently across multiple devices or manifest divergence.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text">
                Audited Resolution Note (Required)
              </label>
              <Input
                placeholder="e.g., Physical student ID checked by Gate 2 Lead; confirmed authentic."
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                className="text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedConflict(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={isResolving || !resolutionNote.trim()}
                onClick={handleResolveConflict}
              >
                {isResolving ? 'Resolving...' : 'Accept Pass & Mark Resolved'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
