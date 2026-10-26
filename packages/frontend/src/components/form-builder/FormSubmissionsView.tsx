import React, { useState, useEffect } from 'react';
import {
  Users,
  Search,
  Download,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { apiClient } from '@/lib/api-client';

export interface FormSubmissionsViewProps {
  eventId: string;
}

interface FormSubmissionRecord {
  bookingId: string;
  userId: string;
  attendeeName: string;
  attendeeEmail: string;
  bookingStatus: string;
  registrationDate: string;
  attendees: Record<
    number,
    Array<{
      fieldId: string;
      fieldLabel: string;
      fieldType: string;
      value: any;
    }>
  >;
}

export const FormSubmissionsView: React.FC<FormSubmissionsViewProps> = ({ eventId }) => {
  const { toast } = useToast();
  const [submissions, setSubmissions] = useState<FormSubmissionRecord[]>([]);
  const [totalSubmissions, setTotalSubmissions] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null);

  const fetchSubmissions = async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.get<any>(`/api/v1/events/${eventId}/form/submissions`);
      if (res?.submissions) {
        setSubmissions(res.submissions);
        setTotalSubmissions(res.totalSubmissions || res.submissions.length);
      }
    } catch (err: any) {
      toast({
        type: 'error',
        title: 'Could Not Load Submissions',
        message: err?.error?.message || err.message || 'Failed to retrieve attendee answers.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (eventId) {
      fetchSubmissions();
    }
  }, [eventId]);

  const filteredSubmissions = submissions.filter((sub) => {
    const term = searchTerm.toLowerCase();
    const nameMatch = sub.attendeeName?.toLowerCase().includes(term);
    const emailMatch = sub.attendeeEmail?.toLowerCase().includes(term);
    const idMatch = sub.bookingId?.toLowerCase().includes(term);
    return nameMatch || emailMatch || idMatch;
  });

  const handleExportCSV = () => {
    if (submissions.length === 0) {
      toast({
        type: 'error',
        title: 'No Data to Export',
        message: 'No form responses have been submitted for this event yet.',
      });
      return;
    }

    // Collect all unique field labels across submissions
    const fieldLabelsSet = new Set<string>();
    submissions.forEach((sub) => {
      Object.values(sub.attendees || {}).forEach((answersList) => {
        answersList.forEach((a) => fieldLabelsSet.add(a.fieldLabel));
      });
    });
    const fieldLabels = Array.from(fieldLabelsSet);

    // Header row
    const headers = [
      'Booking ID',
      'Attendee Name',
      'Attendee Email',
      'Status',
      'Registration Date',
      'Attendee Index',
      ...fieldLabels,
    ];

    const rows: string[][] = [];

    submissions.forEach((sub) => {
      const attendeeIndices = Object.keys(sub.attendees || {});
      if (attendeeIndices.length === 0) {
        rows.push([
          sub.bookingId,
          sub.attendeeName,
          sub.attendeeEmail,
          sub.bookingStatus,
          sub.registrationDate,
          '1',
          ...fieldLabels.map(() => ''),
        ]);
      } else {
        attendeeIndices.forEach((idxStr) => {
          const idx = parseInt(idxStr, 10);
          const answers = sub.attendees[idx] || [];
          const answerMap = new Map(answers.map((a) => [a.fieldLabel, a.value]));

          rows.push([
            sub.bookingId,
            sub.attendeeName,
            sub.attendeeEmail,
            sub.bookingStatus,
            sub.registrationDate,
            (idx + 1).toString(),
            ...fieldLabels.map((label) => {
              const val = answerMap.get(label);
              if (val === undefined || val === null) return '';
              if (Array.isArray(val)) return `"${val.join('; ')}"`;
              return `"${String(val).replace(/"/g, '""')}"`;
            }),
          ]);
        });
      }
    });

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `event_${eventId}_form_responses.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      type: 'success',
      title: 'Export Complete',
      message: `Exported ${rows.length} attendee response row(s) to CSV.`,
    });
  };

  const toggleExpand = (bookingId: string) => {
    setExpandedBookingId((prev) => (prev === bookingId ? null : bookingId));
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-3">
        <RefreshCw className="w-6 h-6 animate-spin text-brand" />
        <p className="text-xs text-text-muted">Loading custom form responses...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header and stats */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-surface p-4 rounded-lg border border-border">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-text">Attendee Questionnaire Responses</h3>
            <Badge variant="brand" size="sm">
              {totalSubmissions} Total
            </Badge>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            View captured responses for custom registration fields, dietary preferences, and attendee details.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={fetchSubmissions}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleExportCSV}
            className="flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex items-center gap-2 max-w-md">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by student name or email..."
            className="pl-9 text-xs"
          />
        </div>
      </div>

      {/* Submissions Table */}
      {filteredSubmissions.length === 0 ? (
        <Card className="p-8 text-center">
          <Users className="w-8 h-8 text-text-muted mx-auto mb-2 opacity-50" />
          <p className="text-sm font-semibold text-text">No Submissions Found</p>
          <p className="text-xs text-text-muted mt-1">
            {searchTerm
              ? 'No attendee responses match the current search filters.'
              : 'No attendees have completed the custom registration form yet.'}
          </p>
        </Card>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Attendee</TableHead>
                <TableHead>Booking Reference</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Registered</TableHead>
                <TableHead>Responses Preview</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSubmissions.map((sub) => {
                const isExpanded = expandedBookingId === sub.bookingId;
                const attendeeIndices = Object.keys(sub.attendees || {});
                const firstAttendeeAnswers = sub.attendees[0] || [];

                return (
                  <React.Fragment key={sub.bookingId}>
                    <TableRow
                      onClick={() => toggleExpand(sub.bookingId)}
                      className="cursor-pointer hover:bg-surface-2 transition-colors"
                    >
                      <TableCell className="w-8 p-2">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-text-muted" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-text-muted" />
                        )}
                      </TableCell>
                      <TableCell>
                        <p className="font-semibold text-xs text-text">
                          {sub.attendeeName || 'Anonymous Attendee'}
                        </p>
                        <p className="text-[11px] text-text-muted">{sub.attendeeEmail}</p>
                      </TableCell>
                      <TableCell>
                        <code className="text-[11px] text-text-muted font-mono">
                          {sub.bookingId.slice(0, 8)}...
                        </code>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={sub.bookingStatus === 'CONFIRMED' ? 'success' : 'warning'}
                          size="sm"
                        >
                          {sub.bookingStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-text-muted">
                        {new Date(sub.registrationDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-xs text-text-muted">
                        <span className="truncate max-w-xs block">
                          {firstAttendeeAnswers.length > 0
                            ? firstAttendeeAnswers
                                .slice(0, 2)
                                .map((a) => `${a.fieldLabel}: ${Array.isArray(a.value) ? a.value.join(', ') : a.value}`)
                                .join(' | ')
                            : 'No answers'}
                        </span>
                      </TableCell>
                    </TableRow>

                    {/* Expanded details row */}
                    {isExpanded && (
                      <TableRow className="bg-surface-2/40">
                        <TableCell colSpan={6} className="p-4">
                          <div className="space-y-4">
                            <h4 className="text-xs font-bold text-text uppercase tracking-wider">
                              Attendee Form Answers ({attendeeIndices.length} Ticket/Seat
                              {attendeeIndices.length > 1 ? 's' : ''})
                            </h4>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {attendeeIndices.map((idxStr) => {
                                const idx = parseInt(idxStr, 10);
                                const answers = sub.attendees[idx] || [];

                                return (
                                  <div
                                    key={idx}
                                    className="bg-surface p-3.5 rounded-lg border border-border space-y-2.5"
                                  >
                                    <div className="flex items-center justify-between border-b border-border pb-1.5">
                                      <span className="text-xs font-bold text-brand">
                                        Attendee #{idx + 1}
                                      </span>
                                      <Badge variant="neutral" size="sm">
                                        {answers.length} Response(s)
                                      </Badge>
                                    </div>

                                    {answers.length === 0 ? (
                                      <p className="text-xs text-text-muted italic">
                                        No custom fields answered.
                                      </p>
                                    ) : (
                                      <div className="space-y-2">
                                        {answers.map((ans, aIdx) => (
                                          <div key={aIdx} className="text-xs">
                                            <p className="font-semibold text-text-muted">
                                              {ans.fieldLabel}
                                            </p>
                                            <p className="text-text font-medium mt-0.5">
                                              {ans.value === undefined || ans.value === null
                                                ? '-'
                                                : Array.isArray(ans.value)
                                                ? ans.value.join(', ')
                                                : typeof ans.value === 'boolean'
                                                ? ans.value
                                                  ? 'Yes'
                                                  : 'No'
                                                : String(ans.value)}
                                            </p>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};
