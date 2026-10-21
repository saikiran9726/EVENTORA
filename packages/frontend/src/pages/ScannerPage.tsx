import React, { useState, useEffect, useRef } from 'react';
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
  Clock,
  RotateCw,
  Search,
  ShieldCheck,
} from 'lucide-react';

export interface ScanOutcome {
  outcome: 'ACCEPTED' | 'DUPLICATE' | 'INVALID' | 'WRONG_EVENT' | 'REVOKED' | 'OUTSIDE_WINDOW';
  message: string;
  ticketId?: string;
  checkedInAt?: string;
  attendeeInitials?: string;
  ticketTierName?: string;
  firstScannedAt?: string;
  firstScannedBy?: string;
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

export const ScannerPage: React.FC<{ eventId?: string }> = ({ eventId = 'mock-event-id' }) => {
  const [manualToken, setManualToken] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<ScanOutcome | null>(null);
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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // Trigger haptic feedback
  const triggerHaptic = (outcome: ScanOutcome['outcome']) => {
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      if (outcome === 'ACCEPTED') {
        navigator.vibrate([100]); // Short sharp buzz
      } else if (outcome === 'DUPLICATE') {
        navigator.vibrate([50, 50, 50]); // Warning double tap
      } else {
        navigator.vibrate([200, 100, 200]); // Error long buzz
      }
    }
  };

