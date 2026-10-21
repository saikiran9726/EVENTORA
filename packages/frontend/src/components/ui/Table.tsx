import React from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Table: React.FC<React.TableHTMLAttributes<HTMLTableElement>> = ({
  className,
  'aria-label': ariaLabel,
  ...props
}) => (
  <div
    className="w-full overflow-x-auto focus:outline-none focus:ring-1 focus:ring-brand rounded-md"
    tabIndex={0}
    role="region"
    aria-label={ariaLabel || 'Data table scrollable region'}
  >
    <table className={cn('w-full text-left border-collapse text-sm', className)} {...props} />
  </div>
);

export const TableHeader: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  className,
  ...props
}) => (
  <thead
    className={cn(
      'sticky top-0 z-10 bg-surface-2 border-b border-border text-xs text-text-muted font-semibold uppercase tracking-wider',
      className
    )}
    {...props}
  />
);

export const TableBody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  className,
  ...props
}) => (
  <tbody className={cn('divide-y divide-border bg-surface', className)} {...props} />
);

export const TableRow: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = ({
  className,
  ...props
}) => (
  <tr className={cn('hover:bg-surface-2/50 transition-colors duration-fast', className)} {...props} />
);

export interface SortableTableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortDirection?: 'asc' | 'desc' | null;
  onSort?: () => void;
}

export const TableHead: React.FC<SortableTableHeadProps> = ({
  className,
  children,
  sortDirection,
  onSort,
  ...props
}) => {
  return (
    <th
      className={cn('py-3 px-4 font-semibold text-text align-middle', onSort && 'cursor-pointer select-none', className)}
      onClick={onSort}
      {...props}
    >
      <div className="flex items-center gap-1.5">
        <span>{children}</span>
        {onSort && (
          <span className="text-text-muted">
            {sortDirection === 'asc' ? (
              <ArrowUp className="w-3.5 h-3.5 text-brand" />
            ) : sortDirection === 'desc' ? (
              <ArrowDown className="w-3.5 h-3.5 text-brand" />
            ) : (
              <ArrowUpDown className="w-3.5 h-3.5 opacity-40 hover:opacity-100" />
            )}
          </span>
        )}
      </div>
    </th>
  );
};

export const TableCell: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({
  className,
  ...props
}) => (
  <td className={cn('py-3 px-4 text-text align-middle', className)} {...props} />
);
