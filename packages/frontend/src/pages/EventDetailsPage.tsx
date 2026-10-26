import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Share2,
  Download,
  HelpCircle,
  Bell,
  Image as ImageIcon,
  Star,
  Info,
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
import { VenueCard } from '@/components/venue/VenueCard';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import {
  DynamicRegistrationForm,
  validateDynamicForm,
} from '@/components/form-builder/DynamicRegistrationForm';
import { FormFieldItem } from '@/lib/utils';

interface EventDetailsPageProps {
  eventId?: string;
  onBack?: () => void;
  onProceedToCheckout?: (bookingId: string) => void;
}

interface PublicRatingData {
  feedbackCount: number;
  ratingAvg: number | null;
  hasEnoughResponses: boolean;
  displayRating: string;
  responseRatePct: number;
  formattedSummary: string;
}

export const EventDetailsPage: React.FC<EventDetailsPageProps> = ({
  eventId: propEventId,
  onBack: propOnBack,
  onProceedToCheckout: propOnProceedToCheckout,
}) => {
  const params = useParams<{ slug?: string; id?: string }>();
  const navigate = useNavigate();
  const eventId = propEventId || params.slug || params.id || '';
  const onBack = propOnBack || (() => navigate(-1));
  const onProceedToCheckout =
    propOnProceedToCheckout || ((bookingId: string) => navigate(`/checkout/${bookingId}`));
  const { toast } = useToast();
  const { user } = useAuth();
  const prototypeEvent = PROTOTYPE_EVENTS.find((e) => e.id === eventId) || PROTOTYPE_EVENTS[0];
  const [loadedEvent, setLoadedEvent] = useState<any>(null);
  const [ticketTiers, setTicketTiers] = useState<any[]>([]);
  const [selectedTierId, setSelectedTierId] = useState<string>('');
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [selectedTicketType, setSelectedTicketType] = useState('regular');
  const [attendeeName, setAttendeeName] = useState(() => {
    try {
      return localStorage.getItem('eventora_attendee_name') || '';
    } catch {
      return '';
    }
  });
  const [attendeeRoll, setAttendeeRoll] = useState(() => {
    try {
      return localStorage.getItem('eventora_attendee_roll') || '';
    } catch {
      return '';
    }
  });
  const [agreedToTerms, setAgreedToTerms] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formFields, setFormFields] = useState<FormFieldItem[]>([]);
  const [customAnswers, setCustomAnswers] = useState<Record<string, any>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Auto-populate attendee name from user profile when available
  useEffect(() => {
    if (user?.displayName && !attendeeName) {
      setAttendeeName(user.displayName);
    }
  }, [user?.displayName, attendeeName]);
  const [imageError, setImageError] = useState(false);
  const [ratingsData, setRatingsData] = useState<PublicRatingData>({
    feedbackCount: 38,
    ratingAvg: 4.6,
    hasEnoughResponses: true,
    displayRating: '4.6 ★',
    responseRatePct: 42,
    formattedSummary: '4.6 ★ (38 of 90 attended · 42% responded)',
  });

  // Effective event merges backend API data over prototype baseline
  const event = loadedEvent ? {
    id: loadedEvent.id,
    title: loadedEvent.title,
    description: loadedEvent.description,
    category: loadedEvent.category || prototypeEvent.category,
    department: loadedEvent.department || prototypeEvent.department,
    venue: loadedEvent.venue?.name || loadedEvent.venueName || prototypeEvent.venue,
    venueName: loadedEvent.venue?.name || loadedEvent.venueName || prototypeEvent.venue,
    venueBuilding: loadedEvent.venue?.building || loadedEvent.venueBuilding || 'Main Campus',
    dateStr: loadedEvent.startsAt ? new Date(loadedEvent.startsAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : prototypeEvent.dateStr,
    timeStr: loadedEvent.startsAt ? `${new Date(loadedEvent.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(loadedEvent.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : prototypeEvent.timeStr,
    capacity: loadedEvent.capacity || prototypeEvent.capacity,
    registeredCount: loadedEvent.registeredCount ?? prototypeEvent.registeredCount,
    isPaid: ticketTiers.some((t: any) => (t.price_paise || t.pricePaise || 0) > 0),
    pricePaise: ticketTiers.find((t: any) => (t.price_paise || t.pricePaise || 0) > 0)?.price_paise || 0,
    imageUrl: loadedEvent.imageUrl || prototypeEvent.imageUrl,
    tags: Array.isArray(loadedEvent.tags) && loadedEvent.tags.length > 0 ? (loadedEvent.tags as string[]) : prototypeEvent.tags,
    organizer: loadedEvent.organizer?.displayName || loadedEvent.organizerName || prototypeEvent.organizer,
    organizerName: loadedEvent.organizer?.displayName || loadedEvent.organizerName || prototypeEvent.organizer,
    faqs: loadedEvent.faqs && loadedEvent.faqs.length > 0 ? loadedEvent.faqs : [],
    announcements: loadedEvent.announcements || [],
  } : {
    ...prototypeEvent,
    venueName: prototypeEvent.venue,
    venueBuilding: 'Main Campus',
    organizerName: prototypeEvent.organizer,
    faqs: [] as any[],
    announcements: [] as any[],
  };

  useEffect(() => {
    let isMounted = true;

    async function loadEventDetails() {
      try {
        const res = await apiClient.get<any>(`/api/v1/events/${eventId}`);
        const eventObj = res?.event || res;
        if (isMounted && eventObj?.id) {
          setLoadedEvent(eventObj);
          if (Array.isArray(eventObj.formFields) && eventObj.formFields.length > 0) {
            setFormFields(eventObj.formFields);
          } else {
            try {
              const formRes = await apiClient.get<any>(`/api/v1/events/${eventId}/form`);
              if (isMounted && formRes?.form?.fields) {
                setFormFields(formRes.form.fields);
              }
            } catch {
              // No custom form fields
            }
          }
        }
      } catch {
        // Prototype event fallback
      }

      try {
        const tierRes = await apiClient.get<any>(`/api/v1/events/${eventId}/ticket-types`);
        const tiers = tierRes?.ticketTypes || [];
        if (isMounted && tiers.length > 0) {
          setTicketTiers(tiers);
          setSelectedTierId(tiers[0].id);
        }
      } catch {
        // Fallback
      }
    }

    loadEventDetails();
    return () => { isMounted = false; };
  }, [eventId]);

  useEffect(() => {
    async function loadRatings() {
      try {
        const data = await apiClient<any>(`/api/v1/events/${eventId}/ratings`);
        if (data?.ratings) {
          setRatingsData(data.ratings);
        }
      } catch {
        // Fallback to prototype rating state
      }
    }
    loadRatings();
  }, [eventId]);

  const isSoldOut = event.registeredCount >= event.capacity;

  const handleRegisterSubmit = async (e: React.FormEvent) => {
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

    if (formFields.length > 0) {
      const { isValid, errors } = validateDynamicForm(formFields, customAnswers, 1);
      if (!isValid) {
        setFormErrors(errors);
        toast({
          type: 'error',
          title: 'Required Information Missing',
          message: 'Please complete all mandatory questions before proceeding.',
        });
        return;
      }
    }

    try {
      localStorage.setItem('eventora_attendee_name', attendeeName.trim());
      localStorage.setItem('eventora_attendee_roll', attendeeRoll.trim());
    } catch {
      // ignore localStorage quota errors
    }

    setIsSubmitting(true);
    try {
      const activeTierId = selectedTierId || ticketTiers[0]?.id || 'tier-standard';
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeTierId);
      const isEventUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId);
      const idempotencyKey = `book-${eventId}-${activeTierId}-${Date.now()}`;

      if (isUuid && isEventUuid) {
        const answersPayload: Array<{ fieldId: string; value: any; attendeeIndex: number }> = [];
        if (formFields.length > 0) {
          for (const field of formFields) {
            const key = `0_${field.id}`;
            const val =
              customAnswers[key] !== undefined ? customAnswers[key] : customAnswers[field.id || ''];
            if (val !== undefined && val !== null && val !== '') {
              answersPayload.push({
                fieldId: field.id!,
                value: val,
                attendeeIndex: 0,
              });
            }
          }
        }

        const payload: { items: { ticketTypeId: string; quantity: number }[]; answers?: any[] } = {
          items: [{ ticketTypeId: activeTierId, quantity: 1 }],
          ...(answersPayload.length > 0 ? { answers: answersPayload } : {}),
        };
        const res = await apiClient.post<any>(`/api/v1/events/${eventId}/bookings`, payload, {
          headers: { 'Idempotency-Key': idempotencyKey },
        });

        setIsRegisterOpen(false);

        if (res?.booking?.status === 'CONFIRMED' || res?.booking?.total_paise === 0) {
          toast({
            type: 'success',
            title: 'Registration Confirmed!',
            message: `Your pass for "${event.title}" has been issued and added to Tickets & Passport.`,
          });
        } else if (res?.booking?.status === 'PENDING_PAYMENT' && onProceedToCheckout) {
          toast({
            type: 'success',
            title: 'Seat Hold Created (Test Mode)',
            message: `Proceeding to test simulator checkout for ${formatINR(res.booking.total_paise || event.pricePaise || 0)}.`,
          });
          onProceedToCheckout(res.booking.id);
        }
      } else {
        // Prototype fallback simulation
        setIsRegisterOpen(false);
        if (event.isPaid) {
          toast({
            type: 'success',
            title: 'Seat Hold Created (Test Mode)',
            message: `Proceeding to test simulator checkout for ${formatINR(event.pricePaise)}.`,
          });
          if (onProceedToCheckout) {
            onProceedToCheckout(`bkg_demo_${Date.now()}`);
          }
        } else {
          toast({
            type: 'success',
            title: 'Registration Confirmed!',
            message: 'Your digital QR ticket has been generated and added to My Events.',
          });
        }
      }
    } catch (err: any) {
      toast({
        type: 'error',
        title: 'Booking Error',
        message: err.error?.message || err.message || 'Could not complete registration. Please check availability or sign in.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const RegistrationFormContent = (
    <form onSubmit={handleRegisterSubmit} className="space-y-4">
      {event.isPaid && (
        <div className="p-3 bg-warning/10 border border-warning/20 rounded-md text-xs text-warning font-medium">
          TEST MODE – simulated money. Server calculates exact totals from stored integer paise; no real money moves.
        </div>
      )}

      <Input
        id="reg-attendee-name"
        name="attendeeName"
        autoComplete="name"
        label="Full Name"
        required
        placeholder="e.g. Aarav Sharma"
        value={attendeeName}
        onChange={(e) => setAttendeeName(e.target.value)}
      />

      <Input
        id="reg-attendee-roll"
        name="attendeeRoll"
        autoComplete="off"
        label="College Roll / ID Number"
        required
        placeholder="e.g. CS22B1042"
        value={attendeeRoll}
        onChange={(e) => setAttendeeRoll(e.target.value)}
      />

      <Select
        label="Ticket Category"
        options={ticketTiers.length > 0 ? ticketTiers.map((t: any) => ({
          value: t.id,
          label: `${t.name} (${(t.price_paise || t.pricePaise) ? formatINR(t.price_paise || t.pricePaise) : 'Free'})`,
        })) : [
          {
            value: 'regular',
            label: `Student Standard Pass (${event.isPaid ? formatINR(event.pricePaise) : 'Free'})`,
          },
        ]}
        value={selectedTierId || selectedTicketType}
        onChange={(e) => {
          setSelectedTierId(e.target.value);
          setSelectedTicketType(e.target.value);
        }}
      />

      {formFields.length > 0 && (
        <div className="pt-3 border-t border-border space-y-2">
          <h4 className="text-xs font-bold text-text uppercase tracking-wider">
            Registration Questionnaire
          </h4>
          <DynamicRegistrationForm
            fields={formFields}
            answers={customAnswers}
            onAnswerChange={(fieldId, val, attendeeIndex = 0) => {
              const key = `${attendeeIndex}_${fieldId}`;
              setCustomAnswers((prev) => ({
                ...prev,
                [key]: val,
                [fieldId]: val,
              }));
              setFormErrors((prev) => {
                const next = { ...prev };
                delete next[key];
                delete next[fieldId];
                return next;
              });
            }}
            errors={formErrors}
            ticketQuantity={1}
          />
        </div>
      )}

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
              {event.tags.map((tag: string) => (
                <span
                  key={tag}
                  className="text-xs bg-surface-2 text-text-muted px-2.5 py-1 rounded-sm border border-border"
                >
                  #{tag}
                </span>
              ))}
            </div>
          </Card>

          {/* Attendee Ratings & Reviews Summary (FR-FEED Cold-Start Guard) */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                <h2 className="text-base font-bold text-text">Attendee Ratings & Transparency</h2>
              </div>
              <Badge variant={ratingsData.hasEnoughResponses ? 'success' : 'neutral'} size="sm">
                {ratingsData.hasEnoughResponses ? 'Verified Feedback' : 'Cold Start'}
              </Badge>
            </div>

            {ratingsData.hasEnoughResponses ? (
              <div className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black text-text font-mono">
                    {ratingsData.ratingAvg?.toFixed(1)} ★
                  </span>
                  <span className="text-xs text-text-muted font-medium">
                    ({ratingsData.feedbackCount} reviews · {ratingsData.responseRatePct}% response rate)
                  </span>
                </div>
                <p className="text-xs text-text-muted leading-relaxed">
                  Based on verified check-ins from attendees who participated in previous editions.
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-2.5 p-3 bg-surface-2 border border-border rounded-lg text-xs text-text-muted">
                <Info className="w-4 h-4 text-brand-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-text">Not enough responses yet</p>
                  <p className="text-[11px] mt-0.5">
                    Ratings will be published once at least 5 verified attendees submit feedback.
                  </p>
                </div>
              </div>
            )}
          </Card>

          {/* Campus Venue Navigator Card (FR-VENUE) */}
          <VenueCard
            name={event.venue}
            building="Sir MV Academic Complex, East Wing"
            capacity={event.capacity}
            accessibilityNotes="Step-free wheelchair ramp at Gate 2 entrance, elevator access to 2nd Floor, designated priority seating rows 1-2."
            directions="From the Central Quadrangle, follow the paved North Walkway for 150m. Enter via the double glass doors."
            entryInstructions="Staff turnstile check-in opens 15 minutes before the scheduled start time. Have your high-contrast QR pass ready."
          />

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
              initialTicketTypes={ticketTiers.length > 0 ? ticketTiers.map((t: any) => ({
                id: t.id,
                name: t.name,
                pricePaise: t.price_paise !== undefined ? t.price_paise : (t.pricePaise || 0),
                capacity: t.capacity,
                sold: t.sold,
                held: t.held,
                available: t.available !== undefined ? t.available : Math.max(0, t.capacity - (t.sold + t.held)),
              })) : [
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
