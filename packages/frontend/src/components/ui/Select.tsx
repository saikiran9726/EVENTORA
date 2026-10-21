import React, { forwardRef, useId } from 'react';
import { cn } from '@/lib/utils';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, options, id: providedId, ...props }, ref) => {
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
        <select
          id={id}
          ref={ref}
          aria-invalid={Boolean(error)}
          className={cn(
            'w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text transition-colors duration-fast ease-eventora',
            error && 'border-error',
            className
          )}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-surface text-text">
              {opt.label}
            </option>
          ))}
        </select>
        {error && <span className="text-xs text-error font-medium">{error}</span>}
      </div>
    );
  }
);

Select.displayName = 'Select';
