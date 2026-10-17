import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { DurableObjectNamespace } from '@cloudflare/workers-types/index.ts';
import { withRuntime, type RuntimeEnvironment } from '../server/runtime';
import { hashPassword, verifyPassword } from '../server/credentials';
import { PASSWORD_POOL_BINDINGS } from '../server/passwordVerification';
import { SCRYPT_COST } from '../server/passwordHash';
import publicWorker, { PasswordVerifier } from '../worker/passwordVerifier';
import { apiBackendName } from '../server/apiRouting';
import benchmarkWorker from './fixtures/passwordPoolBenchmark';

test('local mode never dispatches to the optional pools and rejects unknown mode settings', async () => {
  const f = fixture(() => Response.json({ valid: true }));
  const encoded = await hashPassword('Local-mode-password-123');
  for (const mode of [undefined, 'local']) {
    await withRuntime({ ...f.env, PASSWORD_VERIFICATION_MODE: mode }, async () => {
      assert.equal(await verifyPassword('Local-mode-password-123', encoded), true);
      assert.equal(await verifyPassword('wrong-password', encoded), false);
    });
  }
  assert.equal(f.requests.length, 0);
  await assert.rejects(withRuntime({ PASSWORD_VERIFICATION_MODE: 'typo' }, () => verifyPassword('password', encoded)), /設定無效/);
});

test('isolated benchmark gateway requires its key before forwarding any request', async () => {
  let calls = 0;
  const env = { BENCHMARK_KEY: 'synthetic-benchmark-key', BENCHMARK_API: {
    idFromName(name: string) { return name; },
    get() { return { async fetch() { calls++; return Response.json({ ready: true }); } }; },
  } };
  const request = (key?: string) => new Request('https://benchmark.test/ready', { headers: key ? { Authorization: `Bearer ${key}` } : {} });
  assert.equal((await benchmarkWorker.fetch(request(), env)).status, 403);
  assert.equal((await benchmarkWorker.fetch(request('wrong-key'), env)).status, 403);
  assert.equal((await benchmarkWorker.fetch(request(env.BENCHMARK_KEY), { ...env, BENCHMARK_KEY: '' })).status, 403);
  assert.equal(calls, 0);
  assert.equal((await benchmarkWorker.fetch(request(env.BENCHMARK_KEY), env)).status, 200);
  assert.equal(calls, 1);
});

test('login queues stay on one object per scope while queries retain their shard pool', () => {
  for (let shard = 0; shard < 256; shard++) {
    for (const path of ['/api/student/verify', '/API/Student/Verify/']) {
      assert.equal(apiBackendName(path, shard, true), 'api-student-login-v2');
      assert.equal(apiBackendName(path, shard), `api-${shard}`);
    }
    assert.equal(apiBackendName('/api/auth/verify', shard, true), 'api-staff-login-v2');
    assert.equal(apiBackendName('/api/student/me', shard), `api-${shard}`);
    assert.equal(apiBackendName('/api/lottery/draw', shard), `api-${shard}`);
  }
});

const hash = `scrypt-v1$${'a'.repeat(32)}$${'b'.repeat(64)}`;
function fixture(reply: (payload: any) => Response | Promise<Response>) {
  const requests: Array<{ pool: number; shard: string; payload: any }> = [];
  const env: RuntimeEnvironment = { LOGIN_LIMITER: {} as DurableObjectNamespace, PASSWORD_VERIFICATION_MODE: 'distributed' };
  for (const [pool, binding] of PASSWORD_POOL_BINDINGS.entries()) {
    env[binding] = {
      idFromName(name: string) { return name; },
      get(shard: string) { return { async fetch(url: string, init: RequestInit) {
        assert.equal(url, 'https://password.internal/verify');
        assert.equal(init.method, 'POST'); assert.ok(init.signal);
        const payload = JSON.parse(String(init.body));
        requests.push({ pool, shard, payload });
        return reply(payload);
      } }; },
    } as unknown as DurableObjectNamespace;
  }
  return { env, requests };
}

