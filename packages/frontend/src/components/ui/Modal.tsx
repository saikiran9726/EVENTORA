import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  className,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const modalRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previouslyFocusedElement.current = document.activeElement as HTMLElement;

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose();
        }

        // Focus trap
        if (e.key === 'Tab' && modalRef.current) {
          const focusable = modalRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (focusable.length > 0) {
            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (e.shiftKey && document.activeElement === first) {
              last.focus();
              e.preventDefault();
            } else if (!e.shiftKey && document.activeElement === last) {
              first.focus();
              e.preventDefault();
            }
          }
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      // Auto-focus container or first focusable
      setTimeout(() => {
        if (modalRef.current) {
          const first = modalRef.current.querySelector<HTMLElement>(
            'button, [href], input, select, textarea'
          );
          if (first) first.focus();
          else modalRef.current.focus();
        }
      }, 50);

      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        if (previouslyFocusedElement.current) {
          previouslyFocusedElement.current.focus();
        }
      };
    }
  }, [isOpen, onClose]);

  const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  };

  const sheetVariants = {
    hidden: { y: '100%', opacity: shouldReduceMotion ? 0 : 1 },
    visible: { y: 0, opacity: 1 },
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 bg-black/50"
          onClick={onClose}
          aria-modal="true"
          role="dialog"
          aria-labelledby="modal-title"
          aria-describedby={description ? 'modal-description' : undefined}
        >
          {/* Backdrop animation */}
          <motion.div
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={backdropVariants}
            transition={{
              duration: shouldReduceMotion ? 0.01 : 0.2,
              ease: [0.2, 0.8, 0.2, 1],
            }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm -z-10"
          />

          {/* Modal / Bottom Sheet content */}
          <motion.div
            ref={modalRef}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={sheetVariants}
            transition={{
              duration: shouldReduceMotion ? 0.01 : 0.2,
              ease: [0.2, 0.8, 0.2, 1],
            }}
            className={cn(
              'w-full max-h-[90vh] overflow-y-auto bg-surface border border-border shadow-md rounded-t-lg md:rounded-lg max-w-lg p-5 flex flex-col',
              className
            )}
          >
            {/* Mobile Drag Handle */}
            <div className="md:hidden flex justify-center pb-2">
              <div className="w-12 h-1.5 bg-border rounded-full" />
            </div>

            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div>
                <h2 id="modal-title" className="text-base font-semibold text-text">
                  {title}
                </h2>
                {description && (
                  <p id="modal-description" className="text-xs text-text-muted mt-0.5">
                    {description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="p-1 rounded-sm text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-4">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
