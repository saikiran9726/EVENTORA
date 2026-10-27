import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { BellRing, Clock, Volume2, VolumeX, XCircle } from 'lucide-react';
import { apiClient } from '@/lib/api-client';

export interface WaitlistOfferBannerProps {
  entryId: string;
  eventName: string;
  offerExpiresAt: string; // ISO string
  serverTime?: string; // ISO string from backend to calculate and negate local clock skew
  pricePaise?: number; // Integer paise: 0 for free, >0 for paid
  claimToken?: string;
  onOfferClaimed?: (result?: any) => void;
  onOfferDeclined?: () => void;
  onOfferExpired?: () => void;
}

export const WaitlistOfferBanner: React.FC<WaitlistOfferBannerProps> = ({
  entryId,
  eventName,
  offerExpiresAt,
  serverTime,
  pricePaise = 0,
  claimToken,
  onOfferClaimed,
  onOfferDeclined,
  onOfferExpired,
}) => {
  const { toast } = useToast();

  // Compute clock skew offset: (serverMs - localMs)
  // When adding this offset to Date.now(), we obtain accurate server-synced time.
  const [clockOffset] = useState<number>(() => {
    if (!serverTime) return 0;
    const serverMs = new Date(serverTime).getTime();
    return Number.isFinite(serverMs) ? serverMs - Date.now() : 0;
  });

  const getSyncedRemaining = () => {
    const syncedNow = Date.now() + clockOffset;
    const expiresMs = new Date(offerExpiresAt).getTime();
    return Math.max(Math.floor((expiresMs - syncedNow) / 1000), 0);
  };

  const [secondsRemaining, setSecondsRemaining] = useState<number>(getSyncedRemaining);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [showDeclineConfirm, setShowDeclineConfirm] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [hasAnnouncedWarning, setHasAnnouncedWarning] = useState(false);

  useEffect(() => {
    const originalTitle = document.title;

    const timer = setInterval(() => {
      const remaining = getSyncedRemaining();
      setSecondsRemaining(remaining);

      // Format mm:ss
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

      // Update browser tab title
      if (remaining > 0) {
        document.title = `[${timeStr}] Action Required - Eventora`;
      } else {
        document.title = originalTitle;
      }

      // Assertive announcement when <= 5 minutes (300 seconds)
      if (remaining <= 300 && remaining > 0 && !hasAnnouncedWarning) {
        setHasAnnouncedWarning(true);
        if (soundEnabled && typeof Audio !== 'undefined') {
          try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(440, ctx.currentTime);
            osc.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.3);
          } catch {}
        }
      }

      if (remaining <= 0) {
        clearInterval(timer);
        if (onOfferExpired) {
          onOfferExpired();
        }
      }
    }, 1000);

    return () => {
      clearInterval(timer);
      document.title = originalTitle;
    };
  }, [offerExpiresAt, soundEnabled, hasAnnouncedWarning, onOfferExpired, clockOffset]);

  const mins = Math.floor(secondsRemaining / 60);
  const secs = secondsRemaining % 60;
  const isUrgent = secondsRemaining <= 300; // 5 min warning

  const handleClaim = async () => {
    setIsClaiming(true);
    try {
      const res = await apiClient<any>(`/api/v1/waitlist/${entryId}/claim`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': `claim-${entryId}-${Date.now()}`,
        },
        body: JSON.stringify({
          claimToken: claimToken || '',
        }),
      });

      if (res.checkoutRequired || res.requiresPayment) {
        toast({
          type: 'info',
          title: 'Offer Claimed - Complete Checkout',
          message: `Your seat for ${eventName} is reserved for 15 minutes. Please complete payment.`,
        });
      } else {
        toast({
          type: 'success',
          title: 'Offer Claimed!',
          message: `Your seat for ${eventName} has been secured. Your digital ticket is ready.`,
        });
      }

      if (onOfferClaimed) {
        onOfferClaimed(res);
      }
    } catch (err: any) {
      toast({
        type: 'error',
        title: 'Offer Unavailable',
        message: err.message || 'This offer has expired or already been claimed.',
      });
    } finally {
      setIsClaiming(false);
    }
  };

  const handleDecline = async () => {
    setIsDeclining(true);
    try {
      await apiClient<any>(`/api/v1/waitlist/${entryId}/decline`, {
        method: 'POST',
      });

      toast({
        type: 'info',
        title: 'Offer Declined',
        message: 'You have released your reserved seat. It will be offered to the next waitlisted attendee.',
      });
      setShowDeclineConfirm(false);

      if (onOfferDeclined) {
        onOfferDeclined();
      }
    } catch (err: any) {
      toast({
        type: 'error',
        title: 'Could Not Decline Offer',
        message: err.message || 'Failed to decline waitlist offer.',
      });
    } finally {
      setIsDeclining(false);
    }
  };

  if (secondsRemaining <= 0) {
    return (
      <Card className="p-4 bg-muted/20 border-destructive/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Clock className="w-5 h-5 text-destructive" />
          <div>
            <p className="text-sm font-semibold text-destructive">Offer Expired</p>
            <p className="text-xs text-muted">The claim window for {eventName} has closed and the seat was offered to the next waitlisted attendee.</p>
          </div>
        </div>
      </Card>
    );
  }

  const isPaid = pricePaise > 0;
  const formattedPrice = isPaid ? `₹${(pricePaise / 100).toFixed(0)}` : 'Free';

  return (
    <Card className={`p-4 border ${isUrgent ? 'border-warning/60 bg-warning/5 ring-1 ring-warning/30' : 'border-brand-300 bg-brand-50/10'} shadow-sm transition-all`}>
      {/* ARIA Live assertive announcement for accessibility when 5m left */}
      <div className="sr-only" aria-live="assertive" role="alert">
        {isUrgent && `Action Required: Only ${mins} minutes and ${secs} seconds remaining to claim your waitlist ticket for ${eventName}.`}
      </div>

      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={`p-2.5 rounded-full ${isUrgent ? 'bg-warning/20 text-warning' : 'bg-brand-100 text-brand-600'}`}>
            <BellRing className="w-5 h-5 animate-bounce" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-text text-sm">Seat Available! Claim Your Ticket</h4>
              <Badge variant={isUrgent ? 'error' : 'warning'} size="sm">
                Expires in {mins}:{secs.toString().padStart(2, '0')}
              </Badge>
            </div>
            <p className="text-xs text-muted mt-0.5">
              A seat opened for <strong>{eventName}</strong> ({formattedPrice}). Claim it now before your exclusive window expires.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 text-muted hover:text-text rounded-md hover:bg-surface-2 transition-colors"
            title={soundEnabled ? 'Mute alert chime' : 'Enable audio chime'}
            aria-label={soundEnabled ? 'Mute alert chime' : 'Enable audio chime'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-brand-600" /> : <VolumeX className="w-4 h-4 text-muted" />}
          </button>

          {showDeclineConfirm ? (
            <div className="flex items-center gap-1.5 bg-surface-2 p-1 rounded-md border border-border">
              <span className="text-xs text-muted px-1.5">Release seat?</span>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDecline}
                disabled={isDeclining}
                className="h-7 text-xs px-2"
              >
                {isDeclining ? 'Releasing...' : 'Yes, Decline'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDeclineConfirm(false)}
                disabled={isDeclining}
                className="h-7 text-xs px-2"
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDeclineConfirm(true)}
              disabled={isClaiming || isDeclining}
              className="text-muted hover:text-destructive text-xs"
            >
              <XCircle className="w-3.5 h-3.5 mr-1" />
              Decline
            </Button>
          )}

          <Button
            variant="primary"
            size="sm"
            onClick={handleClaim}
            disabled={isClaiming || isDeclining}
            className="w-full md:w-auto"
          >
            {isClaiming
              ? 'Claiming Seat...'
              : isPaid
              ? `Claim & Pay ${formattedPrice}`
              : 'Claim Free Ticket'}
          </Button>
        </div>
      </div>
    </Card>
  );
};
