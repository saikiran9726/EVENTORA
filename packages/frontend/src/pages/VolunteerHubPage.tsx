import React, { useState, useEffect } from 'react';
import {
  HeartHandshake,
  Calendar,
  Clock,
  MapPin,
  CheckCircle,
  Award,
  Send,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';

export interface OpenShiftItem {
  id: string;
  roleId: string;
  roleTitle: string;
  requirements: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  assigned: number;
  venueName: string;
  eventTitle: string;
}

export interface MyVolunteerShift {
  applicationId: string;
  shiftId: string;
  status: 'APPLIED' | 'APPROVED' | 'ASSIGNED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' | 'REJECTED';
  roleTitle: string;
  eventTitle: string;
  startsAt: string;
  endsAt: string;
  venueName: string;
  appliedAt: string;
}

export const VolunteerHubPage: React.FC = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'browse' | 'myshifts'>('myshifts');
  const [totalHours, setTotalHours] = useState(12.5);
  const [isApplying, setIsApplying] = useState<string | null>(null);
  const [isCheckedIn, setIsCheckedIn] = useState<Record<string, boolean>>({});

  const [openShifts] = useState<OpenShiftItem[]>([
    {
      id: 'shift-demo-1',
      roleId: 'role-demo-1',
      roleTitle: 'Stage & Track Usher',
      requirements: 'Welcome guests, check digital badges, direct to seating blocks.',
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 86400000 + 4 * 3600000).toISOString(),
      capacity: 6,
      assigned: 4,
      venueName: 'Sir MV Auditorium Hall A',
      eventTitle: 'Smart Campus AI & Robotics Symposium 2026',
    },
    {
      id: 'shift-demo-2',
      roleId: 'role-demo-2',
      roleTitle: 'Turnstile Scanner Assistant',
      requirements: 'Assist entrance scanner staff with optical device alignment and attendee flow.',
      startsAt: new Date(Date.now() + 172800000).toISOString(),
      endsAt: new Date(Date.now() + 172800000 + 3 * 3600000).toISOString(),
      capacity: 4,
      assigned: 1,
      venueName: 'North Gate Entrance Hub',
      eventTitle: 'Autonomous Robotics Workshop',
    },
  ]);

  const [myShifts, setMyShifts] = useState<MyVolunteerShift[]>([
    {
      applicationId: 'app-demo-1',
      shiftId: 'shift-demo-active',
      status: 'ASSIGNED',
      roleTitle: 'Lead Event Ambassador',
      eventTitle: 'Smart Campus AI & Robotics Symposium 2026',
      startsAt: new Date(Date.now() - 10 * 60000).toISOString(), // Started 10 min ago (inside window!)
      endsAt: new Date(Date.now() + 3 * 3600000).toISOString(),
      venueName: 'Main Entrance & Registration Desk',
      appliedAt: '2026-10-20T10:00:00Z',
    },
    {
      applicationId: 'app-demo-2',
      shiftId: 'shift-demo-future',
      status: 'APPROVED',
      roleTitle: 'AV Equipment Coordinator',
      eventTitle: 'Autonomous Drone Derby',
      startsAt: new Date(Date.now() + 2 * 86400000).toISOString(), // In 2 days (outside window)
      endsAt: new Date(Date.now() + 2 * 86400000 + 4 * 3600000).toISOString(),
      venueName: 'Outdoor Arena Ground B',
      appliedAt: '2026-10-21T08:30:00Z',
    },
  ]);

  useEffect(() => {
    async function loadVolunteeringData() {
      try {
        const token = localStorage.getItem('eventora_auth_token');
        if (!token) return;

        const res = await fetch('/api/v1/me/volunteering', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const data = await res.json();
          if (data.volunteering) {
            setTotalHours(data.volunteering.totalHours ?? 12.5);
            if (Array.isArray(data.volunteering.applications) && data.volunteering.applications.length > 0) {
              setMyShifts(data.volunteering.applications);
            }
          }
        }
      } catch {
        // Retain prototype data
      }
    }
    loadVolunteeringData();
  }, []);

  const handleApply = async (shift: OpenShiftItem) => {
    setIsApplying(shift.id);
    try {
      const token = localStorage.getItem('eventora_auth_token');
      if (token && !shift.id.startsWith('shift-demo')) {
        const res = await fetch(`/api/v1/shifts/${shift.id}/applications`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error?.message || 'Application failed');
        }
      }

      toast({
        type: 'success',
        title: 'Volunteer Application Submitted',
        message: `Applied for ${shift.roleTitle}. Shift managers will review and notify you.`,
      });

      // Add to my shifts in applied state
      setMyShifts((prev) => [
        {
          applicationId: `app-usr-${Date.now()}`,
          shiftId: shift.id,
          status: 'APPLIED',
          roleTitle: shift.roleTitle,
          eventTitle: shift.eventTitle,
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
          venueName: shift.venueName,
          appliedAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setActiveTab('myshifts');
    } catch (e: any) {
      toast({
        type: 'error',
        title: 'Application Error',
        message: e.message || 'Could not submit application.',
      });
    } finally {
      setIsApplying(null);
    }
  };

  const handleCheckIn = async (app: MyVolunteerShift) => {
    try {
      const token = localStorage.getItem('eventora_auth_token');
      if (token && !app.applicationId.startsWith('app-demo')) {
        const res = await fetch(`/api/v1/applications/${app.applicationId}/check-in`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error?.message || 'Check-in failed');
        }
      }

      toast({
        type: 'success',
        title: 'Shift Check-In Verified',
        message: 'Turnstile volunteer token accepted. Have a great shift!',
      });

      setIsCheckedIn((prev) => ({ ...prev, [app.applicationId]: true }));
      setMyShifts((prev) =>
        prev.map((s) => (s.applicationId === app.applicationId ? { ...s, status: 'CHECKED_IN' } : s))
      );
    } catch (e: any) {
      toast({
        type: 'error',
        title: 'Check-In Error',
        message: e.message || 'Check-in failed.',
      });
    }
  };

  // Helper: Is current time inside check-in window [startsAt - 15m, endsAt]?
  const checkWindowStatus = (startsAtStr: string, endsAtStr: string) => {
    const now = Date.now();
    const start = new Date(startsAtStr).getTime();
    const end = new Date(endsAtStr).getTime();
    const windowStart = start - 15 * 60 * 1000;

    if (now < windowStart) {
      const minsUntil = Math.ceil((windowStart - now) / 60000);
      return {
        allowed: false,
        reason: `Check-in opens 15m before start (in ${minsUntil > 60 ? `${Math.ceil(minsUntil / 60)}h` : `${minsUntil}m`})`,
      };
    }
    if (now > end) {
      return { allowed: false, reason: 'Shift window has ended' };
    }
    return { allowed: true, reason: 'Window open' };
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text flex items-center gap-2">
            <HeartHandshake className="w-6 h-6 text-brand" />
            <span>Campus Volunteer Hub & Shift Check-In</span>
          </h1>
          <p className="text-xs sm:text-sm text-text-muted mt-1">
            Browse event roles, track deployment schedules, and record verified service hours for your Passport.
          </p>
        </div>

        {/* Verified Hours Card */}
        <div className="flex items-center gap-3 bg-surface-2 p-3 rounded-lg border border-border">
          <div className="p-2 bg-brand/10 text-brand rounded-md">
            <Award className="w-5 h-5 text-brand" />
          </div>
          <div>
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Verified Service
            </span>
            <div className="text-lg font-bold text-text">{totalHours} hrs</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-surface-2 p-1 rounded-lg border border-border w-fit">
        <button
          onClick={() => setActiveTab('myshifts')}
          className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            activeTab === 'myshifts'
              ? 'bg-surface text-text shadow-sm'
              : 'text-text-muted hover:text-text'
          }`}
        >
          My Shifts & Check-In ({myShifts.length})
        </button>
        <button
          onClick={() => setActiveTab('browse')}
          className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            activeTab === 'browse'
              ? 'bg-surface text-text shadow-sm'
              : 'text-text-muted hover:text-text'
          }`}
        >
          Browse Opportunities ({openShifts.length})
        </button>
      </div>

      {/* Tab 1: My Shifts */}
      {activeTab === 'myshifts' && (
        <div className="space-y-4">
          {myShifts.length === 0 ? (
            <Card className="p-8 text-center text-xs text-text-muted">
              You haven&apos;t applied to any volunteer shifts yet. Click &quot;Browse Opportunities&quot; to join upcoming event teams!
            </Card>
          ) : (
            myShifts.map((shift) => {
              const windowCheck = checkWindowStatus(shift.startsAt, shift.endsAt);
              const isChecked = isCheckedIn[shift.applicationId] || shift.status === 'CHECKED_IN';
              const isAssigned = shift.status === 'ASSIGNED';
              const isCompleted = shift.status === 'COMPLETED';

              return (
                <Card key={shift.applicationId} className="p-4 sm:p-5 border border-border space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-bold text-text">{shift.roleTitle}</h2>
                        <Badge
                          variant={
                            isCompleted || isChecked
                              ? 'success'
                              : isAssigned
                              ? 'warning'
                              : shift.status === 'APPROVED'
                              ? 'brand'
                              : 'neutral'
                          }
                          size="sm"
                        >
                          {isChecked ? 'CHECKED IN' : shift.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-brand font-medium mt-0.5">{shift.eventTitle}</p>
                    </div>

                    {/* Check-in CTA */}
                    <div>
                      {isChecked ? (
                        <div className="flex items-center gap-1.5 text-xs text-success font-semibold px-2 py-1 bg-success/10 rounded-md">
                          <CheckCircle className="w-4 h-4" />
                          <span>Active on Duty</span>
                        </div>
                      ) : isAssigned ? (
                        <div className="flex flex-col items-end gap-1">
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={!windowCheck.allowed}
                            onClick={() => handleCheckIn(shift)}
                            className="text-xs"
                          >
                            Check In to Shift
                          </Button>
                          {!windowCheck.allowed && (
                            <span className="text-[10px] text-text-muted font-medium">
                              {windowCheck.reason}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-text-muted italic">
                          {shift.status === 'APPROVED'
                            ? 'Awaiting assignment confirmation'
                            : 'Application under review'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-text-muted pt-2 border-t border-border/60">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-brand" />
                      <span>{new Date(shift.startsAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-brand" />
                      <span>
                        {new Date(shift.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} –{' '}
                        {new Date(shift.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 sm:col-span-2">
                      <MapPin className="w-3.5 h-3.5 text-brand" />
                      <span>{shift.venueName}</span>
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      )}

      {/* Tab 2: Browse Opportunities */}
      {activeTab === 'browse' && (
        <div className="space-y-4">
          {openShifts.map((shift) => {
            const seatsLeft = Math.max(0, shift.capacity - shift.assigned);
            return (
              <Card key={shift.id} className="p-4 sm:p-5 border border-border space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-bold text-text">{shift.roleTitle}</h2>
                    <p className="text-xs text-brand font-medium mt-0.5">{shift.eventTitle}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={seatsLeft > 0 ? 'success' : 'neutral'} size="sm">
                      {seatsLeft > 0 ? `${seatsLeft} seats available` : 'Full'}
                    </Badge>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={seatsLeft === 0 || isApplying === shift.id}
                      onClick={() => handleApply(shift)}
                      className="text-xs flex items-center gap-1"
                    >
                      <Send className="w-3 h-3" />
                      <span>{isApplying === shift.id ? 'Applying...' : 'Apply'}</span>
                    </Button>
                  </div>
                </div>

                <p className="text-xs text-text-muted leading-relaxed">{shift.requirements}</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-text-muted pt-2 border-t border-border/60">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-brand" />
                    <span>{new Date(shift.startsAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-brand" />
                    <span>
                      {new Date(shift.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} –{' '}
                      {new Date(shift.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 sm:col-span-2">
                    <MapPin className="w-3.5 h-3.5 text-brand" />
                    <span>{shift.venueName}</span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
