import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';
import { loginLimiter } from '../server/rateLimit';
import { withRuntime } from '../server/runtime';
import { decideLoginBudgets, type LoginBucket } from '../server/loginBudgets';
import { solveLoginChallenge } from '../src/lib/loginProof';

for (const mode of ['Node', 'Workers'] as const) {
  test(`${mode}: account bursts require proof without locking out valid callers across IPs`, async () => {
    const counts = new Map<string, LoginBucket>();
    const shared = {
      idFromName(name: string) { return name; },
      get() { return { async fetch(_url: string, init: { body: string }) {
        const { loginBudgets, windowMs, proof } = JSON.parse(init.body);
        const result = decideLoginBudgets(loginBudgets, counts, Date.now(), windowMs, proof);
        for (const [key, value] of result.updates || []) counts.set(key, value);
        return Response.json(result.decision);
      } }; },
    };
    const env = { SESSION_SECRET: 'test-login-proof-secret', ...(mode === 'Workers' ? { LOGIN_LIMITER: shared as any } : {}) };
    const attempt = (limiter: ReturnType<typeof loginLimiter>, body: unknown, ip: string) => withRuntime(env,
      () => new Promise<{ status: number; data?: any }>((resolve, reject) => {
        const req = { ip, body, get: () => ip } as unknown as Request;
        let status = 200;
        const res = { setHeader() {}, status(code: number) { status = code; return this; }, json(data: any) { resolve({ status, data }); return this; } } as unknown as Response;
        limiter(req, res, ((error?: any) => error?.status ? resolve({ status: error.status }) : error ? reject(error) : resolve({ status: 200 })) as NextFunction);
      }));
    for (const scope of ['staff', 'student'] as const) {
      const limiter = loginLimiter(scope);
      const field = scope === 'staff' ? 'username' : 'leaderId';
      for (let n = 0; n < 10; n++) assert.equal((await attempt(limiter, { [field]: n % 2 ? ' Victim ' : 'victim', password: 'wrong', ignored: n }, `203.0.113.${n+1}`)).status, 200);
      const body = { [field]: 'victim', password: 'correct-password' };
      const blocked = await attempt(limiter, body, '198.51.100.1');
      assert.equal(blocked.status, 429);
      assert.ok(blocked.data.loginChallenge);
      const loginProof = await solveLoginChallenge(blocked.data.loginChallenge, new AbortController().signal);
      assert.equal((await attempt(limiter, { ...body, loginProof }, '198.51.100.1')).status, 200);
      assert.equal((await attempt(limiter, { ...body, password: 'changed-guess', loginProof }, '198.51.100.1')).status, 429);
      for (const value of [null, {}, [], 123, '', '   ', 'x'.repeat(scope === 'staff' ? 257 : 129)]) assert.equal((await attempt(limiter, { [field]: value }, '198.51.100.2')).status, 400);
      assert.equal((await attempt(limiter, { [field]: 'other-account', password: 'wrong' }, '198.51.100.1')).status, 200);
    }
  });
  test(`${mode}: IP rejection does not consume another account's quota; proof never bypasses IP limit`, async () => {
    const counts = new Map<string, LoginBucket>();
    const shared = { idFromName(name: string) { return name; }, get() { return { async fetch(_url: string, init: { body: string }) {
      const { loginBudgets, windowMs, proof } = JSON.parse(init.body);
      const result = decideLoginBudgets(loginBudgets, counts, Date.now(), windowMs, proof);
      for (const [key, value] of result.updates || []) counts.set(key, value);
      return Response.json(result.decision);
    } }; } };
    const env = { SESSION_SECRET: 'test-login-proof-secret', ...(mode === 'Workers' ? { LOGIN_LIMITER: shared as any } : {}) };
    const limiter = loginLimiter('student', 1, 1);
    const attempt = (leaderId: string, ip: string, loginProof?: unknown) => withRuntime(env, () => new Promise<any>((resolve, reject) => {
      let status = 200;
      const req = { ip, body: { leaderId, password: 'password', loginProof }, get: () => ip } as unknown as Request;
      const res = { setHeader() {}, status(code: number) { status = code; return this; }, json(data: any) { resolve({ status, ...data }); } } as unknown as Response;
      limiter(req, res, ((error?: unknown) => error ? reject(error) : resolve({ status: 200 })) as NextFunction);
    }));
    assert.equal((await attempt('first', '203.0.113.1')).status, 200);
    for (let n=0;n<10;n++) assert.equal((await attempt('victim','203.0.113.1')).loginChallenge, undefined);
    assert.equal((await attempt('victim','203.0.113.2')).status, 200);
    const challenge = await attempt('victim','203.0.113.3');
    const proof = await solveLoginChallenge(challenge.loginChallenge, new AbortController().signal);
    assert.equal((await attempt('other','203.0.113.3')).status, 200);
    assert.equal((await attempt('victim','203.0.113.3',proof)).loginChallenge, undefined);
    assert.equal((await attempt('victim','203.0.113.3',proof)).status, 429);
  });
}

for (const mode of ['Node', 'Workers'] as const) {
  test(`${mode}: anonymous budgets enforce both IP and aggregate limits before handlers`, async () => {
    const counts = new Map<string, number>();
    const shared = {
      idFromName(name: string) { return name; },
      get(name: string) { return { async fetch(_url: string, init: { body: string }) {
        const { limit } = JSON.parse(init.body);
        const count = counts.get(name) || 0;
        if (count >= limit) return Response.json({ success: false, retryAfter: 60 });
        counts.set(name, count + 1); return Response.json({ success: true, retryAfter: 0 });
      } }; },
    };
    const { anonymousLimiter } = await import('../server/rateLimit');
    const limiter = anonymousLimiter('health', 2, 3);
    const attempt = (ip: string) => withRuntime(mode === 'Workers' ? { LOGIN_LIMITER: shared as any } : {},
      () => new Promise<number>((resolve, reject) => {
        let status = 200; let retryAfter: unknown;
        const req = { ip, get: () => ip } as unknown as Request;
        const res = { setHeader(_key: string, value: unknown) { retryAfter = value; }, status(value: number) { status = value; return this; }, json() { assert.ok(Number(retryAfter) > 0); resolve(status); } } as unknown as Response;
        limiter(req, res, ((error?: unknown) => error ? reject(error) : resolve(200)) as NextFunction);
      }));
    assert.equal(await attempt('203.0.113.1'), 200);
    assert.equal(await attempt('203.0.113.1'), 200);
    assert.equal(await attempt('203.0.113.1'), 429);
    assert.equal(await attempt('203.0.113.2'), 200);
    assert.equal(await attempt('203.0.113.3'), 429);
  });
}
