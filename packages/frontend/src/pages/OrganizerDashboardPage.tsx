import React, { useState } from 'react';
import {
  Users,
  CheckCircle2,
  Hourglass,
  Plus,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { MOCK_ORGANIZER_STATS, MOCK_ATTENDEES } from '@/mock/data';
import { formatINR } from '@/lib/utils';

export const OrganizerDashboardPage: React.FC = () => {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredAttendees = MOCK_ATTENDEES.filter(
    (att) =>
      att.studentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      att.rollNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      att.ticketId.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Dashboard Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text">
            Club Organizer Command Center
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
                message: 'Event creation workflow will open in Phase 3.',
              })
            }
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            <span>Propose Event</span>
          </Button>
        </div>
      </div>

      {/* KPI Stat Cards (4 columns on desktop) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-medium text-text-muted">Total Registrations</span>
            <Users className="w-4 h-4 text-brand" />
          </div>
          <div className="text-2xl font-bold text-text">
            {MOCK_ORGANIZER_STATS.activeRegistrations}
          </div>
          <p className="text-[11px] text-text-muted mt-1">Across 4 published club events</p>
        </Card>

        <Card>
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-medium text-text-muted">Attendance Rate</span>
            <CheckCircle2 className="w-4 h-4 text-success" />
          </div>
          <div className="text-2xl font-bold text-text">
            {MOCK_ORGANIZER_STATS.attendanceRatePercent}%
          </div>
          <p className="text-[11px] text-success font-medium mt-1">QR scan verified on entry</p>
        </Card>

        <Card>
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-medium text-text-muted">Waitlist Queue</span>
            <Hourglass className="w-4 h-4 text-warning" />
          </div>
          <div className="text-2xl font-bold text-text">
            {MOCK_ORGANIZER_STATS.waitlistQueueSize}
          </div>
          <p className="text-[11px] text-text-muted mt-1">Eligible for automatic promotion</p>
        </Card>

        <Card>
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-medium text-text-muted">Simulated Gross Sales</span>
            <Badge variant="warning" size="sm">
              TEST MODE
            </Badge>
          </div>
          <div className="text-2xl font-bold text-text">
            {formatINR(MOCK_ORGANIZER_STATS.simulatedGrossSalesPaise)}
          </div>
          <p className="text-[11px] text-text-muted mt-1">Simulated test funds (ledger records)</p>
        </Card>
      </div>

      {/* Attendee Roster Section */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <CardTitle>Smart Campus AI & Robotics Symposium — Attendee Roster</CardTitle>
              <p className="text-xs text-text-muted mt-1">
                Real-time check-in log with tamper-proof ticket identifiers and scan status.
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket ID</TableHead>
                <TableHead>Student Name</TableHead>
                <TableHead>Roll Number</TableHead>
                <TableHead>Ticket Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Scan Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAttendees.map((att) => (
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
                        Valid (Unused)
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
        </CardContent>
      </Card>
    </div>
  );
};
