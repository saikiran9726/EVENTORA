/**
 * Eventora Frontend Error Reporter
 * Centralized error logging and diagnostics utility.
 */

export interface ErrorReportContext {
  component?: string;
  action?: string;
  endpoint?: string;
  requestId?: string;
  [key: string]: any;
}

export function reportError(error: unknown, context?: ErrorReportContext): void {
  const isDev = typeof process !== 'undefined'
    ? process.env.NODE_ENV !== 'production'
    : true;

  if (isDev) {
    console.error('[Eventora Error]', {
      error,
      context: context || {},
      timestamp: new Date().toISOString(),
    });
  }

  // Dispatch custom event for telemetry or dev monitors
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('eventora:error', {
        detail: { error, context, timestamp: Date.now() },
      })
    );
  }
}
