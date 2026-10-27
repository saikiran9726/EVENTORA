import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatPaise } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  Code,
  User,
} from 'lucide-react';

export interface VerificationItem {
  id: string;
  booking_id: string;
  provider: string;
  provider_order_id: string;
  amount_paise: number;
  currency: string;
  status: string;
  utr?: string;
  verification_queue_reason?: string;
  raw_webhook_payload?: any;
  created_at: string;
  updated_at: string;
  event_id: string;
  event_title: string;
  organizer_id: string;
  attendee_email: string;
  attendee_name: string;
}

export interface VerificationQueueViewProps {
  isAdmin?: boolean;
  className?: string;
}

export const VerificationQueueView: React.FC<VerificationQueueViewProps> = ({
  isAdmin = false,
  className = '',
}) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState<boolean>(true);
  const [items, setItems] = useState<VerificationItem[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedItemForAction, setSelectedItemForAction] = useState<VerificationItem | null>(null);
  const [actionType, setActionType] = useState<'CONFIRM' | 'REJECT' | null>(null);
  const [actionNotes, setActionNotes] = useState<string>('');
  const [isSubmittingAction, setIsSubmittingAction] = useState<boolean>(false);
  const [payloadModalItem, setPayloadModalItem] = useState<VerificationItem | null>(null);

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const data = await apiClient.get<{ items: VerificationItem[]; count: number }>(
        '/api/v1/organizer/payments/verification-queue'
      );
      setItems(data.items || []);
    } catch (err: any) {
      toast({
        type: 'error',
        title: 'Failed to Load Verification Queue',
        message: err?.message || err?.error?.message || 'Access denied or network error',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
  }, []);

  const handleResolve = async () => {
    if (!selectedItemForAction || !actionType) return;
    if (actionType === 'REJECT' && !actionNotes.trim()) {
      toast({
        type: 'error',
        title: 'Rejection Reason Required',
        message: 'Please provide a clear reason for rejecting the payment.',
      });
      return;
    }

    setIsSubmittingAction(true);
    try {
      await apiClient.post<{ success: boolean; result: any }>(
        `/api/v1/organizer/payments/${selectedItemForAction.id}/resolve-verification`,
        {
          resolution: actionType,
          notes: actionNotes.trim() || undefined,
        }
      );

      toast({
        type: 'success',
        title: actionType === 'CONFIRM' ? 'Payment Approved & Fulfilled' : 'Payment Rejected',
        message:
          actionType === 'CONFIRM'
            ? `Payment ${selectedItemForAction.id.slice(0, 8)} approved. Booking confirmed and tickets issued.`
            : `Payment ${selectedItemForAction.id.slice(0, 8)} marked failed and seats released.`,
      });

      // Remove item from local state
      setItems((prev) => prev.filter((i) => i.id !== selectedItemForAction.id));
      setSelectedItemForAction(null);
      setActionType(null);
      setActionNotes('');
    } catch (err: any) {
      toast({
        type: 'error',
        title: 'Action Failed',
        message: err?.message || err?.error?.message || 'Could not resolve verification status',
      });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const filteredItems = items.filter((item) => {
    const q = searchTerm.toLowerCase();
    return (
      item.event_title?.toLowerCase().includes(q) ||
      item.attendee_name?.toLowerCase().includes(q) ||
      item.attendee_email?.toLowerCase().includes(q) ||
      item.utr?.toLowerCase().includes(q) ||
      item.booking_id?.toLowerCase().includes(q) ||
      item.verification_queue_reason?.toLowerCase().includes(q)
    );
  });

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header & Stats Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-surface p-4 sm:p-6 rounded-xl border border-border">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold text-text">Payment Verification Queue (P13)</h2>
            <Badge variant="warning" size="sm">
              {items.length} Pending Review
            </Badge>
            {isAdmin && (
              <Badge variant="info" size="sm">
                Global Admin Mode
              </Badge>
            )}
          </div>
          <p className="text-xs text-text-muted mt-1 max-w-xl">
            Payments flagged by YouPI-PG or the webhook pipeline due to amount discrepancy, unconfirmed UTR,
            or status divergence. Reviewing and approving executes the same atomic fulfillment as the verified webhook.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={fetchQueue}
          disabled={loading}
          className="flex items-center gap-1.5 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Queue</span>
        </Button>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder="Filter by UTR, attendee name, email, event title, or booking ref..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-9 pr-4 py-2 bg-surface border border-border rounded-lg text-xs text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>

      {/* Queue Items List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-4 space-y-2">
              <div className="h-5 bg-surface-2 rounded animate-pulse w-1/3" />
              <div className="h-4 bg-surface-2 rounded animate-pulse w-2/3" />
            </Card>
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <Card className="p-12 text-center space-y-3 border-dashed">
          <CheckCircle2 className="w-10 h-10 text-success mx-auto" />
          <h3 className="text-sm font-bold text-text">Verification Queue Clear</h3>
          <p className="text-xs text-text-muted max-w-sm mx-auto">
            {searchTerm
              ? 'No payments matching your search criteria.'
              : 'There are currently no suspicious or pending payments requiring manual review.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredItems.map((item) => (
            <Card key={item.id} className="p-5 space-y-4 border-amber-500/30 bg-surface">
              {/* Item Top Bar */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-border pb-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-text">{item.event_title}</span>
                    <Badge variant="error" size="sm">
                      FLAGGED
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-text-muted">
                    <span>Booking: {item.booking_id.slice(0, 14)}...</span>
                    <span>•</span>
                    <span>Payment ID: {item.id.slice(0, 14)}...</span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-mono font-bold text-sm text-text">
                    ₹{formatPaise(item.amount_paise)}
                  </div>
                  <div className="text-[10px] text-text-muted font-mono">
                    ({item.amount_paise} paise)
                  </div>
                </div>
              </div>

              {/* Item Details Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                {/* Attendee */}
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-semibold text-text-muted">Attendee</span>
                  <p className="font-semibold text-text flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-text-muted" />
                    <span>{item.attendee_name || 'Anonymous'}</span>
                  </p>
                  <p className="text-text-muted font-mono">{item.attendee_email}</p>
                </div>

                {/* UTR & Gateway */}
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-semibold text-text-muted">Bank UTR & Provider</span>
                  <p className="font-mono font-bold text-text">
                    {item.utr || 'No UTR Reported'}
                  </p>
                  <p className="text-text-muted uppercase text-[10px]">
                    Provider: {item.provider}
                  </p>
                </div>

                {/* Flag Reason */}
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-semibold text-text-muted">Verification Reason</span>
                  <p className="text-amber-500 font-medium">
                    {item.verification_queue_reason || 'Manual review requested'}
                  </p>
                  <p className="text-[10px] text-text-muted">
                    Flagged: {new Date(item.updated_at).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
                {item.raw_webhook_payload ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-text-muted flex items-center gap-1.5"
                    onClick={() => setPayloadModalItem(item)}
                  >
                    <Code className="w-3.5 h-3.5" />
                    <span>Inspect Raw Webhook Payload</span>
                  </Button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-error border-error/30 hover:bg-error/10"
                    onClick={() => {
                      setSelectedItemForAction(item);
                      setActionType('REJECT');
                      setActionNotes('');
                    }}
                  >
                    <XCircle className="w-3.5 h-3.5 mr-1" />
                    <span>Reject</span>
                  </Button>

                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setSelectedItemForAction(item);
                      setActionType('CONFIRM');
                      setActionNotes('');
                    }}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                    <span>Approve & Fulfill</span>
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Confirmation & Review Modal */}
      {selectedItemForAction && actionType && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <Card className="max-w-md w-full p-6 space-y-4 bg-surface border border-border shadow-2xl">
            <div className="flex items-center gap-2.5">
              {actionType === 'CONFIRM' ? (
                <CheckCircle2 className="w-6 h-6 text-success shrink-0" />
              ) : (
                <AlertTriangle className="w-6 h-6 text-error shrink-0" />
              )}
              <h3 className="text-base font-bold text-text">
                {actionType === 'CONFIRM' ? 'Approve Flagged Payment?' : 'Reject Flagged Payment?'}
              </h3>
            </div>

            <p className="text-xs text-text-muted leading-relaxed">
              {actionType === 'CONFIRM'
                ? `You are about to manually approve payment ${selectedItemForAction.id.slice(0, 8)} for ₹${formatPaise(
                    selectedItemForAction.amount_paise
                  )}. This will confirm booking ${selectedItemForAction.booking_id.slice(0, 8)}, issue QR tickets to ${
                    selectedItemForAction.attendee_email
                  }, and record an audited ledger entry.`
                : `You are rejecting payment ${selectedItemForAction.id.slice(0, 8)}. The booking will be marked failed and any held seats will be released.`}
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text">
                Reviewer Notes {actionType === 'REJECT' && <span className="text-error">*</span>}
              </label>
              <textarea
                rows={3}
                placeholder={
                  actionType === 'CONFIRM'
                    ? 'Optional: e.g., Verified credit of ₹... on bank portal against UTR ...'
                    : 'Required: e.g., No matching credit found on bank statement'
                }
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                className="w-full p-2.5 bg-surface-2 border border-border rounded-lg text-xs text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedItemForAction(null);
                  setActionType(null);
                  setActionNotes('');
                }}
                disabled={isSubmittingAction}
              >
                Cancel
              </Button>

              <Button
                variant={actionType === 'CONFIRM' ? 'primary' : 'destructive'}
                size="sm"
                onClick={handleResolve}
                isLoading={isSubmittingAction}
              >
                {actionType === 'CONFIRM' ? 'Confirm Approval' : 'Confirm Rejection'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Raw Payload Inspection Modal */}
      {payloadModalItem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <Card className="max-w-xl w-full p-6 space-y-4 bg-surface border border-border shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Code className="w-4 h-4 text-brand" />
                <h3 className="text-sm font-bold text-text">Inbound Webhook Payload Snippet</h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPayloadModalItem(null)}
                className="text-xs"
              >
                Close
              </Button>
            </div>

            <pre className="p-3 bg-surface-2 rounded-lg text-[11px] font-mono text-text overflow-x-auto max-h-80 border border-border">
              {JSON.stringify(payloadModalItem.raw_webhook_payload, null, 2)}
            </pre>
          </Card>
        </div>
      )}
    </div>
  );
};
