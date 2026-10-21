import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient, ApiError, getCsrfToken } from '../../packages/frontend/src/lib/api-client';

describe('Typed API Client Skeleton', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should parse active CSRF token from document.cookie', () => {
    expect(getCsrfToken()).toBeNull();
    (globalThis as any).document = {
      cookie: 'eventora_csrf=test-csrf-token-12345; other_cookie=val',
    };
    expect(getCsrfToken()).toBe('test-csrf-token-12345');
    delete (globalThis as any).document;
  });

  it('should inject X-Request-ID and Accept headers on GET requests', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await apiClient<{ success: boolean }>('/api/test');
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers as Headers;
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('X-Request-ID')).toBeDefined();
  });

  it('should parse standard error envelope when response is not ok', async () => {
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

    await expect(apiClient('/api/events/proposal', { method: 'POST' })).rejects.toThrow(ApiError);

    try {
      await apiClient('/api/events/proposal', { method: 'POST' });
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err.code).toBe('UNAUTHORIZED_ACCESS');
      expect(err.status).toBe(401);
      expect(err.requestId).toBe('req-test-9921');
      expect(err.details.policy).toBe('event:create');
    }
  });

  it('should reject with REQUEST_TIMEOUT when request exceeds timeoutMs', async () => {
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

    await expect(apiClient('/api/slow-query', { timeoutMs: 50 })).rejects.toThrow(ApiError);

    try {
      await apiClient('/api/slow-query', { timeoutMs: 50 });
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err.code).toBe('REQUEST_TIMEOUT');
      expect(err.status).toBe(408);
    }
  });
});
