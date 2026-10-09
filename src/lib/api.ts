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
  constructor(message: string, readonly status: number) { super(message); this.name = 'ApiRequestError'; }
}
export class ApiRequestCancelledError extends ApiRequestError {
  constructor() { super('請求已取消。', 0); this.name = 'ApiRequestCancelledError'; }
}
export const isApiRequestCancelled = (error: unknown): error is ApiRequestCancelledError => error instanceof ApiRequestCancelledError;
export interface ApiRequestOptions { signal?: AbortSignal; timeoutMs?: number; }
export const API_TIMEOUTS = { read: 15000, studentRead: 30000, login: 45000, studentLogin: 180000, write: 60000 } as const;
export function requestTimeoutMs(url: string, writing: boolean): number {
  return url === '/api/student/verify' ? API_TIMEOUTS.studentLogin
    : url === '/api/student/me' && !writing ? API_TIMEOUTS.studentRead
    : url === '/api/auth/verify' ? API_TIMEOUTS.login
    : writing ? API_TIMEOUTS.write : API_TIMEOUTS.read;
}

function retryPause(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new ApiRequestCancelledError());
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(new ApiRequestCancelledError()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

export async function apiRequest<T = StoreState>(url: string, body?: Record<string, unknown>, options: ApiRequestOptions = {}): Promise<T> {
  const session = getAuthSession();
  const timeoutMs = options.timeoutMs ?? requestTimeoutMs(url, !!body);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('請求期限必須為正數。');
  if (options.signal?.aborted) throw new ApiRequestCancelledError();
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  const retryableRead = url === '/api/student/me' && !body;
  const canRetry = (delay: number) => retryableRead && !controller.signal.aborted && Date.now() + delay + 1000 < deadline;
  let timedOut = false;
  const cancel = () => controller.abort();
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(timedOut ? new ApiRequestError(body
      ? '操作等候逾時，無法確認是否已完成。請重新載入確認登入狀態或資料結果，再決定是否重試；請勿直接重複送出。'
      : '讀取逾時，請檢查網路連線後再試。', 0) : new ApiRequestCancelledError());
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
  });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    // Deadline covers both response headers and body. Race also prevents a late
    // response from changing auth/state if a transport ignores cancellation.
    const { res, data } = await Promise.race([
      (async () => {
        let requestBody = body;
        for (let attempt = 0; ; attempt++) {
          let res: Response;
          try {
            res = await fetch(url, {
              method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', signal: controller.signal,
              ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
            });
          } catch (error) {
            const delay = 500 + Math.floor(Math.random() * 1000);
            const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
            if (attempt === 0 && !offline && canRetry(delay)) {
              await retryPause(delay, controller.signal); continue;
            }
            throw error;
          }
          const data = await res.json().catch(error => { if (controller.signal.aborted) throw error; return null; });
          if (attempt === 0 && res.status === 429 && data?.loginChallenge && body && ['/api/student/verify', '/api/auth/verify'].includes(url)) {
            // This response is emitted before credential/session work; only this
            // explicit challenge permits resubmission. Network errors never do.
            const { solveLoginChallenge } = await import('./loginProof');
            const loginProof = await solveLoginChallenge(data.loginChallenge, controller.signal).catch(error => {
              if (controller.signal.aborted) throw error;
              throw new ApiRequestError('登入驗證無法完成，請稍後再試。', 429);
            });
            if (controller.signal.aborted) throw new ApiRequestCancelledError();
            requestBody = { ...body, loginProof }; continue;
          }
          if (attempt === 0 && res.status === 503) {
            const header = res.headers.get('Retry-After');
            const base = header === null ? 2000 : /^\d+$/.test(header) ? Number(header) * 1000 : Infinity;
            const delay = base + Math.floor(Math.random() * 1000);
            if (base <= 5000 && canRetry(delay)) {
              await retryPause(delay, controller.signal); continue;
            }
          }
          return { res, data };
        }
      })(), aborted,
    ]);
    if (!res.ok || !data?.success) {
      if (res.status === 401 && session && getAuthSession() === session && !url.startsWith('/api/student/') && url !== '/api/auth/verify') {
        clearAuthSession();
        window.dispatchEvent(new Event('auth-expired'));
      }
      throw new ApiRequestError(data?.error || data?.message || `伺服器連線失敗 (HTTP ${res.status})`, res.status);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const message = offline ? '目前沒有網路連線，請檢查 Wi-Fi 或行動網路。' : '無法連線至伺服器，請檢查網路連線或稍後再試。';
    throw new ApiRequestError(body ? `${message}無法確認操作是否完成，恢復連線後請重新載入確認結果，再決定是否重試。` : message, 0);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}
