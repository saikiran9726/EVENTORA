import React from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { Button } from './Button';
import { cn } from '@/lib/utils';

export interface OfflineBannerProps {
  isOffline: boolean;
  pendingSyncCount?: number;
  onSyncNow?: () => void;
  className?: string;
}

export const OfflineBanner: React.FC<OfflineBannerProps> = ({
  isOffline,
  pendingSyncCount = 0,
  onSyncNow,
  className,
}) => {
  if (!isOffline && pendingSyncCount === 0) return null;

  return (
    <aside
      aria-label="Network status banner"
      className={cn(
        'w-full py-2 px-4 flex items-center justify-between text-xs font-medium z-40 transition-colors duration-fast',
        isOffline ? 'bg-warning/15 text-warning border-b border-warning/30' : 'bg-brand/10 text-brand border-b border-brand/20',
        className
      )}
    >
      <div className="flex items-center gap-2">
        <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>
          {isOffline
            ? 'Offline Mode Active – Local check-in queue persisting scans to storage.'
            : `${pendingSyncCount} offline scans pending server reconciliation.`}
        </span>
      </div>

      {onSyncNow && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onSyncNow}
          className="text-xs py-1 px-2.5 h-auto bg-surface"
        >
          <RefreshCw className="w-3 h-3 mr-1" />
          <span>Sync Queue</span>
        </Button>
      )}
    </aside>
  );
};
