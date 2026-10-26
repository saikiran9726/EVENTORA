import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000, // 30 seconds
      gcTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Do not retry non-transient HTTP client errors
        if (error instanceof ApiError) {
          if ([400, 401, 403, 404, 409, 422].includes(error.status)) {
            return false;
          }
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false, // Never automatically retry mutations
    },
  },
});