test('Workers verification dispatches through private pools with only bounded credential payloads', async () => {
  const f = fixture(() => Response.json({ valid: true }));
  await withRuntime(f.env, async () => {
    assert.equal(await verifyPassword('test-password', hash), true);
    assert.equal(await verifyPassword('test-password'), true);
    assert.equal(await verifyPassword('test-password', 'malformed'), true);
    assert.equal(await verifyPassword('test-password', hash), true);
  });
  assert.equal(f.requests.length, 4);
  assert.deepEqual(f.requests.map(r => r.payload), [
    { password: 'test-password', encoded: hash },
    { password: 'test-password', encoded: null },
    { password: 'test-password', encoded: null },
    { password: 'test-password', encoded: hash },
  ]);
  for (const request of f.requests) {
    assert.ok(request.pool >= 0 && request.pool < 4);
    assert.equal(request.shard, 'password-v1');
  }
  assert.equal(new Set(f.requests.map(r => r.pool)).size, 4);
});

test('verification rejects missing pools, outages and malformed results without local fallback or retries', async () => {
  await assert.rejects(withRuntime({ PASSWORD_VERIFICATION_MODE: 'distributed' }, () => verifyPassword('test-password', hash)), /設定不完整/);
  for (const reply of [
    () => Response.json({ valid: 'true' }), () => Response.json({}),
    () => Response.json({ valid: true }, { status: 503 }),
    () => { throw new Error('private service failure with sensitive data'); },
  ]) {
    const f = fixture(reply);
    await assert.rejects(withRuntime(f.env, () => verifyPassword('test-password', hash)), error => {
      assert.equal((error as any).status, 503);
      assert.equal((error as Error).message, '密碼驗證服務暫時無法使用。'); return true;
    });
    assert.equal(f.requests.length, 1);
  }
  const f = fixture(() => Response.json({ valid: false }));
  assert.equal(await withRuntime(f.env, () => verifyPassword('wrong-password', hash)), false);
});

test('private verifier preserves existing scrypt hashes and exposes no public verification route', async () => {
  assert.deepEqual(SCRYPT_COST, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
  assert.equal(publicWorker.fetch().status, 404);
  const verifier = new PasswordVerifier();
  const encoded = await hashPassword('Existing-password-123');
  const request = (body: unknown) => new Request('https://password.internal/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  for (const [password, expected] of [['Existing-password-123', true], ['wrong-password', false]] as const) {
    const response = await verifier.fetch(request({ password, encoded }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { valid: expected });
  }
  assert.deepEqual(await (await verifier.fetch(request({ password: 'unknown-account-password', encoded: null }))).json(), { valid: false });
  for (const invalid of [null, {}, { password: 'x'.repeat(129), encoded }, { password: 'test', encoded: 'bad' }]) {
    assert.equal((await verifier.fetch(request(invalid))).status, 400);
  }
  assert.equal((await verifier.fetch(request({ password: 'x'.repeat(5000), encoded }))).status, 413);
  assert.equal((await verifier.fetch(new Request('https://password.internal/verify'))).status, 404);
});

test('deployment uses four separate private Worker scripts and retains the shared database identity', async () => {
  const main = JSON.parse(await readFile('wrangler.distributed.jsonc', 'utf8'));
  const base = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  assert.equal(base.vars.PASSWORD_VERIFICATION_MODE, 'local');
  assert.equal(base.durable_objects.bindings.some((b: any) => b.name.startsWith('PASSWORD_VERIFIER_')), false);
  assert.equal(main.vars.PASSWORD_VERIFICATION_MODE, 'distributed');
  const names = new Set<string>();
  for (let i = 0; i < 4; i++) {
    const pool = JSON.parse(await readFile(`wrangler.password-${i}.jsonc`, 'utf8'));
    names.add(pool.name);
    assert.equal(pool.workers_dev, false); assert.equal(pool.preview_urls, false);
    assert.equal(pool.routes, undefined); assert.equal(pool.assets, undefined);
    assert.equal(pool.durable_objects.bindings[0].class_name, 'PasswordVerifier');
    const binding = main.durable_objects.bindings.find((b: any) => b.name === PASSWORD_POOL_BINDINGS[i]);
    assert.equal(binding.script_name, pool.name); assert.equal(binding.class_name, 'PasswordVerifier');
  }
  assert.equal(names.size, 4);
  assert.equal(main.durable_objects.bindings.find((b: any) => b.name === 'LOTTERY_DATABASE').class_name, 'LotteryDatabase');
  assert.deepEqual(main.migrations.map((m: any) => m.tag), ['v1', 'v2']);
});
