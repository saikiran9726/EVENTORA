import React, { useState } from 'react';
import { LucideIcon, Inbox, AlertTriangle, ShieldAlert, Copy, Check } from 'lucide-react';
import { Button } from './Button';
import { cn } from '@/lib/utils';

export interface StateViewProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<StateViewProps> = ({
  icon: Icon = Inbox,
  title,
  description,
  actionLabel,
  onAction,
  className,
}) => {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center p-8 text-center bg-surface border border-dashed border-border rounded-lg max-w-md mx-auto my-6',
        className
      )}
    >
      <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center text-text-muted mb-3 border border-border shrink-0">
        <Icon className="w-6 h-6" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-text">{title}</h3>
      <p className="text-xs text-text-muted mt-1 max-w-xs leading-relaxed">{description}</p>
      {actionLabel && onAction && (
        <Button variant="primary" size="sm" onClick={onAction} className="mt-4">
          {actionLabel}
        </Button>
      )}
    </div>
  );
};

export interface ErrorStateProps extends StateViewProps {
  retryLabel?: string;
  onRetry?: () => void;
  requestId?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  icon: Icon = AlertTriangle,
  title,
  description,
  retryLabel = 'Try again',
  onRetry,
  requestId,
  className,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyRequestId = () => {
    if (requestId && typeof navigator !== 'undefined') {
      navigator.clipboard.writeText(requestId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center p-8 text-center bg-surface border border-error/30 rounded-lg max-w-md mx-auto my-6 shadow-sm',
        className
      )}
    >
      <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center text-error mb-3 border border-error/20 shrink-0">
        <Icon className="w-6 h-6" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-text">{title}</h3>
      <p className="text-xs text-text-muted mt-1 max-w-xs leading-relaxed">{description}</p>

      {requestId && (
        <div className="mt-3 flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-2 border border-border text-[11px] font-mono text-text-muted">
          <span>Request: {requestId.slice(0, 16)}...</span>
          <button
            type="button"
            onClick={handleCopyRequestId}
            className="p-0.5 hover:text-text rounded transition-colors"
            title="Copy Request ID"
            aria-label="Copy Request ID"
          >
            {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      )}

      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-4">
          {retryLabel}
        </Button>
      )}
    </div>
  );
};

export const PermissionDeniedState: React.FC<StateViewProps> = ({
  icon: Icon = ShieldAlert,
  title = 'Access Denied',
  description = "You do not have permission to view or manage this resource under Eventora's server-enforced role policy.",
  actionLabel = 'Return to Events',
  onAction,
  className,
}) => {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center p-8 text-center bg-surface border border-warning/30 rounded-lg max-w-md mx-auto my-6',
        className
      )}
    >
      <div className="w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center text-warning mb-3 border border-warning/20 shrink-0">
        <Icon className="w-6 h-6" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-text">{title}</h3>
      <p className="text-xs text-text-muted mt-1 max-w-xs leading-relaxed">{description}</p>
      {actionLabel && onAction && (
        <Button variant="outline" size="sm" onClick={onAction} className="mt-4">
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
