import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  apiClient,
  ApiError,
  getCsrfToken,
  setCsrfToken,
  setSessionToken,
  setOnUnauthorized,
  setOnColdStart,
} from '../../packages/frontend/src/lib/api-client';

describe('Phase P05: Typed API Client Robustness Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    setCsrfToken(null);
    setSessionToken(null);
    setOnUnauthorized(null);
    setOnColdStart(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('parses active CSRF token from document.cookie', () => {
    expect(getCsrfToken()).toBeNull();
    (globalThis as any).document = {
      cookie: 'eventora_csrf=test-csrf-token-12345; other_cookie=val',
    };
    expect(getCsrfToken()).toBe('test-csrf-token-12345');
    delete (globalThis as any).document;
  });

  it('injects X-Request-ID, Accept headers, and Bearer token on requests', async () => {
    setSessionToken('session-jwt-token-9988');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await apiClient.get<{ success: boolean }>('/api/v1/test');
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers as Headers;
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('X-Request-ID')).toBeDefined();
    expect(headers.get('Authorization')).toBe('Bearer session-jwt-token-9988');
  });

  it('parses standard error envelope when response is not ok', async () => {
    const errorPayload = {
      error: {
        code: 'UNAUTHORIZED_ACCESS',
        message: 'Authentication required for event proposal',
        details: { policy: 'event:create' },
        requestId: 'req-test-9921',
      },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => errorPayload,
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(apiClient.post('/api/events/proposal', {})).rejects.toThrow(ApiError);

    try {
      await apiClient.post('/api/events/proposal', {});
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err.code).toBe('UNAUTHORIZED_ACCESS');
      expect(err.status).toBe(401);
      expect(err.requestId).toBe('req-test-9921');
      expect(err.details.policy).toBe('event:create');
    }
  });

  it('invokes global onUnauthorized callback on 401 response', async () => {
    const onUnauthorized = vi.fn();
    setOnUnauthorized(onUnauthorized);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: { code: 'UNAUTHORIZED', message: 'Session expired', requestId: 'req-1' },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(apiClient.get('/api/v1/protected')).rejects.toThrow(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('distinguishes user abort from timeout and removes abort listener on finish (no leak)', async () => {
    const userController = new AbortController();
    const addListenerSpy = vi.spyOn(userController.signal, 'addEventListener');
    const removeListenerSpy = vi.spyOn(userController.signal, 'removeEventListener');

    const mockFetch = vi.fn().mockImplementation((_url, options) => {
      return new Promise((_, reject) => {
        const signal = options.signal as AbortSignal;
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    // Trigger user abort
    const promise = apiClient.get('/api/v1/search', { signal: userController.signal });
    userController.abort();

    await expect(promise).rejects.toThrow(ApiError);

    try {
      await promise;
    } catch (err: any) {
      expect(err.code).toBe('USER_ABORTED');
      expect(err.status).toBe(499);
    }

    // Verify listeners were cleaned up
    expect(addListenerSpy).toHaveBeenCalled();
    expect(removeListenerSpy).toHaveBeenCalled();
  });

  it('rejects with REQUEST_TIMEOUT (408) when request exceeds timeoutMs', async () => {
    const mockFetch = vi.fn().mockImplementation((_url, options) => {
      return new Promise((_, reject) => {
        const signal = options.signal as AbortSignal;
        signal.addEventListener('abort', () => {
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(apiClient.get('/api/slow-query', { timeoutMs: 50, retries: 0 })).rejects.toThrow(ApiError);

    try {
      await apiClient.get('/api/slow-query', { timeoutMs: 50, retries: 0 });
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err.code).toBe('REQUEST_TIMEOUT');
      expect(err.status).toBe(408);
    }
  });

  it('notifies onColdStart callback when request exceeds 3000ms and settles later', async () => {
    vi.useFakeTimers();

    const onColdStart = vi.fn();
    setOnColdStart(onColdStart);

    let resolveFetch: any;
    const mockFetch = vi.fn().mockImplementation(() => {
      return new Promise((resolve) => {
        resolveFetch = () =>
          resolve({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ status: 'ready' }),
          });
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const promise = apiClient.get<{ status: string }>('/api/v1/heavy-boot', { timeoutMs: 15000 });

    // Advance 3001ms to trigger cold-start detection
    await vi.advanceTimersByTimeAsync(3100);
    expect(onColdStart).toHaveBeenCalledWith(true);

    // Complete request
    resolveFetch();
    await promise;

    expect(onColdStart).toHaveBeenCalledWith(false);
  });

  it('retries idempotent GET requests on 502/503/504 errors with exponential backoff', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        return {
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ error: { code: 'GATEWAY_ERROR', message: 'Render cold booting' } }),
        };
      }
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ recovered: true }),
      };
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await apiClient.get<{ recovered: boolean }>('/api/v1/transient-service', {
      retries: 2,
      retryDelayMs: 20,
    });

    expect(result.recovered).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('never retries non-idempotent POST requests on server errors', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: { code: 'GATEWAY_ERROR', message: 'Busy' } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(apiClient.post('/api/v1/bookings', { seats: 1 })).rejects.toThrow(ApiError);
    // Even if 503, POST must not be retried to avoid duplicate charges or bookings
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('provides type-safe convenience helpers: get, post, put, patch, delete', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await apiClient.get('/api/test-get');
    expect(mockFetch.mock.calls[0][1].method).toBe('GET');

    await apiClient.post('/api/test-post', { key: 'val' });
    expect(mockFetch.mock.calls[1][1].method).toBe('POST');
    expect(mockFetch.mock.calls[1][1].body).toBe(JSON.stringify({ key: 'val' }));

    await apiClient.put('/api/test-put', { key: 'updated' });
    expect(mockFetch.mock.calls[2][1].method).toBe('PUT');
    expect(mockFetch.mock.calls[2][1].body).toBe(JSON.stringify({ key: 'updated' }));

    await apiClient.patch('/api/test-patch', { patch: true });
    expect(mockFetch.mock.calls[3][1].method).toBe('PATCH');
    expect(mockFetch.mock.calls[3][1].body).toBe(JSON.stringify({ patch: true }));

    await apiClient.delete('/api/test-delete');
    expect(mockFetch.mock.calls[4][1].method).toBe('DELETE');
  });
});
