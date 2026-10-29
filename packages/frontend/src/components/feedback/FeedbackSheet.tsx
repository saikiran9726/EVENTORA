import React, { useState, useEffect, useRef } from 'react';
import { Star, ShieldCheck, Clock, AlertCircle } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { apiClient, ApiError } from '@/lib/api-client';
import { reportError } from '@/lib/error-reporter';

export interface FeedbackSheetProps {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  eventTitle: string;
  existingFeedback?: {
    id?: string;
    rating: number;
    comment?: string;
    submittedAt?: string;
    editedAt?: string;
  } | null;
  onSuccess?: (feedback: any) => void;
}

export const FeedbackSheet: React.FC<FeedbackSheetProps> = ({
  isOpen,
  onClose,
  eventId,
  eventTitle,
  existingFeedback,
  onSuccess,
}) => {
  const { toast } = useToast();
  const [rating, setRating] = useState<number>(existingFeedback?.rating ?? 5);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [comment, setComment] = useState<string>(existingFeedback?.comment ?? '');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const ratingGroupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (existingFeedback) {
      setRating(existingFeedback.rating);
      setComment(existingFeedback.comment || '');
    } else {
      setRating(5);
      setComment('');
    }
    setErrorMessage(null);
  }, [existingFeedback, isOpen]);

  // Handle arrow keys navigation for 5-star rating (accessibility)
  const handleRatingKeyDown = (e: React.KeyboardEvent, starValue: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(5, starValue + 1);
      setRating(next);
      const nextEl = ratingGroupRef.current?.querySelector<HTMLButtonElement>(`[data-rating="${next}"]`);
      nextEl?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      const prev = Math.max(1, starValue - 1);
      setRating(prev);
      const prevEl = ratingGroupRef.current?.querySelector<HTMLButtonElement>(`[data-rating="${prev}"]`);
      prevEl?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setRating(starValue);
    }
  };

  const isEdit = Boolean(existingFeedback?.submittedAt);
  const maxCommentLength = 2000;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating < 1 || rating > 5) {
      setErrorMessage('Please select a star rating between 1 and 5.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const data = await apiClient.post<any>(`/api/v1/events/${eventId}/feedback`, {
        rating,
        comment: comment.trim(),
      });

      toast({
        type: 'success',
        title: isEdit ? 'Feedback Updated' : 'Thank You for Your Feedback!',
        message: isEdit
          ? 'Your review was updated successfully.'
          : 'Your response helps organizers enhance upcoming campus events.',
      });

      if (onSuccess) {
        onSuccess(data?.feedback || { rating, comment });
      }
      onClose();
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.code === 'INELIGIBLE_NOT_ATTENDED' || err.status === 403) {
          setErrorMessage('Only verified attendees who checked in can submit feedback.');
        } else if (err.code === 'FEEDBACK_LOCKED' || err.status === 409) {
          setErrorMessage('The 48-hour edit window for this review has expired.');
        } else if (err.code === 'RATE_LIMITED' || err.status === 429) {
          setErrorMessage('Too many submissions. Maximum 5 reviews per hour.');
        } else {
          setErrorMessage(err.message || 'Failed to submit feedback.');
        }
      } else {
        reportError(err, { context: 'submitFeedback', eventId });
        setErrorMessage('A network error occurred while submitting your review.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Event Feedback' : 'Leave Event Feedback'}
      description={eventTitle}
    >
      <form onSubmit={handleSubmit} className="space-y-5 py-2">
        {errorMessage && (
          <div
            role="alert"
            className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-600 dark:text-red-400 flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* 5-Star Rating Input */}
        <div>
          <label className="block text-xs font-semibold text-text uppercase tracking-wider mb-2">
            Overall Experience Rating <span className="text-red-500">*</span>
          </label>
          <div
            ref={ratingGroupRef}
            role="radiogroup"
            aria-label="Event star rating"
            className="flex items-center gap-2 p-2 bg-surface-2 rounded-lg border border-border inline-flex"
          >
            {[1, 2, 3, 4, 5].map((star) => {
              const active = (hoverRating ?? rating) >= star;
              return (
                <button
                  key={star}
                  type="button"
                  data-rating={star}
                  role="radio"
                  aria-checked={rating === star}
                  aria-label={`${star} star${star > 1 ? 's' : ''}`}
                  tabIndex={rating === star ? 0 : -1}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(null)}
                  onClick={() => setRating(star)}
                  onKeyDown={(e) => handleRatingKeyDown(e, star)}
                  className="p-1 rounded hover:scale-110 focus:outline-none focus:ring-2 focus:ring-brand-600 transition-transform"
                >
                  <Star
                    className={`w-7 h-7 transition-colors ${
                      active
                        ? 'fill-amber-400 text-amber-500'
                        : 'text-text-muted hover:text-amber-400'
                    }`}
                  />
                </button>
              );
            })}
            <span className="text-xs font-bold text-text ml-2 min-w-[3rem]">
              {rating} / 5 ★
            </span>
          </div>
        </div>

        {/* Written Comment Area */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label htmlFor="feedback-comment" className="text-xs font-semibold text-text">
              Detailed Comments & Suggestions (Optional)
            </label>
            <span
              className={`text-[11px] font-mono ${
                comment.length > maxCommentLength ? 'text-red-500 font-bold' : 'text-text-muted'
              }`}
            >
              {comment.length} / {maxCommentLength}
            </span>
          </div>
          <textarea
            id="feedback-comment"
            rows={4}
            maxLength={maxCommentLength}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What went well? What can the organizing team improve next time?"
            className="w-full text-xs sm:text-sm p-3 rounded-lg border border-border bg-surface text-text focus:outline-none focus:ring-2 focus:ring-brand-600 placeholder:text-text-muted/60 resize-y"
          />
        </div>

        {/* Privacy & Edit Guarantee Disclaimers */}
        <div className="space-y-2 pt-1">
          <div className="flex items-start gap-2 p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-md text-xs text-blue-700 dark:text-blue-300">
            <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              <strong>Privacy Guaranteed:</strong> Your feedback is anonymous. Organizers view ratings and comments but never your email, student ID, or personal identity.
            </span>
          </div>

          <div className="flex items-center gap-2 px-1 text-[11px] text-text-muted">
            <Clock className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            <span>
              {isEdit
                ? 'You can revise your review within 48 hours of initial submission.'
                : 'You may update or refine your review within 48 hours after submitting.'}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end items-center gap-2 pt-3 border-t border-border">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={isSubmitting || comment.length > maxCommentLength}
          >
            {isSubmitting ? 'Saving...' : isEdit ? 'Update Feedback' : 'Submit Feedback'}
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
};
