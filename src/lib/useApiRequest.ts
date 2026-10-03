import { useCallback, useEffect, useMemo } from 'react';
import { apiRequest, ApiRequestError, type ApiRequestOptions, type StoreState } from './api';

// Each view owns its requests; leaving it cancels every pending network operation.
export function useApiRequest(scopeKey?: unknown) {
  const scope = useMemo(() => ({ pending: new Set<AbortController>(), active: true }), [scopeKey]);
  useEffect(() => {
    scope.active = true;
    return () => {
      scope.active = false;
      for (const controller of scope.pending) controller.abort();
      scope.pending.clear();
    };
  }, [scope]);
  return useCallback(async <T = StoreState>(url: string, body?: Record<string, unknown>, options: ApiRequestOptions = {}): Promise<T> => {
    if (!scope.active) throw new ApiRequestError('請求已取消。', 0, 'cancelled');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    scope.pending.add(controller);
    try {
      const result = await apiRequest<T>(url, body, { ...options, signal: controller.signal });
      if (!scope.active || controller.signal.aborted) throw new ApiRequestError('請求已取消。', 0, 'cancelled');
      return result;
    }
    finally {
      scope.pending.delete(controller);
      options.signal?.removeEventListener('abort', cancel);
    }
  }, [scope]);
}
