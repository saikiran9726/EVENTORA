import React, { createContext, useContext, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastContextType {
  toast: (options: { type?: ToastType; title: string; message?: string }) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = ({
    type = 'info',
    title,
    message,
  }: {
    type?: ToastType;
    title: string;
    message?: string;
  }) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, title, message }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-16 md:bottom-6 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-start gap-3 p-3.5 rounded-md border shadow-md bg-surface text-text transition-all duration-normal ease-eventora',
              t.type === 'success' && 'border-success/30 text-text',
              t.type === 'error' && 'border-error/30 text-text',
              t.type === 'info' && 'border-brand/30 text-text',
              t.type === 'warning' && 'border-warning/30 text-text'
            )}
          >
            {t.type === 'success' && <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />}
            {t.type === 'error' && <AlertCircle className="w-5 h-5 text-error shrink-0 mt-0.5" />}
            {t.type === 'info' && <Info className="w-5 h-5 text-brand shrink-0 mt-0.5" />}
            {t.type === 'warning' && <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />}
            <div className="flex-1">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.message && <p className="text-xs text-text-muted mt-0.5">{t.message}</p>}
            </div>
            <button
              onClick={() => removeToast(t.id)}
              className="text-text-muted hover:text-text p-1 rounded-sm"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
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
