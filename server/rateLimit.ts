import type { AbortSignal as WorkerAbortSignal } from '@cloudflare/workers-types/index.ts';
import type { Request, Response, NextFunction } from 'express';
import { fingerprint } from './credentials';
import { runtimeEnv } from './runtime';
import { ApiError } from './errors';
import { readSessionToken, type SessionScope } from './sessionSecurity';

type Budget = { key: string; limit: number };
type Buckets = Map<string, { count: number; resetAt: number }>;
const sessionBuckets: Buckets = new Map();
function limited(budgets: (req: Request) => Budget[], windowMs: number, message: string, buckets: Buckets = new Map(), batchShared = false) {
  let nextSweep = 0;
  return (req: Request, res: Response, next: NextFunction) => {
    const run = async () => {
      const entries = budgets(req); // Validate before creating account buckets.
      const now = Date.now();
      const shared = runtimeEnv().LOGIN_LIMITER;
      if (shared && batchShared) {
        // One atomic check avoids three shared-object calls per student lookup.
        const result = await shared.get(shared.idFromName('session-budgets')).fetch('https://limiter/check', {
          method: 'POST', body: JSON.stringify({ budgets: entries, windowMs }), signal: AbortSignal.timeout(2000) as unknown as WorkerAbortSignal,
        }).catch(() => { throw new ApiError(503, '限流服務暫時無法使用。'); });
        if (!result.ok) throw new ApiError(503, '限流服務暫時無法使用。');
        const decision = await result.json() as { success: boolean; retryAfter: number };
        const retryAfter = decision.success ? 0 : decision.retryAfter;
        if (retryAfter > 0) {
          res.setHeader('Retry-After', retryAfter);
          res.status(429).json({ success: false, error: message }); return;
        }
        next(); return;
      }
      for (const { key, limit } of entries) {
        let retryAfter = 0;
        if (shared) {
          const result = await shared.get(shared.idFromName(key)).fetch('https://limiter/check', {
            method: 'POST', body: JSON.stringify({ limit, windowMs }), signal: AbortSignal.timeout(2000) as unknown as WorkerAbortSignal,
          }).catch(() => { throw new ApiError(503, '限流服務暫時無法使用。'); });
          if (!result.ok) throw new ApiError(503, '登入服務暫時無法使用。');
          const decision = await result.json() as { success: boolean; retryAfter: number };
          if (!decision.success) retryAfter = decision.retryAfter;
        } else {
          if (now >= nextSweep) {
            for (const [id, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(id);
            nextSweep = now + 1000;
          }
          const old = buckets.get(key);
          const bucket = old && old.resetAt > now ? old : { count: 0, resetAt: now + windowMs };
          if (bucket.count >= limit) retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
          else {
            if (buckets.size >= 10000 && !buckets.has(key)) retryAfter = 1;
            else { bucket.count++; buckets.set(key, bucket); }
          }
        }
        if (retryAfter > 0) {
          res.setHeader('Retry-After', retryAfter);
          res.status(429).json({ success: false, error: message }); return;
        }
      }
      next();
    };
    void run().catch(next);
  };
}
function clientIp(req: Request): string {
  // Cloudflare supplies this header; Node uses its socket address.
  return runtimeEnv().LOGIN_LIMITER ? req.get('cf-connecting-ip') || req.ip || 'unknown' : req.ip || 'unknown';
}
export function loginLimiter(scope: 'staff' | 'student', accountLimit = 10, ipLimit = 100, windowMs = 15 * 60 * 1000) {
  return limited(req => {
    const rawAccount = scope === 'staff' ? req.body?.username : req.body?.leaderId;
    const maxLength = scope === 'staff' ? 256 : 128;
    if (typeof rawAccount !== 'string' || !rawAccount.trim() || rawAccount.length > maxLength) {
      throw new ApiError(400, scope === 'staff' ? '請輸入有效的登入 Email。' : '請輸入有效的組長學號。');
    }
    return [
      { key: `${scope}:account:${fingerprint(rawAccount.trim().toLowerCase())}`, limit: accountLimit },
      { key: `${scope}:ip:${fingerprint(clientIp(req))}`, limit: ipLimit },
    ];
  }, windowMs, '登入嘗試過於頻繁，請稍後再試。');
}

export function anonymousLimiter(scope: 'health', ipLimit: number, globalLimit: number) {
  return limited(req => [
    { key: `public:${scope}:ip:${fingerprint(clientIp(req))}`, limit: ipLimit },
    { key: `public:${scope}:global`, limit: globalLimit },
  ], 60000, '查詢過於頻繁，請稍後再試。');
}

export function sessionLimiter(scope: SessionScope, tokenLimit = 600, ipLimit = 3000, globalLimit = 12000) {
  return limited(req => {
    const token = readSessionToken(req, scope);
    if (!token) throw new ApiError(401, '請重新登入。');
    return [
      { key: `session:${scope}:token:${fingerprint(token)}`, limit: tokenLimit },
      { key: `session:${scope}:ip:${fingerprint(clientIp(req))}`, limit: ipLimit },
      { key: 'session:global', limit: globalLimit },
    ];
  }, 60000, '查詢或操作過於頻繁，請稍後再試。', sessionBuckets, true);
}
