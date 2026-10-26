import React, { useEffect, useRef, useId } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  isDismissible?: boolean;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  className,
  isDismissible = true,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const sheetRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Body scroll-lock with restore
  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [isOpen]);

  // Focus trap, ESC, and return focus — strictly dependent ONLY on isOpen
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedElement.current = document.activeElement as HTMLElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isDismissible) {
        e.preventDefault();
        onCloseRef.current();
        return;
      }

      if (e.key === 'Tab' && sheetRef.current) {
        const focusable = sheetRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];

          if (e.shiftKey && (document.activeElement === first || document.activeElement === sheetRef.current)) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    const timer = setTimeout(() => {
      if (sheetRef.current) {
        const first = sheetRef.current.querySelector<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (first) {
          first.focus();
        } else {
          sheetRef.current.focus();
        }
      }
    }, 30);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocusedElement.current && typeof previouslyFocusedElement.current.focus === 'function') {
        previouslyFocusedElement.current.focus();
      }
    };
  }, [isOpen, isDismissible]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-0 bg-black/50 pb-safe"
          onClick={() => {
            if (isDismissible) {
              onCloseRef.current();
            }
          }}
          aria-modal="true"
          role="dialog"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0.01 : 0.15 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm -z-10"
          />

          <motion.div
            ref={sheetRef}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: shouldReduceMotion ? 0.01 : 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className={cn(
              'w-full max-h-[85vh] overflow-y-auto bg-surface border-t border-border shadow-2xl rounded-t-2xl p-5 flex flex-col focus:outline-none min-w-0',
              className
            )}
          >
            {/* Drag Handle */}
            <div className="flex justify-center pb-2 shrink-0 cursor-grab active:cursor-grabbing">
              <div className="w-12 h-1.5 bg-border rounded-full" />
            </div>

            <div className="flex items-center justify-between pb-3 border-b border-border shrink-0">
              <div className="min-w-0 pr-2">
                <h2 id={titleId} className="text-base sm:text-lg font-semibold text-text truncate">
                  {title}
                </h2>
                {description && (
                  <p id={descId} className="text-xs text-text-muted mt-0.5 leading-relaxed">
                    {description}
                  </p>
                )}
              </div>
              {isDismissible && (
                <button
                  type="button"
                  onClick={() => onCloseRef.current()}
                  className="p-1 rounded-sm text-text-muted hover:text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand shrink-0"
                  aria-label="Close bottom sheet"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="pt-3 min-w-0">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
