import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Calendar,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Save,
  Send,
  Building,
  Info,
  Users,
  ShieldAlert,
  IndianRupee,
  Plus,
  Trash2,
  CheckCircle2,
} from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { apiClient, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  rupeeToPaise,
  formatPaiseToRupee,
} from '@/lib/utils';

// Step 1: Details Schema
const detailsSchema = z.object({
  title: z
    .string()
    .min(5, 'Title must be at least 5 characters')
    .max(150, 'Title cannot exceed 150 characters'),
  description: z
    .string()
    .min(20, 'Description must be at least 20 characters'),
  category: z.string().min(1, 'Category is required'),
  department: z.string().min(1, 'Department is required'),
  format: z.enum(['in_person', 'online', 'hybrid']),
  tags: z.string().optional(),
  contactEmail: z.string().email('Invalid email address'),
});

// Step 2: Schedule Schema
const scheduleSchema = z
  .object({
    venueId: z.string().optional(),
    startsAt: z.string().min(1, 'Event start time is required'),
    endsAt: z.string().min(1, 'Event end time is required'),
  })
  .refine(
    (data) => {
      if (!data.startsAt || !data.endsAt) return true;
      return new Date(data.endsAt) > new Date(data.startsAt);
    },
    {
      message: 'Event end time must be strictly after start time',
      path: ['endsAt'],
    }
  );

// Step 3: Capacity & Rules Base Schema
const capacitySchema = z.object({
  capacity: z.coerce.number().min(1, 'Capacity must be at least 1').max(50000, 'Max capacity is 50,000'),
  registrationOpensAt: z.string().optional(),
  registrationClosesAt: z.string().optional(),
  teamMode: z.enum(['none', 'optional', 'required']),
  teamMin: z.coerce.number().min(1),
  teamMax: z.coerce.number().min(1),
});

export interface VenueOption {
  id: string;
  name: string;
  building: string;
  capacity: number;
  accessibilityNotes?: string;
  directions?: string;
}

export interface TicketTierInput {
  id: string;
  name: string;
  priceRupees: string;
  capacity: number;
  perUserLimit: number;
}

interface CreateEventPageProps {
  onBack?: () => void;
  onSuccess?: (eventId: string) => void;
}

