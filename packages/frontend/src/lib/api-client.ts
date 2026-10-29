import {
  ErrorEnvelopeSchema,
  createErrorEnvelope,
  createTypedClient,
  validateEndpointContract,
  ErrorCode,
} from '@eventora/shared';

export interface ApiClientOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  skipColdStartDetection?: boolean;
}

export class ApiError extends Error {
  public readonly code: ErrorCode | string;
  public readonly details: Record<string, any>;
  public readonly requestId: string;
  public readonly status: number;
  public readonly error: {
    code: string;
    message: string;
    details: Record<string, any>;
    requestId: string;
  };

  constructor(
    code: string,
    message: string,
    requestId: string,
    details: Record<string, any> = {},
    status = 500
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.status = status;
    this.error = { code, message, details, requestId };
  }
}

let inMemoryCsrfToken: string | null = null;
let inMemorySessionToken: string | null = null;

let onUnauthorizedHandler: (() => void) | null = null;
let onColdStartHandler: ((isColdStarting: boolean) => void) | null = null;
let activeColdStartsCount = 0;

export function setCsrfToken(token: string | null) {
  inMemoryCsrfToken = token;
}

export function setSessionToken(token: string | null) {
  inMemorySessionToken = token;
}

export function getSessionToken(): string | null {
  return inMemorySessionToken;
}

export function setOnUnauthorized(callback: (() => void) | null) {
  onUnauthorizedHandler = callback;
}

export function setOnColdStart(callback: ((isColdStarting: boolean) => void) | null) {
  onColdStartHandler = callback;
}

/**
 * Returns active CSRF token from document.cookie or in-memory fallback
 */
export function getCsrfToken(): string | null {
  if (inMemoryCsrfToken) return inMemoryCsrfToken;
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(^|;)\s*eventora_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[2]) : null;
}

function updateColdStartState(isColdStarting: boolean) {
  if (isColdStarting) {
    activeColdStartsCount++;
    if (activeColdStartsCount === 1) {
      if (onColdStartHandler) onColdStartHandler(true);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('eventora:server-waking'));
      }
    }
  } else {
    if (activeColdStartsCount > 0) {
      activeColdStartsCount--;
      if (activeColdStartsCount === 0) {
        if (onColdStartHandler) onColdStartHandler(false);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('eventora:server-ready'));
        }
      }
    }
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Robust typed API client with:
 * - CSRF token & X-Request-ID propagation
 * - Cold-start warning for Render free instances (> 3s)
 * - Clean AbortController management (no event listener leaks)
 * - User abort vs timeout differentiation
 * - Exponential backoff retry on idempotent requests
 * - Global 401 unauthorized interception
 */
