import React, { forwardRef, useId } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, helperText, id: providedId, ...props }, ref) => {
    const generatedId = useId();
    const id = providedId || generatedId;
    const errorId = `${id}-error`;
    const helperId = `${id}-helper`;

    return (
      <div className="flex flex-col gap-1 w-full text-left">
        {label && (
          <label htmlFor={id} className="text-xs font-semibold text-text">
            {label}
            {props.required && <span className="text-error ml-1">*</span>}
          </label>
        )}
        <input
          id={id}
          ref={ref}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : helperText ? helperId : undefined}
          className={cn(
            'w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors duration-fast ease-eventora',
            error && 'border-error focus:border-error',
            className
          )}
          {...props}
        />
        {error && (
          <span id={errorId} className="text-xs text-error font-medium">
            {error}
          </span>
        )}
        {!error && helperText && (
          <span id={helperId} className="text-xs text-text-muted">
            {helperText}
          </span>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
