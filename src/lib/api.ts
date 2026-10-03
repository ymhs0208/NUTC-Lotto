import { clearAuthSession, getAuthSession } from './auth';
import type { ProjectItem, DomainConfig } from '../types';

export interface StoreState {
  projects: ProjectItem[];
  domainConfigs: DomainConfig[];
  version: number;
  lastUpdated: string;
  sharedPasswordEnabled: boolean;
}
export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number, readonly kind: 'server' | 'network' | 'timeout' | 'cancelled' = 'server') { super(message); this.name = 'ApiRequestError'; }
}

export interface ApiRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
export const API_TIMEOUTS = { read: 15000, login: 45000, write: 60000 } as const;
export function isRequestCancelled(error: unknown): boolean {
  return error instanceof ApiRequestError && error.kind === 'cancelled';
}

export async function apiRequest<T = StoreState>(url: string, body?: Record<string, unknown>, options: ApiRequestOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? (url.endsWith('/verify') ? API_TIMEOUTS.login : body ? API_TIMEOUTS.write : API_TIMEOUTS.read);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('請求期限必須為正數。');
  const session = getAuthSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(new Error('Request aborted'));
  controller.signal.addEventListener('abort', onAbort, { once: true });
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    // Race the whole response, not just headers; abort also releases the network stream.
    const response = async () => {
      if (controller.signal.aborted) throw new Error('Request aborted');
      const res = await fetch(url, {
        method: body ? 'POST' : 'GET', headers, credentials: 'same-origin', signal: controller.signal,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await res.json().catch(error => {
        if (error instanceof SyntaxError) return null;
        throw error;
      });
      return { res, data };
    };
    const { res, data } = await Promise.race([aborted, response()]);
    if (controller.signal.aborted) throw new Error('Request aborted');
    if (!res.ok || !data?.success) {
      if (res.status === 401 && session && !url.startsWith('/api/student/') && url !== '/api/auth/verify') {
        clearAuthSession();
        window.dispatchEvent(new Event('auth-expired'));
      }
      throw new ApiRequestError(data?.error || data?.message || `伺服器連線失敗 (HTTP ${res.status})`, res.status);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    if (controller.signal.aborted) {
      const message = timedOut ? '請求逾時，請檢查網路連線後再試。' : '請求已取消。';
      throw new ApiRequestError(body
        ? `${message}無法確認操作是否完成，請重新載入確認結果，再決定是否重試。`
        : message, 0, timedOut ? 'timeout' : 'cancelled');
    }
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const connectionMessage = offline
      ? '目前沒有網路連線，請檢查 Wi-Fi 或行動網路。'
      : '無法連線至伺服器，請檢查網路連線或稍後再試。';
    throw new ApiRequestError(body
      ? `${connectionMessage}無法確認操作是否完成，恢復連線後請重新載入確認結果，再決定是否重試。`
      : connectionMessage, 0, 'network');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', onAbort);
  }
}
