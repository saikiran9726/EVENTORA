import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { Button } from './Button';
import { cn } from '@/lib/utils';

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
  maxVisiblePages?: number;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  className,
  maxVisiblePages = 5,
}) => {
  if (totalPages <= 1) return null;

  const pageNumbers = useMemo(() => {
    const items: Array<number | 'dots'> = [];

    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        items.push(i);
      }
      return items;
    }

    // Always include first page
    items.push(1);

    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);

    if (start > 2) {
      items.push('dots');
    }

    for (let i = start; i <= end; i++) {
      items.push(i);
    }

    if (end < totalPages - 1) {
      items.push('dots');
    }

    // Always include last page
    items.push(totalPages);

    return items;
  }, [currentPage, totalPages, maxVisiblePages]);

  return (
    <nav
      role="navigation"
      aria-label="Pagination Navigation"
      className={cn('flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-border w-full', className)}
    >
      <div className="text-xs text-text-muted">
        Page <span className="font-semibold text-text">{currentPage}</span> of{' '}
        <span className="font-semibold text-text">{totalPages}</span>
      </div>

      <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap justify-center">
        <Button
          variant="outline"
          size="sm"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          aria-label="Previous page"
          className="px-2 sm:px-3"
        >
          <ChevronLeft className="w-3.5 h-3.5 sm:mr-1" aria-hidden="true" />
          <span className="hidden sm:inline">Previous</span>
        </Button>

        {/* Page Number Buttons */}
        <div className="flex items-center gap-1">
          {pageNumbers.map((item, idx) => {
            if (item === 'dots') {
              return (
                <span
                  key={`dots-${idx}`}
                  className="px-2 py-1 text-text-muted select-none flex items-center justify-center"
                  aria-hidden="true"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </span>
              );
            }

            const isCurrent = item === currentPage;
            return (
              <button
                key={item}
                type="button"
                onClick={() => onPageChange(item)}
                aria-label={`Page ${item}`}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'min-w-[32px] h-8 px-2 text-xs font-medium rounded-md transition-colors duration-fast',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                  isCurrent
                    ? 'bg-brand text-white font-semibold shadow-sm'
                    : 'text-text hover:bg-surface-2 border border-transparent hover:border-border'
                )}
              >
                {item}
              </button>
            );
          })}
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          aria-label="Next page"
          className="px-2 sm:px-3"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="w-3.5 h-3.5 sm:ml-1" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
};
