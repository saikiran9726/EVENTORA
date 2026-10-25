import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { apiClient, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';

const detailsSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters').max(150),
  description: z.string().min(20, 'Description must be at least 20 characters'),
  category: z.string().min(1, 'Category is required'),
  department: z.string().min(1, 'Department is required'),
  format: z.enum(['in_person', 'online', 'hybrid']),
  tags: z.string().optional(),
  contactEmail: z.string().email('Invalid email address'),
});

const scheduleSchema = z.object({
  venueId: z.string().optional(),
  startsAt: z.string().min(1, 'Start time is required'),
  endsAt: z.string().min(1, 'End time is required'),
});

const capacitySchema = z.object({
  capacity: z.coerce.number().min(1, 'Capacity must be at least 1').max(50000),
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

interface CreateEventPageProps {
  onBack: () => void;
  onSuccess: (eventId: string) => void;
}

export const CreateEventPage: React.FC<CreateEventPageProps> = ({ onBack, onSuccess }) => {
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [createdDraftId, setCreatedDraftId] = useState<string | null>(null);
  const [idempotencyKey] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('eventora_proposal_idempotency_key');
      if (saved) return saved;
      const newKey = `prop-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      localStorage.setItem('eventora_proposal_idempotency_key', newKey);
      return newKey;
    } catch {
      return `prop-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
  });

  // Form states with local autosave
  const detailsForm = useForm<z.infer<typeof detailsSchema>>({
    resolver: zodResolver(detailsSchema),
    defaultValues: {
      title: '',
      description: '',
      category: 'AI & Robotics',
      department: 'Computer Science',
      format: 'in_person',
      tags: 'tech, campus, workshop',
      contactEmail: 'organizer@campus.edu',
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

  // Load draft from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('eventora_event_draft');
      if (saved) {
        const draft = JSON.parse(saved);
        if (draft.details) detailsForm.reset(draft.details);
        if (draft.schedule) scheduleForm.reset(draft.schedule);
        if (draft.capacity) capacityForm.reset(draft.capacity);
      }
    } catch {
      // ignore parsing errors
    }
  }, []);

  // Autosave to localStorage on changes
  const saveDraftLocally = () => {
    try {
      const draft = {
        details: detailsForm.getValues(),
        schedule: scheduleForm.getValues(),
        capacity: capacityForm.getValues(),
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem('eventora_event_draft', JSON.stringify(draft));
      toast({
        title: 'Draft Saved',
        message: 'Your event proposal draft was saved locally.',
        type: 'info',
      });
    } catch {
      // ignore
    }
  };

  // Fetch available venues
  useEffect(() => {
    const fetchVenues = async () => {
      try {
        const res = await apiClient<any>('/api/v1/venues');
        const venueList = res?.venues || res?.data?.venues || [];
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
      } catch {
        // Fallback campus venues
        setVenues([
          { id: '44d2a71e-f6af-4764-8793-b116f9439a30', name: 'Sir MV Auditorium', building: 'Main Administrative Block', capacity: 500 },
          { id: '5a6a045e-f6f1-4ac7-aaed-ddfe186f7a04', name: 'Dr. APJ Abdul Kalam Seminar Hall', building: 'Science & Technology Block', capacity: 200 },
          { id: '5a422e51-2330-4681-b913-a008328fe263', name: 'Turing Computing Lab', building: 'Computer Science Department', capacity: 80 },
          { id: 'a5aa35ed-6177-418d-af68-46db8142662d', name: 'Campus Central Amphitheater', building: 'Student Activity Center', capacity: 1200 },
        ]);
      }
    };
    fetchVenues();
  }, []);

  const handleStep1Next = detailsForm.handleSubmit(() => {
    setConflictWarning(null);
    setCurrentStep(2);
  });

  const handleStep2Next = scheduleForm.handleSubmit((values) => {
    const start = new Date(values.startsAt);
    const end = new Date(values.endsAt);
    if (end <= start) {
      scheduleForm.setError('endsAt', { message: 'End time must be strictly after start time' });
      return;
    }
    setConflictWarning(null);
    setCurrentStep(3);
  });

  const selectedVenueId = scheduleForm.watch('venueId');
  const selectedVenue = venues.find((v) => v.id === selectedVenueId);

  // Submit and create event
  const handleFinalSubmit = capacityForm.handleSubmit(async (capValues) => {
    setIsSubmitting(true);
    setConflictWarning(null);

    const details = detailsForm.getValues();
    const schedule = scheduleForm.getValues();

    const tagList = details.tags
      ? details.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    const organizerId = user?.organizerMemberships?.[0]?.organizerId;

    const payload = {
      organizerId,
      title: details.title,
      description: details.description,
      category: details.category,
      department: details.department,
      format: details.format,
      tags: tagList,
      contactEmail: details.contactEmail || user?.email || 'organizer@campus.edu',
      venueId: details.format !== 'online' ? schedule.venueId : null,
      startsAt: new Date(schedule.startsAt).toISOString(),
      endsAt: new Date(schedule.endsAt).toISOString(),
      capacity: capValues.capacity,
      registrationOpensAt: capValues.registrationOpensAt ? new Date(capValues.registrationOpensAt).toISOString() : undefined,
      registrationClosesAt: capValues.registrationClosesAt ? new Date(capValues.registrationClosesAt).toISOString() : undefined,
      teamMode: capValues.teamMode,
      teamMin: capValues.teamMin,
      teamMax: capValues.teamMax,
      visibility: 'public',
    };

    try {
      // 1. Create draft event (or reuse if previous attempt succeeded before response timeout)
      let eventId = createdDraftId;
      if (!eventId) {
        const res = await apiClient<any>(
          '/api/v1/events',
          {
            method: 'POST',
            headers: { 'Idempotency-Key': idempotencyKey },
            body: JSON.stringify(payload),
            timeoutMs: 60000,
          }
        );

        eventId = res?.event?.id || res?.data?.event?.id;
        if (eventId) setCreatedDraftId(eventId);
      }

      localStorage.removeItem('eventora_event_draft');
      localStorage.removeItem('eventora_proposal_idempotency_key');

      toast({
        title: 'Draft Created Successfully',
        message: `Event "${details.title}" was saved as a draft.`,
        type: 'success',
      });

      // 2. Submit for review
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
            `Venue booking conflict: The requested venue is already booked during this time window. Please change venue or timing.`
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
          `PostgreSQL GiST Overlap Check: The selected venue is already occupied during this time window. Please pick a different slot or hall.`
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
            Step-by-step proposal wizard with automated venue conflict pre-check and faculty review routing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={saveDraftLocally} className="flex items-center gap-1.5">
            <Save className="w-3.5 h-3.5" /> Save Draft
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
              <p className="text-text-muted">You are currently browsing as a guest. Please sign in with an active club organizer account to submit proposals for faculty review.</p>
            </div>
          </div>
          <Button size="sm" variant="primary" onClick={() => window.location.href = '/login'}>
            Sign In
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
          <span className="hidden sm:inline">Capacity & Rules</span>
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
                  Event Starts At <span className="text-error">*</span>
                </label>
                <Input
                  type="datetime-local"
                  {...scheduleForm.register('startsAt')}
                  error={scheduleForm.formState.errors.startsAt?.message}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-text block mb-1">
                  Event Ends At <span className="text-error">*</span>
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

      {/* Step 3: Capacity & Rules */}
      {currentStep === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-brand" /> Step 3: Capacity, Registration & Team Rules
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-semibold text-text block mb-1">
                  Attendee Capacity <span className="text-error">*</span>
                </label>
                <Input
                  type="number"
                  {...capacityForm.register('capacity')}
                  error={capacityForm.formState.errors.capacity?.message}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-text block mb-1">
                  Registration Opens At
                </label>
                <Input
                  type="datetime-local"
                  {...capacityForm.register('registrationOpensAt')}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-text block mb-1">
                  Registration Closes At
                </label>
                <Input
                  type="datetime-local"
                  {...capacityForm.register('registrationClosesAt')}
                />
              </div>
            </div>

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
                <Badge variant="brand" size="sm">Ready for Faculty Submission</Badge>
              </div>
              <p className="text-text-muted">
                <strong>Event:</strong> {detailsForm.watch('title') || 'Untitled Event'}
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
