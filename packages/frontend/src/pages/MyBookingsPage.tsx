import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { QRDisplay } from '@/components/ui/QRDisplay';
import { useToast } from '@/components/ui/Toast';
import { WaitlistOfferBanner } from '@/components/booking/WaitlistOfferBanner';
import { FeedbackSheet } from '@/components/feedback/FeedbackSheet';
import {
  Calendar,
  MapPin,
  Ticket,
  ArrowRight,
  MessageSquare,
  Download,
  FileText,
  CalendarPlus,
  WifiOff,
  CreditCard,
  AlertCircle,
} from 'lucide-react';
import { formatINR } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';

export interface BookingRecord {
  id: string;
  ticketId?: string;
  eventId: string;
  eventTitle: string;
  status: string;
  totalPaise: number;
  createdAt: string;
  ticketCode?: string;
  qrPayload?: string;
  startsAt?: string;
  endsAt?: string;
  venueName?: string;
  isCheckedIn?: boolean;
}

export interface EventMaterialItem {
  id: string;
  eventId: string;
  title: string;
  description?: string | null;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  fileUrl: string;
  createdAt: string;
}

const OFFLINE_TICKETS_CACHE_KEY = 'eventora_offline_tickets_cache';

export const MyBookingsPage: React.FC<{ onNavigateToDiscovery?: () => void }> = ({ onNavigateToDiscovery }) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<'upcoming' | 'past'>('upcoming');
  const [isOfflineData, setIsOfflineData] = useState(false);

  // Cancellation state
  const [cancelBookingId, setCancelBookingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('Change of schedule');
  const [isCancelling, setIsCancelling] = useState(false);

  // Active waitlist offer state
  const [activeOffer, setActiveOffer] = useState<any | null>(null);

  // Feedback state
  const [selectedBookingForFeedback, setSelectedBookingForFeedback] = useState<BookingRecord | null>(null);
  const [submittedFeedbacks, setSubmittedFeedbacks] = useState<Record<string, any>>({});

  // Event materials state
  const [selectedBookingForMaterials, setSelectedBookingForMaterials] = useState<BookingRecord | null>(null);
  const [materials, setMaterials] = useState<EventMaterialItem[]>([]);
  const [isLoadingMaterials, setIsLoadingMaterials] = useState(false);
  const [materialsError, setMaterialsError] = useState<string | null>(null);

  const fetchBookings = async () => {
    setIsLoading(true);
    try {
      const [bookingsData, ticketsData] = await Promise.allSettled([
        apiClient.get<any>('/api/v1/me/bookings'),
        apiClient.get<any>('/api/v1/me/tickets'),
      ]);

      const rawBookings = bookingsData.status === 'fulfilled' ? (bookingsData.value?.bookings || []) : [];
      const rawTickets = ticketsData.status === 'fulfilled' ? (ticketsData.value?.tickets || []) : [];

      if (rawBookings.length > 0 || rawTickets.length > 0) {
        const mapped: BookingRecord[] = rawBookings.map((b: any) => {
          const associatedTicket = rawTickets.find((t: any) => t.booking_id === b.id || t.id === b.ticket_id);
          const tCode = b.ticket_code || associatedTicket?.ticket_code || b.ticketCode;
          return {
            id: b.id,
            ticketId: associatedTicket?.id || b.ticket_id,
            eventId: b.event_id || b.eventId,
            eventTitle: b.event_title || b.eventTitle || associatedTicket?.event_title || 'Campus Event',
            status: b.status || (associatedTicket ? 'CONFIRMED' : 'PENDING'),
            totalPaise: b.total_paise !== undefined ? b.total_paise : (b.totalPaise || 0),
            createdAt: b.created_at || b.createdAt || new Date().toISOString(),
            ticketCode: tCode,
            qrPayload: tCode ? `https://eventora-jet.vercel.app/verify/${tCode}` : b.qrPayload,
            startsAt: b.event_starts_at || b.startsAt || associatedTicket?.event_starts_at,
            endsAt: b.event_ends_at || b.endsAt || associatedTicket?.event_ends_at,
            venueName: b.venue_name || b.venueName || associatedTicket?.venue_name || 'Campus Venue',
            isCheckedIn:
              b.ticket_status === 'CHECKED_IN' ||
              b.ticket_status === 'USED' ||
              associatedTicket?.status === 'CHECKED_IN' ||
              associatedTicket?.status === 'USED',
          };
        });

        // Add any tickets that might not be mapped in bookings
        for (const t of rawTickets) {
          if (!mapped.some((m) => m.id === t.booking_id || m.ticketCode === t.ticket_code)) {
            mapped.push({
              id: t.booking_id || t.id,
              ticketId: t.id,
              eventId: t.event_id,
              eventTitle: t.event_title || 'Campus Event',
              status: t.status === 'VALID' ? 'CONFIRMED' : t.status,
              totalPaise: t.price_paise || 0,
              createdAt: t.created_at || new Date().toISOString(),
              ticketCode: t.ticket_code,
              qrPayload: `https://eventora-jet.vercel.app/verify/${t.ticket_code}`,
              startsAt: t.event_starts_at,
              venueName: t.venue_name || 'Campus Venue',
              isCheckedIn: t.status === 'CHECKED_IN' || t.status === 'USED',
            });
          }
        }

        setBookings(mapped);
        setIsOfflineData(false);
        // Persist into offline cache for resilient offline venue check-in
        try {
          localStorage.setItem(OFFLINE_TICKETS_CACHE_KEY, JSON.stringify(mapped));
        } catch {
          // Ignore localStorage quota limits
        }
      } else {
        setBookings([]);
        setIsOfflineData(false);
      }
    } catch {
      // Offline fallback: load from persisted offline cache
      const cached = localStorage.getItem(OFFLINE_TICKETS_CACHE_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setBookings(parsed);
            setIsOfflineData(true);
            return;
          }
        } catch {
          // Ignore parsing errors
        }
      }

      setBookings([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, []);

  // Fetch materials for selected booking
  const handleOpenMaterials = async (booking: BookingRecord) => {
    setSelectedBookingForMaterials(booking);
    setIsLoadingMaterials(true);
    setMaterialsError(null);
    setMaterials([]);

    try {
      const res = await apiClient.get<any>(`/api/v1/events/${booking.eventId}/materials`);
      setMaterials(res?.materials || []);
    } catch (err: any) {
      setMaterialsError(
        err?.message || err?.error?.message || 'Materials are reserved for registered attendees.'
      );
    } finally {
      setIsLoadingMaterials(false);
    }
  };

  const handleExportIcs = (booking: BookingRecord) => {
    try {
      const link = document.createElement('a');
      link.href = `/api/v1/events/${booking.eventId}/ics`;
      link.setAttribute('download', `${booking.eventTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast({
        type: 'success',
        title: 'iCalendar Exported',
        message: `Downloaded schedule file (.ics) for ${booking.eventTitle}`,
      });
    } catch {
      // Client-side fallback RFC 5545 generator
      const icsData = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Eventora//Campus Pass//EN',
        'BEGIN:VEVENT',
        `SUMMARY:${booking.eventTitle}`,
        `LOCATION:${booking.venueName || 'Campus Venue'}`,
        `DTSTART:${new Date(booking.startsAt || new Date()).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
        `DTEND:${new Date(booking.endsAt || (new Date(booking.startsAt || Date.now()).getTime() + 3 * 3600000)).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${booking.eventTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast({
        type: 'success',
        title: 'iCalendar Generated',
        message: 'Downloaded calendar invite for event.',
      });
    }
  };

  const handleDownloadTicketPass = (booking: BookingRecord) => {
    if (booking.ticketId) {
      window.open(`/api/v1/tickets/${booking.ticketId}/download`, '_blank');
    } else {
      toast({
        type: 'info',
        title: 'Digital Pass Ready',
        message: `Reference ${booking.ticketCode || booking.id.slice(0, 8)} ready on screen for scanner check-in.`,
      });
    }
  };

  const handleCancelBooking = async () => {
    if (!cancelBookingId) return;
    setIsCancelling(true);

    try {
      await apiClient.post(`/api/v1/bookings/${cancelBookingId}/cancel`, {
        reason: cancelReason,
      });

      toast({
        type: 'success',
        title: 'Booking Cancelled',
        message: 'Your ticket was released. Any eligible refund has been scheduled.',
      });
      setBookings((prev) =>
        prev.map((b) => (b.id === cancelBookingId ? { ...b, status: 'CANCELLED' } : b))
      );
      setCancelBookingId(null);
    } catch (err: any) {
      toast({
        type: 'error',
        title: 'Cancellation Error',
        message: err?.message || err?.error?.message || 'Could not cancel booking.',
      });
    } finally {
      setIsCancelling(false);
    }
  };

  // Helper: Filter bookings into upcoming and past
  const now = new Date();
  const isPastBooking = (b: BookingRecord) => {
    if (b.status === 'CANCELLED' || b.status === 'REFUNDED') return true;
    if (b.endsAt) return new Date(b.endsAt) < now;
    if (b.startsAt) return new Date(b.startsAt) < new Date(now.getTime() - 24 * 3600000);
    return false;
  };

  const upcomingBookings = bookings.filter((b) => !isPastBooking(b));
  const pastBookings = bookings.filter((b) => isPastBooking(b));
  const displayedBookings = filterTab === 'upcoming' ? upcomingBookings : pastBookings;

  const activeCancelBooking = bookings.find((b) => b.id === cancelBookingId);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text">My Tickets & Registrations</h1>
          <p className="text-sm text-muted mt-1">
            Access your confirmed event passes, digital QR check-in codes, and course materials.
          </p>
        </div>
        {onNavigateToDiscovery && (
          <Button variant="secondary" size="sm" onClick={onNavigateToDiscovery} className="flex items-center gap-2">
            Explore Events <ArrowRight className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Offline Status Notice */}
      {isOfflineData && (
        <div
          role="status"
          className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 font-medium"
        >
          <WifiOff className="w-4 h-4 shrink-0 text-amber-600" />
          <span>
            You are viewing offline cached passes. Your dynamic QR tokens remain valid for turnstile optical check-in.
          </span>
        </div>
      )}

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

      {/* Filter Tabs: Upcoming vs Past */}
      <div className="flex items-center gap-3 border-b border-border pb-1">
        <button
          onClick={() => setFilterTab('upcoming')}
          className={`pb-2 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
            filterTab === 'upcoming'
              ? 'border-brand text-brand'
              : 'border-transparent text-muted hover:text-text'
          }`}
        >
          <span>Upcoming Events</span>
          <Badge variant={filterTab === 'upcoming' ? 'brand' : 'neutral'} size="sm">
            {upcomingBookings.length}
          </Badge>
        </button>
        <button
          onClick={() => setFilterTab('past')}
          className={`pb-2 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
            filterTab === 'past'
              ? 'border-brand text-brand'
              : 'border-transparent text-muted hover:text-text'
          }`}
        >
          <span>Past & Completed</span>
          <Badge variant={filterTab === 'past' ? 'brand' : 'neutral'} size="sm">
            {pastBookings.length}
          </Badge>
        </button>
      </div>

      {/* Bookings List */}
      {isLoading ? (
        <div className="text-center py-12 text-muted">Loading your tickets...</div>
      ) : displayedBookings.length === 0 ? (
        <Card className="p-8 text-center space-y-4 border border-dashed border-border">
          <div className="p-3 bg-muted/20 rounded-full w-12 h-12 flex items-center justify-center mx-auto text-muted">
            <Ticket className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-semibold text-text text-base">
              {filterTab === 'upcoming' ? 'No Upcoming Events' : 'No Past Event History'}
            </h3>
            <p className="text-sm text-muted mt-1">
              {filterTab === 'upcoming'
                ? "You haven't registered for any upcoming events yet. Check out campus activities!"
                : 'Your attended and completed campus events will appear here.'}
            </p>
          </div>
          {onNavigateToDiscovery && filterTab === 'upcoming' && (
            <Button variant="primary" size="sm" onClick={onNavigateToDiscovery}>
              Discover Events
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {displayedBookings.map((booking) => {
            const isPendingPayment =
              booking.status === 'PENDING_PAYMENT' || booking.status === 'PENDING';
            const isConfirmed = booking.status === 'CONFIRMED';
            const isCheckedIn = booking.isCheckedIn || booking.status === 'CHECKED_IN';
            const isCancelled = booking.status === 'CANCELLED' || booking.status === 'REFUNDED';

            return (
              <Card
                key={booking.id}
                className="p-5 flex flex-col justify-between border border-border shadow-sm hover:border-brand/40 transition-colors"
              >
                <div className="space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <h3 className="font-semibold text-text text-base line-clamp-1">{booking.eventTitle}</h3>
                    {/* Status Chip */}
                    <Badge
                      variant={
                        isCheckedIn
                          ? 'brand'
                          : isConfirmed
                          ? 'success'
                          : isPendingPayment
                          ? 'warning'
                          : isCancelled
                          ? 'neutral'
                          : 'brand'
                      }
                      size="sm"
                    >
                      {isCheckedIn ? 'CHECKED IN' : isPendingPayment ? 'PENDING PAYMENT' : booking.status}
                    </Badge>
                  </div>

                  <div className="space-y-1.5 text-xs text-muted">
                    {booking.startsAt && (
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-brand-600 flex-shrink-0" />
                        <span>
                          {new Date(booking.startsAt).toLocaleDateString(undefined, {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
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
                      <span>
                        Reference:{' '}
                        <strong className="font-mono text-text">
                          {booking.ticketCode || booking.id.slice(0, 8)}
                        </strong>
                      </span>
                    </div>
                  </div>

                  {/* Pending Payment Prompt or Digital QR Pass */}
                  {isPendingPayment ? (
                    <div className="mt-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg space-y-3">
                      <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
                        <CreditCard className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>
                          Your booking seat is temporarily reserved. Complete payment to secure your digital QR pass.
                        </span>
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => navigate(`/checkout/${booking.id}`)}
                        className="w-full text-xs font-semibold flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
                      >
                        <span>Resume Checkout ({formatINR(booking.totalPaise)})</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-3 p-3 bg-surface-2 rounded-lg flex items-center justify-center border border-border/80">
                      <QRDisplay
                        ticketId={booking.ticketId || booking.id}
                        actualTicketId={booking.ticketId}
                        ticketCode={booking.ticketCode}
                        qrPayloadPreview={
                          booking.qrPayload ||
                          `dGVzdF9xcl90b2tlbl8zMl9ieXRlc19yYW5kb21fc2VjdXJl_${booking.id.slice(0, 8)}`
                        }
                        status={isCancelled ? 'CANCELLED' : isCheckedIn ? 'CHECKED_IN' : 'VALID'}
                        eventName={booking.eventTitle}
                        attendeeName="Student Attendee"
                        onRotated={fetchBookings}
                      />
                    </div>
                  )}

                  {/* Quick Action Pills: Materials & Calendar */}
                  <div className="pt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleExportIcs(booking)}
                      className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-surface-2 hover:bg-surface border border-border text-text flex items-center gap-1 transition-colors"
                      title="Download RFC 5545 .ics schedule"
                    >
                      <CalendarPlus className="w-3.5 h-3.5 text-brand" />
                      <span>Add to Calendar (.ics)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenMaterials(booking)}
                      className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-surface-2 hover:bg-surface border border-border text-text flex items-center gap-1 transition-colors"
                      title="Access registered event materials"
                    >
                      <FileText className="w-3.5 h-3.5 text-brand" />
                      <span>Event Materials</span>
                    </button>

                    {booking.ticketId && (
                      <button
                        type="button"
                        onClick={() => handleDownloadTicketPass(booking)}
                        className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-surface-2 hover:bg-surface border border-border text-text flex items-center gap-1 transition-colors"
                        title="Download printable digital pass"
                      >
                        <Download className="w-3.5 h-3.5 text-brand" />
                        <span>Download Pass</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Footer Controls: Price, Feedback, Cancel/Refund */}
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

                    {!isCancelled && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCancelBookingId(booking.id)}
                        className="text-destructive hover:bg-destructive/10 text-xs"
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Cancellation / Refund Modal */}
      {cancelBookingId && (
        <Modal
          isOpen={!!cancelBookingId}
          onClose={() => setCancelBookingId(null)}
          title="Cancel Registration & Refund Policy"
        >
          <div className="space-y-4 py-2">
            <p className="text-sm text-text/90 leading-relaxed">
              Are you sure you want to cancel your registration?
            </p>

            {/* Dynamic refund policy notice */}
            {activeCancelBooking && activeCancelBooking.totalPaise > 0 ? (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg space-y-1.5 text-xs text-amber-900 dark:text-amber-300">
                <p className="font-semibold flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-amber-600" />
                  <span>Paid Ticket Refund Policy:</span>
                </p>
                <p>
                  You paid <strong>{formatINR(activeCancelBooking.totalPaise)}</strong> for this ticket.
                  In accordance with campus ticketing policy, an automatic refund in paise will be processed
                  back to your original payment method via YouPI-PG.
                </p>
                <p className="text-[11px] text-muted">
                  Your seat will be released immediately and offered to the waitlist queue.
                </p>
              </div>
            ) : (
              <div className="p-3 bg-surface-2 border border-border rounded-lg text-xs text-muted">
                Your free pass will be released immediately and re-allocated to waitlisted campus attendees.
              </div>
            )}

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
                Keep Pass
              </Button>
              <Button
                variant="destructive"
                onClick={handleCancelBooking}
                disabled={isCancelling}
              >
                {isCancelling ? 'Processing Cancellation...' : 'Confirm Cancellation'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Event Materials Modal */}
      {selectedBookingForMaterials && (
        <Modal
          isOpen={!!selectedBookingForMaterials}
          onClose={() => setSelectedBookingForMaterials(null)}
          title={`Event Materials — ${selectedBookingForMaterials.eventTitle}`}
        >
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted">
              Official event handouts, presentation decks, code repositories, and workshop files shared exclusively
              with registered attendees.
            </p>

            {isLoadingMaterials ? (
              <div className="py-8 text-center text-xs text-muted">Loading event materials...</div>
            ) : materialsError ? (
              <div className="p-4 bg-error/10 border border-error/20 rounded-lg flex items-start gap-2 text-xs text-error">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{materialsError}</span>
              </div>
            ) : materials.length === 0 ? (
              <div className="p-6 bg-surface-2 rounded-lg border border-dashed border-border text-center space-y-2">
                <FileText className="w-8 h-8 text-muted mx-auto opacity-50" />
                <p className="text-sm font-semibold text-text">No Materials Published Yet</p>
                <p className="text-xs text-muted max-w-sm mx-auto">
                  Organizers have not published slides or handouts for this session yet. Check back during or after the
                  event!
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/60 max-h-80 overflow-y-auto pr-1">
                {materials.map((mat) => {
                  const sizeFormatted =
                    mat.fileSizeBytes > 1024 * 1024
                      ? `${(mat.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB`
                      : `${Math.round(mat.fileSizeBytes / 1024)} KB`;

                  return (
                    <div key={mat.id} className="py-3 flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-text">{mat.title}</h4>
                          <Badge variant="brand" size="sm" className="uppercase text-[9px]">
                            {mat.mimeType.split('/').pop() || 'FILE'}
                          </Badge>
                        </div>
                        {mat.description && (
                          <p className="text-xs text-muted line-clamp-2">{mat.description}</p>
                        )}
                        <p className="text-[11px] text-muted">
                          {mat.fileName} • {sizeFormatted} • {new Date(mat.createdAt).toLocaleDateString()}
                        </p>
                      </div>

                      <a
                        href={mat.fileUrl}
                        download={mat.fileName}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 px-3 py-1.5 rounded-md text-xs font-semibold bg-brand text-white hover:bg-brand/90 transition-colors flex items-center gap-1.5 shadow-xs"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </a>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-border">
              <Button variant="secondary" size="sm" onClick={() => setSelectedBookingForMaterials(null)}>
                Close
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
