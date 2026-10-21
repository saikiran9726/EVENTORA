import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StepItem {
  id: string;
  title: string;
  description?: string;
}

export interface StepperProps {
  steps: StepItem[];
  currentStepIndex: number;
  className?: string;
}

export const Stepper: React.FC<StepperProps> = ({ steps, currentStepIndex, className }) => {
  return (
    <nav aria-label="Progress steps" className={cn('w-full py-2', className)}>
      <ol className="flex items-center justify-between w-full">
        {steps.map((step, index) => {
          const isCompleted = index < currentStepIndex;
          const isCurrent = index === currentStepIndex;

          return (
            <li
              key={step.id}
              className={cn(
                'flex-1 flex items-center',
                index < steps.length - 1 ? 'pr-2' : ''
              )}
            >
              <div className="flex flex-col items-center flex-1">
                <div className="flex items-center w-full">
                  <div
                    className={cn(
                      'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 transition-colors duration-fast',
                      isCompleted
                        ? 'bg-success text-white'
                        : isCurrent
                        ? 'bg-brand text-white ring-2 ring-brand/20 ring-offset-2'
                        : 'bg-surface-2 text-text-muted border border-border'
                    )}
                    aria-current={isCurrent ? 'step' : undefined}
                  >
                    {isCompleted ? <Check className="w-4 h-4 stroke-[3]" /> : index + 1}
                  </div>

                  {index < steps.length - 1 && (
                    <div
                      className={cn(
                        'flex-1 h-0.5 mx-2 transition-colors duration-fast',
                        isCompleted ? 'bg-success' : 'bg-border'
                      )}
                    />
                  )}
                </div>

                <div className="text-center mt-1.5 hidden sm:block">
                  <p
                    className={cn(
                      'text-xs font-medium truncate max-w-[100px]',
                      isCurrent ? 'text-brand font-semibold' : 'text-text'
                    )}
                  >
                    {step.title}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
