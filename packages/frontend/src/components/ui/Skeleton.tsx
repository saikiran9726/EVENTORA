import React from 'react';
import { cn } from '@/lib/utils';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: string | number;
  height?: string | number;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className,
  style,
  width,
  height,
  ...props
}) => {
  return (
    <div
      aria-hidden="true"
      style={{
        width,
        height,
        ...style,
      }}
      className={cn(
        'animate-pulse rounded-md bg-surface-2 border border-border/50',
        className
      )}
      {...props}
    />
  );
};
