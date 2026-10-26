import React, { useId } from 'react';
import { cn } from '@/lib/utils';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  label,
  description,
  error,
  disabled = false,
  className,
  id: providedId,
}) => {
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
    <div className={cn('flex flex-col gap-1 text-left min-w-0', className)}>
      <div className="flex items-center justify-between gap-4 select-none">
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
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          disabled={disabled}
          onClick={() => !disabled && onChange(!checked)}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-fast ease-eventora',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
            checked ? 'bg-brand' : 'bg-surface-3 border-border',
            error && 'ring-2 ring-error',
            disabled && 'opacity-50 cursor-not-allowed bg-surface-2'
          )}
        >
          <span
            className={cn(
              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition-transform duration-fast ease-eventora',
              checked ? 'translate-x-5' : 'translate-x-0'
            )}
            aria-hidden="true"
          />
        </button>
      </div>
      {error && (
        <span id={errorId} role="alert" className="text-xs text-error font-medium">
          {error}
        </span>
      )}
    </div>
  );
};
