import React from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'brand' | 'success' | 'warning' | 'error' | 'info' | 'neutral';
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = 'neutral',
  size = 'md',
  children,
  ...props
}) => {
  const variants = {
    brand: 'bg-brand/10 text-brand border-brand/20',
    success: 'bg-success/10 text-success border-success/20',
    warning: 'bg-warning/10 text-warning border-warning/20',
    error: 'bg-error/10 text-error border-error/20',
    info: 'bg-info/10 text-info border-info/20',
    neutral: 'bg-surface-2 text-text-muted border-border',
  };

  const sizes = {
    sm: 'text-[11px] px-2 py-0.5 rounded-sm',
    md: 'text-xs px-2.5 py-1 rounded-sm font-medium',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center border select-none',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};
