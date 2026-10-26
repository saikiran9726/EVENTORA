import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  toast: (options: { type?: ToastType; title: string; message?: string; duration?: number }) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const shouldReduceMotion = useReducedMotion();

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    ({
      type = 'info',
      title,
      message,
      duration = 4000,
    }: {
      type?: ToastType;
      title: string;
      message?: string;
      duration?: number;
    }) => {
      const id = Math.random().toString(36).substring(2, 9);
      const newToast: ToastItem = { id, type, title, message, duration };

      setToasts((prev) => [...prev, newToast]);

      if (duration > 0) {
        const timer = setTimeout(() => {
          removeToast(id);
        }, duration);
        timersRef.current.set(id, timer);
      }
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ toast: addToast, removeToast }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-16 md:bottom-6 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none pb-safe"
      >
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: shouldReduceMotion ? 0 : 12, scale: 0.96 }}
              transition={{ duration: shouldReduceMotion ? 0.01 : 0.18, ease: [0.2, 0.8, 0.2, 1] }}
              role={t.type === 'error' ? 'alert' : 'status'}
              aria-atomic="true"
              className={cn(
                'pointer-events-auto flex items-start gap-3 p-3.5 rounded-md border shadow-md bg-surface text-text',
                t.type === 'success' && 'border-success/30',
                t.type === 'error' && 'border-error/30',
                t.type === 'info' && 'border-brand/30',
                t.type === 'warning' && 'border-warning/30'
              )}
            >
              {t.type === 'success' && <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" aria-hidden="true" />}
              {t.type === 'error' && <AlertCircle className="w-5 h-5 text-error shrink-0 mt-0.5" aria-hidden="true" />}
              {t.type === 'info' && <Info className="w-5 h-5 text-brand shrink-0 mt-0.5" aria-hidden="true" />}
              {t.type === 'warning' && <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" aria-hidden="true" />}
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-semibold leading-tight text-text">{t.title}</p>
                {t.message && <p className="text-xs text-text-muted mt-1 leading-relaxed">{t.message}</p>}
              </div>
              <button
                onClick={() => removeToast(t.id)}
                className="text-text-muted hover:text-text p-1 rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                aria-label="Dismiss notification"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
