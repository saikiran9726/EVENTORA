import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { reportError } from './lib/error-reporter';
import { initFrontendSentry } from './lib/sentry';

// Initialize frontend Sentry observability
initFrontendSentry();

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
    <App />
  </React.StrictMode>
);
