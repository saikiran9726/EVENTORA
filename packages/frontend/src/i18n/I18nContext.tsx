import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import enCatalog from './en.json';
import hiCatalog from './hi.json';
import teCatalog from './te.json';
import { SupportedLocale } from './types';
import { formatPaiseToRupee, formatISTDateTime, formatISTDate, formatISTTime } from '@eventora/shared';

const catalogs: Record<SupportedLocale, any> = {
  en: enCatalog,
  hi: hiCatalog,
  te: teCatalog,
};

interface I18nContextType {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  formatRupees: (paise: number, forceDecimals?: boolean) => string;
  formatIST: (
    dateInput: string | number | Date,
    mode?: 'datetime' | 'date' | 'time'
  ) => string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<SupportedLocale>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('eventora_locale');
      if (saved && (saved === 'en' || saved === 'hi' || saved === 'te')) {
        return saved;
      }
      const navLang = navigator.language?.toLowerCase() || '';
      if (navLang.startsWith('te')) return 'te';
      if (navLang.startsWith('hi')) return 'hi';
    }
    return 'en';
  });

  const setLocale = useCallback((newLocale: SupportedLocale) => {
    setLocaleState(newLocale);
    if (typeof window !== 'undefined') {
      localStorage.setItem('eventora_locale', newLocale);
      document.documentElement.lang = newLocale;
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const t = useCallback(
    (path: string, params?: Record<string, string | number>): string => {
      const parts = path.split('.');
      let currentVal = catalogs[locale];

      for (const part of parts) {
        if (currentVal && typeof currentVal === 'object' && part in currentVal) {
          currentVal = currentVal[part];
        } else {
          currentVal = undefined;
          break;
        }
      }

      // Fallback to English catalog if missing in selected locale
      if (typeof currentVal !== 'string') {
        let fallbackVal: any = enCatalog;
        for (const part of parts) {
          if (fallbackVal && typeof fallbackVal === 'object' && part in fallbackVal) {
            fallbackVal = fallbackVal[part];
          } else {
            fallbackVal = undefined;
            break;
          }
        }
        currentVal = typeof fallbackVal === 'string' ? fallbackVal : path;
      }

      if (params && typeof currentVal === 'string') {
        return Object.entries(params).reduce((str, [k, v]) => {
          return str.replace(new RegExp(`{${k}}`, 'g'), String(v));
        }, currentVal);
      }

      return currentVal;
    },
    [locale]
  );

  const formatRupees = useCallback((paise: number, forceDecimals = false) => {
    return formatPaiseToRupee(paise, forceDecimals);
  }, []);

  const formatIST = useCallback(
    (dateInput: string | number | Date, mode: 'datetime' | 'date' | 'time' = 'datetime') => {
      try {
        if (mode === 'date') return formatISTDate(dateInput);
        if (mode === 'time') return formatISTTime(dateInput);
        return formatISTDateTime(dateInput);
      } catch {
        return String(dateInput);
      }
    },
    []
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, formatRupees, formatIST }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
};
