import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { reportError } from './lib/error-reporter';
import { initFrontendSentry } from './lib/sentry';
import { registerServiceWorker } from './lib/pwa';
import { I18nProvider } from './i18n/I18nContext';

// Initialize frontend Sentry observability & PWA service worker
initFrontendSentry();
registerServiceWorker();

// Global unhandled promise rejection and uncaught error handlers
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { context: 'unhandledrejection' });
  });

  window.addEventListener('error', (event) => {
    reportError(event.error || event.message, { context: 'uncaught_error' });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
);
