import React from 'react';
import { useI18n } from '@/i18n/I18nContext';
import { SUPPORTED_LOCALES, SupportedLocale } from '@/i18n/types';
import { Globe } from 'lucide-react';

export const LanguageSelector: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <label htmlFor="language-select" className="sr-only">
        {t('common.language')}
      </label>
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 min-h-[44px] rounded-md border border-border bg-surface text-text text-xs hover:bg-surface-2 transition-colors">
        <Globe className="w-4 h-4 text-brand shrink-0" aria-hidden="true" />
        <select
          id="language-select"
          value={locale}
          onChange={(e) => setLocale(e.target.value as SupportedLocale)}
          aria-label={t('common.language')}
          className="bg-transparent text-text text-xs font-medium focus:outline-none cursor-pointer"
        >
          {SUPPORTED_LOCALES.map((loc) => (
            <option key={loc.code} value={loc.code} className="bg-surface text-text">
              {loc.nativeName} ({loc.name})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
