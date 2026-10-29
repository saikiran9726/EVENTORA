import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { formatINR } from '@/lib/utils';
import { AlertTriangle, Clock, ShieldCheck, Ticket } from 'lucide-react';
import { apiClient, ApiError } from '@/lib/api-client';

export interface TicketTypeInfo {
  id: string;
  name: string;
  pricePaise: number;
  capacity: number;
  sold: number;
  held: number;
  available: number;
}

interface TicketSelectorProps {
  eventId: string;
  eventTitle: string;
  startsAt?: string;
  endsAt?: string;
  initialTicketTypes?: TicketTypeInfo[];
  onBookingSuccess?: (booking: any) => void;
  onOpenCheckoutModal?: () => void;
}

export const TicketSelector: React.FC<TicketSelectorProps> = ({
  eventId,
  eventTitle,
  initialTicketTypes = [],
  onBookingSuccess,
  onOpenCheckoutModal,
}) => {
  const { toast } = useToast();
  const [ticketTypes, setTicketTypes] = useState<TicketTypeInfo[]>(initialTicketTypes);
  const [selectedTicketId, setSelectedTicketId] = useState<string>(initialTicketTypes[0]?.id || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflictWarning, setConflictWarning] = useState<any | null>(null);
  const [isWaitlistModalOpen, setIsWaitlistModalOpen] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  // Live polling (every 15s + refetch on window focus)
  const fetchAvailability = useCallback(async () => {
    try {
      const data = await apiClient<{ ticketTypes: any[] }>(`/api/v1/events/${eventId}/ticket-types`);
      if (data?.ticketTypes && data.ticketTypes.length > 0) {
        const mapped: TicketTypeInfo[] = data.ticketTypes.map((t: any) => ({
          id: t.id,
          name: t.name,
          pricePaise: t.price_paise !== undefined ? t.price_paise : (t.pricePaise || 0),
          capacity: t.capacity,
          sold: t.sold,
          held: t.held,
          available: t.available !== undefined ? t.available : Math.max(0, t.capacity - (t.sold + t.held)),
        }));
        setTicketTypes(mapped);
        if (!selectedTicketId && mapped.length > 0) {
          setSelectedTicketId(mapped[0].id);
        }
      }
      setLastRefreshed(new Date());
    } catch {
      // Offline or network error handled quietly during background poll
    }
  }, [eventId, selectedTicketId]);

  useEffect(() => {
    fetchAvailability();

    // 15-second polling interval
    const interval = setInterval(fetchAvailability, 15000);

    // Refetch on focus
    const handleFocus = () => {
      fetchAvailability();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchAvailability]);

  // Active ticket tiers from API
  const activeTiers: TicketTypeInfo[] = ticketTypes;

  const selectedTier = activeTiers.find((t) => t.id === selectedTicketId) || activeTiers[0] || null;
  const isTierSoldOut = selectedTier ? selectedTier.available <= 0 : false;

  const handleBooking = async (ignoreConflict = false) => {
    if (!selectedTier) return;
    setIsSubmitting(true);

    try {
      const idempotencyKey = `book-${eventId}-${selectedTier.id}-${Date.now()}`;
      const data = await apiClient<any>(`/api/v1/events/${eventId}/bookings`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          items: [{ ticketTypeId: selectedTier.id, quantity: 1 }],
          ignoreConflict,
        }),
      });

      // Free flow or zero-paise registration confirmed
      toast({
        type: 'success',
        title: 'Ticket Confirmed!',
        message: `Your booking for "${eventTitle}" is confirmed. No payment required.`,
      });
      if (conflictWarning) {
        setConflictWarning(null);
      }
      if (onBookingSuccess) {
        onBookingSuccess(data.booking);
      }
      fetchAvailability();
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          toast({
            type: 'error',
            title: 'Authentication Required',
            message: 'Please sign in to register for this event.',
          });
        } else if (err.status === 409 && err.code === 'SCHEDULE_CONFLICT' && !ignoreConflict) {
          setConflictWarning(err.details?.conflicts || [{ title: 'Another registered event' }]);
        } else if (err.status === 409 && err.code === 'SOLD_OUT') {
          toast({
            type: 'warning',
            title: 'Sold Out',
            message: 'This ticket tier just sold out. You can join the waitlist below.',
          });
          fetchAvailability();
        } else {
          toast({
            type: 'error',
            title: 'Booking Failed',
            message: err.message || 'Could not complete registration.',
          });
        }
      } else {
        toast({
          type: 'error',
          title: 'Network Error',
          message: 'Could not connect to the booking server.',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJoinWaitlist = async () => {
    if (!selectedTier) return;
    setIsSubmitting(true);

    try {
      const data = await apiClient<any>(`/api/v1/events/${eventId}/waitlist`, {
        method: 'POST',
        body: JSON.stringify({ ticketTypeId: selectedTier.id }),
      });

      setIsWaitlistModalOpen(false);
      toast({
        type: 'success',
        title: 'Added to Waitlist',
        message: `Position #${data.entry?.position || 1}. We will notify you if a seat opens.`,
      });
      fetchAvailability();
    } catch (err: any) {
      toast({
        type: 'error',
        title: 'Waitlist Error',
        message: err.message || 'Could not connect to waitlist service.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="p-5 shadow-sm border border-border">
      <div className="flex items-center justify-between pb-3 border-b border-border/60 mb-4">
        <div className="flex items-center gap-2">
          <Ticket className="w-5 h-5 text-brand-600" />
          <h3 className="font-semibold text-text text-base">Select Ticket</h3>
        </div>
        <span className="text-[11px] text-muted flex items-center gap-1 font-mono">
          <span className="w-2 h-2 rounded-full bg-success inline-block animate-pulse" />
          Live synced {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </div>

      {/* Tier Options */}
      {activeTiers.length === 0 ? (
        <div className="py-6 text-center text-sm text-text-muted">
          No ticket tiers are currently available for this event.
        </div>
      ) : (
        <div className="space-y-3 mb-5">
          {activeTiers.map((tier) => {
            const isSelected = tier.id === (selectedTicketId || activeTiers[0]?.id);
            const isSoldOut = tier.available <= 0;

            return (
              <div
                key={tier.id}
                onClick={() => setSelectedTicketId(tier.id)}
                className={`p-3.5 rounded-lg border cursor-pointer transition-all ${
                  isSelected
                    ? 'border-brand-600 bg-brand-50/10 dark:bg-brand-950/20 ring-1 ring-brand-600'
                    : 'border-border hover:border-brand-300 bg-surface'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text text-sm">{tier.name}</span>
                      {tier.pricePaise === 0 ? (
                        <Badge variant="success" size="sm">Free</Badge>
                      ) : (
                        <Badge variant="neutral" size="sm">
                          {formatINR(tier.pricePaise)}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted mt-1">
                      {isSoldOut ? (
                        <span className="text-destructive font-medium">Sold Out</span>
                      ) : (
                        <span className="text-success font-medium">{tier.available} seats remaining</span>
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-base font-semibold text-text">
                      {tier.pricePaise === 0 ? '₹0' : formatINR(tier.pricePaise)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom Action Bar */}
      {activeTiers.length > 0 && (
        <div className="pt-2">
          {isTierSoldOut ? (
            <Button
              variant="secondary"
              className="w-full flex items-center justify-center gap-2"
              onClick={() => setIsWaitlistModalOpen(true)}
              disabled={isSubmitting}
            >
              <Clock className="w-4 h-4 text-warning" />
              Join Waitlist
            </Button>
          ) : (
            <Button
              variant="primary"
              className="w-full flex items-center justify-center gap-2"
              onClick={() => {
                if (selectedTier && selectedTier.pricePaise > 0 && onOpenCheckoutModal) {
                  onOpenCheckoutModal();
                } else {
                  handleBooking(false);
                }
              }}
              disabled={isSubmitting}
            >
              <ShieldCheck className="w-4 h-4" />
              {isSubmitting
                ? 'Securing Seat...'
                : selectedTier?.pricePaise === 0
                ? 'Register (Free)'
                : `Proceed to Test Checkout – ${formatINR(selectedTier?.pricePaise || 0)}`}
            </Button>
          )}
        </div>
      )}

      {/* Schedule Conflict Modal */}
      {conflictWarning && (
        <Modal
          isOpen={!!conflictWarning}
          onClose={() => setConflictWarning(null)}
          title="Schedule Conflict Detected"
        >
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 p-3 bg-warning/10 border border-warning/20 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
              <div className="text-xs text-text space-y-1">
                <p className="font-semibold text-warning">
                  You are already registered for an event at this time:
                </p>
                <ul className="list-disc list-inside text-muted">
                  {conflictWarning.map((c: any, idx: number) => (
                    <li key={idx} className="font-medium text-text">{c.title || 'Overlapping Event'}</li>
                  ))}
                </ul>
                <p className="pt-1">
                  Double-booking might cause attendance issues. Do you wish to register anyway?
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setConflictWarning(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => handleBooking(true)}
                disabled={isSubmitting}
              >
                Proceed Anyway
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Waitlist Modal */}
      {isWaitlistModalOpen && (
        <Modal
          isOpen={isWaitlistModalOpen}
          onClose={() => setIsWaitlistModalOpen(false)}
          title="Join Waitlist"
        >
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted">
              You are requesting to join the priority waitlist for <strong>{selectedTier?.name}</strong>.
              If another attendee cancels their registration, a seat offer will automatically be reserved for you.
            </p>
            <div className="p-3 bg-surface-2 rounded-lg text-xs space-y-1 border border-border">
              <p className="font-medium text-text">How waitlist works:</p>
              <ul className="list-disc list-inside text-muted">
                <li>Strict First-Come, First-Served queue ordering.</li>
                <li>You get a 30-minute exclusive claim window upon notification.</li>
                <li>No fees to join or hold your spot.</li>
              </ul>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setIsWaitlistModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleJoinWaitlist} disabled={isSubmitting}>
                Confirm Waitlist Join
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
};