export const CreateEventPage: React.FC<CreateEventPageProps> = ({
  onBack: propOnBack,
  onSuccess: propOnSuccess,
}) => {
  const navigate = useNavigate();
  const onBack = propOnBack || (() => navigate('/organizer'));
  const onSuccess = propOnSuccess || ((id: string) => navigate(`/events/${id}`));
  const { toast } = useToast();
  const { user, isAuthenticated, login } = useAuth();

  const isOrganizerOrAdmin = Boolean(
    user &&
      (user.globalRole === 'admin' ||
        (user.organizerMemberships && user.organizerMemberships.length > 0))
  );

  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [createdDraftId, setCreatedDraftId] = useState<string | null>(null);

  // In-memory idempotency key per browser session (No localStorage)
  const [idempotencyKey] = useState<string>(
    () => `prop-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  );

  // Pricing State
  const [pricingType, setPricingType] = useState<'free' | 'paid'>('free');
  const [currency] = useState<'INR'>('INR');
  const [singlePriceRupees, setSinglePriceRupees] = useState<string>('250');
  const [customTiersEnabled, setCustomTiersEnabled] = useState<boolean>(false);
  const [ticketTiers, setTicketTiers] = useState<TicketTierInput[]>([
    {
      id: 'tier-1',
      name: 'General Admission',
      priceRupees: '250',
      capacity: 100,
      perUserLimit: 5,
    },
  ]);
  const [pricingError, setPricingError] = useState<string | null>(null);

  // Form states
  const detailsForm = useForm<z.infer<typeof detailsSchema>>({
    resolver: zodResolver(detailsSchema),
    defaultValues: {
      title: '',
      description: '',
      category: 'AI & Robotics',
      department: 'Computer Science',
      format: 'in_person',
      tags: 'tech, campus, workshop',
      contactEmail: user?.email || 'organizer@campus.edu',
    },
  });

  const scheduleForm = useForm<z.infer<typeof scheduleSchema>>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      venueId: '',
      startsAt: '',
      endsAt: '',
    },
  });

  const capacityForm = useForm<z.infer<typeof capacitySchema>>({
    resolver: zodResolver(capacitySchema),
    defaultValues: {
      capacity: 150,
      teamMode: 'none',
      teamMin: 1,
      teamMax: 4,
    },
  });

  // Fetch available venues on mount
  useEffect(() => {
    let isMounted = true;
    const fetchVenues = async () => {
      try {
        const res = await apiClient<any>('/api/v1/venues');
        const venueList = res?.venues || res?.data?.venues || [];
        if (isMounted) {
          if (venueList.length > 0) {
            setVenues(venueList);
            if (!scheduleForm.getValues('venueId')) {
              scheduleForm.setValue('venueId', venueList[0].id);
            }
          } else {
            setVenues([
              { id: '44d2a71e-f6af-4764-8793-b116f9439a30', name: 'Sir MV Auditorium', building: 'Main Administrative Block', capacity: 500 },
              { id: '5a6a045e-f6f1-4ac7-aaed-ddfe186f7a04', name: 'Dr. APJ Abdul Kalam Seminar Hall', building: 'Science & Technology Block', capacity: 200 },
              { id: '5a422e51-2330-4681-b913-a008328fe263', name: 'Turing Computing Lab', building: 'Computer Science Department', capacity: 80 },
              { id: 'a5aa35ed-6177-418d-af68-46db8142662d', name: 'Campus Central Amphitheater', building: 'Student Activity Center', capacity: 1200 },
            ]);
          }
        }
      } catch {
        if (isMounted) {
          setVenues([
            { id: '44d2a71e-f6af-4764-8793-b116f9439a30', name: 'Sir MV Auditorium', building: 'Main Administrative Block', capacity: 500 },
            { id: '5a6a045e-f6f1-4ac7-aaed-ddfe186f7a04', name: 'Dr. APJ Abdul Kalam Seminar Hall', building: 'Science & Technology Block', capacity: 200 },
            { id: '5a422e51-2330-4681-b913-a008328fe263', name: 'Turing Computing Lab', building: 'Computer Science Department', capacity: 80 },
            { id: 'a5aa35ed-6177-418d-af68-46db8142662d', name: 'Campus Central Amphitheater', building: 'Student Activity Center', capacity: 1200 },
          ]);
        }
      }
    };
    fetchVenues();
    return () => {
      isMounted = false;
    };
  }, [scheduleForm]);

  // Ticket Tiers Management
  const addTier = () => {
    const newTierIndex = ticketTiers.length + 1;
    setTicketTiers((prev) => [
      ...prev,
      {
        id: `tier-${Date.now()}`,
        name: `Tier ${newTierIndex}`,
        priceRupees: '150',
        capacity: 50,
        perUserLimit: 5,
      },
    ]);
  };

  const removeTier = (id: string) => {
    if (ticketTiers.length <= 1) {
      toast({
        title: 'Tier Required',
        message: 'A paid event must have at least one ticket tier.',
        type: 'warning',
      });
      return;
    }
    setTicketTiers((prev) => prev.filter((t) => t.id !== id));
  };

  const updateTier = (id: string, field: keyof TicketTierInput, value: any) => {
    setTicketTiers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, [field]: value } : t))
    );
  };

  // Helper: Live calculation of paise for single ticket price
  const getSinglePricePaiseSafe = (): { paise: number | null; error: string | null } => {
    try {
      const paise = rupeeToPaise(singlePriceRupees);
      if (paise <= 0) {
        return { paise: null, error: 'Price must be greater than ₹0 for paid events' };
      }
      return { paise, error: null };
    } catch (err: any) {
      return { paise: null, error: err.message || 'Invalid rupee format' };
    }
  };

  // Build validated ticket tiers payload
  const buildTicketTiersPayload = (overallCapacity: number) => {
    if (pricingType === 'free') {
      return [
        {
          name: 'Free Admission',
          pricePaise: 0,
          capacity: overallCapacity,
          perUserLimit: 2,
        },
      ];
    }

    if (!customTiersEnabled) {
      const { paise, error } = getSinglePricePaiseSafe();
      if (error || paise === null) {
        throw new Error(error || 'Invalid ticket price');
      }
      return [
        {
          name: 'General Admission',
          pricePaise: paise,
          capacity: overallCapacity,
          perUserLimit: 5,
        },
      ];
    }

    // Custom Tiers
    if (ticketTiers.length === 0) {
      throw new Error('At least one ticket tier is required for paid events');
    }

    let sumCapacity = 0;
    const mapped = ticketTiers.map((tier, idx) => {
      if (!tier.name.trim()) {
        throw new Error(`Tier ${idx + 1} name cannot be empty`);
      }
      let paise: number;
      try {
        paise = rupeeToPaise(tier.priceRupees);
      } catch (err: any) {
        throw new Error(`Tier "${tier.name}": ${err.message}`);
      }
      if (paise <= 0) {
        throw new Error(`Tier "${tier.name}" must have price greater than ₹0`);
      }
      if (tier.capacity < 1) {
        throw new Error(`Tier "${tier.name}" capacity must be at least 1`);
      }
      sumCapacity += tier.capacity;
      return {
        name: tier.name.trim(),
        pricePaise: paise,
        capacity: tier.capacity,
        perUserLimit: tier.perUserLimit || 5,
      };
    });

    if (sumCapacity > overallCapacity) {
      throw new Error(
        `Sum of tier capacities (${sumCapacity}) exceeds event capacity (${overallCapacity})`
      );
    }

    return mapped;
  };

  // Step Navigations
  const handleStep1Next = detailsForm.handleSubmit(() => {
    setConflictWarning(null);
    setCurrentStep(2);
  });

  const handleStep2Next = scheduleForm.handleSubmit((values) => {
    const start = new Date(values.startsAt);
    const end = new Date(values.endsAt);
    if (end <= start) {
      scheduleForm.setError('endsAt', {
        message: 'End time must be strictly after start time',
      });
      return;
    }
    setConflictWarning(null);
    setCurrentStep(3);
  });

  // Server-Side Draft Autosave (Rule 5: No localStorage)
  const saveDraftToServer = async (silent = false) => {
    const details = detailsForm.getValues();
    if (!details.title || details.title.trim().length < 3) {
      if (!silent) {
        toast({
          title: 'Title Required',
          message: 'Please provide an event title of at least 3 characters before saving a draft.',
          type: 'warning',
        });
      }
      return;
    }

    setIsSavingDraft(true);
    const schedule = scheduleForm.getValues();
    const capacityValues = capacityForm.getValues();
    const organizerId = user?.organizerMemberships?.[0]?.organizerId;

    const tagList = details.tags
      ? details.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    let tiersPayload: any[] = [];
    try {
      tiersPayload = buildTicketTiersPayload(capacityValues.capacity || 100);
    } catch {
      // In draft mode, fall back to safe tier
      tiersPayload = [
        {
          name: pricingType === 'free' ? 'Free Admission' : 'General Admission',
          pricePaise: pricingType === 'free' ? 0 : 10000,
          capacity: capacityValues.capacity || 100,
          perUserLimit: 2,
        },
      ];
    }

    const payload: any = {
      organizerId,
      title: details.title,
      description: details.description || 'Draft event description pending organizer completion.',
      category: details.category || 'AI & Robotics',
      department: details.department || 'Computer Science',
      format: details.format || 'in_person',
      tags: tagList,
      contactEmail: details.contactEmail || user?.email || 'organizer@campus.edu',
      venueId: details.format !== 'online' ? (schedule.venueId || null) : null,
      startsAt: schedule.startsAt
        ? new Date(schedule.startsAt).toISOString()
        : new Date(Date.now() + 86400000).toISOString(),
      endsAt: schedule.endsAt
        ? new Date(schedule.endsAt).toISOString()
        : new Date(Date.now() + 90000000).toISOString(),
      capacity: capacityValues.capacity || 100,
      pricingType,
      currency,
      ticketTiers: tiersPayload,
      visibility: 'public',
      teamMode: capacityValues.teamMode || 'none',
      teamMin: capacityValues.teamMin || 1,
      teamMax: capacityValues.teamMax || 4,
    };

    if (capacityValues.registrationOpensAt) {
      payload.registrationOpensAt = new Date(capacityValues.registrationOpensAt).toISOString();
    }
    if (capacityValues.registrationClosesAt) {
      payload.registrationClosesAt = new Date(capacityValues.registrationClosesAt).toISOString();
    }

    try {
      if (createdDraftId) {
        // Update existing draft on server
        await apiClient<any>(`/api/v1/events/${createdDraftId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        if (!silent) {
          toast({
            title: 'Draft Updated',
            message: `Draft "${details.title}" updated on server.`,
            type: 'info',
          });
        }
      } else {
        // Create initial draft on server
        const res = await apiClient<any>('/api/v1/events', {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify(payload),
        });
        const eventId = res?.event?.id || res?.data?.event?.id;
        if (eventId) {
          setCreatedDraftId(eventId);
          if (!silent) {
            toast({
              title: 'Draft Saved on Server',
              message: `Draft created with ID: ${eventId.substring(0, 8)}...`,
              type: 'success',
            });
          }
        }
      }
    } catch (err: any) {
      if (!silent) {
        toast({
          title: 'Draft Save Failed',
          message: err.message || 'Unable to save draft to server.',
          type: 'error',
        });
      }
    } finally {
      setIsSavingDraft(false);
    }
  };

  const selectedVenueId = scheduleForm.watch('venueId');
  const selectedVenue = venues.find((v) => v.id === selectedVenueId);

  // Final Submit Handler
  const handleFinalSubmit = capacityForm.handleSubmit(async (capValues) => {
    setPricingError(null);
    setConflictWarning(null);

    // Validate pricing and ticket tiers
    let tiersPayload: any[] = [];
    try {
      tiersPayload = buildTicketTiersPayload(capValues.capacity);
    } catch (err: any) {
      setPricingError(err.message || 'Invalid pricing configuration');
      return;
    }

    // Cross-validate registration window if specified
    if (capValues.registrationOpensAt && capValues.registrationClosesAt) {
      const opens = new Date(capValues.registrationOpensAt);
      const closes = new Date(capValues.registrationClosesAt);
      if (closes <= opens) {
        capacityForm.setError('registrationClosesAt', {
          message: 'Registration closing time must be strictly after opening time',
        });
        return;
      }
      const ends = new Date(scheduleForm.getValues('endsAt'));
      if (closes > ends) {
        capacityForm.setError('registrationClosesAt', {
          message: 'Registration closing time cannot be after event end time',
        });
        return;
      }
    }

    // Validate team constraints
    if (capValues.teamMode !== 'none' && capValues.teamMin > capValues.teamMax) {
      capacityForm.setError('teamMin', {
        message: 'Minimum team size cannot exceed maximum team size',
      });
      return;
    }

    setIsSubmitting(true);
    const details = detailsForm.getValues();
    const schedule = scheduleForm.getValues();
    const organizerId = user?.organizerMemberships?.[0]?.organizerId;

    const tagList = details.tags
      ? details.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    const payload = {
      organizerId,
      title: details.title,
      description: details.description,
      category: details.category,
      department: details.department,
      format: details.format,
      tags: tagList,
      contactEmail: details.contactEmail || user?.email || 'organizer@campus.edu',
      venueId: details.format !== 'online' ? (schedule.venueId || null) : null,
      startsAt: new Date(schedule.startsAt).toISOString(),
      endsAt: new Date(schedule.endsAt).toISOString(),
      capacity: capValues.capacity,
      pricingType,
      currency,
      ticketTiers: tiersPayload,
      registrationOpensAt: capValues.registrationOpensAt
        ? new Date(capValues.registrationOpensAt).toISOString()
        : null,
      registrationClosesAt: capValues.registrationClosesAt
        ? new Date(capValues.registrationClosesAt).toISOString()
        : null,
      teamMode: capValues.teamMode,
      teamMin: capValues.teamMin,
      teamMax: capValues.teamMax,
      visibility: 'public' as const,
    };

    try {
      let eventId = createdDraftId;

      if (!eventId) {
        const res = await apiClient<any>('/api/v1/events', {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify(payload),
          timeoutMs: 60000,
        });
        eventId = res?.event?.id || res?.data?.event?.id;
        if (eventId) setCreatedDraftId(eventId);
      } else {
        await apiClient<any>(`/api/v1/events/${eventId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
          timeoutMs: 60000,
        });
      }

      toast({
        title: 'Draft Saved',
        message: `Event proposal "${details.title}" successfully recorded.`,
        type: 'success',
      });

      // Submit for review
      try {
        await apiClient(`/api/v1/events/${eventId}/submit`, {
          method: 'POST',
          body: JSON.stringify({}),
          timeoutMs: 60000,
        });
        toast({
          title: 'Submitted for Faculty Review',
          message: 'Your event proposal has been queued for faculty approval.',
          type: 'success',
        });
      } catch (submitErr) {
        if (submitErr instanceof ApiError && submitErr.code === 'VENUE_CONFLICT') {
          setConflictWarning(
            'Venue booking conflict: The requested venue is already booked during this time window. Please change venue or timing.'
          );
          return;
        }
      }

      if (eventId) {
        onSuccess(eventId);
      }
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'VENUE_CONFLICT') {
        setConflictWarning(
          'PostgreSQL GiST Overlap Check: The selected venue is already occupied during this time window. Please pick a different slot or hall.'
        );
      } else {
        toast({
          title: 'Proposal Submission Error',
          message: err.message || 'Failed to submit event proposal.',
          type: 'error',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-text mb-2 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
          </button>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text">
            Create Campus Event Proposal
          </h1>
          <p className="text-xs sm:text-sm text-text-muted mt-0.5">
            Step-by-step proposal wizard with server autosave, Free/Paid pricing controls, and faculty review routing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isSavingDraft}
            onClick={() => saveDraftToServer(false)}
            className="flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            {isSavingDraft ? 'Saving Draft...' : 'Save Draft'}
          </Button>
        </div>
      </div>

      {/* Unauthenticated Guest Alert */}
      {!isAuthenticated && (
        <div role="alert" className="p-3.5 rounded-lg bg-warning/10 border border-warning/30 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-4 h-4 text-warning shrink-0" />
            <div>
              <p className="font-semibold text-text">Organizer Sign-In Required</p>
              <p className="text-text-muted">
                You are currently browsing as a guest. Please sign in with an active club organizer account to submit proposals for faculty review.
              </p>
            </div>
          </div>
          <Button size="sm" variant="primary" onClick={() => (window.location.href = '/login')}>
            Sign In
          </Button>
        </div>
      )}

      {/* Authenticated Student Notice */}
      {isAuthenticated && !isOrganizerOrAdmin && (
        <div role="alert" className="p-3.5 rounded-lg bg-warning/10 border border-warning/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-4 h-4 text-warning shrink-0" />
            <div>
              <p className="font-semibold text-text">Organizer Club Membership Required</p>
              <p className="text-text-muted">
                You are currently signed in as <span className="font-mono text-text">{user?.email}</span> (Student). Event proposals require an active club organizer role.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              const res = await login('organizer.ras@campus.edu', 'Organizer@123');
              if (res.success) {
                toast({
                  title: 'Switched to Organizer Account',
                  message: 'Logged in as Robotics & Automation Society Organizer.',
                  type: 'success',
                });
              } else {
                toast({
                  title: 'Switch Failed',
                  message: res.error || 'Please login with organizer credentials manually.',
                  type: 'error',
                });
              }
            }}
          >
            Switch to Organizer
          </Button>
        </div>
      )}

      {/* Wizard Step Stepper */}
      <div className="flex items-center justify-between bg-surface border border-border rounded-lg p-3 sm:p-4 text-xs">
        <div className={`flex items-center gap-2 ${currentStep >= 1 ? 'text-brand font-semibold' : 'text-text-muted'}`}>
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
            currentStep >= 1 ? 'bg-brand text-white' : 'bg-surface-2 text-text-muted border border-border'
          }`}>
            1
          </div>
          <span className="hidden sm:inline">Event Details</span>
        </div>
        <div className="w-8 sm:w-16 h-0.5 bg-border" />
        <div className={`flex items-center gap-2 ${currentStep >= 2 ? 'text-brand font-semibold' : 'text-text-muted'}`}>
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
            currentStep >= 2 ? 'bg-brand text-white' : 'bg-surface-2 text-text-muted border border-border'
          }`}>
            2
          </div>
          <span className="hidden sm:inline">Schedule & Venue</span>
        </div>
        <div className="w-8 sm:w-16 h-0.5 bg-border" />
        <div className={`flex items-center gap-2 ${currentStep >= 3 ? 'text-brand font-semibold' : 'text-text-muted'}`}>
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
            currentStep >= 3 ? 'bg-brand text-white' : 'bg-surface-2 text-text-muted border border-border'
          }`}>
            3
          </div>
          <span className="hidden sm:inline">Capacity, Pricing & Rules</span>
        </div>
      </div>

      {conflictWarning && (
        <div className="p-4 rounded-md bg-warning/10 border border-warning/30 text-warning text-xs flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm">Venue Conflict Detected (SQLSTATE 23P01)</p>
            <p className="mt-0.5 leading-relaxed">{conflictWarning}</p>
          </div>
        </div>
      )}

      {/* Step 1: Details */}
      {currentStep === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Info className="w-4 h-4 text-brand" /> Step 1: Basic Event Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-text block mb-1">
                Event Title <span className="text-error">*</span>
              </label>
              <Input
                placeholder="e.g. Smart Campus AI & Robotics Symposium 2026"
                {...detailsForm.register('title')}
                error={detailsForm.formState.errors.title?.message}
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-text block mb-1">
                Description & Agenda <span className="text-error">*</span>
              </label>
              <textarea
                rows={4}
                placeholder="Detailed event description, guest speakers, key takeaways, and prerequisites..."
                className="w-full bg-surface border border-border rounded-md p-3 text-xs text-text focus:outline-none focus:ring-2 focus:ring-brand"
                {...detailsForm.register('description')}
              />
              {detailsForm.formState.errors.description && (
                <p className="text-[11px] text-error mt-1">{detailsForm.formState.errors.description.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-text block mb-1">Category</label>
                <select
                  className="w-full bg-surface border border-border rounded-md px-3 py-2 text-xs text-text focus:outline-none focus:ring-2 focus:ring-brand"
                  {...detailsForm.register('category')}
                >
                  <option value="AI & Robotics">AI & Robotics</option>
                  <option value="Hackathon">Hackathon</option>
                  <option value="Cultural Fest">Cultural Fest</option>
                  <option value="Workshop">Workshop</option>
                  <option value="Sports">Sports</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-text block mb-1">Department</label>
                <select
                  className="w-full bg-surface border border-border rounded-md px-3 py-2 text-xs text-text focus:outline-none focus:ring-2 focus:ring-brand"
                  {...detailsForm.register('department')}
                >
                  <option value="Computer Science">Computer Science</option>
                  <option value="Electronics">Electronics</option>
                  <option value="Mechanical">Mechanical</option>
                  <option value="Biotech">Biotech</option>
                  <option value="Student Affairs">Student Affairs</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-text block mb-1">Format</label>
                <select
                  className="w-full bg-surface border border-border rounded-md px-3 py-2 text-xs text-text focus:outline-none focus:ring-2 focus:ring-brand"
                  {...detailsForm.register('format')}
                >
                  <option value="in_person">In-Person Campus</option>
                  <option value="online">Online / Virtual</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-text block mb-1">Tags (comma-separated)</label>
                <Input
                  placeholder="ai, robotics, competition, certificates"
                  {...detailsForm.register('tags')}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-text block mb-1">Contact Email</label>
                <Input
                  placeholder="organizer@campus.edu"
                  {...detailsForm.register('contactEmail')}
                  error={detailsForm.formState.errors.contactEmail?.message}
                />
              </div>
            </div>

            <div className="flex justify-end pt-3">
              <Button variant="primary" size="md" onClick={handleStep1Next} className="flex items-center gap-1.5">
                Next: Venue & Schedule <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Schedule & Venue */}
      {currentStep === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="w-4 h-4 text-brand" /> Step 2: Schedule & Campus Venue Booking
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-text block mb-1">
                  Event Starts At <span className="text-brand font-medium">(IST / Indian Standard Time, UTC+5:30)</span> <span className="text-error">*</span>
                </label>
                <Input
                  type="datetime-local"
                  {...scheduleForm.register('startsAt')}
                  error={scheduleForm.formState.errors.startsAt?.message}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-text block mb-1">
                  Event Ends At <span className="text-brand font-medium">(IST / Indian Standard Time, UTC+5:30)</span> <span className="text-error">*</span>
                </label>
                <Input
                  type="datetime-local"
                  {...scheduleForm.register('endsAt')}
                  error={scheduleForm.formState.errors.endsAt?.message}
                />
              </div>
            </div>

            {detailsForm.watch('format') !== 'online' && (
              <div className="space-y-3 pt-2">
                <label className="text-xs font-semibold text-text block">
                  Select Campus Venue (PostgreSQL GiST Overlap Protection)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {venues.map((venue) => {
                    const isSelected = selectedVenueId === venue.id;
                    return (
                      <div
                        key={venue.id}
                        onClick={() => scheduleForm.setValue('venueId', venue.id)}
                        className={`p-3.5 rounded-lg border cursor-pointer transition-all ${
                          isSelected
                            ? 'border-brand bg-brand/5 ring-2 ring-brand/20'
                            : 'border-border bg-surface hover:border-brand/40'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-xs text-text">{venue.name}</p>
                          <Badge variant={isSelected ? 'brand' : 'neutral'} size="sm">
                            Cap: {venue.capacity}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-text-muted mt-1 flex items-center gap-1">
                          <Building className="w-3 h-3" /> {venue.building}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {selectedVenue && (
                  <div className="p-3 bg-surface-2 rounded-md border border-border text-xs flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-text">{selectedVenue.name}</p>
                      <p className="text-[11px] text-text-muted">
                        Max Seating Capacity: {selectedVenue.capacity} attendees • Wheelchair Accessible
                      </p>
                    </div>
                    <Badge variant="success" size="sm">GiST Pre-Check Ready</Badge>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t border-border">
              <Button variant="outline" size="md" onClick={() => setCurrentStep(1)} className="flex items-center gap-1.5">
                <ArrowLeft className="w-4 h-4" /> Previous
              </Button>
              <Button variant="primary" size="md" onClick={handleStep2Next} className="flex items-center gap-1.5">
                Next: Capacity & Registration <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Capacity, Pricing Model & Rules */}
      {currentStep === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-brand" /> Step 3: Capacity, Pricing Model & Registration Rules
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Attendee Capacity */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-semibold text-text block mb-1">
                  Attendee Capacity <span className="text-error">*</span>
                </label>
                <Input
                  type="number"
                  min={1}
                  max={50000}
                  {...capacityForm.register('capacity')}
                  error={capacityForm.formState.errors.capacity?.message}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-text block mb-1">
                  Registration Opens At <span className="text-brand font-medium text-[10px]">(IST)</span>
                </label>
                <Input
                  type="datetime-local"
                  {...capacityForm.register('registrationOpensAt')}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-text block mb-1">
                  Registration Closes At <span className="text-brand font-medium text-[10px]">(IST)</span>
                </label>
                <Input
                  type="datetime-local"
                  {...capacityForm.register('registrationClosesAt')}
                  error={capacityForm.formState.errors.registrationClosesAt?.message}
                />
              </div>
            </div>

            {/* MANDATORY FREE / PAID SEGMENTED CONTROL */}
            <div className="p-4 bg-surface-2 rounded-xl border border-border space-y-4">
              <div>
                <label className="text-xs font-bold text-text block mb-1">
                  Event Pricing Model <span className="text-error">*</span>
                </label>
                <p className="text-[11px] text-text-muted mb-3">
                  Specify whether attendance is complimentary or requires ticket purchase in INR (Paise stored integer).
                </p>

                <div className="grid grid-cols-2 gap-3 p-1.5 bg-surface rounded-lg border border-border">
                  <button
                    type="button"
                    onClick={() => {
                      setPricingType('free');
                      setPricingError(null);
                    }}
                    className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-xs font-semibold transition-all ${
                      pricingType === 'free'
                        ? 'bg-brand text-white shadow-sm'
                        : 'text-text-muted hover:text-text hover:bg-surface-2'
                    }`}
                  >
                    <span>[ Free ]</span> Free Registration
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPricingType('paid');
                      setPricingError(null);
                    }}
                    className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-xs font-semibold transition-all ${
                      pricingType === 'paid'
                        ? 'bg-brand text-white shadow-sm'
                        : 'text-text-muted hover:text-text hover:bg-surface-2'
                    }`}
                  >
                    <IndianRupee className="w-3.5 h-3.5" />
                    <span>[ Paid ]</span> Paid / Ticketed Event
                  </button>
                </div>
              </div>

              {/* Free Mode Info */}
              {pricingType === 'free' && (
                <div className="p-3 bg-brand/5 border border-brand/20 rounded-lg text-xs flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-brand shrink-0" />
                  <p className="text-text-muted">
                    <strong className="text-text">Free Event:</strong> Attendees can register instantly. No payment gateway or checkout simulator required.
                  </p>
                </div>
              )}

              {/* Paid Mode Controls */}
              {pricingType === 'paid' && (
                <div className="space-y-4 pt-2 border-t border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-text">Ticket Pricing & Tiers</p>
                      <p className="text-[11px] text-text-muted">
                        Currency is standardized to <span className="font-semibold text-text">INR (₹)</span>. Stored as integer paise.
                      </p>
                    </div>
                    <Badge variant="brand" size="sm">
                      Allowed Currency: {currency}
                    </Badge>
                  </div>

                  {/* Custom Tiers Toggle */}
                  <div className="flex items-center justify-between p-2.5 bg-surface rounded-md border border-border text-xs">
                    <span className="text-text font-medium">Use Multiple Ticket Tiers (e.g., Early Bird, VIP)</span>
                    <button
                      type="button"
                      onClick={() => setCustomTiersEnabled(!customTiersEnabled)}
                      className={`text-xs px-3 py-1 rounded font-medium transition-colors ${
                        customTiersEnabled
                          ? 'bg-brand text-white'
                          : 'bg-surface-2 border border-border text-text hover:border-brand/40'
                      }`}
                    >
                      {customTiersEnabled ? 'Enabled' : 'Single Price'}
                    </button>
                  </div>

                  {/* Single Ticket Price Input */}
                  {!customTiersEnabled && (
                    <div className="p-3 bg-surface rounded-lg border border-border space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                        <div>
                          <label className="text-xs font-semibold text-text block mb-1">
                            Ticket Price (₹ INR) <span className="text-error">*</span>
                          </label>
                          <div className="relative">
                            <span className="absolute left-3 top-2.5 text-xs text-text-muted font-bold">₹</span>
                            <input
                              type="text"
                              value={singlePriceRupees}
                              onChange={(e) => setSinglePriceRupees(e.target.value)}
                              placeholder="250"
                              className="w-full bg-surface border border-border rounded-md pl-7 pr-3 py-2 text-xs text-text focus:outline-none focus:ring-2 focus:ring-brand"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-text block mb-1">
                            Calculated Integer Paise
                          </label>
                          <div className="py-2 px-3 bg-surface-2 rounded-md border border-border text-xs">
                            {(() => {
                              const { paise, error } = getSinglePricePaiseSafe();
                              if (error) {
                                return <span className="text-error font-medium">{error}</span>;
                              }
                              return (
                                <span className="text-brand font-mono font-bold">
                                  {paise?.toLocaleString('en-IN')} paise ({formatPaiseToRupee(paise || 0)})
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Multiple Tiers Builder */}
                  {customTiersEnabled && (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        {ticketTiers.map((tier) => {
                          let paiseDisplay = '';
                          try {
                            const p = rupeeToPaise(tier.priceRupees);
                            paiseDisplay = `${p.toLocaleString('en-IN')} paise`;
                          } catch {
                            paiseDisplay = 'Invalid';
                          }

                          return (
                            <div
                              key={tier.id}
                              className="p-3 bg-surface rounded-lg border border-border grid grid-cols-12 gap-2 items-center text-xs"
                            >
                              <div className="col-span-12 sm:col-span-4">
                                <label className="text-[10px] text-text-muted block">Tier Name</label>
                                <input
                                  type="text"
                                  value={tier.name}
                                  onChange={(e) => updateTier(tier.id, 'name', e.target.value)}
                                  placeholder="e.g. Early Bird"
                                  className="w-full bg-surface-2 border border-border rounded px-2 py-1 text-xs text-text"
                                />
                              </div>

                              <div className="col-span-6 sm:col-span-3">
                                <label className="text-[10px] text-text-muted block">Price (₹)</label>
                                <input
                                  type="text"
                                  value={tier.priceRupees}
                                  onChange={(e) => updateTier(tier.id, 'priceRupees', e.target.value)}
                                  placeholder="150"
                                  className="w-full bg-surface-2 border border-border rounded px-2 py-1 text-xs text-text"
                                />
                                <span className="text-[10px] text-brand font-mono">{paiseDisplay}</span>
                              </div>

                              <div className="col-span-4 sm:col-span-3">
                                <label className="text-[10px] text-text-muted block">Capacity</label>
                                <input
                                  type="number"
                                  min={1}
                                  value={tier.capacity}
                                  onChange={(e) => updateTier(tier.id, 'capacity', parseInt(e.target.value, 10) || 0)}
                                  className="w-full bg-surface-2 border border-border rounded px-2 py-1 text-xs text-text"
                                />
                              </div>

                              <div className="col-span-2 sm:col-span-2 flex justify-end pt-3">
                                <button
                                  type="button"
                                  onClick={() => removeTier(tier.id)}
                                  className="p-1.5 text-text-muted hover:text-error rounded hover:bg-error/10 transition-colors"
                                  title="Remove tier"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={addTier}
                          className="flex items-center gap-1.5 text-xs"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add Tier
                        </Button>

                        <div className="text-[11px] text-text-muted">
                          Total Tier Capacity:{' '}
                          <span className="font-semibold text-text">
                            {ticketTiers.reduce((acc, t) => acc + (t.capacity || 0), 0)}
                          </span>{' '}
                          / {capacityForm.watch('capacity')} max
                        </div>
                      </div>
                    </div>
                  )}

                  {pricingError && (
                    <div className="p-2.5 rounded bg-error/10 border border-error/30 text-error text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{pricingError}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Team Participation Mode */}
            <div className="p-3.5 bg-surface-2 rounded-lg border border-border space-y-3">
              <label className="text-xs font-semibold text-text block">Team Participation Mode</label>
              <div className="grid grid-cols-3 gap-2">
                {(['none', 'optional', 'required'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => capacityForm.setValue('teamMode', mode)}
                    className={`p-2.5 rounded-md border text-xs font-medium capitalize transition-colors ${
                      capacityForm.watch('teamMode') === mode
                        ? 'bg-brand text-white border-brand'
                        : 'bg-surface text-text border-border hover:bg-surface-2'
                    }`}
                  >
                    {mode === 'none' ? 'Solo Only' : mode === 'optional' ? 'Solo or Team' : 'Team Required'}
                  </button>
                ))}
              </div>

              {capacityForm.watch('teamMode') !== 'none' && (
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="text-xs font-semibold text-text block mb-1">Min Team Size</label>
                    <Input type="number" min={1} max={10} {...capacityForm.register('teamMin')} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text block mb-1">Max Team Size</label>
                    <Input type="number" min={2} max={10} {...capacityForm.register('teamMax')} />
                  </div>
                </div>
              )}
            </div>

            {/* Proposal Summary Card */}
            <div className="p-4 bg-brand/5 border border-brand/20 rounded-lg text-xs space-y-2">
              <div className="flex items-center justify-between font-semibold text-text">
                <span>Summary Review</span>
                <Badge variant={pricingType === 'paid' ? 'brand' : 'success'} size="sm">
                  {pricingType === 'paid' ? 'Paid / Ticketed' : 'Free Registration'}
                </Badge>
              </div>
              <p className="text-text-muted">
                <strong>Event:</strong> {detailsForm.watch('title') || 'Untitled Event'}
              </p>
              <p className="text-text-muted">
                <strong>Pricing Model:</strong>{' '}
                {pricingType === 'free'
                  ? 'Complimentary (₹0)'
                  : !customTiersEnabled
                  ? `Single Tier at ₹${singlePriceRupees} INR (${getSinglePricePaiseSafe().paise || 0} paise)`
                  : `${ticketTiers.length} custom tiers defined`}
              </p>
              <p className="text-text-muted">
                <strong>Department / Category:</strong> {detailsForm.watch('department')} • {detailsForm.watch('category')}
              </p>
              <p className="text-text-muted">
                <strong>Venue:</strong> {selectedVenue?.name || 'TBD'} (Cap: {capacityForm.watch('capacity')})
              </p>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-border">
              <Button variant="outline" size="md" onClick={() => setCurrentStep(2)} className="flex items-center gap-1.5">
                <ArrowLeft className="w-4 h-4" /> Previous
              </Button>
              <Button
                variant="primary"
                size="md"
                disabled={isSubmitting}
                onClick={handleFinalSubmit}
                className="flex items-center gap-1.5"
              >
                <Send className="w-4 h-4" />
                {isSubmitting ? 'Submitting Proposal...' : 'Submit Proposal for Faculty Review'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
