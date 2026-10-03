import { runtimeEnv } from './runtime';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { createStore } from './store';
import { fingerprint } from './credentials';
import type { StaffAccount } from './cloudflareDatabase';
import { ApiError } from './errors';
import { readSessionToken, signSessionToken, sessionWork } from './sessionSecurity';

const COOKIE = 'ntcust_staff_session';
const options = () => ({ httpOnly: true, secure: runtimeEnv().NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api' });
export async function clearStaffSession(req: Request, res: Response) {
  const token = readSessionToken(req, 'staff');
  if (token) await sessionWork.run(() => createStore().deleteSession('staff', fingerprint(token)));
  res.clearCookie(COOKIE, options());
}
export async function createStaffSession(req: Request, res: Response, account: StaffAccount, remember: boolean) {
  await clearStaffSession(req, res);
  const token = randomBytes(32).toString('hex');
  const createdAt = new Date().toISOString();
  const expiresAt = Date.now() + 60 * 60 * 1000;
  await sessionWork.run(() => createStore().putSession('staff', fingerprint(token), {
    user_id: account.id, credential_version: fingerprint(account.password_hash),
    expires_at: new Date(expiresAt).toISOString(), created_at: createdAt,
  }));
  res.cookie(COOKIE, signSessionToken(token, 'staff'), { ...options(), ...(remember ? { maxAge: expiresAt - Date.now() } : {}) });
  return profile(account, createdAt, expiresAt);
}
function profile(account: StaffAccount, createdAt: string, expiresAt: number) {
  return { role: account.role, username: account.email, displayName: account.role === 'admin' ? '大會系統管理員' : '抽籤展演人員', loginTime: createdAt, expiresAt: Math.floor(expiresAt / 1000) };
}
export async function getStaffSession(req: Request, required = true) {
  const token = readSessionToken(req, 'staff');
  if (!token) {
    if (required) throw new ApiError(401, '請先登入。');
    return null;
  }
  return sessionWork.run(async () => {
    const store = createStore();
    const session = await store.getStaffSession(fingerprint(token));
    if (!session) throw new ApiError(401, '登入已過期，請重新登入。');
    const account = await store.findAccount('id', session.user_id);
    if (!account || fingerprint(account.password_hash) !== session.credential_version) throw new ApiError(401, '登入已失效，請重新登入。');
    if (!['admin', 'stage'].includes(account.role)) throw new ApiError(403, '此帳號尚未獲得操作權限。');
    return { userId: account.id, profile: profile(account, session.created_at, Date.parse(session.expires_at)) };
  });
}
