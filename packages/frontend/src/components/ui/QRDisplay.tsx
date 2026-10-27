import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  QrCode,
  ShieldCheck,
  Lock,
  SunMedium,
  RotateCcw,
  Check,
  Copy,
  Maximize2,
  X,
  FileText,
  Image as ImageIcon,
  WifiOff,
  RefreshCw,
} from 'lucide-react';
import { Badge } from './Badge';
import { Button } from './Button';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';
import { useToast } from './Toast';

export interface QRDisplayProps {
  ticketId: string; // Ticket UUID or code
  actualTicketId?: string; // Explicit Ticket UUID if ticketId is human ticket_code
  ticketCode?: string;
  qrPayloadPreview?: string;
  status: 'VALID' | 'CHECKED_IN' | 'CANCELLED' | 'REVOKED';
  eventName: string;
  attendeeName: string;
  tierName?: string;
  className?: string;
  onRotated?: () => void;
}

export const QRDisplay: React.FC<QRDisplayProps> = ({
  ticketId,
  actualTicketId,
  ticketCode: propTicketCode,
  qrPayloadPreview,
  status,
  eventName,
  attendeeName,
  tierName = 'General Admission',
  className,
  onRotated,
}) => {
  const { toast } = useToast();
  const ticketUuid = actualTicketId || (ticketId.includes('-') && ticketId.length === 36 ? ticketId : ticketId);
  const displayCode = propTicketCode || (ticketId.startsWith('TCK-') ? ticketId : ticketId.slice(0, 16));

  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isOfflineCached, setIsOfflineCached] = useState<boolean>(false);
  const [isMaxBrightness, setIsMaxBrightness] = useState<boolean>(false);
  const [isRotating, setIsRotating] = useState<boolean>(false);
  const [hasCopiedCode, setHasCopiedCode] = useState<boolean>(false);
  const wakeLockRef = useRef<any>(null);

  const cacheKey = `eventora_offline_qr_${ticketUuid}`;

  // Fetch or load from offline cache
  const loadQrSvg = useCallback(async () => {
    // 1. Check local offline cache first
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        setSvgContent(cached);
        setIsOfflineCached(true);
      }
    } catch {
      // LocalStorage access issues
    }

    if (status === 'REVOKED' || status === 'CANCELLED') {
      return;
    }

    // 2. Fetch fresh SVG from backend if online
    if (navigator.onLine) {
      setIsLoading(true);
      try {
        const svg = await apiClient.get<string>(`/api/v1/tickets/${ticketUuid}/qr.svg`, {
          headers: { Accept: 'image/svg+xml, text/plain' },
        });

        if (typeof svg === 'string' && svg.includes('<svg')) {
          setSvgContent(svg);
          setIsOfflineCached(false);
          try {
            localStorage.setItem(cacheKey, svg);
          } catch {
            // Storage quota
          }
        }
      } catch {
        // If fetch fails, keep offline cached version if present
      } finally {
        setIsLoading(false);
      }
    }
  }, [ticketUuid, status, cacheKey]);

  useEffect(() => {
    loadQrSvg();
  }, [loadQrSvg]);

  // Screen Wake Lock API for Max-Brightness Gate Entry
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator && (navigator as any).wakeLock) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch {
      // Wake lock not supported or denied
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  };

  const toggleMaxBrightness = (enable: boolean) => {
    setIsMaxBrightness(enable);
    if (enable) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }
  };

  useEffect(() => {
    return () => {
      releaseWakeLock();
    };
  }, []);

  // Handle Token Rotation (Invalidates old QR)
  const handleRotateToken = async () => {
    if (status !== 'VALID') {
      toast({
        title: 'Cannot Rotate Token',
        message: `This ticket is ${status.toLowerCase()} and cannot be rotated.`,
        type: 'error',
      });
      return;
    }

    const confirmed = window.confirm(
      'Are you sure you want to regenerate your QR pass? Any previously printed or screenshotted QR code will immediately become invalid.'
    );
    if (!confirmed) return;

    setIsRotating(true);
    try {
      await apiClient.post(`/api/v1/tickets/${ticketUuid}/regenerate-qr`, {});
      try {
        localStorage.removeItem(cacheKey);
      } catch {
        // Ignore
      }
      toast({
        title: 'QR Code Regenerated',
        message: 'New secure token generated. Old pass invalidated.',
        type: 'success',
      });
      await loadQrSvg();
      if (onRotated) onRotated();
    } catch (err: any) {
      toast({
        title: 'Rotation Failed',
        message: err.message || 'Could not regenerate QR code.',
        type: 'error',
      });
    } finally {
      setIsRotating(false);
    }
  };

  const handleCopyCode = () => {
    if (displayCode) {
      navigator.clipboard.writeText(displayCode).catch(() => {});
      setHasCopiedCode(true);
      setTimeout(() => setHasCopiedCode(false), 2000);
      toast({
        title: 'Code Copied',
        message: 'Human pass code copied to clipboard.',
        type: 'info',
      });
    }
  };

  const downloadFile = (format: 'pdf' | 'png') => {
    const url = `/api/v1/tickets/${ticketUuid}/download?format=${format}`;
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `ticket-${displayCode}.${format}`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      <div
        className={cn(
          'bg-surface border border-border rounded-xl p-5 flex flex-col items-center text-center max-w-sm w-full mx-auto shadow-sm',
          className
        )}
      >
        {/* Header with pass code and validity */}
        <div className="w-full flex justify-between items-center mb-3">
          <button
            type="button"
            onClick={handleCopyCode}
            className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-brand hover:text-brand-dark tracking-wider transition-colors"
            title="Click to copy pass code"
          >
            <span>{displayCode}</span>
            {hasCopiedCode ? (
              <Check className="w-3.5 h-3.5 text-success" />
            ) : (
              <Copy className="w-3.5 h-3.5 opacity-60 hover:opacity-100" />
            )}
          </button>
          <Badge
            variant={
              status === 'VALID'
                ? 'success'
                : status === 'CHECKED_IN'
                ? 'neutral'
                : 'error'
            }
            size="sm"
          >
            {status === 'VALID'
              ? 'Valid for Entry'
              : status === 'CHECKED_IN'
              ? 'Already Checked In'
              : status === 'REVOKED'
              ? 'Revoked'
              : 'Cancelled'}
          </Badge>
        </div>

        {/* High-Contrast Quiet Zone QR Container: Minimum 240px x 240px */}
        <div
          className="w-[240px] h-[240px] bg-white p-2 rounded-xl border-2 border-slate-300 flex items-center justify-center my-2 shadow-sm relative overflow-hidden group"
          aria-label="High-contrast Turnstile QR Code"
        >
          {isLoading && !svgContent ? (
            <div className="flex flex-col items-center justify-center gap-2 text-text-muted">
              <RefreshCw className="w-8 h-8 animate-spin text-brand" />
              <span className="text-xs">Loading Secure QR...</span>
            </div>
          ) : svgContent ? (
            <div
              className="w-full h-full flex items-center justify-center"
              dangerouslySetInnerHTML={{ __html: svgContent }}
            />
          ) : (
            <div className="w-full h-full bg-slate-950 rounded-lg p-3 flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <div className="w-12 h-12 border-4 border-white bg-slate-950 flex items-center justify-center rounded-xs">
                  <div className="w-5 h-5 bg-white rounded-xs" />
                </div>
                <div className="w-12 h-12 border-4 border-white bg-slate-950 flex items-center justify-center rounded-xs">
                  <div className="w-5 h-5 bg-white rounded-xs" />
                </div>
              </div>

              <div className="flex items-center justify-center py-2">
                <div className="p-2 bg-white/10 rounded-lg backdrop-blur-xs">
                  <QrCode className="w-14 h-14 text-white" />
                </div>
              </div>

              <div className="flex justify-between items-end">
                <div className="w-12 h-12 border-4 border-white bg-slate-950 flex items-center justify-center rounded-xs">
                  <div className="w-5 h-5 bg-white rounded-xs" />
                </div>
                <div className="flex flex-col gap-1 items-end">
                  <div className="w-10 h-3 bg-white/80 rounded-xs" />
                  <div className="w-6 h-3 bg-white/60 rounded-xs" />
                </div>
              </div>
            </div>
          )}

          {/* Quick-Action Overlay on Hover */}
          <button
            type="button"
            onClick={() => toggleMaxBrightness(true)}
            className="absolute inset-0 bg-slate-950/60 text-white flex flex-col items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-xs cursor-pointer"
            title="Open Turnstile Max-Brightness View"
          >
            <Maximize2 className="w-6 h-6" />
            <span className="text-xs font-semibold">Max Brightness</span>
          </button>
        </div>

        {/* Offline Cache Indicator */}
        {isOfflineCached && (
          <div className="flex items-center gap-1.5 text-[10px] text-amber-500 font-medium bg-amber-500/10 px-2 py-0.5 rounded-full mt-1 border border-amber-500/20">
            <WifiOff className="w-3 h-3" />
            <span>Offline Ready • Gate Cached</span>
          </div>
        )}

        {/* Quick Help */}
        <p className="text-[11px] text-text-muted mt-2 text-center">
          Increase screen brightness for rapid gate scan
        </p>

        {/* Action Controls */}
        <div className="w-full grid grid-cols-2 gap-2 mt-3 pt-2 border-t border-border/80">
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleMaxBrightness(true)}
            className="text-xs flex items-center justify-center gap-1.5"
            title="Max screen brightness for fast scan"
          >
            <SunMedium className="w-3.5 h-3.5 text-warning" />
            <span>Max Light</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleRotateToken}
            disabled={isRotating || status !== 'VALID'}
            isLoading={isRotating}
            className="text-xs flex items-center justify-center gap-1.5"
            title="Regenerate token (invalidates old QR)"
          >
            <RotateCcw className="w-3.5 h-3.5 text-brand" />
            <span>Rotate QR</span>
          </Button>
        </div>

        {/* Download Buttons */}
        <div className="w-full flex items-center gap-2 mt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => downloadFile('pdf')}
            className="flex-1 text-[11px] h-8 flex items-center justify-center gap-1 text-text-muted hover:text-text border border-border/60"
          >
            <FileText className="w-3 h-3" />
            <span>Download PDF</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => downloadFile('png')}
            className="flex-1 text-[11px] h-8 flex items-center justify-center gap-1 text-text-muted hover:text-text border border-border/60"
          >
            <ImageIcon className="w-3 h-3" />
            <span>Download PNG</span>
          </Button>
        </div>

        {/* Ticket Meta & Tier */}
        <div className="w-full mt-3 text-left space-y-1.5 border-t border-border pt-3">
          <div className="flex justify-between items-start">
            <p className="text-xs font-bold text-text truncate max-w-[200px]">{eventName}</p>
            <Badge variant="neutral" size="sm">{tierName}</Badge>
          </div>
          <p className="text-[11px] text-text-muted">Attendee: <span className="font-medium text-text">{attendeeName}</span></p>

          <div className="flex items-center gap-1 text-[10px] text-text-muted mt-2 pt-1.5 border-t border-border/60">
            <Lock className="w-3 h-3 text-brand shrink-0" />
            <span className="font-mono truncate">
              Token: {qrPayloadPreview ? qrPayloadPreview.substring(0, 18) : ticketUuid.slice(0, 18)}...
            </span>
          </div>
        </div>

        {/* Security Guarantee */}
        <div className="mt-3 flex items-center justify-center gap-1 text-[10px] text-success font-medium">
          <ShieldCheck className="w-3.5 h-3.5 text-success shrink-0" />
          <span>Opaque 32-Byte Token • Zero PII Exposure</span>
        </div>
      </div>

      {/* Full-Screen Max-Brightness Turnstile Modal */}
      {isMaxBrightness && (
        <div
          className="fixed inset-0 z-50 bg-white text-slate-950 flex flex-col items-center justify-between p-6 sm:p-10 select-none"
          role="dialog"
          aria-label="Max Brightness Turnstile Pass"
        >
          {/* Top Exit & Notice */}
          <div className="w-full max-w-md flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SunMedium className="w-5 h-5 text-amber-500 animate-spin" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Gate Entry Mode (Max Brightness)
              </span>
            </div>
            <button
              type="button"
              onClick={() => toggleMaxBrightness(false)}
              className="p-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              title="Close max brightness mode"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Central QR Code Card */}
          <div className="flex flex-col items-center text-center space-y-4 my-auto">
            <div className="w-72 h-72 sm:w-80 sm:h-80 bg-white p-4 rounded-2xl border-4 border-slate-900 shadow-2xl flex items-center justify-center">
              {svgContent ? (
                <div
                  className="w-full h-full flex items-center justify-center"
                  dangerouslySetInnerHTML={{ __html: svgContent }}
                />
              ) : (
                <QrCode className="w-52 h-52 text-slate-950" />
              )}
            </div>

            <div className="space-y-1">
              <p className="font-mono text-xl sm:text-2xl font-black text-slate-900 tracking-wider">
                {displayCode}
              </p>
              <p className="text-sm font-semibold text-slate-600">
                {eventName} • {tierName}
              </p>
            </div>
          </div>

          {/* Bottom Guidance */}
          <div className="w-full max-w-md text-center space-y-2">
            <p className="text-xs text-slate-600 font-medium">
              Hold device steady 4–6 inches from the scanner lens. Screen lock is kept awake.
            </p>
            <Button
              variant="outline"
              size="md"
              className="w-full text-slate-950 border-slate-300 hover:bg-slate-100"
              onClick={() => toggleMaxBrightness(false)}
            >
              Dismiss Turnstile Mode
            </Button>
          </div>
        </div>
      )}
    </>
  );
};
