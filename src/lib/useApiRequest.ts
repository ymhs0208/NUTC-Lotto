import { useCallback, useEffect, useRef } from 'react';
import { apiRequest, ApiRequestCancelledError, type ApiRequestOptions, type StoreState } from './api';

/** Each mounted screen owns its requests; leaving it cancels outstanding work. */
export function useApiRequest() {
  const controllers = useRef(new Set<AbortController>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
    };
  }, []);
  return useCallback(async <T = StoreState>(url: string, body?: Record<string, unknown>, options: ApiRequestOptions = {}): Promise<T> => {
    if (!mounted.current) throw new ApiRequestCancelledError();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener('abort', cancel, { once: true });
    controllers.current.add(controller);
    try {
      const data = await apiRequest<T>(url, body, { ...options, signal: controller.signal });
      if (!mounted.current || controller.signal.aborted) throw new ApiRequestCancelledError();
      return data;
    } finally {
      controllers.current.delete(controller);
      options.signal?.removeEventListener('abort', cancel);
    }
  }, []);
}
