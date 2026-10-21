import React, { useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Users,
  Share2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { MOCK_EVENTS } from '@/mock/data';
import { formatINR } from '@/lib/utils';

interface EventDetailsPageProps {
  eventId: string;
  onBack: () => void;
}

export const EventDetailsPage: React.FC<EventDetailsPageProps> = ({ eventId, onBack }) => {
  const { toast } = useToast();
  const event = MOCK_EVENTS.find((e) => e.id === eventId) || MOCK_EVENTS[0];
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [selectedTicketType, setSelectedTicketType] = useState('regular');
  const [attendeeName, setAttendeeName] = useState('');
  const [attendeeRoll, setAttendeeRoll] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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

    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      setIsRegisterModalOpen(false);
      toast({
        type: 'success',
        title: event.isPaid ? 'Seat Hold Created (Test Mode)' : 'Registration Confirmed!',
        message: event.isPaid
          ? `Proceeding to test simulator checkout for ${formatINR(event.pricePaise)}.`
          : 'Your digital QR ticket has been generated and added to My Events.',
      });
    }, 600);
  };

  return (
    <div className="space-y-6 pb-24 md:pb-6">
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

      {/* Hero Event Banner */}
      <div className="relative rounded-lg overflow-hidden border border-border bg-surface-2 h-64 sm:h-80 w-full">
        <img
          src={event.imageUrl}
          alt={event.title}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent flex flex-col justify-end p-5 sm:p-8">
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
        {/* Left Column (8 cols): Description, Schedule, Venue, FAQ */}
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
                <span className="text-[11px] font-semibold text-warning bg-warning/10 px-2 py-0.5 rounded-sm border border-warning/20">
                  TEST MODE – simulated money
                </span>
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
        </div>

        {/* Right Column (4 cols): Booking Status Box */}
        <div className="lg:col-span-4 space-y-4">
          <Card className="sticky top-20">
            <h2 className="text-sm font-bold text-text mb-4">Registration Status</h2>

            <div className="space-y-3 pb-4 border-b border-border">
              <div className="flex items-center gap-2.5 text-xs text-text">
                <Calendar className="w-4 h-4 text-brand shrink-0" />
                <div>
                  <p className="font-semibold">{event.dateStr}</p>
                  <p className="text-text-muted text-[11px]">{event.timeStr}</p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 text-xs text-text">
                <Users className="w-4 h-4 text-brand shrink-0" />
                <div>
                  <p className="font-semibold">
                    {isSoldOut ? 'Sold Out' : `${event.capacity - event.registeredCount} Seats Remaining`}
                  </p>
                  <p className="text-text-muted text-[11px]">
                    {event.registeredCount} / {event.capacity} seats filled
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-text-muted">Ticket Fee</span>
                <span className="text-base font-bold text-text">
                  {event.isPaid ? formatINR(event.pricePaise) : 'Free'}
                </span>
              </div>

              <Button
                variant={isSoldOut ? 'secondary' : 'primary'}
                size="lg"
                className="w-full"
                onClick={() => setIsRegisterModalOpen(true)}
              >
                {isSoldOut ? 'Join Seat Waitlist' : event.isPaid ? 'Proceed to Test Checkout' : 'Claim Free Pass'}
              </Button>

              <p className="text-[11px] text-text-muted text-center leading-normal">
                {event.isPaid
                  ? 'Simulated sandbox transaction. No card or bank account needed.'
                  : 'Instant confirmation. Zero payment details required.'}
              </p>
            </div>
          </Card>
        </div>
      </div>

      {/* Sticky Bottom Action Bar on Phones (<768px) */}
      <div className="md:hidden fixed bottom-16 left-0 right-0 z-30 bg-surface border-t border-border p-3 flex items-center justify-between shadow-md">
        <div>
          <span className="text-[11px] text-text-muted block">Fee</span>
          <span className="text-sm font-bold text-text">
            {event.isPaid ? formatINR(event.pricePaise) : 'Free'}
          </span>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() => setIsRegisterModalOpen(true)}
        >
          {isSoldOut ? 'Join Waitlist' : 'Register Now'}
        </Button>
      </div>

      {/* Registration Bottom Sheet / Modal */}
      <Modal
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
        title={isSoldOut ? 'Join Waitlist Queue' : 'Campus Event Registration'}
        description={
          isSoldOut
            ? 'When a seat is released, an offer will be dispatched to your account.'
            : 'Enter attendee credentials for your digital QR ticket.'
        }
      >
        <form onSubmit={handleRegisterSubmit} className="space-y-4">
          {event.isPaid && (
            <div className="p-3 bg-warning/10 border border-warning/20 rounded-md text-xs text-warning font-medium">
              TEST MODE – simulated money. This booking will create a pending hold and test-mode simulator receipt.
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

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => setIsRegisterModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" isLoading={isSubmitting}>
              {isSoldOut ? 'Join Waitlist' : event.isPaid ? 'Proceed to Test Pay' : 'Confirm Registration'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