export async function apiClient<T>(
  endpoint: string,
  options: ApiClientOptions = {}
): Promise<T> {
  const {
    timeoutMs = 30000,
    retries,
    retryDelayMs = 300,
    skipColdStartDetection = false,
    headers: customHeaders,
    signal: externalSignal,
    ...fetchOptions
  } = options;

  const method = (fetchOptions.method || 'GET').toUpperCase();
  const isIdempotent = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  const maxRetries = retries !== undefined ? retries : isIdempotent ? 2 : 0;

  let attempt = 0;

  while (true) {
    // Generate unique request ID for client-side tracing
    const requestId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // If external signal was already aborted before we even start
    if (externalSignal?.aborted) {
      throw new ApiError(
        'USER_ABORTED',
        'Request was aborted by user',
        requestId,
        {},
        499
      );
    }

    const controller = new AbortController();
    let timedOut = false;
    let didColdStartNotify = false;

    // Timeout timer
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    // Cold start notification timer (Render free tier wakes up in 15-45s)
    let coldStartTimer: any = null;
    if (!skipColdStartDetection) {
      coldStartTimer = setTimeout(() => {
        didColdStartNotify = true;
        updateColdStartState(true);
      }, 3000);
    }

    // Attach external abort signal listener
    let onExternalAbort: (() => void) | null = null;
    if (externalSignal) {
      onExternalAbort = () => {
        controller.abort();
      };
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    const headers = new Headers(customHeaders);
    headers.set('X-Request-ID', requestId);
    headers.set('Accept', 'application/json');

    if (inMemorySessionToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${inMemorySessionToken}`);
    }

    // Inject double-submit CSRF token on non-GET / non-HEAD requests
    if (!isIdempotent) {
      const csrfToken = getCsrfToken();
      if (csrfToken) {
        headers.set('X-CSRF-Token', csrfToken);
      }
      if (!headers.has('Content-Type') && !(fetchOptions.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
      }
    }

    try {
      const response = await fetch(endpoint, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
        credentials: 'include',
      });

      // Response received, cleanup timers immediately
      clearTimeout(timeoutId);
      if (coldStartTimer) clearTimeout(coldStartTimer);
      if (didColdStartNotify) {
        updateColdStartState(false);
        didColdStartNotify = false;
      }

      // Handle 401 Unauthorized
      if (response.status === 401) {
        try {
          if (onUnauthorizedHandler) {
            onUnauthorizedHandler();
          }
        } catch {
          // Guard against errors inside the unauthorized callback
        }
      }

      // Parse response body
      let responseData: any = null;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }

      if (!response.ok) {
        // If idempotent and response is retryable (502, 503, 504), retry with backoff
        if (isIdempotent && attempt < maxRetries && isRetryableStatus(response.status)) {
          attempt++;
          const delay = retryDelayMs * Math.pow(2, attempt - 1) + Math.random() * 50;
          await sleep(delay);
          continue;
        }

        const serverRequestId = response.headers.get('x-request-id') || response.headers.get('X-Request-ID');

        // Validate or construct standard error envelope
        const parseResult = ErrorEnvelopeSchema.safeParse(responseData);
        if (parseResult.success) {
          const err = parseResult.data.error;
          throw new ApiError(
            err.code,
            err.message,
            err.requestId || serverRequestId || requestId,
            err.details,
            response.status
          );
        } else {
          const fallbackEnvelope = createErrorEnvelope(
            'HTTP_ERROR',
            typeof responseData === 'string' && responseData.length > 0
              ? responseData
              : response.statusText,
            serverRequestId || requestId,
            { status: response.status }
          );
          throw new ApiError(
            fallbackEnvelope.error.code,
            fallbackEnvelope.error.message,
            fallbackEnvelope.error.requestId,
            fallbackEnvelope.error.details,
            response.status
          );
        }
      }

      return responseData as T;
    } catch (rawError: any) {
      clearTimeout(timeoutId);
      if (coldStartTimer) clearTimeout(coldStartTimer);
      if (didColdStartNotify) {
        updateColdStartState(false);
        didColdStartNotify = false;
      }

      // User aborted
      if (externalSignal?.aborted) {
        throw new ApiError(
          'USER_ABORTED',
          'Request was aborted by user',
          requestId,
          {},
          499
        );
      }

      // Timed out
      if (timedOut) {
        const timeoutError = new ApiError(
          'REQUEST_TIMEOUT',
          'The operation timed out. Please check your connectivity.',
          requestId,
          { timeoutMs },
          408
        );

        if (isIdempotent && attempt < maxRetries) {
          attempt++;
          const delay = retryDelayMs * Math.pow(2, attempt - 1) + Math.random() * 50;
          await sleep(delay);
          continue;
        }

        throw timeoutError;
      }

      // If it's already an ApiError (from !response.ok), throw directly
      if (rawError instanceof ApiError) {
        throw rawError;
      }

      // Transient network failure (e.g. failed to fetch, DNS / network dropped)
      const networkError = new ApiError(
        'NETWORK_ERROR',
        rawError.message || 'Network request failed',
        requestId,
        { originalError: rawError.name },
        0
      );

      if (isIdempotent && attempt < maxRetries) {
        attempt++;
        const delay = retryDelayMs * Math.pow(2, attempt - 1) + Math.random() * 50;
        await sleep(delay);
        continue;
      }

      throw networkError;
    } finally {
      // Unconditionally remove abort listener to avoid leaks
      if (externalSignal && onExternalAbort) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
      clearTimeout(timeoutId);
      if (coldStartTimer) clearTimeout(coldStartTimer);
      if (didColdStartNotify) {
        updateColdStartState(false);
      }
    }
  }
}

// Type-safe HTTP convenience helpers
apiClient.get = function <T>(endpoint: string, options?: ApiClientOptions): Promise<T> {
  return apiClient<T>(endpoint, { ...options, method: 'GET' });
};

apiClient.post = function <T>(
  endpoint: string,
  body?: any,
  options?: ApiClientOptions
): Promise<T> {
  const isFormData = body instanceof FormData;
  const isString = typeof body === 'string';
  return apiClient<T>(endpoint, {
    ...options,
    method: 'POST',
    body: isFormData || isString ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
};

apiClient.put = function <T>(
  endpoint: string,
  body?: any,
  options?: ApiClientOptions
): Promise<T> {
  const isFormData = body instanceof FormData;
  const isString = typeof body === 'string';
  return apiClient<T>(endpoint, {
    ...options,
    method: 'PUT',
    body: isFormData || isString ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
};

apiClient.patch = function <T>(
  endpoint: string,
  body?: any,
  options?: ApiClientOptions
): Promise<T> {
  const isFormData = body instanceof FormData;
  const isString = typeof body === 'string';
  return apiClient<T>(endpoint, {
    ...options,
    method: 'PATCH',
    body: isFormData || isString ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
};

apiClient.delete = function <T>(endpoint: string, options?: ApiClientOptions): Promise<T> {
  return apiClient<T>(endpoint, { ...options, method: 'DELETE' });
};

apiClient.setCsrfToken = setCsrfToken;
apiClient.setSessionToken = setSessionToken;
apiClient.getSessionToken = getSessionToken;
apiClient.setOnUnauthorized = setOnUnauthorized;
apiClient.setOnColdStart = setOnColdStart;

// Typed Client generated from @eventora/shared OpenAPI contracts
apiClient.typed = createTypedClient(apiClient);
apiClient.validateContract = validateEndpointContract;
