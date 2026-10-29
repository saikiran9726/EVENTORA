import React, { useState, useEffect } from 'react';
import { onPWAUpdate, activatePWAUpdate } from '@/lib/pwa';
import { useI18n } from '@/i18n/I18nContext';
import { RefreshCw, X, Sparkles } from 'lucide-react';
import { Button } from './Button';

export const PWAUpdatePrompt: React.FC = () => {
  const [waitingRegistration, setWaitingRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    const unsubscribe = onPWAUpdate((registration) => {
      setWaitingRegistration(registration);
    });

    // Reload window when new service worker takes control
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    }

    return () => {
      unsubscribe();
    };
  }, []);

  if (!waitingRegistration || dismissed) {
    return null;
  }

  const handleUpdate = () => {
    activatePWAUpdate(waitingRegistration);
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed bottom-20 md:bottom-6 left-4 right-4 md:left-auto md:right-6 md:max-w-md z-50 bg-surface border border-brand/40 shadow-xl rounded-lg p-4 flex items-center justify-between gap-3 text-text animate-in fade-in slide-in-from-bottom-4 duration-200"
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-brand/10 text-brand flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-brand" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs font-semibold text-text">
            {t('common.updateAvailable')}
          </p>
          <p className="text-[11px] text-text-muted mt-0.5">
            Instant update with latest campus events and fixes.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={handleUpdate}
          className="min-h-[44px] px-3 text-xs flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{t('common.updateNow')}</span>
        </Button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="p-2 min-h-[44px] min-w-[44px] rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand flex items-center justify-center"
          aria-label={t('common.cancel')}
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
