import { runtimeEnv } from './runtime';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { database } from './database';
import { fingerprint, type StoredProject } from './credentials';
import { ApiError } from './errors';
import { readSessionToken, signSessionToken, sessionWork } from './sessionSecurity';
const COOKIE = 'ntcust_student_session';
const MAX_AGE = 3600000;
const options = () => ({ httpOnly: true, secure: runtimeEnv().NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api/student' });
export async function clearStudentSession(req: Request, res: Response) {
  const token = readSessionToken(req, 'student');
  if (token) await sessionWork.run(() => database().call('endStudentSession', { tokenHash: fingerprint(token) }));
  res.clearCookie(COOKIE, options());
}
export async function createStudentSession(req: Request, res: Response, project: StoredProject): Promise<StoredProject> {
  const token = randomBytes(32).toString('hex');
  const signed = signSessionToken(token, 'student');
  const old = readSessionToken(req, 'student');
  const current = await sessionWork.run(() => database().call('startStudentSession', { project, tokenHash: fingerprint(token), oldTokenHash: old ? fingerprint(old) : null }));
  res.cookie(COOKIE, signed, { ...options(), maxAge: MAX_AGE });
  return current;
}
export async function getStudentProject(req: Request): Promise<StoredProject> {
  const token = readSessionToken(req, 'student');
  if (!token) throw new ApiError(401, '請先登入學生查詢。');
  const project = await sessionWork.run(() => database().call('studentSession', { tokenHash: fingerprint(token) }));
  if (!project) throw new ApiError(401, '學生登入已失效，請重新登入。');
  return project;
}
