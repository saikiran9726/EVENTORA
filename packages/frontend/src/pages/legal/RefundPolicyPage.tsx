import React from 'react';
import { RefreshCcw, Clock, CheckCircle2, ArrowLeft } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const RefundPolicyPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-background text-text py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.history.back()}
            className="flex items-center gap-2 text-xs"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </Button>
          <span className="text-xs text-text-muted">Effective Date: October 29, 2026</span>
        </div>

        <div className="border-b border-border pb-6 space-y-2">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-brand/10 text-brand">
              <RefreshCcw className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-text">Refund & Cancellation Policy</h1>
              <p className="text-xs text-text-muted">
                Transparent Processing for Paid Passes & Event Cancellations
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-6 text-sm text-text-muted leading-relaxed">
          <Card className="p-6 space-y-3 border border-border">
            <h2 className="text-base font-semibold text-text flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-brand" />
              1. Event Cancellation by Organizer or College
            </h2>
            <p className="text-xs">
              If a campus event is cancelled by the student club organizer or institution administration, all registered attendees receive an automatic 100% full refund of the ticket purchase price directly to the originating payment instrument via YouPI-PG. No attendee action is required.
            </p>
          </Card>

          <Card className="p-6 space-y-3 border border-border">
            <h2 className="text-base font-semibold text-text flex items-center gap-2">
              <Clock className="w-4 h-4 text-brand" />
              2. Attendee-Initiated Cancellations
            </h2>
            <p className="text-xs">
              Attendees may cancel their booking and request a refund up to 24 hours prior to the scheduled event start time via My Bookings. Cancellations requested within 24 hours of event kickoff are non-refundable to prevent seat hoarding and last-minute vacancy.
            </p>
          </Card>

          <Card className="p-6 space-y-3 border border-border">
            <h2 className="text-base font-semibold text-text">3. Gateway Turnaround & Banking Settlement</h2>
            <p className="text-xs">
              All payment refunds are executed over the YouPI-PG gateway network. For UPI payments, refunds typically reflect within 2 to 4 hours. NetBanking and debit card refunds are credited within 3 to 5 official banking business days.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
};
