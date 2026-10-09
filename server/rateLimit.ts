import type { AbortSignal as WorkerAbortSignal } from '@cloudflare/workers-types/index.ts';
import type { Request, Response, NextFunction } from 'express';
import { fingerprint } from './credentials';
import { runtimeEnv } from './runtime';
import { ApiError } from './errors';
import { readSessionToken, type SessionScope } from './sessionSecurity';
import { issueLoginChallenge, verifyLoginProof } from './loginChallenge';
import { decideLoginBudgets, type LoginDecision } from './loginBudgets';

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
            // 修正：當容量超過 10,000 時，主動淘汰最舊的一筆紀錄 (FIFO)，避免合法使用者被 429 拒絕
            if (buckets.size >= 10000 && !buckets.has(key)) {
              const firstKey = buckets.keys().next().value;
              if (firstKey !== undefined) buckets.delete(firstKey);
            }
            bucket.count++; buckets.set(key, bucket);
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

function campusStudent(scope: SessionScope): boolean {
  return scope === 'student' && runtimeEnv().CAMPUS_NETWORK_ONLY === 'true';
}

export function loginLimiter(scope: 'staff' | 'student', accountLimit = 10, ipLimit = 100, windowMs = 15 * 60 * 1000) {
  const buckets: Buckets = new Map();
  let nextSweep = 0;
  return (req: Request, res: Response, next: NextFunction) => { void (async () => {
    const rawAccount = scope === 'staff' ? req.body?.username : req.body?.leaderId;
    const maxLength = scope === 'staff' ? 256 : 128;
    if (typeof rawAccount !== 'string' || !rawAccount.trim() || rawAccount.length > maxLength) {
      throw new ApiError(400, scope === 'staff' ? '請輸入有效的登入 Email。' : '請輸入有效的組長學號。');
    }
    const context = { scope, account: rawAccount.trim().toLowerCase(), ip: clientIp(req), password: typeof req.body?.password === 'string' ? req.body.password : '' };

    // 修正：為校網模式保留 IP 限制，但給予 50 倍的寬鬆上限，防禦單一 IP 狂刷假學號
    const entries = [
      { key: `${scope}:ip:${fingerprint(context.ip)}`, limit: campusStudent(scope) ? ipLimit * 50 : ipLimit },
      { key: `${scope}:account:${fingerprint(context.account)}`, limit: accountLimit },
    ];

    const proof = verifyLoginProof(req.body?.loginProof, context);
    const now = Date.now();
    const shared = runtimeEnv().LOGIN_LIMITER;
    let decision: LoginDecision;

    if (shared) {
      // All account/IP updates for this scope share one transactional object.
      const result = await shared.get(shared.idFromName(`login-budgets-v2:${scope}`)).fetch('https://limiter/check', {
        method: 'POST', body: JSON.stringify({ loginBudgets: entries, windowMs, proof }), signal: AbortSignal.timeout(2000) as unknown as WorkerAbortSignal,
      }).catch(() => { throw new ApiError(503, '限流服務暫時無法使用。'); });
      if (!result.ok) throw new ApiError(503, '限流服務暫時無法使用。');
      decision = await result.json() as LoginDecision;
    } else {
      if (now >= nextSweep) {
        for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
        nextSweep = now + 1000;
      }
      const result = decideLoginBudgets(entries, buckets, now, windowMs, proof);
      decision = result.decision;
      if (result.updates) {
        const additions = entries.filter(b => !buckets.has(b.key)).length;

        // 修正：刪除原本會造成 503 當機的條件判斷，改以 FIFO 清除舊有紀錄
        if (buckets.size + additions > 10000) {
          let overage = (buckets.size + additions) - 10000;
          for (const key of buckets.keys()) {
            buckets.delete(key);
            if (--overage <= 0) break;
          }
        }

        for (const [key, value] of result.updates) buckets.set(key, value);
      }
    }
    if (decision.challenge) {
      res.status(429).json({ success: false, error: '登入需要額外驗證，請稍後再試。', loginChallenge: issueLoginChallenge(context) }); return;
    }
    if (!decision.success) {
      res.setHeader('Retry-After', decision.retryAfter);
      res.status(429).json({ success: false, error: '登入嘗試過於頻繁，請稍後再試。' }); return;
    }
    next();
  })().catch(next); };
}

export function anonymousLimiter(scope: 'health' | 'results', ipLimit: number, globalLimit: number) {
  return limited(req => [
    { key: `public:${scope}:ip:${fingerprint(clientIp(req))}`, limit: ipLimit },
    { key: `public:${scope}:global`, limit: globalLimit },
  ], 60000, '查詢過於頻繁，請稍後再試。');
}

export function sessionLimiter(scope: SessionScope, tokenLimit = 600, ipLimit = scope === 'student' ? 6000 : 3000, globalLimit = 12000) {
  return limited(req => {
    const token = readSessionToken(req, scope);
    if (!token) throw new ApiError(401, '請重新登入。');

    // 修正：同樣為 sessionLimiter 的校網模式加入 50 倍 IP 限流防護
    return [
      { key: `session:${scope}:token:${fingerprint(token)}`, limit: tokenLimit },
      { key: `session:${scope}:ip:${fingerprint(clientIp(req))}`, limit: campusStudent(scope) ? ipLimit * 50 : ipLimit },
      { key: 'session:global', limit: globalLimit },
    ];
  }, 60000, '查詢或操作過於頻繁，請稍後再試。', sessionBuckets, true);
}
