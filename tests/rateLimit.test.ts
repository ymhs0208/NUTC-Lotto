import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';
import { loginLimiter } from '../server/rateLimit';
import { withRuntime } from '../server/runtime';

test('campus IP permits 300 distinct student logins while each account and staff retain tight limits', async () => {
  const counts = new Map<string, number>();
  const names = new Set<string>();
  const shared = {
    idFromName(name: string) { names.add(name); return name; },
    get(name: string) {
      return {
        async fetch(_url: string, init: { body: string }) {
          const { limit } = JSON.parse(init.body) as { limit: number };
          const count = counts.get(name) || 0;
          if (count >= limit) return Response.json({ success: false, retryAfter: 60 });
          counts.set(name, count + 1);
          return Response.json({ success: true, retryAfter: 0 });
        },
      };
    },
  };
  const student = loginLimiter('student', 10, 600);
  const staff = loginLimiter('staff');
  const attempt = (middleware: ReturnType<typeof loginLimiter>, account: string) => withRuntime(
    { LOGIN_LIMITER: shared as any },
    () => new Promise<number>((resolve, reject) => {
      const req = {
        ip: '127.0.0.1', body: { leaderId: account, username: account },
        get: (header: string) => header === 'cf-connecting-ip' ? '203.0.113.1' : undefined,
      } as unknown as Request;
      let statusCode = 200;
      const res = {
        setHeader() {},
        status(code: number) { statusCode = code; return this; },
        json() { resolve(statusCode); return this; },
      } as unknown as Response;
      middleware(req, res, ((error?: unknown) => error ? reject(error) : resolve(200)) as NextFunction);
    }),
  );

  for (let i = 0; i < 300; i++) assert.equal(await attempt(student, `student-${i}`), 200);
  for (let i = 0; i < 10; i++) assert.equal(await attempt(student, 'repeated-student'), 200);
  assert.equal(await attempt(student, 'repeated-student'), 429);
  assert.equal(counts.get([...names].find(name => name.startsWith('student:ip:'))!), 310);
  for (let i = 0; i < 100; i++) assert.equal(await attempt(staff, `staff-${i}`), 200);
  assert.equal(await attempt(staff, 'staff-over-limit'), 429);
  assert.ok([...names].some(name => name.startsWith('student:ip:')));
  assert.ok([...names].some(name => name.startsWith('staff:ip:')));
});


for (const mode of ['Node', 'Workers'] as const) {
  test(`${mode}: account limits ignore extra fields and follow the actual login account across IPs`, async () => {
    const counts = new Map<string, number>();
    const shared = {
      idFromName(name: string) { return name; },
      get(name: string) { return { async fetch(_url: string, init: { body: string }) {
        const { limit } = JSON.parse(init.body);
        const count = counts.get(name) || 0;
        if (count >= limit) return Response.json({ success: false, retryAfter: 60 });
        counts.set(name, count + 1);
        return Response.json({ success: true, retryAfter: 0 });
      } }; },
    };
    const attempt = (limiter: ReturnType<typeof loginLimiter>, body: unknown, ip: string) => withRuntime(
      mode === 'Workers' ? { LOGIN_LIMITER: shared as any } : {},
      () => new Promise<number>((resolve, reject) => {
        const req = { ip, body, get: (header: string) => header === 'cf-connecting-ip' ? ip : undefined } as unknown as Request;
        let status = 200;
        const res = { setHeader() {}, status(code: number) { status = code; return this; }, json() { resolve(status); return this; } } as unknown as Response;
        limiter(req, res, ((error?: unknown) => {
          if (!error) resolve(200);
          else if (typeof error === 'object' && error && 'status' in error) resolve(Number(error.status));
          else reject(error);
        }) as NextFunction);
      }),
    );
    const extraValues = [null, {}, [], 123, false, 'rotating-1', 'rotating-2', 'rotating-3', 'rotating-4', 'rotating-5'];
    for (const scope of ['staff', 'student'] as const) {
      const limiter = loginLimiter(scope);
      const accountField = scope === 'staff' ? 'username' : 'leaderId';
      const extraField = scope === 'staff' ? 'leaderId' : 'username';
      for (let n = 0; n < 10; n++) {
        const account = n % 2 ? 'victim@example.test' : ' VICTIM@example.test ';
        assert.equal(await attempt(limiter, { [accountField]: account, [extraField]: extraValues[n] }, `203.0.113.${n + 1}`), 200);
      }
      assert.equal(await attempt(limiter, { [accountField]: 'victim@example.test', [extraField]: 'another-rotation' }, '198.51.100.1'), 429);
      assert.equal(await attempt(limiter, { [accountField]: 'different@example.test', [extraField]: 'victim@example.test' }, '198.51.100.1'), 200);
    }
    const before = counts.size;
    for (const scope of ['staff', 'student'] as const) {
      const limiter = loginLimiter(scope);
      const accountField = scope === 'staff' ? 'username' : 'leaderId';
      const extraField = scope === 'staff' ? 'leaderId' : 'username';
      for (const invalid of [undefined, null, {}, [], 123, '', '   ', 'x'.repeat(scope === 'staff' ? 257 : 129)]) {
        assert.equal(await attempt(limiter, { [accountField]: invalid, [extraField]: 'apparently-valid' }, '198.51.100.2'), 400);
      }
    }
    assert.equal(counts.size, before, 'invalid account fields must be rejected before creating shared buckets');
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
