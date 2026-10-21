import React, { useState, useMemo, useEffect } from 'react';
import {
  Users,
  Download,
  Plus,
  TrendingDown,
  TrendingUp,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { PROTOTYPE_ORGANIZER_STATS, PROTOTYPE_ATTENDEES } from '@/prototype/data';
import { formatPaise } from '@/lib/utils';

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

export const OrganizerDashboardPage: React.FC<OrganizerDashboardPageProps> = ({
  organizerId = 'org-profile-1',
  onProposeEvent,
}) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'roster' | 'ledger'>('roster');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<'studentName' | 'rollNumber' | 'checkInStatus'>('studentName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

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

        <div className="flex items-center gap-2">
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
            onClick={() =>
              toast({
                type: 'info',
                title: 'Data Export',
                message: activeTab === 'roster' ? 'Attendee roster CSV generated.' : 'Financial ledger CSV exported.',
              })
            }
          >
            <Download className="w-3.5 h-3.5 mr-1" />
            <span>Export CSV</span>
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
            {PROTOTYPE_ORGANIZER_STATS.activeRegistrations}
          </div>
          <p className="text-[11px] text-text-muted mt-1">Across 4 published club events</p>
        </Card>

        <Card>
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-medium text-text-muted">Simulated Gross Sales</span>
            <TrendingUp className="w-4 h-4 text-success" />
          </div>
          <div className="text-2xl font-bold text-text">
            ₹{formatPaise(salesSummary.grossPaise)}
          </div>
          <p className="text-[11px] text-text-muted mt-1">({salesSummary.grossPaise} paise)</p>
        </Card>

        <Card>
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-medium text-text-muted">Simulated Refunds</span>
            <TrendingDown className="w-4 h-4 text-error" />
          </div>
          <div className="text-2xl font-bold text-text">
            ₹{formatPaise(salesSummary.refundsPaise)}
          </div>
          <p className="text-[11px] text-text-muted mt-1">{salesSummary.refundsCount} approved refund(s)</p>
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

      {/* Tab 2: Financial Sales & Ledger Section (FR-PAY) */}
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
    </div>
  );
};
