import React from 'react';
import { cn } from '@/lib/utils';

export const Table: React.FC<React.TableHTMLAttributes<HTMLTableElement>> = ({
  className,
  ...props
}) => (
  <div className="w-full overflow-x-auto">
    <table className={cn('w-full text-left border-collapse text-sm', className)} {...props} />
  </div>
);

export const TableHeader: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  className,
  ...props
}) => (
  <thead className={cn('bg-surface-2 border-b border-border text-xs text-text-muted font-semibold uppercase tracking-wider', className)} {...props} />
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

export const TableHead: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({
  className,
  ...props
}) => (
  <th className={cn('py-3 px-4 font-semibold text-text', className)} {...props} />
);

export const TableCell: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({
  className,
  ...props
}) => (
  <td className={cn('py-3 px-4 text-text align-middle', className)} {...props} />
);
