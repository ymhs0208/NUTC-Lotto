import { runtimeEnv } from './runtime';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { createStore } from './store';
import { fingerprint, type StoredProject } from './credentials';
import { ApiError } from './errors';
import { readSessionToken, signSessionToken, sessionWork } from './sessionSecurity';

const COOKIE = 'ntcust_student_session';
const MAX_AGE = 60 * 60 * 1000;
const options = () => ({ httpOnly: true, secure: runtimeEnv().NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api/student' });
export async function clearStudentSession(req: Request, res: Response): Promise<void> {
  const token = readSessionToken(req, 'student');
  if (token) await sessionWork.run(() => createStore().deleteSession('student', fingerprint(token)));
  res.clearCookie(COOKIE, options());
}
export async function createStudentSession(req: Request, res: Response, project: StoredProject): Promise<void> {
  await clearStudentSession(req, res);
  const token = randomBytes(32).toString('hex');
  await sessionWork.run(() => createStore().putSession('student', fingerprint(token), {
    project_id: project.id, credential_version: fingerprint(project.password_hash!),
    expires_at: new Date(Date.now() + MAX_AGE).toISOString(),
  }));
  res.cookie(COOKIE, signSessionToken(token, 'student'), { ...options(), maxAge: MAX_AGE });
}
export async function getStudentProject(req: Request): Promise<StoredProject> {
  const token = readSessionToken(req, 'student');
  if (!token) throw new ApiError(401, '請先登入學生查詢。');
  return sessionWork.run(async () => {
    const lookup = await createStore().studentLookup(fingerprint(token));
    const project = lookup?.project;
    if (!project?.password_hash || project.password || fingerprint(project.password_hash) !== lookup?.credential_version) throw new ApiError(401, '學生登入已失效，請重新登入。');
    return project;
  });
}
