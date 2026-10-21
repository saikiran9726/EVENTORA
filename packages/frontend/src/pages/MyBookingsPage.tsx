import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { QRDisplay } from '@/components/ui/QRDisplay';
import { useToast } from '@/components/ui/Toast';
import { WaitlistOfferBanner } from '@/components/booking/WaitlistOfferBanner';
import { FeedbackSheet } from '@/components/feedback/FeedbackSheet';
import { Calendar, MapPin, Ticket, ArrowRight, MessageSquare } from 'lucide-react';
import { formatINR } from '@/lib/utils';

export interface BookingRecord {
  id: string;
  eventId: string;
  eventTitle: string;
  status: string;
  totalPaise: number;
  createdAt: string;
  ticketCode?: string;
  qrPayload?: string;
  startsAt?: string;
  venueName?: string;
  isCheckedIn?: boolean;
}

export const MyBookingsPage: React.FC<{ onNavigateToDiscovery?: () => void }> = ({ onNavigateToDiscovery }) => {
  const { toast } = useToast();
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [cancelBookingId, setCancelBookingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('Change of schedule');
  const [isCancelling, setIsCancelling] = useState(false);
  const [activeOffer, setActiveOffer] = useState<any | null>(null);
  const [selectedBookingForFeedback, setSelectedBookingForFeedback] = useState<BookingRecord | null>(null);
  const [submittedFeedbacks, setSubmittedFeedbacks] = useState<Record<string, any>>({});

  const fetchBookings = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/v1/me/bookings', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setBookings(data.bookings || []);
      } else {
        // Fallback prototype state
        setBookings([
          {
            id: 'mock-bk-1',
            eventId: 'mock-evt-1',
            eventTitle: 'AI & Robotics Annual Symposium',
            status: 'CONFIRMED',
            totalPaise: 0,
            createdAt: new Date().toISOString(),
            ticketCode: 'EVT-ROBOT-8921',
            qrPayload: 'https://eventora.campus.edu/verify/EVT-ROBOT-8921',
            startsAt: '2026-11-20T10:00:00Z',
            venueName: 'Sir MV Auditorium',
          },
        ]);
      }
    } catch {
      // Offline fallback
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, []);

  const handleCancelBooking = async () => {
    if (!cancelBookingId) return;
    setIsCancelling(true);

    try {
      const res = await fetch(`/api/v1/bookings/${cancelBookingId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: cancelReason }),
      });

      if (res.ok) {
        toast({
          type: 'success',
          title: 'Booking Cancelled',
          message: 'Your ticket was released. Any waitlisted student has been promoted.',
        });
        setBookings((prev) => prev.filter((b) => b.id !== cancelBookingId));
        setCancelBookingId(null);
      } else {
        const err = await res.json();
        toast({
          type: 'error',
          title: 'Cancellation Error',
          message: err.error?.message || 'Could not cancel booking.',
        });
      }
    } catch {
      toast({
        type: 'error',
        title: 'Error',
        message: 'Network issue while cancelling booking.',
      });
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text">My Tickets & Registrations</h1>
          <p className="text-sm text-muted mt-1">
            Access your confirmed event passes and digital QR check-in codes.
          </p>
        </div>
        {onNavigateToDiscovery && (
          <Button variant="secondary" size="sm" onClick={onNavigateToDiscovery} className="flex items-center gap-2">
            Explore Events <ArrowRight className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Active Waitlist Offer Banner if present */}
      {activeOffer && (
        <WaitlistOfferBanner
          entryId={activeOffer.id}
          eventName={activeOffer.eventName}
          offerExpiresAt={activeOffer.offerExpiresAt}
          onOfferClaimed={() => {
            setActiveOffer(null);
            fetchBookings();
          }}
          onOfferExpired={() => setActiveOffer(null)}
        />
      )}

      {/* Bookings List */}
      {isLoading ? (
        <div className="text-center py-12 text-muted">Loading your tickets...</div>
      ) : bookings.length === 0 ? (
        <Card className="p-8 text-center space-y-4 border border-dashed border-border">
          <div className="p-3 bg-muted/20 rounded-full w-12 h-12 flex items-center justify-center mx-auto text-muted">
            <Ticket className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-semibold text-text text-base">No Active Registrations</h3>
            <p className="text-sm text-muted mt-1">
              You haven&apos;t registered for any events yet. Check out upcoming campus activities!
            </p>
          </div>
          {onNavigateToDiscovery && (
            <Button variant="primary" size="sm" onClick={onNavigateToDiscovery}>
              Discover Events
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {bookings.map((booking) => (
            <Card key={booking.id} className="p-5 flex flex-col justify-between border border-border shadow-sm">
              <div className="space-y-3">
                <div className="flex justify-between items-start gap-2">
                  <h3 className="font-semibold text-text text-base line-clamp-1">{booking.eventTitle}</h3>
                  <Badge variant={booking.status === 'CONFIRMED' ? 'success' : 'neutral'} size="sm">
                    {booking.status}
                  </Badge>
                </div>

                <div className="space-y-1.5 text-xs text-muted">
                  {booking.startsAt && (
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-brand-600 flex-shrink-0" />
                      <span>{new Date(booking.startsAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    </div>
                  )}
                  {booking.venueName && (
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-brand-600 flex-shrink-0" />
                      <span>{booking.venueName}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Ticket className="w-4 h-4 text-brand-600 flex-shrink-0" />
                    <span>Reference: <strong className="font-mono text-text">{booking.ticketCode || booking.id.slice(0, 8)}</strong></span>
                  </div>
                </div>

                {/* Digital QR Pass */}
                <div className="mt-3 p-3 bg-surface-2 rounded-lg flex items-center justify-center border border-border/80">
                  <QRDisplay
                    ticketId={booking.ticketCode || booking.id.slice(0, 8)}
                    qrPayloadPreview={booking.qrPayload || `dGVzdF9xcl90b2tlbl8zMl9ieXRlc19yYW5kb21fc2VjdXJl_${booking.id.slice(0, 8)}`}
                    status={booking.status === 'CONFIRMED' ? 'VALID' : 'CANCELLED'}
                    eventName={booking.eventTitle}
                    attendeeName="Student Attendee"
                  />
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-text">
                  {booking.totalPaise === 0 ? 'FREE PASS' : formatINR(booking.totalPaise)}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedBookingForFeedback(booking)}
                    className="text-xs flex items-center gap-1.5"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-brand" />
                    <span>{submittedFeedbacks[booking.eventId] ? 'Edit Review' : 'Feedback'}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCancelBookingId(booking.id)}
                    className="text-destructive hover:bg-destructive/10 text-xs"
                  >
                    Cancel Registration
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Cancellation Modal */}
      {cancelBookingId && (
        <Modal
          isOpen={!!cancelBookingId}
          onClose={() => setCancelBookingId(null)}
          title="Cancel Registration"
        >
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted">
              Are you sure you want to cancel your registration? Your reserved seat will be immediately released
              and offered to the next student in the queue.
            </p>
            <div>
              <label className="block text-xs font-medium text-text mb-1">Reason for Cancellation</label>
              <select
                className="w-full text-sm p-2 rounded border border-border bg-surface text-text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              >
                <option value="Change of schedule">Change of schedule</option>
                <option value="Registered by mistake">Registered by mistake</option>
                <option value="Schedule clash with academics">Schedule clash with academics</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setCancelBookingId(null)}>
                Keep Ticket
              </Button>
              <Button
                variant="destructive"
                onClick={handleCancelBooking}
                disabled={isCancelling}
              >
                {isCancelling ? 'Cancelling...' : 'Confirm Cancellation'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Feedback Sheet */}
      {selectedBookingForFeedback && (
        <FeedbackSheet
          isOpen={!!selectedBookingForFeedback}
          onClose={() => setSelectedBookingForFeedback(null)}
          eventId={selectedBookingForFeedback.eventId}
          eventTitle={selectedBookingForFeedback.eventTitle}
          existingFeedback={submittedFeedbacks[selectedBookingForFeedback.eventId]}
          onSuccess={(fb) => {
            setSubmittedFeedbacks((prev) => ({
              ...prev,
              [selectedBookingForFeedback.eventId]: fb,
            }));
          }}
        />
      )}
    </div>
  );
};
