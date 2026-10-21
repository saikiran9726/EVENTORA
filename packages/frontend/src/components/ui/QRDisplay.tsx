import React from 'react';
import { QrCode, ShieldCheck, Lock, SunMedium } from 'lucide-react';
import { Badge } from './Badge';
import { cn } from '@/lib/utils';

export interface QRDisplayProps {
  ticketId: string;
  qrPayloadPreview: string; // 43-character opaque base64url token or full url
  status: 'VALID' | 'CHECKED_IN' | 'CANCELLED' | 'REVOKED';
  eventName: string;
  attendeeName: string;
  tierName?: string;
  className?: string;
}

export const QRDisplay: React.FC<QRDisplayProps> = ({
  ticketId,
  qrPayloadPreview,
  status,
  eventName,
  attendeeName,
  tierName = 'General Admission',
  className,
}) => {
  return (
    <div
      className={cn(
        'bg-surface border border-border rounded-xl p-5 flex flex-col items-center text-center max-w-sm w-full mx-auto shadow-sm',
        className
      )}
    >
      <div className="w-full flex justify-between items-center mb-3">
        <span className="font-mono text-xs font-semibold text-brand tracking-wider">{ticketId}</span>
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

      {/* High-Contrast Quiet Zone QR Container: Minimum 240px x 240px for reliable scanner reads */}
      <div
        className="w-[240px] h-[240px] bg-white p-4 rounded-xl border-2 border-slate-300 flex items-center justify-center my-2 shadow-sm relative"
        aria-label="High-contrast Turnstile QR Code"
      >
        {/* Visual QR Pattern representation with clear quiet zone border */}
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
      </div>

      {/* Brightness Guidance for Fast Turnstile Scanning */}
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-text-muted bg-surface-2 px-3 py-1.5 rounded-md border border-border/80 w-full justify-center">
        <SunMedium className="w-3.5 h-3.5 text-warning shrink-0" />
        <span>Tip: Increase screen brightness for rapid gate scan</span>
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
            Token: {qrPayloadPreview.substring(0, 18)}...
          </span>
        </div>
      </div>

      {/* Security Guarantee */}
      <div className="mt-3 flex items-center justify-center gap-1 text-[10px] text-success font-medium">
        <ShieldCheck className="w-3.5 h-3.5 text-success shrink-0" />
        <span>Opaque 32-Byte Token • Zero PII Exposure</span>
      </div>
    </div>
  );
};
