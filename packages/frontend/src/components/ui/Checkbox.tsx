import React, { forwardRef, useId } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  description?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, description, id: providedId, checked, onChange, disabled, ...props }, ref) => {
    const generatedId = useId();
    const id = providedId || generatedId;

    return (
      <div className="flex items-start gap-2.5 text-left select-none">
        <div className="relative flex items-center justify-center mt-0.5">
          <input
            id={id}
            ref={ref}
            type="checkbox"
            checked={checked}
            onChange={onChange}
            disabled={disabled}
            className="peer sr-only"
            {...props}
          />
          <div
            className={cn(
              'w-4 h-4 rounded-sm border border-border bg-surface transition-colors duration-fast ease-eventora flex items-center justify-center cursor-pointer',
              'peer-checked:bg-brand peer-checked:border-brand peer-checked:text-white',
              'peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2',
              disabled && 'opacity-50 cursor-not-allowed',
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
            {checked && <Check className="w-3 h-3 text-white stroke-[3]" />}
          </div>
        </div>
        {(label || description) && (
          <label htmlFor={id} className="text-xs flex flex-col cursor-pointer">
            {label && <span className="font-semibold text-text">{label}</span>}
            {description && <span className="text-text-muted mt-0.5">{description}</span>}
          </label>
        )}
      </div>
    );
  }
);

Checkbox.displayName = 'Checkbox';
