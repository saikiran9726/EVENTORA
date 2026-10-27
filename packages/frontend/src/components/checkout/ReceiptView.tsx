import React from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatPaise } from '@/lib/utils';
import { Printer, CheckCircle2, ShieldCheck, ExternalLink } from 'lucide-react';

export interface ReceiptData {
  receiptNumber: string;
  bookingId: string;
  paymentId?: string;
  utr?: string;
  eventTitle: string;
  collegeName?: string;
  organizerName?: string;
  attendeeName?: string;
  attendeeEmail?: string;
  ticketName: string;
  quantity: number;
  amountPaise: number;
  issuedAt: string;
  isSimulated?: boolean;
}

export interface ReceiptViewProps {
  receipt: ReceiptData;
  onNavigateToTickets?: () => void;
  className?: string;
}

export const ReceiptView: React.FC<ReceiptViewProps> = ({
  receipt,
  onNavigateToTickets,
  className = '',
}) => {
  const handlePrint = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  const formattedDate = new Date(receipt.issuedAt).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Printable Receipt Card */}
      <Card className="p-6 sm:p-8 space-y-6 border-success/30 bg-surface print:border-none print:shadow-none print:p-0">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border pb-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center text-success shrink-0 print:border print:border-success">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-text">Tax Invoice & Digital Receipt</h2>
                <Badge variant="success" size="sm">
                  Payment Confirmed & Verified
                </Badge>
              </div>
              <p className="text-xs text-text-muted mt-0.5">
                Official registration confirmation and voucher
              </p>
            </div>
          </div>

          <div className="text-left sm:text-right text-xs space-y-1">
            <div className="font-mono font-bold text-text text-sm">
              <span className="text-text-muted font-sans font-normal text-xs">Receipt Number: </span>
              {receipt.receiptNumber}
            </div>
            <div className="text-text-muted">{formattedDate}</div>
          </div>
        </div>

        {/* GST & Organization Header */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-lg bg-surface-2 border border-border text-xs">
          <div className="space-y-1">
            <span className="font-semibold text-text uppercase tracking-wider text-[10px] text-text-muted">
              Issued By (Organizer / Campus Entity)
            </span>
            <p className="font-bold text-text text-sm">
              {receipt.organizerName || 'Eventora Campus Event Society'}
            </p>
            <p className="text-text-muted">{receipt.collegeName || 'Autonomous Campus Center'}</p>
            <div className="pt-1.5 space-y-0.5 text-[11px] text-text-muted font-mono">
              <p>
                <span className="font-medium text-text">GSTIN:</span> 29AAAAA0000A1Z5 (Exempt / Educational)
              </p>
              <p>
                <span className="font-medium text-text">SAC Code:</span> 9996 (Student Training & Events)
              </p>
            </div>
          </div>

          <div className="space-y-1 md:text-right">
            <span className="font-semibold text-text uppercase tracking-wider text-[10px] text-text-muted">
              Billed To (Attendee)
            </span>
            <p className="font-bold text-text text-sm">{receipt.attendeeName || 'Registered Student'}</p>
            <p className="text-text-muted font-mono">{receipt.attendeeEmail || 'student@campus.edu'}</p>
            <div className="pt-1.5 space-y-0.5 text-[11px] text-text-muted font-mono">
              <p>
                <span className="font-medium text-text">Booking Ref:</span> {receipt.bookingId.slice(0, 16)}...
              </p>
              {receipt.utr && (
                <p>
                  <span className="font-medium text-text">Bank UPI UTR:</span> {receipt.utr}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Line Items Table */}
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs text-left">
            <thead className="bg-surface-2 border-b border-border text-text-muted font-semibold">
              <tr>
                <th className="py-2.5 px-3">Description</th>
                <th className="py-2.5 px-3 text-center">SAC</th>
                <th className="py-2.5 px-3 text-center">Qty</th>
                <th className="py-2.5 px-3 text-right">Price</th>
                <th className="py-2.5 px-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="py-3 px-3">
                  <div className="font-semibold text-text">{receipt.eventTitle}</div>
                  <div className="text-[11px] text-text-muted mt-0.5">{receipt.ticketName}</div>
                </td>
                <td className="py-3 px-3 text-center font-mono text-text-muted">9996</td>
                <td className="py-3 px-3 text-center font-semibold text-text">{receipt.quantity}</td>
                <td className="py-3 px-3 text-right font-mono text-text">
                  ₹{formatPaise(Math.round(receipt.amountPaise / receipt.quantity))}
                </td>
                <td className="py-3 px-3 text-right font-mono font-semibold text-text">
                  ₹{formatPaise(receipt.amountPaise)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Tax Breakdown & Totals */}
        <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pt-2">
          <div className="text-[11px] text-text-muted max-w-sm space-y-1">
            <p className="font-semibold text-text flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-success" />
              <span>Verified Bank Settlement via YouPI-PG Gateway</span>
            </p>
            <p>
              Direct peer-to-peer settlement verified by cryptographic HMAC-SHA256 signature and bank UTR match.
              All monetary values stored server-side in integer paise.
            </p>
          </div>

          <div className="w-full sm:w-64 space-y-2 text-xs font-mono">
            <div className="flex justify-between text-text-muted">
              <span>Taxable Subtotal:</span>
              <span>₹{formatPaise(receipt.amountPaise)}</span>
            </div>
            <div className="flex justify-between text-text-muted">
              <span>CGST (0%):</span>
              <span>₹0.00</span>
            </div>
            <div className="flex justify-between text-text-muted">
              <span>SGST (0%):</span>
              <span>₹0.00</span>
            </div>
            <div className="flex justify-between text-text-muted">
              <span>Convenience Fee:</span>
              <span>₹0.00</span>
            </div>
            <div className="border-t border-border pt-2 flex justify-between font-bold text-sm text-text">
              <span className="font-sans">Total Paid:</span>
              <span>₹{formatPaise(receipt.amountPaise)}</span>
            </div>
            <div className="text-[10px] text-right text-text-muted font-sans">
              ({receipt.amountPaise} paise)
            </div>
          </div>
        </div>
      </Card>

      {/* Action Controls (Hidden in Print) */}
      <div className="flex flex-col sm:flex-row items-center gap-3 print:hidden">
        {onNavigateToTickets && (
          <Button
            variant="primary"
            size="md"
            className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2"
            onClick={onNavigateToTickets}
          >
            <span>View QR Tickets in Passport</span>
            <ExternalLink className="w-4 h-4" />
          </Button>
        )}

        <Button
          variant="outline"
          size="md"
          className="w-full sm:w-auto flex items-center justify-center gap-2"
          onClick={handlePrint}
        >
          <Printer className="w-4 h-4" />
          <span>Print / Save PDF</span>
        </Button>
      </div>
    </div>
  );
};
