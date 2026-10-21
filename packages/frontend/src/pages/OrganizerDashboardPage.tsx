import React, { useState, useMemo } from 'react';
import {
  Users,
  CheckCircle2,
  Hourglass,
  Download,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { PROTOTYPE_ORGANIZER_STATS, PROTOTYPE_ATTENDEES } from '@/prototype/data';
import { formatINR } from '@/lib/utils';

export const OrganizerDashboardPage: React.FC = () => {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<'studentName' | 'rollNumber' | 'checkInStatus'>('studentName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

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
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text">
            Club Organizer Command Center & Analytics
          </h1>
          <p className="text-xs sm:text-sm text-text-muted mt-1">
            Robotics & Automation Society (RAS) • Department of Computer Science & Engineering
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              toast({
                type: 'info',
                title: 'Roster Export',
                message: 'Attendee list exported as CSV format.',
              })
            }
          >
            <Download className="w-3.5 h-3.5 mr-1" />
            <span>Export CSV</span>
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              toast({
                type: 'info',
                title: 'Event Proposal Form',
                message: 'Event creation wizard opens in Phase 3.',
              })
            }
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            <span>Propose Event</span>
          </Button>
        </div>
      </div>

      {/* KPI Metric Cards (Organizer Analytics) */}
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
            <span className="text-xs font-medium text-text-muted">Attendance Rate</span>
            <CheckCircle2 className="w-4 h-4 text-success" />
          </div>
          <div className="text-2xl font-bold text-text">
            {PROTOTYPE_ORGANIZER_STATS.attendanceRatePercent}%
          </div>
          <p className="text-[11px] text-success font-medium mt-1">
            {PROTOTYPE_ORGANIZER_STATS.conversionRatePercent}% conversion on waitlist
          </p>
        </Card>

        <Card>
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-medium text-text-muted">Waitlist Queue</span>
            <Hourglass className="w-4 h-4 text-warning" />
          </div>
          <div className="text-2xl font-bold text-text">
            {PROTOTYPE_ORGANIZER_STATS.waitlistQueueSize}
          </div>
          <p className="text-[11px] text-text-muted mt-1">Deterministic sequence order</p>
        </Card>

        <Card>
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-medium text-text-muted">Simulated Gross Sales</span>
            <Badge variant="warning" size="sm">
              TEST MODE
            </Badge>
          </div>
          <div className="text-2xl font-bold text-text">
            {formatINR(PROTOTYPE_ORGANIZER_STATS.simulatedGrossSalesPaise)}
          </div>
          <p className="text-[11px] text-text-muted mt-1">Simulated ledger receipts</p>
        </Card>
      </div>

      {/* Attendee Roster Section (Sortable, Sticky Header, Responsive cards on <640px) */}
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
    </div>
  );
};
