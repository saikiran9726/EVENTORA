import React, { useState } from 'react';
import {
  ArrowLeft,
  MapPin,
  Share2,
  Download,
  HelpCircle,
  Bell,
  Image as ImageIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Checkbox } from '@/components/ui/Checkbox';
import { useToast } from '@/components/ui/Toast';
import { PROTOTYPE_EVENTS } from '@/prototype/data';
import { formatINR } from '@/lib/utils';
import { TicketSelector } from '@/components/booking/TicketSelector';

interface EventDetailsPageProps {
  eventId: string;
  onBack: () => void;
}

export const EventDetailsPage: React.FC<EventDetailsPageProps> = ({ eventId, onBack }) => {
  const { toast } = useToast();
  const event = PROTOTYPE_EVENTS.find((e) => e.id === eventId) || PROTOTYPE_EVENTS[0];
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [selectedTicketType, setSelectedTicketType] = useState('regular');
  const [attendeeName, setAttendeeName] = useState('');
  const [attendeeRoll, setAttendeeRoll] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imageError, setImageError] = useState(false);

  const isSoldOut = event.registeredCount >= event.capacity;

  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!attendeeName.trim() || !attendeeRoll.trim()) {
      toast({
        type: 'error',
        title: 'Validation Error',
        message: 'Please complete all required fields.',
      });
      return;
    }

    if (!agreedToTerms) {
      toast({
        type: 'error',
        title: 'Terms Required',
        message: 'Please agree to campus event rules.',
      });
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      setIsRegisterOpen(false);
      toast({
        type: 'success',
        title: event.isPaid ? 'Seat Hold Created (Test Mode)' : 'Registration Confirmed!',
        message: event.isPaid
          ? `Proceeding to test simulator checkout for ${formatINR(event.pricePaise)}.`
          : 'Your digital QR ticket has been generated and added to My Events.',
      });
    }, 600);
  };

  const RegistrationFormContent = (
    <form onSubmit={handleRegisterSubmit} className="space-y-4">
      {event.isPaid && (
        <div className="p-3 bg-warning/10 border border-warning/20 rounded-md text-xs text-warning font-medium">
          TEST MODE – simulated money. Server calculates exact totals from stored integer paise; no real money moves.
        </div>
      )}

      <Input
        label="Full Name"
        required
        placeholder="e.g. Aarav Sharma"
        value={attendeeName}
        onChange={(e) => setAttendeeName(e.target.value)}
      />

      <Input
        label="College Roll / ID Number"
        required
        placeholder="e.g. CS22B1042"
        value={attendeeRoll}
        onChange={(e) => setAttendeeRoll(e.target.value)}
      />

      <Select
        label="Ticket Category"
        options={[
          {
            value: 'regular',
            label: `Student Standard Pass (${event.isPaid ? formatINR(event.pricePaise) : 'Free'})`,
          },
        ]}
        value={selectedTicketType}
        onChange={(e) => setSelectedTicketType(e.target.value)}
      />

      <Checkbox
        label="I agree to campus attendance code and check-in policy"
        checked={agreedToTerms}
        onChange={(e) => setAgreedToTerms(e.target.checked)}
      />

      <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={() => setIsRegisterOpen(false)}
        >
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="md" isLoading={isSubmitting}>
          {isSoldOut ? 'Join Waitlist' : event.isPaid ? 'Proceed to Test Pay' : 'Confirm Registration'}
        </Button>
      </div>
    </form>
  );

  return (
    <div className="space-y-6 pb-28 md:pb-6">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-semibold text-text-muted hover:text-text transition-colors py-1.5 px-2 rounded-md hover:bg-surface-2"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Event Discovery</span>
        </button>

        <button
          onClick={() => {
            const icsData = [
              'BEGIN:VCALENDAR',
              'VERSION:2.0',
              'PRODID:-//Eventora//Campus Calendar//EN',
              'BEGIN:VEVENT',
              `SUMMARY:${event.title}`,
              `LOCATION:${event.venue}`,
              'END:VEVENT',
              'END:VCALENDAR',
            ].join('\r\n');
            const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${event.id}.ics`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            toast({
              type: 'success',
              title: 'Calendar File Downloaded',
              message: 'Added RFC 5545 .ics event to downloads.',
            });
          }}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-text border border-border px-3 py-1.5 rounded-md hover:bg-surface-2"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Add to Calendar (.ics)</span>
        </button>

        <button
          onClick={() =>
            toast({
              type: 'info',
              title: 'Share Link Copied',
              message: 'Public event URL copied to clipboard.',
            })
          }
          className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-text border border-border px-3 py-1.5 rounded-md hover:bg-surface-2"
        >
          <Share2 className="w-3.5 h-3.5" />
          <span>Share</span>
        </button>
      </div>

      {/* Hero Event Banner (Fixed 16:9 Aspect Box with Gradient Fallback) */}
      <div className="relative rounded-lg overflow-hidden border border-border bg-gradient-to-br from-surface-2 via-border to-surface aspect-16/9 max-h-[380px] w-full">
        {!imageError ? (
          <img
            src={event.imageUrl}
            alt={event.title}
            onError={() => setImageError(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-text-muted p-6">
            <ImageIcon className="w-12 h-12 text-brand/30 mb-2" />
            <span className="text-sm font-semibold">{event.category} Event Showcase</span>
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent flex flex-col justify-end p-5 sm:p-8">
          <div className="flex flex-wrap gap-2 mb-2">
            <Badge variant="brand" size="sm" className="bg-brand text-white border-none">
              {event.category}
            </Badge>
            {event.isPaid ? (
              <Badge variant="warning" size="sm">
                TEST MODE – SIMULATED MONEY
              </Badge>
            ) : (
              <Badge variant="success" size="sm">
                FREE ADMISSION
              </Badge>
            )}
            <Badge variant="neutral" size="sm" className="bg-black/50 text-white border-white/20">
              {event.department}
            </Badge>
          </div>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-white leading-tight">
            {event.title}
          </h1>
          <p className="text-xs sm:text-sm text-gray-200 mt-1 font-medium">
            Hosted by {event.organizer}
          </p>
        </div>
      </div>

      {/* Main Grid: Details + Registration Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-6">
          <Card>
            <h2 className="text-base font-bold text-text mb-3">About the Event</h2>
            <p className="text-sm text-text-muted leading-relaxed whitespace-pre-line">
              {event.description}
            </p>

            <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-border">
              {event.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs bg-surface-2 text-text-muted px-2.5 py-1 rounded-sm border border-border"
                >
                  #{tag}
                </span>
              ))}
            </div>
          </Card>

          {/* Campus Venue Navigator Card */}
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="w-4 h-4 text-brand" />
              <h2 className="text-base font-bold text-text">Campus Venue Navigator</h2>
            </div>
            <p className="text-sm font-semibold text-text">{event.venue}</p>
            <p className="text-xs text-text-muted mt-1 leading-relaxed">
              Entry via North Gate elevator to Floor 2. Wheelchair ramp accessible from Campus Courtyard East.
              Please arrive 15 minutes before the session starts with your digital QR ticket ready.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  toast({
                    type: 'info',
                    title: 'Campus Map',
                    message: 'Interactive building map directions will open.',
                  })
                }
              >
                View Directions
              </Button>
            </div>
          </Card>

          {/* Ticket Information & Server Pricing Policy */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-text">Ticket Tiers & Seat Capacity</h2>
              {event.isPaid && (
                <Badge variant="warning" size="sm">
                  TEST MODE – simulated money
                </Badge>
              )}
            </div>

            <div className="border border-border rounded-md overflow-hidden text-xs">
              <div className="bg-surface-2 p-3 font-semibold text-text-muted border-b border-border flex justify-between">
                <span>Tier Name</span>
                <span>Price (paise / INR)</span>
              </div>
              <div className="p-3 bg-surface flex justify-between items-center">
                <div>
                  <p className="font-semibold text-text">Student Standard Admission</p>
                  <p className="text-text-muted text-[11px]">
                    Includes all sessions, verified QR ticket & digital certificate.
                  </p>
                </div>
                <div className="text-right">
                  <span className="font-bold text-sm text-text">
                    {event.isPaid ? formatINR(event.pricePaise) : 'Free'}
                  </span>
                  {event.isPaid && (
                    <span className="block text-[10px] text-text-muted">
                      ({event.pricePaise} paise)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {event.isPaid && (
              <p className="text-xs text-text-muted mt-2 italic">
                * Non-negotiable safety invariant: Server calculates exact totals from stored ticket_types.price_paise.
                No real payments are collected.
              </p>
            )}
          </Card>

          {/* Event Announcements & FAQs (FR-OPS) */}
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Bell className="w-4 h-4 text-brand" />
              <h2 className="text-base font-bold text-text">Event Announcements & Live Updates</h2>
            </div>
            <div className="space-y-2.5">
              <div className="p-3 bg-surface-2 rounded-md border border-border text-xs">
                <div className="flex items-center justify-between font-semibold text-text">
                  <span>Welcome Desk & Badge Pickup Location</span>
                  <span className="text-[10px] text-text-muted">Today</span>
                </div>
                <p className="text-text-muted mt-1 leading-relaxed">
                  Badges and kit distribution begins 45 minutes prior to the opening keynote at the Ground Floor Foyer.
                </p>
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-border">
              <div className="flex items-center gap-2 mb-3">
                <HelpCircle className="w-4 h-4 text-brand" />
                <h3 className="text-sm font-bold text-text">Frequently Asked Questions</h3>
              </div>
              <div className="space-y-2 text-xs">
                <details className="bg-surface-2 p-3 rounded-md border border-border cursor-pointer">
                  <summary className="font-semibold text-text">Can non-CSE students register?</summary>
                  <p className="text-text-muted mt-1 leading-relaxed">
                    Yes, registrations are open to all departments across the college. Interdisciplinary teams are encouraged.
                  </p>
                </details>
                <details className="bg-surface-2 p-3 rounded-md border border-border cursor-pointer">
                  <summary className="font-semibold text-text">Will verified participation certificates be awarded?</summary>
                  <p className="text-text-muted mt-1 leading-relaxed">
                    Yes, upon scanning check-in via QR code and attending the closing valedictory, an authentic cryptographic certificate is added to your Passport.
                  </p>
                </details>
              </div>
            </div>
          </Card>
        </div>

        {/* Right Column: Live Polling Ticket Selector on Desktop */}
        <div className="lg:col-span-4 space-y-4">
          <div className="sticky top-20">
            <TicketSelector
              eventId={event.id}
              eventTitle={event.title}
              startsAt={event.dateStr}
              endsAt={event.timeStr}
              onOpenCheckoutModal={() => setIsRegisterOpen(true)}
              initialTicketTypes={[
                {
                  id: 'tier-standard',
                  name: 'Student Admission',
                  pricePaise: event.isPaid ? event.pricePaise : 0,
                  capacity: event.capacity,
                  sold: event.registeredCount,
                  held: 0,
                  available: Math.max(event.capacity - event.registeredCount, 0),
                },
              ]}
              onBookingSuccess={() => {
                toast({
                  type: 'success',
                  title: 'Booking Confirmed!',
                  message: 'Your digital QR ticket has been added to My Tickets.',
                });
              }}
            />
          </div>
        </div>
      </div>

      {/* Sticky Bottom Action Bar on Phones (<768px) with Price and Availability */}
      <div className="md:hidden fixed bottom-16 left-0 right-0 z-30 bg-surface border-t border-border p-3 flex items-center justify-between shadow-md">
        <div>
          <span className="text-[11px] text-text-muted block">
            {isSoldOut ? 'Waitlist Only' : `${event.capacity - event.registeredCount} Seats Left`}
          </span>
          <span className="text-sm font-bold text-text">
            {event.isPaid ? formatINR(event.pricePaise) : 'Free'}
          </span>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() => setIsRegisterOpen(true)}
        >
          {isSoldOut ? 'Join Waitlist' : 'Register Now'}
        </Button>
      </div>

      {/* Responsive Registration Modal (Bottom Sheet on Mobile, Dialog on Desktop) */}
      <Modal
        isOpen={isRegisterOpen}
        onClose={() => setIsRegisterOpen(false)}
        title={isSoldOut ? 'Join Waitlist Queue' : 'Campus Event Registration'}
        description={
          isSoldOut
            ? 'When a seat is released, an offer will be dispatched to your account.'
            : 'Enter attendee credentials for your digital QR ticket.'
        }
      >
        {RegistrationFormContent}
      </Modal>
    </div>
  );
};
