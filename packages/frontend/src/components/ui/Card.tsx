import React from 'react';
import { cn } from '@/lib/utils';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'surface' | 'surface-2';
  elevation?: 'none' | 'sm' | 'md';
}

export const Card: React.FC<CardProps> = ({
  className,
  variant = 'surface',
  elevation = 'sm',
  children,
  ...props
}) => {
  const variants = {
    surface: 'bg-surface',
    'surface-2': 'bg-surface-2',
  };

  const elevations = {
    none: '',
    sm: 'shadow-sm',
    md: 'shadow-md',
  };

  return (
    <div
      className={cn(
        'rounded-md border border-border p-4 transition-all duration-normal ease-eventora',
        variants[variant],
        elevations[elevation],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...props
}) => (
  <div className={cn('flex flex-col space-y-1.5 pb-3', className)} {...props}>
    {children}
  </div>
);

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  className,
  children,
  ...props
}) => (
  <h3 className={cn('text-base font-semibold leading-none tracking-tight text-text', className)} {...props}>
    {children}
  </h3>
);

export const CardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  className,
  children,
  ...props
}) => (
  <p className={cn('text-xs text-text-muted mt-1', className)} {...props}>
    {children}
  </p>
);

export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...props
}) => (
  <div className={cn('pt-0', className)} {...props}>
    {children}
  </div>
);

export const CardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...props
}) => (
  <div className={cn('flex items-center pt-3 border-t border-border mt-3', className)} {...props}>
    {children}
  </div>
);
