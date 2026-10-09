import { runtimeEnv } from './runtime';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { database } from './database';
import type { StaffAccount, StaffProfile } from './databaseTypes';
import { fingerprint } from './credentials';
import { ApiError } from './errors';
import type { AuditActor } from './audit';
import { readSessionToken, signSessionToken, sessionWork } from './sessionSecurity';
const COOKIE = 'ntcust_staff_session';
const options = () => ({ httpOnly: true, secure: runtimeEnv().NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api' });
function profile(row: StaffProfile) {
  return { role: row.role, username: row.email, displayName: row.role === 'admin' ? '大會系統管理員' : '抽籤展演人員', loginTime: row.created_at, expiresAt: Math.floor(row.expires_at / 1000) };
}
export async function clearStaffSession(req: Request, res: Response, _actor?: AuditActor) {
  const token = readSessionToken(req, 'staff');
  if (token) await sessionWork.run(() => database().call('endStaffSession', { tokenHash: fingerprint(token) }));
  res.clearCookie(COOKIE, options());
}
export async function createStaffSession(req: Request, res: Response, account: StaffAccount, remember: boolean) {
  const token = randomBytes(32).toString('hex');
  const signed = signSessionToken(token, 'staff');
  const old = readSessionToken(req, 'staff');
  const row = await sessionWork.run(() => database().call('startStaffSession', {
    accountId: account.id, passwordHash: account.password_hash, credentialVersion: account.credential_version,
    tokenHash: fingerprint(token), oldTokenHash: old ? fingerprint(old) : null,
  }));
  res.cookie(COOKIE, signed, { ...options(), ...(remember ? { maxAge: Math.max(0, row.expires_at - Date.now()) } : {}) });
  return profile(row);
}
export async function getStaffSession(req: Request, required = true) {
  const token = readSessionToken(req, 'staff');
  if (!token) { if (required) throw new ApiError(401, '請先登入。'); return null; }
  const row = await sessionWork.run(() => database().call('staffSession', { tokenHash: fingerprint(token) }));
  if (!row) throw new ApiError(401, '登入已過期，請重新登入。');
  return { userId: row.id, profile: profile(row) };
}
