import React, { forwardRef, useId } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  description?: string;
  error?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      className,
      label,
      description,
      error,
      id: providedId,
      checked,
      onChange,
      disabled,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const id = providedId || generatedId;
    const descId = `${id}-desc`;
    const errorId = `${id}-error`;

    const describedBy = error
      ? errorId
      : description
        ? descId
        : undefined;

    return (
      <div className="flex flex-col gap-1 text-left min-w-0">
        <div className="flex items-start gap-2.5 select-none">
          <div className="relative flex items-center justify-center mt-0.5 shrink-0">
            <input
              id={id}
              ref={ref}
              type="checkbox"
              checked={checked}
              onChange={onChange}
              disabled={disabled}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
              className="peer sr-only"
              {...props}
            />
            <div
              className={cn(
                'w-4 h-4 rounded-sm border border-border bg-surface transition-colors duration-fast ease-eventora flex items-center justify-center cursor-pointer',
                'peer-checked:bg-brand peer-checked:border-brand peer-checked:text-white',
                'peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2',
                error && 'border-error',
                disabled && 'opacity-50 cursor-not-allowed bg-surface-2',
                className
              )}
              onClick={() => {
                if (!disabled && onChange) {
                  const event = {
                    target: { checked: !checked },
                  } as React.ChangeEvent<HTMLInputElement>;
                  onChange(event);
                }
              }}
            >
              {checked && <Check className="w-3 h-3 text-white stroke-[3]" aria-hidden="true" />}
            </div>
          </div>
          {(label || description) && (
            <label htmlFor={id} className="text-xs flex flex-col cursor-pointer">
              {label && <span className="font-semibold text-text">{label}</span>}
              {description && (
                <span id={descId} className="text-text-muted mt-0.5 leading-relaxed">
                  {description}
                </span>
              )}
            </label>
          )}
        </div>
        {error && (
          <span id={errorId} role="alert" className="text-xs text-error font-medium pl-6">
            {error}
          </span>
        )}
      </div>
    );
  }
);

Checkbox.displayName = 'Checkbox';
