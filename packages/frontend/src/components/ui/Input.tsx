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

    const describedBy = error
      ? errorId
      : helperText
        ? helperId
        : undefined;

    return (
      <div className="flex flex-col gap-1 w-full text-left min-w-0">
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
          aria-describedby={describedBy}
          className={cn(
            'w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors duration-fast ease-eventora min-h-[40px]',
            'focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent',
            error && 'border-error focus:ring-error',
            props.disabled && 'opacity-50 cursor-not-allowed bg-surface-2',
            className
          )}
          {...props}
        />
        {error && (
          <span id={errorId} role="alert" className="text-xs text-error font-medium">
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
