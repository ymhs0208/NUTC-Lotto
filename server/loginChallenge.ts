import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { runtimeEnv } from './runtime';
import { ApiError } from './errors';

export const LOGIN_CHALLENGE_BITS = 16;
const TTL_MS = 120000;
type Context = { scope: string; account: string; ip: string; password: string };
function mac(value: string): string {
  const env = runtimeEnv();
  const secret = env.SESSION_SECRET;
  if (!secret) throw new ApiError(503, '登入服務暫時無法使用。');
  return createHmac('sha256', secret).update('ntcust:login-challenge:v1\0').update(value).digest('hex');
}
function binding(context: Context): string { return mac(JSON.stringify(context)); }
export function issueLoginChallenge(context: Context, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ v: 1, expires: now + TTL_MS, binding: binding(context), nonce: randomBytes(16).toString('hex') })).toString('base64url');
  return { token: `${payload}.${mac(payload)}`, bits: LOGIN_CHALLENGE_BITS };
}
export function verifyLoginProof(proof: unknown, context: Context, now = Date.now()): boolean {
  if (!proof || typeof proof !== 'object') return false;
  const { token, nonce } = proof as { token?: unknown; nonce?: unknown };
  if (typeof token !== 'string' || token.length > 1024 || typeof nonce !== 'string' || !/^[0-9]{1,10}$/.test(nonce)) return false;
  const match = /^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(token);
  if (!match || !timingSafeEqual(Buffer.from(mac(match[1]), 'hex'), Buffer.from(match[2], 'hex'))) return false;
  try {
    const payload = JSON.parse(Buffer.from(match[1], 'base64url').toString());
    if (payload.v !== 1 || !Number.isSafeInteger(payload.expires) || payload.expires <= now || payload.expires > now + TTL_MS || payload.binding !== binding(context)) return false;
    const digest = createHash('sha256').update(`${token}:${nonce}`).digest();
    // Reuse only permits the same credentials, IP and scope until expiration;
    // changing even one password guess requires a different signed challenge.
    return digest[0] === 0 && digest[1] === 0;
  } catch { return false; }
}
