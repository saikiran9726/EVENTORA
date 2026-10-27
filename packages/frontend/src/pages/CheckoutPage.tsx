import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatPaise } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';
import { reportError } from '@/lib/error-reporter';
import { loadYouPiScript } from '@/lib/youpi-loader';
import { ReceiptView, ReceiptData } from '@/components/checkout/ReceiptView';
import {
  CreditCard,
  ShieldCheck,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  RefreshCw,
  QrCode,
  RotateCcw,
  ExternalLink,
  Users,
  ShieldAlert,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';

export interface CheckoutPageProps {
  bookingId?: string;
  onSuccess?: (receipt: any) => void;
  onNavigateToTickets?: () => void;
  onBack?: () => void;
}

export interface BookingHoldDetails {
  id: string;
  eventId: string;
  eventTitle: string;
  ticketName: string;
  quantity: number;
  unitPricePaise: number;
  totalPaise: number;
  expiresAt: string;
  status: string;
  isSimulated?: boolean;
}

export type CheckoutState =
  | 'LOADING'
  | 'READY'
  | 'QUEUED'
  | 'CONFIRMING'
  | 'SUCCESS'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'VERIFICATION_QUEUE';

export const CheckoutPage: React.FC<CheckoutPageProps> = ({
  bookingId: propBookingId,
  onSuccess,
  onNavigateToTickets: propOnNavigateToTickets,
  onBack: propOnBack,
}) => {
  const params = useParams<{ bookingId?: string }>();
  const navigate = useNavigate();
  const bookingId = propBookingId || params.bookingId || '';
  const onNavigateToTickets = propOnNavigateToTickets || (() => navigate('/tickets'));
  const onBack = propOnBack || (() => navigate(-1));
  const { toast } = useToast();

  const [booking, setBooking] = useState<BookingHoldDetails | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [checkoutState, setCheckoutState] = useState<CheckoutState>('LOADING');
  const [queuePosition, setQueuePosition] = useState<number>(1);
  const [failureReason, setFailureReason] = useState<string>('');
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(300); // 5 min UPI window default
  const [isRefunding, setIsRefunding] = useState<boolean>(false);
  const [refundStatus, setRefundStatus] = useState<string | null>(null);
  const [isYouPiModalOpen, setIsYouPiModalOpen] = useState<boolean>(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>('Initializing checkout session...');

  // Accessibility focus management
  const statusHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pollCountRef = useRef<number>(0);

  // Announce and shift focus on state changes
  useEffect(() => {
    if (statusHeadingRef.current) {
      statusHeadingRef.current.focus();
    }
  }, [checkoutState]);

  // Clean up polling timer on unmount
  useEffect(() => {
    return () => {
      if (pollingTimerRef.current) {
        clearTimeout(pollingTimerRef.current);
      }
    };
  }, []);

  // 1. Authoritative Status Polling with Backoff (2s -> 10s)
  const pollPaymentStatus = useCallback(
    async (pid: string, attempt: number = 0) => {
      pollCountRef.current = attempt;

      try {
        const data = await apiClient.get<any>(`/payments/${pid}/status`);

        if (data.status === 'SUCCESS' || data.bookingStatus === 'CONFIRMED') {
          setCheckoutState('SUCCESS');
          setLiveAnnouncement('Payment confirmed and verified. Digital receipt and tickets issued.');
          const rec: ReceiptData = {
            receiptNumber: data.receiptNumber || `REC-${Date.now()}-YOUPI`,
            bookingId: data.bookingId || bookingId,
            paymentId: data.id,
            utr: data.utr,
            eventTitle: data.eventTitle || booking?.eventTitle || 'Campus Event Admission',
            ticketName: booking?.ticketName || 'General Admission',
            quantity: booking?.quantity || 1,
            amountPaise: data.amountPaise || booking?.totalPaise || 0,
            issuedAt: data.receiptIssuedAt || new Date().toISOString(),
            isSimulated: Boolean(data.provider === 'simulator'),
          };
          setReceipt(rec);
          toast({
            type: 'success',
            title: 'Payment Confirmed & Verified',
            message: `Receipt ${rec.receiptNumber} generated. Tickets issued to your Passport.`,
          });
          if (onSuccess) onSuccess(rec);
          return;
        }

        if (data.status === 'VERIFICATION_QUEUE') {
          setCheckoutState('VERIFICATION_QUEUE');
          setLiveAnnouncement(
            'Payment routed to verification queue. Organizer review pending. You will receive an email confirmation.'
          );
          return;
        }

        if (data.status === 'FAILED') {
          setCheckoutState('FAILED');
          setFailureReason(data.verificationQueueReason || 'Payment declined or aborted');
          setLiveAnnouncement('Payment failed. You can retry with a fresh checkout order.');
          return;
        }

        if (data.status === 'EXPIRED') {
          setCheckoutState('EXPIRED');
          setLiveAnnouncement('Seat hold has expired. Released back to the public pool.');
          return;
        }

        if (data.status === 'CANCELLED') {
          setCheckoutState('CANCELLED');
          setLiveAnnouncement('Payment was cancelled.');
          return;
        }

        // Slot activation detection if previously queued
        if (data.status === 'PENDING' && data.slotActive && checkoutState === 'QUEUED') {
          setCheckoutState('READY');
          setLiveAnnouncement('Your payment slot has activated! You have 5 minutes to complete UPI transfer.');
          toast({
            type: 'info',
            title: 'Payment Slot Active!',
            message: 'You are now at the front of the queue. Please complete UPI payment within 5 minutes.',
          });
          setSecondsRemaining(300);
          return;
        }

        // Still PENDING or QUEUED: Schedule next backoff poll (2s -> 10s capped)
        // Up to 90 seconds total polling (approx 15 attempts)
        if (attempt >= 18) {
          // If still confirming after 90s, transition gracefully to verification queue advice
          setCheckoutState('VERIFICATION_QUEUE');
          setLiveAnnouncement('Payment is taking longer than expected to confirm. Routed to verification queue.');
          return;
        }

        const nextDelayMs = Math.min(2000 + attempt * 1000, 10000);
        pollingTimerRef.current = setTimeout(() => {
          pollPaymentStatus(pid, attempt + 1);
        }, nextDelayMs);
      } catch (err: any) {
        reportError(err, { context: 'pollPaymentStatus', paymentId: pid, attempt });
        // Retry polling on temporary network glitch
        if (attempt < 15) {
          pollingTimerRef.current = setTimeout(() => {
            pollPaymentStatus(pid, attempt + 1);
          }, 4000);
        }
      }
    },
    [booking, bookingId, checkoutState, onSuccess, toast]
  );

  const startPolling = useCallback(
    (pid: string) => {
      if (pollingTimerRef.current) {
        clearTimeout(pollingTimerRef.current);
      }
      pollPaymentStatus(pid, 0);
    },
    [pollPaymentStatus]
  );

  // 2. Load Booking & Initiate Order
  useEffect(() => {
    let mounted = true;

    async function loadCheckoutOrder() {
      setCheckoutState('LOADING');
      setLiveAnnouncement('Loading checkout order and reserving seat hold...');

      try {
        const data = await apiClient.post<any>(`/api/v1/bookings/${bookingId}/checkout`, {});
        if (!mounted || !data?.order) return;

        const ord = data.order;
        setOrderId(ord.orderId);
        setPaymentId(ord.paymentId);
        setCheckoutUrl(ord.checkoutUrl || null);

        const bDetails: BookingHoldDetails = {
          id: bookingId,
          eventId: ord.eventId || 'evt',
          eventTitle: ord.eventTitle || 'Campus Event Registration',
          ticketName: ord.ticketName || 'General Admission Tier',
          quantity: ord.quantity || 1,
          unitPricePaise: Math.round(ord.amountPaise / (ord.quantity || 1)),
          totalPaise: ord.amountPaise,
          expiresAt: ord.expiresAt || new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          status: ord.slotActive ? 'PENDING_PAYMENT' : 'QUEUED',
          isSimulated: Boolean(ord.isSimulated),
        };
        setBooking(bDetails);

        // Preload youpi.js in parallel from the checkout origin
        loadYouPiScript(ord.checkoutUrl);

        if (!ord.slotActive || ord.queueStatus === 'WAITING') {
          setCheckoutState('QUEUED');
          setQueuePosition(ord.queuePosition || 1);
          setLiveAnnouncement('You are in the payment queue. Hold timer is paused until your slot activates.');
          // Start background status poll to detect slot activation
          startPolling(ord.paymentId);
        } else {
          setCheckoutState('READY');
          setLiveAnnouncement('Checkout ready. Please complete UPI payment.');
          const expiryTime = new Date(bDetails.expiresAt).getTime();
          const rem = Math.max(0, Math.floor((expiryTime - Date.now()) / 1000));
          setSecondsRemaining(rem > 0 ? rem : 300);
        }
      } catch (err: any) {
        if (!mounted) return;
        const errCode = err?.code || err?.error?.code;

        if (errCode === 'HOLD_EXPIRED') {
          setCheckoutState('EXPIRED');
          setLiveAnnouncement('Seat hold has expired.');
          return;
        }

        setCheckoutState('FAILED');
        setFailureReason(err?.message || err?.error?.message || 'Failed to initialize payment order');
        setLiveAnnouncement('Failed to initialize payment.');
      }
    }

    if (bookingId) {
      loadCheckoutOrder();
    }

    return () => {
      mounted = false;
    };
  }, [bookingId, startPolling]);

  // 3. Countdown Timer (Active only in READY state)
  useEffect(() => {
    if (checkoutState !== 'READY') return;

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setCheckoutState('EXPIRED');
          setLiveAnnouncement('Payment window expired.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [checkoutState]);

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // 4. Launch YouPI Payment Dialog
  const handleLaunchYouPiPayment = () => {
    if (!orderId || !paymentId || !booking) return;

    // Check if window.Youpi script is ready
    if (typeof window !== 'undefined' && window.Youpi && typeof window.Youpi.pay === 'function') {
      try {
        window.Youpi.pay({
          order_id: orderId,
          amount: booking.totalPaise / 100, // YouPI expects rupees in display
          currency: 'INR',
          name: booking.eventTitle,
          description: `${booking.ticketName} (x${booking.quantity})`,
          handler: (_response) => {
            // CRITICAL: Browser callback is NEVER proof of payment!
            // Transition to CONFIRMING and await verified server webhook
            setCheckoutState('CONFIRMING');
            setLiveAnnouncement('Confirming payment with bank. Please do not close this window.');
            startPolling(paymentId);
          },
          onClose: () => {
            toast({
              type: 'info',
              title: 'Checkout Dismissed',
              message: 'You closed the payment dialog. Your seat hold remains active until the timer expires.',
            });
          },
        });
        return;
      } catch (e) {
        console.warn('[YouPI Checkout] Script invocation failed, falling back to embedded portal:', e);
      }
    }

    // Fallback: Open Hosted Checkout Modal or Redirect
    setIsYouPiModalOpen(true);
  };

  // 5. User confirms they finished payment in external UPI app
  const handleManualPaymentConfirmation = () => {
    setIsYouPiModalOpen(false);
    setCheckoutState('CONFIRMING');
    setLiveAnnouncement('Confirming payment with your bank...');
    if (paymentId) {
      startPolling(paymentId);
    }
  };

  // 6. DEV-Only Simulation Action (Strictly behind DEV env and simulated provider flag)
  const handleDevSimulatorTrigger = async (shouldSucceed: boolean) => {
    if (!import.meta.env.DEV) return;
    setCheckoutState('CONFIRMING');
    setLiveAnnouncement('Simulating gateway verification in local development...');

    try {
      const data = await apiClient.post<any>('/api/v1/payments/verify', {
        orderId: orderId || `order_${bookingId}`,
        paymentId: shouldSucceed ? (paymentId || `pay_${Date.now()}`) : 'pay_fail_declined',
      });

      if (data?.confirmed && data?.status === 'SUCCEEDED') {
        if (paymentId) {
          startPolling(paymentId);
        }
      } else {
        setCheckoutState('FAILED');
        setFailureReason(data?.failureCode || 'Simulated payment declined');
      }
    } catch (err: any) {
      setCheckoutState('FAILED');
      setFailureReason(err?.message || err?.error?.message || 'Simulator verification failed');
    }
  };

  // 7. Request Refund (Attendee Self-Service)
  const handleRequestRefund = async () => {
    setIsRefunding(true);
    try {
      const data = await apiClient.post<any>(`/api/v1/bookings/${bookingId}/refunds`, {
        reason: 'Student schedule conflict (Attendee cancellation)',
        idempotencyKey: `ref_${bookingId}_${Date.now()}`,
      });

      setRefundStatus(data?.refund?.status || 'REQUESTED');
      toast({
        type: 'info',
        title: 'Refund Requested',
        message: 'Organizer review pending. Seat will be released upon approval.',
      });
    } catch (err: any) {
      toast({
        type: 'error',
        title: 'Refund Error',
        message: err?.message || err?.error?.message || 'Failed to submit refund request',
      });
    } finally {
      setIsRefunding(false);
    }
  };

  // Free Event Early Exit
  if (booking && booking.totalPaise === 0) {
    return (
      <div className="max-w-xl mx-auto py-12 px-4 text-center space-y-4">
        <CheckCircle2 className="w-12 h-12 text-success mx-auto" />
        <h2 className="text-xl font-bold text-text">Free Event Registration</h2>
        <p className="text-sm text-text-muted">
          This is a free campus event. No payment or checkout is required.
        </p>
        <Button variant="primary" onClick={onNavigateToTickets || onBack}>
          Go to My Tickets
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-6 sm:py-8 px-4 space-y-6 pb-24 sm:pb-8">
      {/* Screen reader live region */}
      <div className="sr-only" aria-live="polite" role="status">
        {liveAnnouncement}
      </div>

      {/* Mandatory Non-Production Notice Banner (when running in simulator mode) */}
      {booking?.isSimulated && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3.5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed">
            <span className="font-bold text-amber-500 tracking-wide uppercase">
              TEST MODE – simulated money
            </span>
            <p className="text-text-muted mt-0.5">
              Eventora is operating in strictly simulated test mode. No real bank accounts or UPI VPAs are charged.
              All amounts calculated server-side from stored integer paise ({booking?.totalPaise} paise = ₹{formatPaise(booking?.totalPaise || 0)}).
            </p>
          </div>
        </div>
      )}

      {/* Navigation & Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-semibold text-text-muted hover:text-text transition-colors py-1.5 px-2 rounded-md hover:bg-surface-2"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Cancel & Return</span>
        </button>

        {checkoutState === 'READY' && (
          <div
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${
              secondsRemaining < 60
                ? 'bg-error/10 border-error/30 text-error animate-pulse'
                : 'bg-surface-2 border-border text-text'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Hold expires in: {formatTimer(secondsRemaining)}</span>
          </div>
        )}
      </div>

      {/* 1. Loading State */}
      {checkoutState === 'LOADING' && (
        <Card className="p-8 text-center space-y-4">
          <RefreshCw className="w-8 h-8 text-brand animate-spin mx-auto" />
          <h2 tabIndex={-1} ref={statusHeadingRef} className="text-base font-bold text-text outline-none">
            Initializing Secure Checkout...
          </h2>
          <p className="text-xs text-text-muted max-w-sm mx-auto">
            Contacting YouPI-PG gateway, reserving your seat hold, and verifying rate limits.
          </p>
        </Card>
      )}

      {/* 2. Single-Slot Queue State (QUEUED) */}
      {checkoutState === 'QUEUED' && (
        <Card className="p-6 sm:p-8 text-center space-y-5 border-amber-500/30 bg-surface">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500 mx-auto animate-pulse">
            <Users className="w-6 h-6" />
          </div>

          <div className="space-y-1">
            <h2 tabIndex={-1} ref={statusHeadingRef} className="text-lg font-bold text-text outline-none">
              Waiting for Payment Slot
            </h2>
            <p className="text-xs text-text-muted max-w-md mx-auto">
              YouPI processes peer-to-peer UPI transfers in a strict single-slot FIFO queue.
              Another attendee is completing payment right now.
            </p>
          </div>

          <div className="p-4 bg-surface-2 rounded-lg border border-border inline-block text-xs font-mono">
            <span className="text-text-muted">Your Queue Position: </span>
            <span className="font-bold text-amber-500">#{queuePosition} in line</span>
            <span className="block text-[11px] text-text-muted mt-1 font-sans">
              Seat hold is paused. Once your slot opens, you will receive a fresh 5-minute payment window.
            </span>
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-brand font-medium">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Standing by for slot activation...</span>
          </div>
        </Card>
      )}

      {/* 3. Confirming Payment State */}
      {checkoutState === 'CONFIRMING' && (
        <Card className="p-8 text-center space-y-5">
          <div className="w-12 h-12 rounded-full bg-brand/10 flex items-center justify-center text-brand mx-auto">
            <RefreshCw className="w-6 h-6 animate-spin" />
          </div>

          <div className="space-y-1">
            <h2 tabIndex={-1} ref={statusHeadingRef} className="text-lg font-bold text-text outline-none">
              Confirming Payment with Bank...
            </h2>
            <p className="text-xs text-text-muted max-w-md mx-auto">
              Your UPI transfer is awaiting cryptographic webhook confirmation from YouPI-PG.
              Please do not close or refresh this tab.
            </p>
          </div>

          <div className="w-56 h-2 bg-surface-2 rounded-full overflow-hidden mx-auto">
            <div className="h-full bg-brand animate-pulse w-3/4 rounded-full" />
          </div>
        </Card>
      )}

      {/* 4. Verification Queue State (Flagged / Delayed Confirmation) */}
      {checkoutState === 'VERIFICATION_QUEUE' && (
        <Card className="p-6 sm:p-8 space-y-5 border-amber-500/40 bg-surface">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h2 tabIndex={-1} ref={statusHeadingRef} className="text-base font-bold text-text outline-none">
                Payment Verification in Progress
              </h2>
              <p className="text-xs text-text-muted">
                Your payment was routed to manual organizer review.
              </p>
            </div>
          </div>

          <div className="p-4 bg-surface-2 rounded-lg border border-border text-xs space-y-2 text-text-muted">
            <p className="text-text font-medium">
              We received your payment attempt, but bank settlement confirmation is pending or requires organizer UTR review.
            </p>
            <p>
              Your seats remain protected while an organizer or admin reviews the credit. You will receive an email confirmation once verified.
            </p>
            {paymentId && (
              <div className="pt-1 font-mono text-[11px]">
                <span className="font-semibold text-text">Payment Session Ref: </span>
                {paymentId}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => paymentId && startPolling(paymentId)}
              className="flex items-center gap-1.5 text-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Check Status Again</span>
            </Button>
            <Button variant="primary" size="sm" onClick={onNavigateToTickets || onBack}>
              Return to Events
            </Button>
          </div>
        </Card>
      )}

      {/* 5. Hold Expired State */}
      {checkoutState === 'EXPIRED' && (
        <Card className="p-8 text-center space-y-4 border-error/30">
          <XCircle className="w-12 h-12 text-error mx-auto" />
          <h2 tabIndex={-1} ref={statusHeadingRef} className="text-lg font-bold text-text outline-none">
            Seat Hold Expired
          </h2>
          <p className="text-xs text-text-muted max-w-md mx-auto">
            The payment window for this registration has lapsed. Held seats have been released back to other students.
          </p>
          <Button variant="primary" onClick={onBack}>
            Return to Event Discovery
          </Button>
        </Card>
      )}

      {/* 6. Payment Failed State */}
      {checkoutState === 'FAILED' && (
        <Card className="p-6 space-y-5 border-error/30">
          <div className="flex items-center gap-3 text-error">
            <XCircle className="w-6 h-6 shrink-0" />
            <div>
              <h3 tabIndex={-1} ref={statusHeadingRef} className="text-sm font-bold outline-none">
                Payment Was Declined or Aborted
              </h3>
              <p className="text-xs text-text-muted mt-0.5">Reason: {failureReason || 'Transaction could not be completed.'}</p>
            </div>
          </div>

          <p className="text-xs text-text-muted leading-relaxed">
            Your seat hold remains active until the timer expires. You may retry payment via YouPI UPI.
          </p>

          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="primary"
              size="md"
              onClick={handleLaunchYouPiPayment}
              className="flex-1"
            >
              Retry Payment
            </Button>
            <Button variant="outline" size="md" onClick={onBack}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* 7. Success State: Digital Receipt & Tickets */}
      {checkoutState === 'SUCCESS' && receipt && (
        <div className="space-y-4">
          <ReceiptView
            receipt={receipt}
            onNavigateToTickets={onNavigateToTickets}
          />

          <div className="flex justify-end pt-2">
            {!refundStatus ? (
              <Button
                variant="outline"
                size="sm"
                className="text-xs text-text-muted hover:text-text"
                onClick={handleRequestRefund}
                isLoading={isRefunding}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                <span>Request Refund / Cancellation</span>
              </Button>
            ) : (
              <Badge variant="info" size="md">
                Refund Status: {refundStatus}
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* 8. Ready State: Order Summary & Pay Triggers */}
      {checkoutState === 'READY' && booking && (
        <div className="space-y-6">
          <Card className="p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 tabIndex={-1} ref={statusHeadingRef} className="text-base font-bold text-text outline-none">
                Order Summary
              </h2>
              <span className="text-xs text-text-muted">Hold ID: {booking.id.slice(0, 8)}</span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-text text-sm">{booking.eventTitle}</p>
                  <p className="text-text-muted mt-0.5">{booking.ticketName}</p>
                </div>
                <div className="text-right">
                  <span className="font-bold text-sm text-text">
                    ₹{formatPaise(booking.unitPricePaise)}
                  </span>
                  <span className="block text-[10px] text-text-muted">Qty: {booking.quantity}</span>
                </div>
              </div>

              <div className="border-t border-border pt-3 space-y-1.5 text-text-muted">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>₹{formatPaise(booking.totalPaise)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Campus Convenience Fee</span>
                  <span>₹0.00</span>
                </div>
                <div className="flex justify-between font-bold text-sm text-text border-t border-border pt-2">
                  <span>Grand Total</span>
                  <div className="text-right">
                    <span>₹{formatPaise(booking.totalPaise)}</span>
                    <span className="block text-[10px] font-normal text-text-muted font-mono">
                      ({booking.totalPaise} paise)
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Desktop Pay Button */}
            <div className="pt-2 hidden sm:block">
              <Button
                variant="primary"
                size="lg"
                className="w-full flex items-center justify-center gap-2"
                onClick={handleLaunchYouPiPayment}
              >
                <ShieldCheck className="w-5 h-5" />
                <span>Pay ₹{formatPaise(booking.totalPaise)} via UPI</span>
              </Button>
            </div>
          </Card>

          {/* DEV-Only Simulator Controls (Strictly hidden in production) */}
          {import.meta.env.DEV && booking.isSimulated && (
            <Card className="p-5 space-y-3 bg-surface-2 border-border">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-brand" />
                <h3 className="text-xs font-bold text-text uppercase tracking-wider">
                  [DEV SIMULATOR TEST CONTROLS]
                </h3>
              </div>
              <p className="text-[11px] text-text-muted leading-relaxed">
                Developer test panel visible only during local development when running against test-mode simulator.
              </p>

              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => handleDevSimulatorTrigger(true)}
                >
                  <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
                  Trigger Success Webhook
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="text-xs"
                  onClick={() => handleDevSimulatorTrigger(false)}
                >
                  Trigger Decline
                </Button>
              </div>
            </Card>
          )}

          {/* Mobile Bottom-Sheet Bar */}
          <div className="sm:hidden fixed bottom-0 left-0 right-0 p-4 bg-surface/95 border-t border-border backdrop-blur-md z-40 shadow-xl flex items-center justify-between gap-3">
            <div>
              <span className="text-[10px] uppercase font-semibold text-text-muted block">Total to Pay</span>
              <span className="text-base font-bold text-text">₹{formatPaise(booking.totalPaise)}</span>
            </div>
            <Button
              variant="primary"
              size="md"
              className="flex-1 flex items-center justify-center gap-1.5"
              onClick={handleLaunchYouPiPayment}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Pay via UPI</span>
            </Button>
          </div>
        </div>
      )}

      {/* Hosted Portal / Iframe Modal Fallback */}
      {isYouPiModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <Card className="max-w-md w-full p-6 space-y-4 bg-surface border border-border shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-brand" />
                <h3 className="text-sm font-bold text-text">YouPI UPI Checkout</h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsYouPiModalOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
            </div>

            <p className="text-xs text-text-muted leading-relaxed">
              Open the YouPI checkout portal to scan the dynamic UPI QR code or pay with any UPI app on your device.
            </p>

            {checkoutUrl && (
              <div className="pt-2 space-y-3">
                <a
                  href={checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-brand text-white text-xs font-semibold rounded-lg hover:bg-brand-hover transition-colors"
                >
                  <span>Open YouPI UPI Portal</span>
                  <ExternalLink className="w-4 h-4" />
                </a>

                <div className="p-3 bg-surface-2 rounded-lg border border-border text-center text-[11px] text-text-muted">
                  After completing payment in your UPI app, click below:
                </div>

                <Button
                  variant="outline"
                  size="md"
                  className="w-full text-xs"
                  onClick={handleManualPaymentConfirmation}
                >
                  <CheckCircle2 className="w-4 h-4 mr-1.5 text-success" />
                  <span>I Have Completed UPI Payment</span>
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};
