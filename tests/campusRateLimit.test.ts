import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';
import { loginLimiter, sessionLimiter } from '../server/rateLimit';
import { decideLoginBudgets, type LoginBucket } from '../server/loginBudgets';
import { signSessionToken } from '../server/sessionSecurity';
import { withRuntime } from '../server/runtime';
import { solveLoginChallenge } from '../src/lib/loginProof';

type Limiter = ReturnType<typeof loginLimiter>;
function attempt(limiter: Limiter, req: Request) {
  return new Promise<{ status: number; data?: any }>((resolve, reject) => {
    let status = 200;
    const res = {
      setHeader(_key: string, value: unknown) { assert.ok(Number(value) > 0); },
      status(code: number) { status = code; return this; },
      json(data: unknown) { resolve({ status, data }); },
    } as unknown as Response;
    limiter(req, res, ((error?: unknown) => error ? reject(error) : resolve({ status: 200 })) as NextFunction);
  });
}
const loginReq = (account: string, scope = 'student', loginProof?: unknown) => ({
  ip: '203.0.113.80', get: () => '203.0.113.80',
  body: { [scope === 'student' ? 'leaderId' : 'username']: account, password: 'test-password', loginProof },
}) as unknown as Request;

for (const mode of ['Node', 'Workers'] as const) {
  test(`${mode}: campus mode expands IP budgets 50-fold while retaining account, token, global and staff limits`, async () => {
    const loginCounts = new Map<string, LoginBucket>();
    const sessionCounts = new Map<string, number>();
    const shared = { idFromName(name: string) { return name; }, get() { return { async fetch(_url: string, init: { body: string }) {
      const { loginBudgets, budgets, windowMs, proof } = JSON.parse(init.body);
      if (loginBudgets) {
        const result = decideLoginBudgets(loginBudgets, loginCounts, Date.now(), windowMs, proof);
        for (const [key, value] of result.updates || []) loginCounts.set(key, value);
        return Response.json(result.decision);
      }
      if (budgets.some((b: { key: string; limit: number }) => (sessionCounts.get(b.key) || 0) >= b.limit)) return Response.json({ success: false, retryAfter: 60 });
      for (const b of budgets) sessionCounts.set(b.key, (sessionCounts.get(b.key) || 0) + 1);
      return Response.json({ success: true, retryAfter: 0 });
    } }; } };
    await withRuntime({ SESSION_SECRET: 'campus-test-secret', CAMPUS_NETWORK_ONLY: 'true', ...(mode === 'Workers' ? { LOGIN_LIMITER: shared as any } : {}) }, async () => {
      // The configured budget of 11 allows 550 student logins in campus mode.
      const studentLogin = loginLimiter('student', 1, 11);
      for (let n = 0; n < 500; n++) assert.equal((await attempt(studentLogin, loginReq(`student-${n}`))).status, 200);
      const challenged = await attempt(studentLogin, loginReq('student-0'));
      assert.equal(challenged.status, 429);
      assert.ok(challenged.data.loginChallenge);
      const proof = await solveLoginChallenge(challenged.data.loginChallenge, new AbortController().signal);
      assert.equal((await attempt(studentLogin, loginReq('student-0', 'student', proof))).status, 200);
      const staffLogin = loginLimiter('staff', 10, 1);
      assert.equal((await attempt(staffLogin, loginReq('staff-1', 'staff'))).status, 200);
      assert.equal((await attempt(staffLogin, loginReq('staff-2', 'staff'))).status, 429);

      const studentSession = sessionLimiter('student', 2, 11, 502);
      const staffSession = sessionLimiter('staff', 2, 1, 502);
      const sessionReq = (n: number, scope: 'student' | 'staff' = 'student') => ({
        ip: '203.0.113.80', get: () => '203.0.113.80',
        headers: { cookie: `ntcust_${scope}_session=${signSessionToken(n.toString(16).padStart(64, '0'), scope)}` },
      }) as unknown as Request;
      for (let n = 0; n < 500; n++) assert.equal((await attempt(studentSession, sessionReq(n))).status, 200);
      assert.equal((await attempt(studentSession, sessionReq(0))).status, 200);
      assert.equal((await attempt(studentSession, sessionReq(0))).status, 429, 'single session remains capped');
      assert.equal((await attempt(staffSession, sessionReq(600, 'staff'))).status, 200);
      assert.equal((await attempt(staffSession, sessionReq(601, 'staff'))).status, 429);
      assert.equal((await attempt(studentSession, sessionReq(700))).status, 429, 'student and staff still share the global budget');
      if (mode === 'Workers') {
        assert.ok([...loginCounts.keys()].some(key => key.startsWith('student:ip:')));
        assert.ok([...sessionCounts.keys()].some(key => key.startsWith('session:student:ip:')));
      }
    });
  });
}

test('campus mode requires an explicit true value; other values retain student IP limits', async () => {
  for (const value of [undefined, 'false', '', '1', 'TRUE']) {
    await withRuntime({ SESSION_SECRET: 'campus-test-secret', CAMPUS_NETWORK_ONLY: value }, async () => {
      const limiter = loginLimiter('student', 10, 1);
      assert.equal((await attempt(limiter, loginReq('student-1'))).status, 200);
      assert.equal((await attempt(limiter, loginReq('student-2'))).status, 429);
    });
  }
});
