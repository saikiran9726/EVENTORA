import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { BellRing, Clock, Volume2, VolumeX } from 'lucide-react';

interface WaitlistOfferBannerProps {
  entryId: string;
  eventName: string;
  offerExpiresAt: string; // ISO string
  onOfferClaimed?: () => void;
  onOfferExpired?: () => void;
}

export const WaitlistOfferBanner: React.FC<WaitlistOfferBannerProps> = ({
  entryId,
  eventName,
  offerExpiresAt,
  onOfferClaimed,
  onOfferExpired,
}) => {
  const { toast } = useToast();
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    const diff = Math.floor((new Date(offerExpiresAt).getTime() - Date.now()) / 1000);
    return Math.max(diff, 0);
  });
  const [isClaiming, setIsClaiming] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [hasAnnouncedWarning, setHasAnnouncedWarning] = useState(false);

  useEffect(() => {
    const originalTitle = document.title;

    const timer = setInterval(() => {
      const remaining = Math.max(Math.floor((new Date(offerExpiresAt).getTime() - Date.now()) / 1000), 0);
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
  }, [offerExpiresAt, soundEnabled, hasAnnouncedWarning, onOfferExpired]);

  const mins = Math.floor(secondsRemaining / 60);
  const secs = secondsRemaining % 60;
  const isUrgent = secondsRemaining <= 300; // 5 min warning

  const handleClaim = async () => {
    setIsClaiming(true);
    try {
      const res = await fetch(`/api/v1/waitlist/${entryId}/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `claim-${entryId}-${Date.now()}`,
        },
        credentials: 'include',
      });

      const data = await res.json();

      if (res.ok) {
        toast({
          type: 'success',
          title: 'Offer Claimed!',
          message: `Your seat for ${eventName} has been secured. Your digital ticket is ready.`,
        });
        if (onOfferClaimed) {
          onOfferClaimed();
        }
      } else {
        toast({
          type: 'error',
          title: 'Offer Unavailable',
          message: data.error?.message || 'This offer has expired or already been claimed.',
        });
      }
    } catch {
      toast({
        type: 'error',
        title: 'Error',
        message: 'Network issue while claiming offer.',
      });
    } finally {
      setIsClaiming(false);
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
              A seat opened for <strong>{eventName}</strong>. Claim it now before your exclusive window expires.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 text-muted hover:text-text rounded-md hover:bg-surface-2 transition-colors"
            title={soundEnabled ? 'Mute alert chime' : 'Enable audio chime'}
            aria-label={soundEnabled ? 'Mute alert chime' : 'Enable audio chime'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-brand-600" /> : <VolumeX className="w-4 h-4 text-muted" />}
          </button>

          <Button
            variant="primary"
            size="sm"
            onClick={handleClaim}
            disabled={isClaiming}
            className="w-full md:w-auto"
          >
            {isClaiming ? 'Claiming Seat...' : 'Claim Offer Now (Free)'}
          </Button>
        </div>
      </div>
    </Card>
  );
};
