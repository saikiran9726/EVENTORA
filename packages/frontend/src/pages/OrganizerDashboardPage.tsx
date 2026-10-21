import React, { useState, useMemo, useEffect } from 'react';
import {
  Users,
  Download,
  Plus,
  TrendingDown,
  TrendingUp,
  ShieldAlert,
  Star,
  Flag,
  EyeOff,
  Eye,
  CheckCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { PROTOTYPE_ORGANIZER_STATS, PROTOTYPE_ATTENDEES } from '@/prototype/data';
import { formatPaise } from '@/lib/utils';
import { ExportDialog } from '@/components/analytics/ExportDialog';

interface OrganizerDashboardPageProps {
  organizerId?: string;
  onProposeEvent?: () => void;
}

interface LedgerEntry {
  id: string;
  bookingId: string;
  paymentId: string;
  entryType: 'SALE' | 'REFUND';
  amountPaise: number;
  isSimulated: boolean;
  createdAt: string;
}

interface SalesSummary {
  grossPaise: number;
  refundsPaise: number;
  netPaise: number;
  salesCount: number;
  refundsCount: number;
}

interface EventAnalytics {
  kpis: {
    registrations: number;
    confirmed: number;
    cancellations: number;
    waitlistJoined: number;
    waitlistConverted: number;
    checkins: number;
    noShows: number;
    feedbackCount: number;
    ratingAvg: number | null;
    checkinRate: number;
    responseRate: number;
  };
  funnel: Array<{ stage: string; count: number; conversionRate: number }>;
  timeSeries: Array<{ date: string; registrations: number; cumulative: number }>;
  ratingsDistribution: Record<number, number>;
}

interface FeedbackItem {
  id: string;
  attendeeLabel: string;
  rating: number;
  comment: string | null;
  moderationStatus: 'visible' | 'flagged' | 'hidden';
  submittedAt: string;
  editedAt: string | null;
}

export const OrganizerDashboardPage: React.FC<OrganizerDashboardPageProps> = ({
  organizerId = 'org-profile-1',
  onProposeEvent,
}) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'roster' | 'ledger' | 'insights'>('roster');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<'studentName' | 'rollNumber' | 'checkInStatus'>('studentName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState('mock-evt-1');
  const [selectedEventTitle, setSelectedEventTitle] = useState('Smart Campus AI & Robotics Symposium');

  // Insights State
  const [analytics, setAnalytics] = useState<EventAnalytics>({
    kpis: {
      registrations: 142,
      confirmed: 120,
      cancellations: 22,
      waitlistJoined: 18,
      waitlistConverted: 6,
      checkins: 98,
      noShows: 22,
      feedbackCount: 42,
      ratingAvg: 4.6,
      checkinRate: 81.7,
      responseRate: 42.9,
    },
    funnel: [
      { stage: 'Initiated Registrations', count: 142, conversionRate: 100 },
      { stage: 'Confirmed Bookings', count: 120, conversionRate: 84.5 },
      { stage: 'Checked In', count: 98, conversionRate: 81.7 },
      { stage: 'Feedback Submitted', count: 42, conversionRate: 42.9 },
    ],
    timeSeries: [
      { date: '2026-10-15', registrations: 25, cumulative: 25 },
      { date: '2026-10-16', registrations: 40, cumulative: 65 },
      { date: '2026-10-17', registrations: 35, cumulative: 100 },
      { date: '2026-10-18', registrations: 20, cumulative: 120 },
    ],
    ratingsDistribution: { 5: 28, 4: 10, 3: 3, 2: 1, 1: 0 },
  });

  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>([
    {
      id: 'fb-1',
      attendeeLabel: 'Attendee #1',
      rating: 5,
      comment: 'Excellent hands-on session with the robotics lab equipment. Very well structured.',
      moderationStatus: 'visible',
      submittedAt: '2026-10-21T14:30:00Z',
      editedAt: null,
    },
    {
      id: 'fb-2',
      attendeeLabel: 'Attendee #2',
      rating: 4,
      comment: 'Great speaker and pacing, would love more time for the Q&A segment next time.',
      moderationStatus: 'visible',
      submittedAt: '2026-10-21T15:10:00Z',
      editedAt: '2026-10-21T16:00:00Z',
    },
    {
      id: 'fb-3',
      attendeeLabel: 'Attendee #3',
      rating: 5,
      comment: 'The live demo was the highlight of the week! Super smooth digital check-in too.',
      moderationStatus: 'visible',
      submittedAt: '2026-10-21T16:45:00Z',
      editedAt: null,
    },
  ]);

  // Ledger state
  const [salesSummary, setSalesSummary] = useState<SalesSummary>({
    grossPaise: PROTOTYPE_ORGANIZER_STATS.simulatedGrossSalesPaise,
    refundsPaise: 15000,
    netPaise: PROTOTYPE_ORGANIZER_STATS.simulatedGrossSalesPaise - 15000,
    salesCount: 42,
    refundsCount: 1,
  });
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([
    {
      id: 'led-1',
      bookingId: 'bkg-8f92a10c',
      paymentId: 'pay-sim-101',
      entryType: 'SALE',
      amountPaise: 15000,
      isSimulated: true,
      createdAt: '2026-10-21T18:30:00Z',
    },
    {
      id: 'led-2',
      bookingId: 'bkg-5b43e71d',
      paymentId: 'pay-sim-102',
      entryType: 'SALE',
      amountPaise: 25000,
      isSimulated: true,
      createdAt: '2026-10-21T19:00:00Z',
    },
    {
      id: 'led-3',
      bookingId: 'bkg-8f92a10c',
      paymentId: 'pay-sim-101',
      entryType: 'REFUND',
      amountPaise: 15000,
      isSimulated: true,
      createdAt: '2026-10-21T20:15:00Z',
    },
  ]);

  // Fetch real ledger from backend if authenticated
  useEffect(() => {
    async function loadLedger() {
      try {
        const token = localStorage.getItem('eventora_auth_token');
        if (!token) return;
        const headers = { Authorization: `Bearer ${token}` };

        const [salesRes, ledgerRes] = await Promise.all([
          fetch(`/api/v1/organizers/${organizerId}/sales`, { headers }),
          fetch(`/api/v1/organizers/${organizerId}/ledger`, { headers }),
        ]);

        if (salesRes.ok) {
          const sData = await salesRes.json();
          setSalesSummary({
            grossPaise: sData.grossPaise ?? 0,
            refundsPaise: sData.refundsPaise ?? 0,
            netPaise: sData.netPaise ?? 0,
            salesCount: sData.salesCount ?? 0,
            refundsCount: sData.refundsCount ?? 0,
          });
        }

        if (ledgerRes.ok) {
          const lData = await ledgerRes.json();
          if (Array.isArray(lData.ledger)) {
            setLedgerEntries(lData.ledger);
          }
        }
      } catch {
        // Retain prototype data if offline or non-live
      }
    }
    loadLedger();
  }, [organizerId]);

  // Fetch real analytics and feedback when on insights tab
  useEffect(() => {
    if (activeTab !== 'insights') return;

    async function loadInsights() {
      try {
        const token = localStorage.getItem('eventora_auth_token');
        if (!token) return;
        const headers = { Authorization: `Bearer ${token}` };

        const [analyticsRes, feedbackRes] = await Promise.all([
          fetch(`/api/v1/organizer/events/${selectedEventId}/analytics`, { headers }),
          fetch(`/api/v1/organizer/events/${selectedEventId}/feedback`, { headers }),
        ]);

        if (analyticsRes.ok) {
          const aData = await analyticsRes.json();
          if (aData.analytics) {
            setAnalytics(aData.analytics);
          }
        }

        if (feedbackRes.ok) {
          const fData = await feedbackRes.json();
          if (Array.isArray(fData.feedback)) {
            setFeedbackList(fData.feedback);
          }
        }
      } catch {
        // Retain fallback prototype analytics
      }
    }

    loadInsights();
  }, [activeTab, selectedEventId]);

  const handleModerateFeedback = async (feedbackId: string, status: 'visible' | 'flagged' | 'hidden') => {
    try {
      const token = localStorage.getItem('eventora_auth_token');

      if (!token || feedbackId.startsWith('fb-')) {
        toast({
          type: 'success',
          title: 'Review Moderated',
          message: `Feedback status set to ${status}.`,
        });
        setFeedbackList((prev) =>
          prev.map((f) => (f.id === feedbackId ? { ...f, moderationStatus: status } : f))
        );
        return;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      };

      const res = await fetch(`/api/v1/feedback/${feedbackId}/moderate`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ status }),
      });

      if (res.ok) {
        toast({
          type: 'success',
          title: 'Review Moderated',
          message: `Feedback status set to ${status}.`,
        });
        setFeedbackList((prev) =>
          prev.map((f) => (f.id === feedbackId ? { ...f, moderationStatus: status } : f))
        );
      } else {
        toast({
          type: 'error',
          title: 'Moderation Error',
          message: 'Could not update feedback moderation status.',
        });
      }
    } catch {
      toast({
        type: 'error',
        title: 'Network Error',
        message: 'Could not connect to server.',
      });
    }
  };

  const handleSort = (field: 'studentName' | 'rollNumber' | 'checkInStatus') => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedAttendees = useMemo(() => {
    return [...PROTOTYPE_ATTENDEES]
      .filter(
        (att) =>
          att.studentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          att.rollNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
          att.ticketId.toLowerCase().includes(searchTerm.toLowerCase())
      )
      .sort((a, b) => {
        const valA = a[sortField];
        const valB = b[sortField];
        const comp = valA.localeCompare(valB);
        return sortDirection === 'asc' ? comp : -comp;
      });
  }, [searchTerm, sortField, sortDirection]);

  return (
    <div className="space-y-6">
      {/* Test Mode Notification */}
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-500" />
          <span className="font-semibold text-amber-500">
            TEST MODE LEDGER – All financial figures are simulated integer paise.
          </span>
        </div>
        <Badge variant="warning" size="sm">
          is_simulated = true
        </Badge>
      </div>

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text">
            Club Organizer Command Center & Analytics
          </h1>
          <p className="text-xs sm:text-sm text-text-muted mt-1">
            Robotics & Automation Society (RAS) • Scoped Policy: analytics:view:owned
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Tab Switcher */}
          <div className="flex bg-surface-2 p-1 rounded-lg border border-border">
            <button
              onClick={() => setActiveTab('roster')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'roster'
                  ? 'bg-surface text-text shadow-sm'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              Attendee Roster
            </button>
            <button
              onClick={() => setActiveTab('insights')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'insights'
                  ? 'bg-surface text-text shadow-sm'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              Insights & Feedback (FR-FEED)
            </button>
            <button
              onClick={() => setActiveTab('ledger')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'ledger'
                  ? 'bg-surface text-text shadow-sm'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              Sales & Ledger (FR-PAY)
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsExportOpen(true)}
            className="flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Data</span>
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (onProposeEvent) {
                onProposeEvent();
              } else {
                toast({
                  type: 'info',
                  title: 'Event Proposal Form',
                  message: 'Opening proposal wizard...',
                });
              }
            }}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            <span>Propose Event</span>
          </Button>
        </div>
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-medium text-text-muted">Total Registrations</span>
            <Users className="w-4 h-4 text-brand" />
          </div>
          <div className="text-2xl font-bold text-text">
            {activeTab === 'insights' ? analytics.kpis.registrations : PROTOTYPE_ORGANIZER_STATS.activeRegistrations}
          </div>
          <p className="text-[11px] text-text-muted mt-1">
            {activeTab === 'insights' ? `${analytics.kpis.confirmed} confirmed seats` : 'Across 4 published club events'}
          </p>
        </Card>

        <Card>
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-medium text-text-muted">
              {activeTab === 'insights' ? 'Check-in Attendance' : 'Simulated Gross Sales'}
            </span>
            {activeTab === 'insights' ? (
              <CheckCircle className="w-4 h-4 text-success" />
            ) : (
              <TrendingUp className="w-4 h-4 text-success" />
            )}
          </div>
          <div className="text-2xl font-bold text-text">
            {activeTab === 'insights'
              ? `${analytics.kpis.checkinRate}%`
              : `₹${formatPaise(salesSummary.grossPaise)}`}
          </div>
          <p className="text-[11px] text-text-muted mt-1">
            {activeTab === 'insights'
              ? `${analytics.kpis.checkins} scanned (${analytics.kpis.noShows} no-shows)`
              : `(${salesSummary.grossPaise} paise)`}
          </p>
        </Card>

        <Card>
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-medium text-text-muted">
              {activeTab === 'insights' ? 'Average Feedback Score' : 'Simulated Refunds'}
            </span>
            {activeTab === 'insights' ? (
              <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
            ) : (
              <TrendingDown className="w-4 h-4 text-error" />
            )}
          </div>
          <div className="text-2xl font-bold text-text">
            {activeTab === 'insights'
              ? analytics.kpis.ratingAvg !== null
                ? `${analytics.kpis.ratingAvg.toFixed(1)} ★`
                : 'Not enough responses'
              : `₹${formatPaise(salesSummary.refundsPaise)}`}
          </div>
          <p className="text-[11px] text-text-muted mt-1">
            {activeTab === 'insights'
              ? `${analytics.kpis.feedbackCount} reviews · ${analytics.kpis.responseRate}% response rate`
              : `${salesSummary.refundsCount} approved refund(s)`}
          </p>
        </Card>

        <Card>
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-medium text-text-muted">Net Revenue</span>
            <Badge variant="warning" size="sm">
              SIMULATED
            </Badge>
          </div>
          <div className="text-2xl font-bold text-brand">
            ₹{formatPaise(salesSummary.netPaise)}
          </div>
          <p className="text-[11px] text-text-muted mt-1">Gross minus approved refunds</p>
        </Card>
      </div>

      {/* Tab 1: Attendee Roster Section */}
      {activeTab === 'roster' && (
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <CardTitle>Smart Campus AI & Robotics Symposium — Attendee Roster</CardTitle>
                <p className="text-xs text-text-muted mt-1">
                  Real-time check-in log with sortable columns, sticky header, and responsive card view.
                </p>
              </div>

              <div className="w-full sm:w-64">
                <Input
                  placeholder="Search attendee or ticket..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="text-xs py-1.5"
                  aria-label="Filter attendees"
                />
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {/* Desktop & Tablet Table (>=640px) */}
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticket ID</TableHead>
                    <TableHead
                      sortDirection={sortField === 'studentName' ? sortDirection : null}
                      onSort={() => handleSort('studentName')}
                    >
                      Student Name
                    </TableHead>
                    <TableHead
                      sortDirection={sortField === 'rollNumber' ? sortDirection : null}
                      onSort={() => handleSort('rollNumber')}
                    >
                      Roll Number
                    </TableHead>
                    <TableHead>Ticket Type</TableHead>
                    <TableHead
                      sortDirection={sortField === 'checkInStatus' ? sortDirection : null}
                      onSort={() => handleSort('checkInStatus')}
                    >
                      Status
                    </TableHead>
                    <TableHead>Scan Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedAttendees.map((att) => (
                    <TableRow key={att.ticketId}>
                      <TableCell className="font-mono text-xs font-medium text-brand">
                        {att.ticketId}
                      </TableCell>
                      <TableCell className="font-medium">{att.studentName}</TableCell>
                      <TableCell className="text-text-muted font-mono text-xs">
                        {att.rollNumber}
                      </TableCell>
                      <TableCell className="text-xs">{att.ticketType}</TableCell>
                      <TableCell>
                        {att.checkInStatus === 'CHECKED_IN' ? (
                          <Badge variant="success" size="sm">
                            Checked In
                          </Badge>
                        ) : (
                          <Badge variant="neutral" size="sm">
                            Valid
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-text-muted">
                        {att.checkInTime}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Responsive Cards (<640px) */}
            <div className="sm:hidden space-y-3">
              {sortedAttendees.map((att) => (
                <div
                  key={att.ticketId}
                  className="p-3 bg-surface-2 border border-border rounded-md text-xs space-y-1.5"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-mono text-xs font-bold text-brand">{att.ticketId}</span>
                    {att.checkInStatus === 'CHECKED_IN' ? (
                      <Badge variant="success" size="sm">Checked In</Badge>
                    ) : (
                      <Badge variant="neutral" size="sm">Valid</Badge>
                    )}
                  </div>
                  <p className="font-semibold text-text text-sm">{att.studentName}</p>
                  <div className="flex justify-between text-text-muted pt-1 border-t border-border/50">
                    <span>{att.rollNumber}</span>
                    <span>{att.checkInTime}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tab 2: Insights & Feedback Section (FR-FEED, FR-INSIGHT) */}
      {activeTab === 'insights' && (
        <div className="space-y-6">
          {/* Event Selector in Insights Tab */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 bg-surface-2 border border-border rounded-lg">
            <div>
              <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Analyzing Event:</span>
              <h2 className="text-sm font-bold text-text mt-0.5">{selectedEventTitle}</h2>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="insight-event-selector" className="text-xs text-text-muted">Switch Event:</label>
              <select
                id="insight-event-selector"
                value={selectedEventId}
                onChange={(e) => {
                  setSelectedEventId(e.target.value);
                  setSelectedEventTitle(e.target.options[e.target.selectedIndex].text);
                }}
                className="text-xs p-1.5 rounded border border-border bg-surface text-text"
              >
                <option value="mock-evt-1">Smart Campus AI & Robotics Symposium</option>
                <option value="mock-evt-2">Annual Autonomous Drone Derby</option>
              </select>
            </div>
          </div>

          {/* Funnel & Distribution Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Conversion Funnel */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Attendee Lifecycle Funnel</CardTitle>
                <p className="text-xs text-text-muted mt-1">
                  Conversion tracking from registration through check-in and post-event feedback.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {analytics.funnel.map((step, idx) => (
                  <div key={step.stage} className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-text">
                        {idx + 1}. {step.stage}
                      </span>
                      <span className="font-mono font-medium text-text">
                        {step.count} ({step.conversionRate}%)
                      </span>
                    </div>
                    <div className="w-full bg-surface-2 h-3 rounded-full overflow-hidden border border-border/50">
                      <div
                        className="bg-brand-600 h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(5, Math.min(100, step.conversionRate))}%` }}
                        role="progressbar"
                        aria-valuenow={step.conversionRate}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${step.stage} conversion rate`}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Ratings Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rating Distribution & Breakdown</CardTitle>
                <p className="text-xs text-text-muted mt-1">
                  Attendee satisfaction scores submitted within 48-hour post-event window.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {[5, 4, 3, 2, 1].map((stars) => {
                  const count = analytics.ratingsDistribution[stars] || 0;
                  const total = analytics.kpis.feedbackCount || 1;
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div key={stars} className="flex items-center gap-3 text-xs">
                      <span className="font-medium text-text min-w-[3.5rem] flex items-center gap-1">
                        {stars} <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                      </span>
                      <div className="flex-1 bg-surface-2 h-2.5 rounded-full overflow-hidden border border-border/50">
                        <div
                          className="bg-amber-400 h-full rounded-full transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="font-mono text-text-muted min-w-[3rem] text-right">
                        {count} ({pct}%)
                      </span>
                    </div>
                  );
                })}

                <div className="pt-3 border-t border-border flex items-center justify-between text-xs text-text-muted">
                  <span>Cold-Start Guard (Blueprint §4):</span>
                  <Badge variant={analytics.kpis.feedbackCount >= 5 ? 'success' : 'neutral'} size="sm">
                    {analytics.kpis.feedbackCount >= 5
                      ? 'Mature Rating (n ≥ 5)'
                      : 'Low Data Rule (n < 5)'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Time Series Table (Accessible Table Alternative) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Registration Trend Over Time</CardTitle>
              <p className="text-xs text-text-muted mt-1">
                Accessible tabular representation of daily and cumulative attendee registrations.
              </p>
            </CardHeader>
            <CardContent>
              <div
                className="overflow-x-auto"
                tabIndex={0}
                role="region"
                aria-label="Registrations over time table container"
              >
                <table
                  className="w-full text-xs text-left border-collapse"
                  aria-label="Registrations over time table"
                >
                  <thead>
                    <tr className="border-b border-border text-text-muted">
                      <th scope="col" className="py-2 px-3 font-semibold">Date</th>
                      <th scope="col" className="py-2 px-3 font-semibold">New Bookings</th>
                      <th scope="col" className="py-2 px-3 font-semibold">Cumulative Total</th>
                      <th scope="col" className="py-2 px-3 font-semibold">Trend Indicator</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.timeSeries.map((row) => (
                      <tr key={row.date} className="border-b border-border/40 hover:bg-surface-2">
                        <td className="py-2 px-3 font-mono text-text">{row.date}</td>
                        <td className="py-2 px-3 font-semibold text-brand-600">+{row.registrations}</td>
                        <td className="py-2 px-3 font-mono font-medium text-text">{row.cumulative}</td>
                        <td className="py-2 px-3">
                          <div className="w-24 bg-surface-2 h-2 rounded-full overflow-hidden">
                            <div
                              className="bg-brand-500 h-full rounded-full"
                              style={{ width: `${Math.min(100, (row.cumulative / (analytics.kpis.confirmed || 1)) * 100)}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Attendee Feedback & Moderation Queue */}
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Attendee Reviews & Feedback Queue</CardTitle>
                  <p className="text-xs text-text-muted mt-1">
                    Zero PII displayed. Emails, student roll numbers, and personal identities are completely excluded.
                  </p>
                </div>
                <Badge variant="neutral" size="sm">
                  Privacy Guard: ZERO_PII
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {feedbackList.length === 0 ? (
                <div className="py-8 text-center text-xs text-text-muted">
                  No feedback reviews submitted yet for this event.
                </div>
              ) : (
                <div
                  className="overflow-x-auto"
                  tabIndex={0}
                  role="region"
                  aria-label="Feedback reviews table container"
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Attendee</TableHead>
                        <TableHead>Rating</TableHead>
                        <TableHead>Review Comment</TableHead>
                        <TableHead>Submitted At</TableHead>
                        <TableHead>Moderation</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {feedbackList.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-semibold text-xs text-text">
                            {item.attendeeLabel}
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1 font-bold text-xs text-amber-500">
                              {item.rating} <Star className="w-3.5 h-3.5 fill-amber-500" />
                            </span>
                          </TableCell>
                          <TableCell className="text-xs max-w-sm truncate text-text">
                            {item.comment || <span className="italic text-text-muted">No comment provided</span>}
                          </TableCell>
                          <TableCell className="text-xs text-text-muted whitespace-nowrap">
                            {new Date(item.submittedAt).toLocaleDateString()}
                            {item.editedAt && (
                              <span className="block text-[10px] text-brand-600 font-mono">(edited)</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                item.moderationStatus === 'visible'
                                  ? 'success'
                                  : item.moderationStatus === 'flagged'
                                  ? 'warning'
                                  : 'neutral'
                              }
                              size="sm"
                            >
                              {item.moderationStatus}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {item.moderationStatus !== 'flagged' && (
                                <button
                                  onClick={() => handleModerateFeedback(item.id, 'flagged')}
                                  title="Flag review"
                                  className="p-1 text-amber-500 hover:bg-surface-2 rounded"
                                >
                                  <Flag className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {item.moderationStatus !== 'hidden' ? (
                                <button
                                  onClick={() => handleModerateFeedback(item.id, 'hidden')}
                                  title="Hide review"
                                  className="p-1 text-text-muted hover:text-error hover:bg-surface-2 rounded"
                                >
                                  <EyeOff className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleModerateFeedback(item.id, 'visible')}
                                  title="Make visible"
                                  className="p-1 text-success hover:bg-surface-2 rounded"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab 3: Financial Sales & Ledger Section (FR-PAY) */}
      {activeTab === 'ledger' && (
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <CardTitle>Organizer Financial Ledger & Audit Trail</CardTitle>
                <p className="text-xs text-text-muted mt-1">
                  Double-entry accounting journal tracking SALE confirmations and REFUND reversals in integer paise.
                </p>
              </div>

              <Badge variant="warning" size="sm">
                POLICY: analytics:view:owned
              </Badge>
            </div>
          </CardHeader>

          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transaction Date</TableHead>
                    <TableHead>Entry Type</TableHead>
                    <TableHead>Booking ID</TableHead>
                    <TableHead>Payment Reference</TableHead>
                    <TableHead>Amount (₹ / Paise)</TableHead>
                    <TableHead>Simulation Mode</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledgerEntries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs text-text-muted whitespace-nowrap">
                        {new Date(entry.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={entry.entryType === 'SALE' ? 'success' : 'error'}
                          size="sm"
                        >
                          {entry.entryType}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-text">
                        {entry.bookingId.substring(0, 12)}...
                      </TableCell>
                      <TableCell className="font-mono text-xs text-text-muted">
                        {entry.paymentId.substring(0, 14)}
                      </TableCell>
                      <TableCell className="font-semibold text-xs">
                        <span className={entry.entryType === 'SALE' ? 'text-success' : 'text-error'}>
                          {entry.entryType === 'SALE' ? '+' : '-'}₹{formatPaise(entry.amountPaise)}
                        </span>
                        <span className="block text-[10px] font-normal text-text-muted">
                          ({entry.amountPaise} paise)
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="neutral" size="sm">
                          Simulated
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Export Dialog Modal */}
      {isExportOpen && (
        <ExportDialog
          isOpen={isExportOpen}
          onClose={() => setIsExportOpen(false)}
          eventId={selectedEventId}
          eventTitle={selectedEventTitle}
        />
      )}
    </div>
  );
};
