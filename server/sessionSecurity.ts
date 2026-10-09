import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { runtimeEnv } from './runtime';
import { ApiError } from './errors';
import { BoundedExecutor } from './resourceLimits';

export type SessionScope = 'student' | 'staff';
// Shared by reads, inserts and deletes across API objects in this isolate.
export const SESSION_WORK_LIMITS = { concurrency: 16, maxWaiting: 512, waitMs: 10000 } as const;
export const sessionWork = new BoundedExecutor(SESSION_WORK_LIMITS.concurrency, SESSION_WORK_LIMITS.maxWaiting, SESSION_WORK_LIMITS.waitMs);

function signature(token: string, scope: SessionScope): Buffer {
  const env = runtimeEnv();
  const secret = env.SESSION_SECRET;
  if (!secret) throw new ApiError(503, '登入服務暫時無法使用。');
  // Stable across restarts/shards; domain separation prevents staff/student reuse.
  // Rotating the backend secret also invalidates all signed session cookies.
  const key = createHmac('sha256', secret).update('ntcust:session-signing:v1').digest();
  return createHmac('sha256', key).update(`v1:${scope}:${token}`).digest();
}

export function signSessionToken(token: string, scope: SessionScope): string {
  return `${token}.${signature(token, scope).toString('hex')}`;
}

export function readSessionToken(req: Request, scope: SessionScope): string | null {
  const cookie = `ntcust_${scope}_session`;
  const raw = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(`${cookie}=`))?.slice(cookie.length + 1);
  const match = raw?.match(/^([a-f0-9]{64})\.([a-f0-9]{64})$/);
  if (!match || !timingSafeEqual(signature(match[1], scope), Buffer.from(match[2], 'hex'))) return null;
  return match[1];
}

export function sessionScopeForPath(path: string): SessionScope | null {
  path = path.toLowerCase().replace(/\/+$/, '');
  if (['/student/me', '/student/logout'].includes(path)) return 'student';
  if (['/auth/me', '/auth/logout', '/state', '/projects', '/domain-configs', '/student/shared-password', '/lottery/test', '/lottery/draw', '/lottery/reset', '/staff-audit', '/staff-accounts', '/data/export', '/data/import'].includes(path)) return 'staff';
  return null;
}
