import React, { forwardRef, useId } from 'react';
import { Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DatePickerProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const DatePicker = forwardRef<HTMLInputElement, DatePickerProps>(
  ({ className, label, error, id: providedId, ...props }, ref) => {
    const generatedId = useId();
    const id = providedId || generatedId;

    return (
      <div className="flex flex-col gap-1 w-full text-left">
        {label && (
          <label htmlFor={id} className="text-xs font-semibold text-text">
            {label}
            {props.required && <span className="text-error ml-1">*</span>}
          </label>
        )}
        <div className="relative">
          <input
            id={id}
            ref={ref}
            type="date"
            aria-invalid={Boolean(error)}
            className={cn(
              'w-full bg-surface border border-border rounded-md px-3 py-2 pr-9 text-sm text-text transition-colors duration-fast ease-eventora',
              error && 'border-error',
              className
            )}
            {...props}
          />
          <Calendar className="w-4 h-4 text-text-muted absolute right-3 top-2.5 pointer-events-none" />
        </div>
        {error && <span className="text-xs text-error font-medium">{error}</span>}
      </div>
    );
  }
);

DatePicker.displayName = 'DatePicker';
