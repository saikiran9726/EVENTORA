import { ErrorEnvelopeSchema, createErrorEnvelope } from '@eventora/shared';

export interface ApiClientOptions extends RequestInit {
  timeoutMs?: number;
}

export class ApiError extends Error {
  public readonly code: string;
  public readonly details: Record<string, any>;
  public readonly requestId: string;
  public readonly status: number;
  public readonly error: {
    code: string;
    message: string;
    details: Record<string, any>;
    requestId: string;
  };

  constructor(code: string, message: string, requestId: string, details: Record<string, any> = {}, status = 500) {
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

export function setCsrfToken(token: string | null) {
  inMemoryCsrfToken = token;
}

export function setSessionToken(token: string | null) {
  inMemorySessionToken = token;
}

/**
 * Returns active CSRF token from document.cookie or memory
 */
export function getCsrfToken(): string | null {
  if (inMemoryCsrfToken) return inMemoryCsrfToken;
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(^|;)\s*eventora_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Typed API client skeleton implementing standard error-envelope parsing,
 * double-submit CSRF headers, unique request-ID tracing, and timeout/abort signals.
 */
export async function apiClient<T>(
  endpoint: string,
  options: ApiClientOptions = {}
): Promise<T> {
  const { timeoutMs = 15000, headers: customHeaders, signal: externalSignal, ...fetchOptions } = options;

  // Generate unique request ID for client-side tracing
  const requestId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  // Abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('Request timeout')), timeoutMs);

  // Combine external abort signal if provided
  if (externalSignal) {
    externalSignal.addEventListener('abort', () => controller.abort());
  }

  const headers = new Headers(customHeaders);
  headers.set('X-Request-ID', requestId);
  headers.set('Accept', 'application/json');

  if (inMemorySessionToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${inMemorySessionToken}`);
  }

  // Inject double-submit CSRF token on non-GET / non-HEAD requests
  const method = (fetchOptions.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
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

    clearTimeout(timeoutId);

    // Parse response JSON
    let responseData: any = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    if (!response.ok) {
      // Validate or construct standard error envelope
      const parseResult = ErrorEnvelopeSchema.safeParse(responseData);
      if (parseResult.success) {
        const err = parseResult.data.error;
        throw new ApiError(err.code, err.message, err.requestId || requestId, err.details, response.status);
      } else {
        const fallbackEnvelope = createErrorEnvelope(
          'HTTP_ERROR',
          typeof responseData === 'string' && responseData.length > 0 ? responseData : response.statusText,
          requestId,
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
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error instanceof ApiError) {
      throw error;
    }
    const isTimeout = error.name === 'AbortError' || error.message === 'Request timeout';
    throw new ApiError(
      isTimeout ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
      isTimeout ? 'The operation timed out. Please check your connectivity.' : (error.message || 'Network request failed'),
      requestId,
      { originalError: error.name },
      isTimeout ? 408 : 0
    );
  }
}

// Convenience methods
apiClient.get = function <T>(endpoint: string, options?: ApiClientOptions) {
  return apiClient<T>(endpoint, { ...options, method: 'GET' });
};

apiClient.post = function <T>(endpoint: string, body?: any, options?: ApiClientOptions) {
  return apiClient<T>(endpoint, {
    ...options,
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
};

apiClient.patch = function <T>(endpoint: string, body?: any, options?: ApiClientOptions) {
  return apiClient<T>(endpoint, {
    ...options,
    method: 'PATCH',
    body: body ? JSON.stringify(body) : undefined,
  });
};

apiClient.delete = function <T>(endpoint: string, options?: ApiClientOptions) {
  return apiClient<T>(endpoint, { ...options, method: 'DELETE' });
};

apiClient.setCsrfToken = setCsrfToken;
apiClient.setSessionToken = setSessionToken;
