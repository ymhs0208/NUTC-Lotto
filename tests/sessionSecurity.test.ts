import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';
import { readSessionToken, signSessionToken, sessionWork } from '../server/sessionSecurity';
import { sessionLimiter } from '../server/rateLimit';
import { withRuntime } from '../server/runtime';

const env = { SESSION_SECRET: 'local-session-test-secret' };
const token = 'a'.repeat(64);
const reqFor = (scope: 'student' | 'staff', value: string, ip = '203.0.113.1') => ({
  headers: { cookie: `ntcust_${scope}_session=${value}` }, ip,
  get: () => ip,
}) as unknown as Request;

test('session signatures bind token, scope and server key; legacy/malformed cookies are rejected', () => {
  withRuntime(env, () => {
    const signed = signSessionToken(token, 'student');
    assert.equal(readSessionToken(reqFor('student', signed), 'student'), token);
    assert.equal(readSessionToken(reqFor('staff', signed), 'staff'), null);
    assert.equal(readSessionToken(reqFor('student', 'b' + signed.slice(1)), 'student'), null);
    assert.equal(readSessionToken(reqFor('student', signed.slice(0, -1) + (signed.endsWith('0') ? '1' : '0')), 'student'), null);
    for (const invalid of [token, '', 'x'.repeat(10000), `${token}.${'0'.repeat(64)}`]) {
      assert.equal(readSessionToken(reqFor('student', invalid), 'student'), null);
    }
    withRuntime({ SESSION_SECRET: 'rotated-session-test-secret' }, () => {
      assert.equal(readSessionToken(reqFor('student', signed), 'student'), null);
    });
    withRuntime(env, () => assert.equal(signSessionToken(token, 'student'), signed));
  });
});

for (const mode of ['Node', 'Workers'] as const) {
  test(`${mode}: signed session limits combine token, IP and aggregate budgets; invalid tokens create no buckets`, async () => {
    const counts = new Map<string, number>();
    const shared = {
      idFromName(name: string) { return name; },
      get(name: string) { return { async fetch(_url: string, init: { body: string }) {
        const { limit, budgets } = JSON.parse(init.body);
        const entries = budgets || [{ key: name, limit }];
        if (entries.some((b: { key: string; limit: number }) => (counts.get(b.key) || 0) >= b.limit)) return Response.json({ success: false, retryAfter: 60 });
        for (const b of entries) counts.set(b.key, (counts.get(b.key) || 0) + 1);
        return Response.json({ success: true, retryAfter: 0 });
      } }; },
    };
    const runtime = { ...env, ...(mode === 'Workers' ? { LOGIN_LIMITER: shared as any } : {}) };
    const limiter = sessionLimiter('student', 2, 3, 4);
    const staffLimiter = sessionLimiter('staff', 2, 3, 4);
    const attempt = (raw: string, ip: string, scope: 'student' | 'staff' = 'student') => withRuntime(runtime, () => new Promise<number>((resolve, reject) => {
      let status = 200;
      const res = { setHeader(_key: string, value: unknown) { assert.ok(Number(value) > 0); }, status(code: number) { status = code; return this; }, json() { resolve(status); } } as unknown as Response;
      (scope === 'student' ? limiter : staffLimiter)(reqFor(scope, raw, ip), res, ((error?: unknown) => error ? reject(error) : resolve(200)) as NextFunction);
    }));
    const sign = (value: string) => withRuntime(env, () => signSessionToken(value, 'student'));
    await assert.rejects(attempt(token, '203.0.113.1'), /重新登入/);
    assert.equal(counts.size, 0);
    const first = sign(token);
    assert.equal(await attempt(first, '203.0.113.1'), 200);
    assert.equal(await attempt(first, '203.0.113.2'), 200);
    assert.equal(await attempt(first, '203.0.113.3'), 429);
    for (const t of ['b', 'c']) assert.equal(await attempt(sign(t.repeat(64)), '203.0.113.1'), 200);
    assert.equal(await attempt(sign('d'.repeat(64)), '203.0.113.1'), 429);
    assert.equal(await attempt(sign('e'.repeat(64)), '203.0.113.4'), 429);
    const staffCookie = withRuntime(env, () => signSessionToken('f'.repeat(64), 'staff'));
    assert.equal(await attempt(staffCookie, '203.0.113.5', 'staff'), 429, 'student and staff share the aggregate budget');
  });
}

test('session database work rejects overflow and never exceeds 16 concurrent operations', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let active = 0; let maximum = 0;
  const requests = Array.from({ length: 530 }, () => sessionWork.run(async () => {
    active++; maximum = Math.max(maximum, active);
    try { await gate; } finally { active--; }
  }));
  const completed = Promise.allSettled(requests);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(maximum, 16);
  release();
  const results = await completed;
  assert.equal(results.filter(r => r.status === 'rejected').length, 2);
  assert.equal(maximum, 16);
  assert.equal(active, 0);
  await sessionWork.run(async () => {});
});

for (const mode of ['Node', 'Workers'] as const) {
  test(`${mode}: default student IP permits 6000 requests while staff IP remains capped at 3000`, async () => {
    const counts = new Map<string, number>();
    const shared = { idFromName(name: string) { return name; }, get() { return { async fetch(_url: string, init: { body: string }) {
      const { budgets } = JSON.parse(init.body);
      if (budgets.some((b: { key: string; limit: number }) => (counts.get(b.key) || 0) >= b.limit)) return Response.json({ success: false, retryAfter: 60 });
      for (const b of budgets) counts.set(b.key, (counts.get(b.key) || 0) + 1);
      return Response.json({ success: true, retryAfter: 0 });
    } }; } };
    const runtime = { ...env, ...(mode === 'Workers' ? { LOGIN_LIMITER: shared as any } : {}) };
    for (const scope of ['student', 'staff'] as const) {
      const limiter = sessionLimiter(scope);
      const limit = scope === 'student' ? 6000 : 3000;
      const attempt = (n: number) => withRuntime(runtime, () => new Promise<number>((resolve, reject) => {
        const raw = signSessionToken(Math.floor(n / 500).toString(16).padStart(64, '0'), scope);
        let status = 200;
        const res = { setHeader(_key: string, value: unknown) { assert.ok(Number(value) > 0); }, status(code: number) { status = code; return this; }, json() { resolve(status); } } as unknown as Response;
        limiter(reqFor(scope, raw, '198.51.100.77'), res, ((error?: unknown) => error ? reject(error) : resolve(200)) as NextFunction);
      }));
      // Rotate cookies every 500 requests so only the IP budget reaches its bound.
      for (let n = 0; n < limit; n++) assert.equal(await attempt(n), 200);
      assert.equal(await attempt(limit), 429);
    }
  });
}
