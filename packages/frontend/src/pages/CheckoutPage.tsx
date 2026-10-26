import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatPaise } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';
import { reportError } from '@/lib/error-reporter';
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
}

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
  const [loading, setLoading] = useState<boolean>(true);
  const [booking, setBooking] = useState<BookingHoldDetails | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [checkoutState, setCheckoutState] = useState<
    'READY' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'EXPIRED'
  >('READY');
  const [failureReason, setFailureReason] = useState<string>('');
  const [receipt, setReceipt] = useState<{
    receiptNumber: string;
    bookingId: string;
    amountPaise: number;
    issuedAt: string;
  } | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(900); // 15 mins default
  const [isRefunding, setIsRefunding] = useState<boolean>(false);
  const [refundStatus, setRefundStatus] = useState<string | null>(null);

  // 1. Fetch hold & initiate checkout order
  useEffect(() => {
    let mounted = true;

    async function loadCheckoutOrder() {
      setLoading(true);

      // In prototype shell or unauthenticated demo walkthrough
      if (bookingId.startsWith('proto-') || bookingId.startsWith('bkg_demo_')) {
        if (mounted) {
          setBooking({
            id: bookingId,
            eventId: 'evt-test-mode',
            eventTitle: 'Advanced Robotics & AI Symposium 2026',
            ticketName: 'Standard Student Admission Tier',
            quantity: 1,
            unitPricePaise: 15000,
            totalPaise: 15000,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            status: 'PENDING_PAYMENT',
          });
          setOrderId(`sim_order_${Date.now()}`);
          setPaymentId(`sim_pay_${Date.now()}`);
          setCheckoutState('READY');
          setLoading(false);
        }
        return;
      }

      try {
        const data = await apiClient.post<any>(`/api/v1/bookings/${bookingId}/checkout`, {});
        if (mounted && data?.order) {
          setOrderId(data.order.orderId);
          setPaymentId(data.order.paymentId);
          setBooking({
            id: bookingId,
            eventId: data.order.eventId || 'evt-confirmed',
            eventTitle: data.order.eventTitle || 'Campus Event Admission',
            ticketName: data.order.ticketName || 'Student Admission Tier',
            quantity: 1,
            unitPricePaise: data.order.amountPaise,
            totalPaise: data.order.amountPaise,
            expiresAt: data.order.expiresAt || new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            status: 'PENDING_PAYMENT',
          });

          const expiryTime = new Date(data.order.expiresAt || Date.now() + 15 * 60 * 1000).getTime();
          const rem = Math.max(0, Math.floor((expiryTime - Date.now()) / 1000));
          setSecondsRemaining(rem > 0 ? rem : 900);
          setLoading(false);
        }
      } catch (err: any) {
        if (err?.code === 'HOLD_EXPIRED' || err?.error?.code === 'HOLD_EXPIRED') {
          if (mounted) {
            setCheckoutState('EXPIRED');
            setLoading(false);
          }
          return;
        }
        if (err?.status === 401 || err?.code === 'AUTHENTICATION_REQUIRED' || bookingId.startsWith('proto-')) {
          if (mounted) {
            setBooking({
              id: bookingId,
              eventId: 'evt-test-mode',
              eventTitle: 'Advanced Robotics & AI Symposium 2026',
              ticketName: 'Standard Student Admission Tier',
              quantity: 1,
              unitPricePaise: 15000,
              totalPaise: 15000,
              expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
              status: 'PENDING_PAYMENT',
            });
            setOrderId(`sim_order_${Date.now()}`);
            setPaymentId(`sim_pay_${Date.now()}`);
            setCheckoutState('READY');
            setLoading(false);
          }
          return;
        }
        if (mounted) {
          setCheckoutState('FAILED');
          setFailureReason(err?.message || err?.error?.message || 'Failed to load booking checkout');
          setLoading(false);
        }
      }
    }

    loadCheckoutOrder();

    return () => {
      mounted = false;
    };
  }, [bookingId]);

  // 2. Countdown Timer
  useEffect(() => {
    if (checkoutState !== 'READY') return;

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setCheckoutState('EXPIRED');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [checkoutState]);

  // Format seconds to mm:ss
  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // 3. Simulate Successful Payment
  const handleSimulatePayment = async (shouldSucceed: boolean) => {
    setCheckoutState('PROCESSING');

    // If demo booking or mock session in frontend prototype, simulate directly
    if (bookingId.startsWith('bkg_demo_') || bookingId.startsWith('proto-')) {
      setTimeout(() => {
        if (shouldSucceed) {
          setCheckoutState('SUCCESS');
          const rec = {
            receiptNumber: `REC-${Date.now()}-SIM`,
            bookingId,
            amountPaise: booking?.totalPaise || 15000,
            issuedAt: new Date().toISOString(),
          };
          setReceipt(rec);
          toast({
            type: 'success',
            title: 'Payment Confirmed & Verified',
            message: `Receipt ${rec.receiptNumber} generated. Ticket is active in your Passport.`,
          });
          if (onSuccess) onSuccess(rec);
        } else {
          setCheckoutState('FAILED');
          setFailureReason('Payment was declined by simulator');
          toast({
            type: 'error',
            title: 'Payment Failed',
            message: 'Transaction declined in simulator mode.',
          });
        }
      }, 350);
      return;
    }

    // Server verification call: verifies payment via authoritative backend transaction
    try {
      const data = await apiClient.post<any>('/api/v1/payments/verify', {
        orderId: orderId || `order_${bookingId}`,
        paymentId: shouldSucceed ? (paymentId || `pay_${Date.now()}`) : 'pay_fail_declined',
      });

      if (data?.confirmed && data?.status === 'SUCCEEDED') {
        setCheckoutState('SUCCESS');
        const rec = {
          receiptNumber: data.receiptNumber || `REC-${Date.now()}-PROD`,
          bookingId,
          amountPaise: booking?.totalPaise || 0,
          issuedAt: new Date().toISOString(),
        };
        setReceipt(rec);
        toast({
          type: 'success',
          title: 'Payment Confirmed & Verified',
          message: `Receipt ${rec.receiptNumber} generated. Ticket is active in your Passport.`,
        });
        if (onSuccess) onSuccess(rec);
      } else {
        setCheckoutState('FAILED');
        setFailureReason(data?.failureCode || 'Payment was declined by payment provider');
        toast({
          type: 'error',
          title: 'Payment Failed',
          message: data?.failureCode || 'Transaction could not be completed.',
        });
      }
    } catch (err: any) {
      reportError(err, { context: 'simulatePayment', bookingId });
      setCheckoutState('FAILED');
      setFailureReason(err?.message || err?.error?.message || 'Payment verification failed');
      toast({
        type: 'error',
        title: 'Payment Verification Error',
        message: err?.message || err?.error?.message || 'Payment verification failed.',
      });
    }
  };

  // 4. Request Refund (Attendee Self-Service)
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

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 space-y-6">
        <div className="h-10 bg-surface-2 rounded animate-pulse w-2/3" />
        <Card className="p-6 space-y-4">
          <div className="h-6 bg-surface-2 rounded animate-pulse w-1/2" />
          <div className="h-24 bg-surface-2 rounded animate-pulse" />
          <div className="h-12 bg-surface-2 rounded animate-pulse" />
        </Card>
      </div>
    );
  }

  // Safety check: Free bookings never show a payment screen
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
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
      {/* 1. Mandatory Test Mode Banner */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3.5 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-xs leading-relaxed">
          <span className="font-bold text-amber-500 tracking-wide uppercase">
            TEST MODE – simulated money
          </span>
          <p className="text-text-muted mt-0.5">
            Eventora is operating in strictly simulated test mode. No real bank accounts, cards, or UPI IDs are charged.
            All totals are calculated server-side from stored integer paise ({booking?.totalPaise} paise = ₹{formatPaise(booking?.totalPaise || 0)}).
          </p>
        </div>
      </div>

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
              secondsRemaining < 120
                ? 'bg-error/10 border-error/30 text-error animate-pulse'
                : 'bg-surface-2 border-border text-text'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Hold expires in {formatTimer(secondsRemaining)}</span>
          </div>
        )}
      </div>

      {/* 2. State-Specific Views */}
      {checkoutState === 'PROCESSING' && (
        <Card className="p-8 text-center space-y-4">
          <RefreshCw className="w-10 h-10 text-brand animate-spin mx-auto" />
          <h2 className="text-lg font-bold text-text">Reconciling Payment with Simulator...</h2>
          <p className="text-xs text-text-muted max-w-md mx-auto">
            Verifying cryptographic HMAC-SHA256 signature, checking idempotency keys, and preparing atomic ledger update.
          </p>
          <div className="w-48 h-2 bg-surface-2 rounded-full overflow-hidden mx-auto">
            <div className="h-full bg-brand animate-pulse w-3/4 rounded-full" />
          </div>
        </Card>
      )}

      {checkoutState === 'EXPIRED' && (
        <Card className="p-8 text-center space-y-4 border-error/30">
          <XCircle className="w-12 h-12 text-error mx-auto" />
          <h2 className="text-lg font-bold text-text">Seat Hold Expired</h2>
          <p className="text-xs text-text-muted max-w-md mx-auto">
            The 15-minute hold window for this registration has lapsed. Held seats have been released back to other students.
          </p>
          <Button variant="primary" onClick={onBack}>
            Return to Event Discovery
          </Button>
        </Card>
      )}

      {checkoutState === 'FAILED' && (
        <Card className="p-6 space-y-5 border-error/30">
          <div className="flex items-center gap-3 text-error">
            <XCircle className="w-6 h-6" />
            <div>
              <h3 className="text-sm font-bold">Simulated Payment Declined</h3>
              <p className="text-xs text-text-muted mt-0.5">Reason: {failureReason}</p>
            </div>
          </div>

          <p className="text-xs text-text-muted leading-relaxed">
            Your seat hold remains active until the timer expires. You may retry checkout using the simulator adapter.
          </p>

          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="primary"
              size="md"
              onClick={() => handleSimulatePayment(true)}
              className="flex-1"
            >
              Retry Payment (Simulate Success)
            </Button>
            <Button variant="outline" size="md" onClick={onBack}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {checkoutState === 'SUCCESS' && receipt && (
        <Card className="p-6 space-y-6 border-success/30 bg-surface">
          <div className="flex items-center gap-3 border-b border-border pb-4">
            <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center text-success shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-text">Payment Confirmed & Verified</h2>
              <p className="text-xs text-text-muted">Digital receipt issued and seats transferred.</p>
            </div>
            <Badge variant="success" size="sm" className="ml-auto">
              CONFIRMED
            </Badge>
          </div>

          {/* Digital Receipt Breakdown */}
          <div className="bg-surface-2 rounded-lg p-4 border border-border text-xs space-y-2.5 font-mono">
            <div className="flex justify-between text-text-muted">
              <span>Receipt Number</span>
              <span className="font-bold text-text">{receipt.receiptNumber}</span>
            </div>
            <div className="flex justify-between text-text-muted">
              <span>Booking Ref ID</span>
              <span className="text-text">{receipt.bookingId.substring(0, 18)}...</span>
            </div>
            <div className="flex justify-between text-text-muted">
              <span>Event</span>
              <span className="text-text font-sans font-semibold">{booking?.eventTitle}</span>
            </div>
            <div className="flex justify-between text-text-muted">
              <span>Tier & Quantity</span>
              <span className="text-text">{booking?.ticketName} × {booking?.quantity}</span>
            </div>
            <div className="border-t border-border pt-2 flex justify-between font-bold text-sm text-text">
              <span className="font-sans">Total Paid (Simulated)</span>
              <span>₹{formatPaise(receipt.amountPaise)} ({receipt.amountPaise} paise)</span>
            </div>
          </div>

          {/* Attendee Actions */}
          <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <Button
              variant="primary"
              size="md"
              className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2"
              onClick={onNavigateToTickets}
            >
              <QrCode className="w-4 h-4" />
              <span>View QR Tickets in Passport</span>
            </Button>

            {!refundStatus ? (
              <Button
                variant="outline"
                size="md"
                className="w-full sm:w-auto text-xs"
                onClick={handleRequestRefund}
                isLoading={isRefunding}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                <span>Request Refund</span>
              </Button>
            ) : (
              <Badge variant="info" size="md">
                Refund: {refundStatus}
              </Badge>
            )}
          </div>
        </Card>
      )}

      {/* 3. Ready State Order Summary & Payment Triggers */}
      {checkoutState === 'READY' && booking && (
        <div className="space-y-6">
          <Card className="p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-base font-bold text-text">Order Summary</h2>
              <span className="text-xs text-text-muted">Hold ID: {booking.id.substring(0, 8)}</span>
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
                    <span className="block text-[10px] font-normal text-text-muted">
                      ({booking.totalPaise} paise)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Test Simulator Controls */}
          <Card className="p-6 space-y-4 bg-surface-2 border-border">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-brand" />
              <h3 className="text-sm font-bold text-text">Test Simulator Payment Controls</h3>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">
              Select an outcome below to test the end-to-end checkout pipeline, HMAC-SHA256 signature verification,
              and double-entry organizer ledger recording.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                variant="primary"
                size="lg"
                className="flex-1"
                onClick={() => handleSimulatePayment(true)}
              >
                <ShieldCheck className="w-4 h-4 mr-2" />
                Pay ₹{formatPaise(booking.totalPaise)} (Simulate Success)
              </Button>
              <Button
                variant="destructive"
                size="lg"
                onClick={() => handleSimulatePayment(false)}
              >
                Simulate Decline
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
