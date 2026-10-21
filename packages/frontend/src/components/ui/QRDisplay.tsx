import React from 'react';
import { QrCode, ShieldCheck, Lock } from 'lucide-react';
import { Badge } from './Badge';
import { cn } from '@/lib/utils';

export interface QRDisplayProps {
  ticketId: string;
  qrPayloadPreview: string; // base64url(32 random bytes)
  status: 'VALID' | 'CHECKED_IN' | 'CANCELLED' | 'REVOKED';
  eventName: string;
  attendeeName: string;
  className?: string;
}

export const QRDisplay: React.FC<QRDisplayProps> = ({
  ticketId,
  qrPayloadPreview,
  status,
  eventName,
  attendeeName,
  className,
}) => {
  return (
    <div
      className={cn(
        'bg-surface border border-border rounded-lg p-5 flex flex-col items-center text-center max-w-sm mx-auto shadow-sm',
        className
      )}
    >
      <div className="w-full flex justify-between items-center mb-3">
        <span className="font-mono text-xs font-semibold text-brand">{ticketId}</span>
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
          {status === 'VALID' ? 'Valid for Entry' : status === 'CHECKED_IN' ? 'Already Checked In' : 'Invalid'}
        </Badge>
      </div>

      {/* QR Code Container */}
      <div className="w-48 h-48 bg-white p-3 rounded-md border border-border flex items-center justify-center my-2 shadow-inner relative group">
        {/* Visual QR Pattern representation */}
        <div className="w-full h-full bg-slate-900 rounded-sm p-2 flex flex-col justify-between">
          <div className="flex justify-between">
            <div className="w-10 h-10 border-4 border-white bg-slate-900 flex items-center justify-center">
              <div className="w-4 h-4 bg-white" />
            </div>
            <div className="w-10 h-10 border-4 border-white bg-slate-900 flex items-center justify-center">
              <div className="w-4 h-4 bg-white" />
            </div>
          </div>
          <div className="flex items-center justify-center">
            <QrCode className="w-12 h-12 text-white/80" />
          </div>
          <div className="flex justify-between items-end">
            <div className="w-10 h-10 border-4 border-white bg-slate-900 flex items-center justify-center">
              <div className="w-4 h-4 bg-white" />
            </div>
            <div className="w-8 h-4 bg-white/60 rounded-xs" />
          </div>
        </div>
      </div>

      {/* Ticket Details */}
      <div className="w-full mt-3 text-left space-y-1 border-t border-border pt-3">
        <p className="text-xs font-semibold text-text truncate">{eventName}</p>
        <p className="text-[11px] text-text-muted">Attendee: {attendeeName}</p>
        <div className="flex items-center gap-1 text-[10px] text-text-muted mt-2 pt-1 border-t border-border/50">
          <Lock className="w-3 h-3 text-brand shrink-0" />
          <span className="font-mono truncate">Token: {qrPayloadPreview.substring(0, 16)}...</span>
        </div>
      </div>

      {/* Zero PII Security Marker */}
      <div className="mt-3 flex items-center gap-1 text-[10px] text-success font-medium">
        <ShieldCheck className="w-3.5 h-3.5 text-success" />
        <span>Cryptographically Secure • Zero PII in QR</span>
      </div>
    </div>
  );
};
