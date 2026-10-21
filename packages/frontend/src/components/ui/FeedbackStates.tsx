import React from 'react';
import { LucideIcon, Inbox, AlertTriangle, ShieldAlert } from 'lucide-react';
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
      <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center text-text-muted mb-3 border border-border">
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="text-base font-semibold text-text">{title}</h3>
      <p className="text-xs text-text-muted mt-1 max-w-xs">{description}</p>
      {actionLabel && onAction && (
        <Button variant="primary" size="sm" onClick={onAction} className="mt-4">
          {actionLabel}
        </Button>
      )}
    </div>
  );
};

export const ErrorState: React.FC<StateViewProps & { retryLabel?: string; onRetry?: () => void }> = ({
  icon: Icon = AlertTriangle,
  title,
  description,
  retryLabel = 'Try again',
  onRetry,
  className,
}) => {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center p-8 text-center bg-surface border border-error/30 rounded-lg max-w-md mx-auto my-6',
        className
      )}
    >
      <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center text-error mb-3 border border-error/20">
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="text-base font-semibold text-text">{title}</h3>
      <p className="text-xs text-text-muted mt-1 max-w-xs">{description}</p>
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
      <div className="w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center text-warning mb-3 border border-warning/20">
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="text-base font-semibold text-text">{title}</h3>
      <p className="text-xs text-text-muted mt-1 max-w-xs">{description}</p>
      {actionLabel && onAction && (
        <Button variant="outline" size="sm" onClick={onAction} className="mt-4">
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
