export type SupportedLocale = 'en' | 'hi' | 'te';

export interface LocaleInfo {
  code: SupportedLocale;
  name: string;
  nativeName: string;
}

export const SUPPORTED_LOCALES: LocaleInfo[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
];

export interface TranslationDictionary {
  common: {
    appName: string;
    loading: string;
    error: string;
    retry: string;
    cancel: string;
    confirm: string;
    save: string;
    delete: string;
    search: string;
    filter: string;
    back: string;
    skipToMain: string;
    language: string;
    theme: string;
    lightMode: string;
    darkMode: string;
    offlineBadge: string;
    updateAvailable: string;
    updateNow: string;
    copyRef: string;
  };
  navigation: {
    discover: string;
    calendar: string;
    tickets: string;
    passport: string;
    profile: string;
    teams: string;
    volunteers: string;
    dashboard: string;
    scanner: string;
  };
  events: {
    details: string;
    register: string;
    registered: string;
    soldOut: string;
    free: string;
    startsAt: string;
    endsAt: string;
    venue: string;
    organizer: string;
    share: string;
    addToCalendar: string;
    categories: string;
  };
  checkout: {
    summary: string;
    selectTier: string;
    attendeeDetails: string;
    completePayment: string;
    verifyingPayment: string;
    paymentConfirmed: string;
    receiptNumber: string;
    downloadReceipt: string;
  };
  scanner: {
    title: string;
    pointCamera: string;
    switchCamera: string;
    toggleTorch: string;
    scanAccepted: string;
    scanDuplicate: string;
    scanInvalid: string;
    offlineMode: string;
    syncPending: string;
  };
  passport: {
    title: string;
    verifiedStudent: string;
    achievements: string;
    attendanceTimeline: string;
    shareLink: string;
  };
}
