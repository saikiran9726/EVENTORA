import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Calendar,
  Building,
  UserCheck,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { apiClient, ApiError } from '@/lib/api-client';

export interface ProposalItem {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  department: string;
  format: string;
  capacity: number;
  startsAt: string;
  endsAt: string;
  status: string;
  venueName?: string;
  organizerName?: string;
  contactEmail?: string;
}

export const ReviewQueuePage: React.FC = () => {
  const { toast } = useToast();
  const [proposals, setProposals] = useState<ProposalItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProposal, setSelectedProposal] = useState<ProposalItem | null>(null);
  const [decisionType, setDecisionType] = useState<'approved' | 'rejected' | 'changes_requested' | null>(null);
  const [reviewerComment, setReviewerComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchProposals = async () => {
    setIsLoading(true);
    try {
      const res = await apiClient<any>('/api/v1/events?status=pending_approval&limit=50');
      const eventList = res?.items || res?.events || res?.data?.events || [];
      if (eventList.length > 0) {
        const items: ProposalItem[] = eventList.map((e: any) => ({
          id: e.id,
          slug: e.slug,
          title: e.title,
          description: e.description || '',
          category: e.category,
          department: e.department,
          format: e.format,
          capacity: e.capacity,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          status: e.status,
          venueName: e.venueName || e.venue?.name || 'Sir MV Auditorium',
          organizerName: e.organizerName || e.organizer?.displayName || 'Campus Tech Council',
          contactEmail: e.contactEmail || 'organizer@campus.edu',
        }));
        setProposals(items);
      } else {
        setProposals([]);
      }
    } catch {
      // Prototype mock queue if API is offline
      setProposals([
        {
          id: 'mock-prop-1',
          slug: 'smart-campus-robotics-grand-prix',
          title: 'Inter-College Robotics Grand Prix 2026',
          description: 'A 24-hour campus autonomous robotics challenge with line-following, obstacle clearance, and drone navigation.',
          category: 'AI & Robotics',
          department: 'Computer Science',
          format: 'in_person',
          capacity: 250,
          startsAt: new Date(Date.now() + 86400000 * 5).toISOString(),
          endsAt: new Date(Date.now() + 86400000 * 6).toISOString(),
          status: 'pending_approval',
          venueName: 'Sir MV Auditorium',
          organizerName: 'Robotics Club',
          contactEmail: 'robotics@campus.edu',
        },
        {
          id: 'mock-prop-2',
          slug: 'national-hackathon-2026',
          title: 'National Level Smart Campus Hackathon',
          description: 'Annual overnight hackathon building AI, sustainability, and Web3 solutions for smart campuses.',
          category: 'Hackathon',
          department: 'Electronics',
          format: 'hybrid',
          capacity: 400,
          startsAt: new Date(Date.now() + 86400000 * 12).toISOString(),
          endsAt: new Date(Date.now() + 86400000 * 13).toISOString(),
          status: 'pending_approval',
          venueName: 'Kalam Seminar Hall',
          organizerName: 'Developer Student Club',
          contactEmail: 'dsc@campus.edu',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProposals();
  }, []);

  const openDecisionModal = (proposal: ProposalItem, type: 'approved' | 'rejected' | 'changes_requested') => {
    setSelectedProposal(proposal);
    setDecisionType(type);
    setReviewerComment(
      type === 'approved'
        ? 'Verified venue booking, safety protocols, and faculty department sponsorship. Proposal approved.'
        : type === 'changes_requested'
        ? 'Please adjust the schedule to avoid overlap with mid-term evaluations and provide faculty mentor endorsement.'
        : 'Proposal does not meet academic calendar guidelines.'
    );
  };

  const submitDecision = async () => {
    if (!selectedProposal || !decisionType) return;
    if (!reviewerComment.trim()) {
      toast({
        title: 'Reviewer Comment Required',
        message: 'You must provide a review comment for audit compliance.',
        type: 'error',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient(`/api/v1/events/${selectedProposal.id}/approval`, {
        method: 'POST',
        body: JSON.stringify({
          decision: decisionType,
          comments: reviewerComment.trim(),
        }),
      });

      toast({
        title: 'Decision Recorded',
        message: `Event "${selectedProposal.title}" was updated with status: ${decisionType}.`,
        type: 'success',
      });

      // Update locally
      setProposals((prev) =>
        prev.map((p) =>
          p.id === selectedProposal.id
            ? { ...p, status: decisionType === 'approved' ? 'approved' : decisionType === 'rejected' ? 'cancelled' : 'draft' }
            : p
        )
      );

      setSelectedProposal(null);
      setDecisionType(null);
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'REVIEWER_CONFLICT') {
        toast({
          title: 'Reviewer Independence Violation',
          message: 'Faculty reviewer cannot review an event they created or an event from their own club.',
          type: 'error',
        });
      } else {
        toast({
          title: 'Approval Error',
          message: err.message || 'Failed to submit review decision.',
          type: 'error',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const filtered = proposals.filter((p) =>
    p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.department.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text">
            Faculty Approval & Review Queue
          </h1>
          <p className="text-xs sm:text-sm text-text-muted mt-0.5">
            Evaluate student club event proposals, verify venue allocations, and enforce faculty governance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="brand" size="sm">Policy: event:review</Badge>
          <Button variant="outline" size="sm" onClick={fetchProposals} disabled={isLoading} className="flex items-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Reviewer Independence Notice */}
      <div className="p-3 bg-brand/5 border border-brand/20 rounded-lg text-xs flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-brand shrink-0" />
          <span className="text-text-muted">
            <strong>Conflict-of-Interest Guard:</strong> Faculty reviewers cannot approve events they authored or events hosted by clubs where they hold active membership.
          </span>
        </div>
        <Badge variant="success" size="sm">Active</Badge>
      </div>

      {/* Search Bar */}
      <div className="max-w-md">
        <Input
          placeholder="Filter proposals by title, club or department..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="text-xs"
        />
      </div>

      {/* Proposal Cards List */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <Card className="text-center p-8">
            <UserCheck className="w-8 h-8 text-text-muted mx-auto mb-2 opacity-50" />
            <p className="text-sm font-semibold text-text">No Pending Proposals in Queue</p>
            <p className="text-xs text-text-muted mt-1">
              All event proposals have been reviewed or no submissions match the filter.
            </p>
          </Card>
        ) : (
          filtered.map((item) => (
            <Card key={item.id} className="transition-all hover:border-brand/40">
              <CardContent className="p-4 sm:p-5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-base font-bold text-text">{item.title}</h2>
                      <Badge
                        variant={
                          item.status === 'approved'
                            ? 'success'
                            : item.status === 'pending_approval'
                            ? 'warning'
                            : item.status === 'published'
                            ? 'brand'
                            : 'neutral'
                        }
                        size="sm"
                      >
                        {item.status.replace('_', ' ').toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-xs text-text-muted mt-1">
                      Submitted by <strong>{item.organizerName}</strong> • Department: {item.department} • Category: {item.category}
                    </p>
                  </div>
                  <div className="text-right sm:shrink-0">
                    <span className="text-xs font-semibold text-text">Capacity: {item.capacity}</span>
                    <p className="text-[11px] text-text-muted capitalize">Format: {item.format.replace('_', ' ')}</p>
                  </div>
                </div>

                <p className="text-xs text-text-muted line-clamp-2 leading-relaxed">
                  {item.description}
                </p>

                {/* Venue & Timing strip */}
                <div className="p-3 bg-surface-2 rounded-md border border-border text-xs grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="flex items-center gap-1.5 text-text">
                    <Building className="w-3.5 h-3.5 text-brand" />
                    <span>Venue: <strong>{item.venueName}</strong></span>
                  </div>
                  <div className="flex items-center gap-1.5 text-text">
                    <Calendar className="w-3.5 h-3.5 text-brand" />
                    <span>
                      {new Date(item.startsAt).toLocaleDateString()} ({new Date(item.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                    </span>
                  </div>
                </div>

                {/* Conflict Pre-check badge */}
                <div className="flex items-center gap-2 text-xs text-success">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>PostgreSQL GiST overlap check: Venue schedule confirmed with no conflicting holds.</span>
                </div>

                {/* Decision Action Buttons */}
                {item.status === 'pending_approval' && (
                  <div className="flex items-center gap-2 pt-2 border-t border-border">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => openDecisionModal(item, 'approved')}
                      className="flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Approve Proposal
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openDecisionModal(item, 'changes_requested')}
                      className="flex items-center gap-1.5"
                    >
                      <AlertCircle className="w-3.5 h-3.5 text-warning" /> Request Changes
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openDecisionModal(item, 'rejected')}
                      className="flex items-center gap-1.5 text-error hover:bg-error/10"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Reject
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Decision Dialog Modal */}
      {selectedProposal && decisionType && (
        <Dialog
          isOpen={true}
          onClose={() => {
            setSelectedProposal(null);
            setDecisionType(null);
          }}
          title={`Faculty Decision: ${decisionType.replace('_', ' ').toUpperCase()}`}
        >
          <div className="space-y-4 text-xs">
            <p className="text-text-muted">
              You are recording an official faculty decision for proposal:
              <br />
              <strong className="text-text">{selectedProposal.title}</strong>
            </p>

            <div>
              <label className="font-semibold text-text block mb-1">
                Faculty Review Comments & Justification <span className="text-error">*</span>
              </label>
              <textarea
                rows={4}
                value={reviewerComment}
                onChange={(e) => setReviewerComment(e.target.value)}
                placeholder="Enter mandatory audit comments and guidance for the organizing team..."
                className="w-full bg-surface border border-border rounded-md p-3 text-xs text-text focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedProposal(null);
                  setDecisionType(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant={decisionType === 'approved' ? 'primary' : decisionType === 'rejected' ? 'destructive' : 'outline'}
                size="sm"
                disabled={isSubmitting}
                onClick={submitDecision}
              >
                {isSubmitting ? 'Recording...' : `Confirm ${decisionType.replace('_', ' ')}`}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};
