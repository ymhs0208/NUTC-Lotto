import { randomInt } from 'node:crypto';
import type { AbortSignal as WorkerAbortSignal } from '@cloudflare/workers-types/index.ts';
import { ApiError } from './errors';
import { runtimeEnv } from './runtime';
import { PASSWORD_HASH_FORMAT } from './passwordHash';

export const PASSWORD_POOL_BINDINGS = ['PASSWORD_VERIFIER_0', 'PASSWORD_VERIFIER_1', 'PASSWORD_VERIFIER_2', 'PASSWORD_VERIFIER_3'] as const;
export const PASSWORD_VERIFY_TIMEOUT_MS = 25000;
let nextPool: number | undefined;

export async function distributedPasswordVerification(password: string, encoded?: string): Promise<boolean> {
  const env = runtimeEnv();
  // Reject partial configuration rather than silently putting CPU work back on API isolates.
  if (PASSWORD_POOL_BINDINGS.some(key => !env[key])) throw new ApiError(503, '密碼驗證服務設定不完整。');
  const index = nextPool ?? randomInt(PASSWORD_POOL_BINDINGS.length);
  const pool = env[PASSWORD_POOL_BINDINGS[index]]!;
  nextPool = (index + 1) % PASSWORD_POOL_BINDINGS.length;
  const stub = pool.get(pool.idFromName('password-v1'));
  try {
    const response = await stub.fetch('https://password.internal/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, encoded: encoded && PASSWORD_HASH_FORMAT.test(encoded) ? encoded : null }),
      signal: AbortSignal.timeout(PASSWORD_VERIFY_TIMEOUT_MS) as unknown as WorkerAbortSignal,
    });
    if (!response.ok) throw new Error('Verification unavailable');
    const data = await response.json() as { valid?: unknown };
    if (typeof data.valid !== 'boolean') throw new Error('Invalid verification response');
    return data.valid;
  } catch {
    // Do not expose service responses, credentials or platform error details.
    // No retry/fallback: avoid multiplying expensive work during an outage.
    throw new ApiError(503, '密碼驗證服務暫時無法使用。');
  }
}
