import * as Sentry from '@sentry/react';

let isFrontendSentryInitialized = false;

export function initFrontendSentry(dsn = import.meta.env.VITE_SENTRY_DSN) {
  if (isFrontendSentryInitialized) return;

  const release = import.meta.env.VITE_SENTRY_RELEASE || '1.0.0';
  const environment = import.meta.env.MODE || 'development';

  if (dsn) {
    Sentry.init({
      dsn,
      release,
      environment,
      integrations: [
        Sentry.browserTracingIntegration(),
      ],
      tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
    });
    console.info(`[Sentry] Frontend monitoring initialized (release: ${release})`);
  }

  isFrontendSentryInitialized = true;
}

export function captureFrontendException(
  error: unknown,
  context: { requestId?: string; component?: string; [key: string]: any } = {}
) {
  const { requestId, ...extra } = context;

  if (import.meta.env.VITE_SENTRY_DSN) {
    Sentry.withScope((scope) => {
      if (requestId) scope.setTag('requestId', requestId);
      for (const [key, val] of Object.entries(extra)) {
        scope.setExtra(key, val);
      }
      Sentry.captureException(error);
    });
  }
}
