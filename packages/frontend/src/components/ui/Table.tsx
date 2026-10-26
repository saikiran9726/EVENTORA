import React from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  'aria-label'?: string;
  responsiveCards?: boolean;
}

export const Table: React.FC<TableProps> = ({
  className,
  'aria-label': ariaLabel,
  responsiveCards = false,
  ...props
}) => (
  <div
    className={cn(
      'w-full overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md border border-border bg-surface',
      responsiveCards && 'mobile-card-table'
    )}
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
      'bg-surface-2 border-b border-border text-xs text-text-muted font-semibold uppercase tracking-wider',
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
  <tr className={cn('hover:bg-surface-2/60 transition-colors duration-fast', className)} {...props} />
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
      scope="col"
      className={cn(
        'py-3 px-4 font-semibold text-text align-middle select-none',
        onSort && 'cursor-pointer hover:text-brand',
        className
      )}
      onClick={onSort}
      onKeyDown={(e) => {
        if (onSort && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSort();
        }
      }}
      tabIndex={onSort ? 0 : undefined}
      aria-sort={
        sortDirection === 'asc'
          ? 'ascending'
          : sortDirection === 'desc'
            ? 'descending'
            : undefined
      }
      {...props}
    >
      <div className="flex items-center gap-1.5">
        <span>{children}</span>
        {onSort && (
          <span className="text-text-muted">
            {sortDirection === 'asc' ? (
              <ArrowUp className="w-3.5 h-3.5 text-brand" aria-label="Sorted ascending" />
            ) : sortDirection === 'desc' ? (
              <ArrowDown className="w-3.5 h-3.5 text-brand" aria-label="Sorted descending" />
            ) : (
              <ArrowUpDown className="w-3.5 h-3.5 opacity-40 hover:opacity-100" aria-label="Sort column" />
            )}
          </span>
        )}
      </div>
    </th>
  );
};

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  dataLabel?: string;
}

export const TableCell: React.FC<TableCellProps> = ({
  className,
  dataLabel,
  children,
  ...props
}) => (
  <td
    data-label={dataLabel}
    className={cn('py-3 px-4 text-text align-middle', className)}
    {...props}
  >
    {children}
  </td>
);