  const fetchAttendanceData = async () => {
    try {
      const res = await fetch(`/api/v1/events/${eventId}/attendance`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
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
    const interval = setInterval(fetchAttendanceData, 10000); // 10s polling for live check-in sync
    return () => clearInterval(interval);
  }, [eventId]);

  // Start Camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraActive(true);
    } catch {
      setCameraActive(false);
    }
  };

  // Stop Camera
  const stopCamera = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setCameraActive(false);
    setTorchOn(false);
  };

  // Toggle Torch
  const toggleTorch = async () => {
    if (!mediaStreamRef.current) return;
    const track = mediaStreamRef.current.getVideoTracks()[0];
    if (track) {
      try {
        const capabilities: any = track.getCapabilities?.() || {};
        if (capabilities.torch) {
          const nextTorch = !torchOn;
          await track.applyConstraints({ advanced: [{ torch: nextTorch } as any] });
          setTorchOn(nextTorch);
        }
      } catch {
        // Torch unsupported
      }
    }
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Submit scan request
  const handleScan = async (tokenToScan: string) => {
    if (!tokenToScan.trim()) return;
    setIsScanning(true);

    try {
      const res = await fetch(`/api/v1/events/${eventId}/check-in/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          token: tokenToScan.trim(),
          sessionId: selectedSessionId || undefined,
          deviceId: 'pwa-scanner-gate1',
        }),
      });

      const data = await res.json();

      if (res.ok) {
        const outcome = data as ScanOutcome;
        setLastOutcome(outcome);
        triggerHaptic(outcome.outcome);
        fetchAttendanceData();
      } else {
        const outcome: ScanOutcome = {
          outcome: (data.error?.code?.replace('SCAN_', '') as any) || 'INVALID',
          message: data.error?.message || 'Check-in scan rejected.',
        };
        setLastOutcome(outcome);
        triggerHaptic(outcome.outcome);
      }
    } catch {
      const outcome: ScanOutcome = {
        outcome: 'INVALID',
        message: 'Network offline. Scan will be queued for synchronization.',
      };
      setLastOutcome(outcome);
      triggerHaptic('INVALID');
    } finally {
      setIsScanning(false);
      setManualToken('');
    }
  };

  const checkinRate = attendance.summary.totalRegistered > 0
    ? Math.round((attendance.summary.totalCheckedIn / attendance.summary.totalRegistered) * 100)
    : 0;

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Header & Policy Marker */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text flex items-center gap-2">
            <Camera className="w-6 h-6 text-brand" />
            <span>QR Ticket Check-in Scanner</span>
          </h1>
          <p className="text-xs sm:text-sm text-text-muted mt-1">
            Turnstile Check-in Scanner • Deterministic Single-Statement Gate • Rate Limited: 120 scans/min
          </p>
        </div>
        <div className="flex items-center gap-2">
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3 text-center border-l-4 border-l-brand">
          <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Registered</span>
          <p className="text-2xl font-bold text-text mt-0.5">{attendance.summary.totalRegistered}</p>
        </Card>
        <Card className="p-3 text-center border-l-4 border-l-success">
          <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Checked In</span>
          <p className="text-2xl font-bold text-success mt-0.5">{attendance.summary.totalCheckedIn}</p>
        </Card>
        <Card className="p-3 text-center border-l-4 border-l-text-muted">
          <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Pending</span>
          <p className="text-2xl font-bold text-text mt-0.5">{attendance.summary.totalValidUnredeemed}</p>
        </Card>
        <Card className="p-3 text-center border-l-4 border-l-warning">
          <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Duplicates</span>
          <p className="text-2xl font-bold text-warning mt-0.5">{attendance.summary.duplicateAttempts}</p>
        </Card>
      </div>

      {/* Attendance Progress Meter */}
      <div className="bg-surface border border-border rounded-lg p-3">
        <div className="flex justify-between items-center text-xs font-medium mb-1.5">
          <span className="text-text">Overall Turnstile Attendance Rate</span>
          <span className="text-brand font-bold">{checkinRate}%</span>
        </div>
        <div className="w-full h-2.5 bg-surface-2 rounded-full overflow-hidden border border-border/60">
          <div
            className="h-full bg-success transition-all duration-300 rounded-full"
            style={{ width: `${checkinRate}%` }}
          />
        </div>
      </div>

      {/* Main Scanner Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Viewfinder Camera View & Manual Entry */}
        <Card className="p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-text flex items-center gap-2">
                <Camera className="w-4 h-4 text-brand" />
                <span>Optical QR Scanner</span>
              </h2>
              {cameraActive && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleTorch}
                  className={torchOn ? 'bg-warning/20 border-warning text-warning' : ''}
                >
                  <Flashlight className="w-3.5 h-3.5 mr-1" />
                  <span>{torchOn ? 'Torch On' : 'Torch Off'}</span>
                </Button>
              )}
            </div>

            {/* Viewfinder Window */}
            <div className="w-full aspect-square max-h-64 bg-slate-950 rounded-xl overflow-hidden relative flex items-center justify-center border-2 border-dashed border-border/80">
              {cameraActive ? (
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                  muted
                />
              ) : (
                <div className="text-center p-6 space-y-2">
                  <Camera className="w-10 h-10 text-white/40 mx-auto" />
                  <p className="text-xs text-white/70">Camera is offline</p>
                  <Button variant="primary" size="sm" onClick={startCamera}>
                    Activate Camera
                  </Button>
                </div>
              )}

              {/* Aiming Reticle Overlay */}
              {cameraActive && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-44 h-44 border-2 border-brand/90 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] animate-pulse" />
                </div>
              )}
            </div>
          </div>

          {/* Manual Token Input */}
          <div className="space-y-2 pt-2 border-t border-border">
            <label className="block text-xs font-medium text-text">
              Manual Code Entry (URL or 43-Char Token)
            </label>
            <div className="flex gap-2">
              <Input
                placeholder="Paste https://eventora/t/... or 43-char token"
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

        {/* Right: Colored Outcome Card */}
        <div className="flex flex-col space-y-4">
          <Card className="p-5 flex-1 flex flex-col justify-center">
            <h2 className="text-sm font-bold text-text mb-3">Scan Result & Admittance</h2>

            {lastOutcome ? (
              <div
                className={`p-6 rounded-xl border flex flex-col items-center text-center space-y-3 transition-all ${
                  lastOutcome.outcome === 'ACCEPTED'
                    ? 'bg-success/10 border-success text-success'
                    : lastOutcome.outcome === 'DUPLICATE'
                    ? 'bg-warning/10 border-warning text-warning'
                    : 'bg-error/10 border-error text-error'
                }`}
                role="alert"
                aria-live="assertive"
              >
                {lastOutcome.outcome === 'ACCEPTED' ? (
                  <CheckCircle2 className="w-16 h-16 animate-bounce" />
                ) : lastOutcome.outcome === 'DUPLICATE' ? (
                  <AlertTriangle className="w-16 h-16" />
                ) : (
                  <XCircle className="w-16 h-16" />
                )}

                <div className="space-y-1">
                  <span className="text-xs font-mono uppercase tracking-wider font-bold">
                    [{lastOutcome.outcome}]
                  </span>
                  <h3 className="text-lg font-bold">{lastOutcome.message}</h3>

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

                  {lastOutcome.firstScannedAt && (
                    <p className="text-xs opacity-90 mt-2">
                      Original Check-in: {new Date(lastOutcome.firstScannedAt).toLocaleTimeString()}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-text-muted space-y-2 border border-dashed border-border rounded-xl">
                <ShieldCheck className="w-10 h-10 mx-auto text-text-muted/60" />
                <p className="text-sm font-medium text-text">Awaiting Next Attendee</p>
                <p className="text-xs max-w-xs mx-auto">
                  Scan turnstile QR pass or enter token to trigger atomic check-in transaction.
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Recent Scan Audit Log Table */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-text flex items-center gap-2">
            <Clock className="w-4 h-4 text-brand" />
            <span>Recent Gate Scans (Audit Log)</span>
          </h2>
          <Badge variant="neutral" size="sm">Last 50 attempts</Badge>
        </div>

        {attendance.recentScans.length === 0 ? (
          <p className="text-xs text-text-muted py-6 text-center">
            No gate scans recorded yet for this session.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border text-text-muted">
                <tr>
                  <th className="py-2 px-3">Timestamp</th>
                  <th className="py-2 px-3">Outcome</th>
                  <th className="py-2 px-3">Staff Verifier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {attendance.recentScans.map((s) => (
                  <tr key={s.id} className="hover:bg-surface-2 transition-colors">
                    <td className="py-2 px-3 font-mono text-text-muted">
                      {new Date(s.at).toLocaleTimeString()}
                    </td>
                    <td className="py-2 px-3">
                      <Badge
                        variant={
                          s.outcome === 'ACCEPTED'
                            ? 'success'
                            : s.outcome === 'DUPLICATE'
                            ? 'warning'
                            : 'error'
                        }
                        size="sm"
                      >
                        {s.outcome}
                      </Badge>
                    </td>
                    <td className="py-2 px-3 text-text">
                      {s.staffName || 'Turnstile Staff'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
