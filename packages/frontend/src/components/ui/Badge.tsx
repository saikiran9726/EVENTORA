import React from 'react';
import { LucideIcon, CheckCircle2, AlertTriangle, AlertCircle, Info, Sparkles, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BadgeVariant = 'brand' | 'success' | 'warning' | 'error' | 'info' | 'neutral';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  icon?: LucideIcon;
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = 'neutral',
  size = 'md',
  icon: CustomIcon,
  children,
  ...props
}) => {
  const defaultIcons: Record<BadgeVariant, LucideIcon> = {
    brand: Sparkles,
    success: CheckCircle2,
    warning: AlertTriangle,
    error: AlertCircle,
    info: Info,
    neutral: Tag,
  };

  const IconComponent = CustomIcon || defaultIcons[variant];

  const variants: Record<BadgeVariant, string> = {
    brand: 'bg-brand/10 text-brand border-brand/20',
    success: 'bg-success/10 text-success border-success/20',
    warning: 'bg-warning/10 text-warning border-warning/20',
    error: 'bg-error/10 text-error border-error/20',
    info: 'bg-info/10 text-info border-info/20',
    neutral: 'bg-surface-2 text-text-muted border-border',
  };

  const sizes = {
    sm: 'text-[11px] px-2 py-0.5 rounded-sm gap-1',
    md: 'text-xs px-2.5 py-1 rounded-sm font-medium gap-1.5',
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-3.5 h-3.5',
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
      {IconComponent && <IconComponent className={cn('shrink-0', iconSizes[size])} aria-hidden="true" />}
      <span>{children}</span>
    </span>
  );
};
