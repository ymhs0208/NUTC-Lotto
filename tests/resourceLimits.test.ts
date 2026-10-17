import { test } from 'node:test';
import assert from 'node:assert/strict';
import { studentLoginWork } from '../server/loginAdmission';
import { sessionWork } from '../server/sessionSecurity';
import { BoundedExecutor, ResourceBusyError, ShortCache } from '../server/resourceLimits';

function gate() {
  let release!: () => void;
  return { wait: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}

test('hash admission rejects overflow, serializes work and recovers after failures', async () => {
  const executor = new BoundedExecutor(1, 1, 1000);
  const active = gate(); const order: number[] = [];
  const first = executor.run(async () => { order.push(1); await active.wait; throw new Error('hash failure'); });
  const rejectedFirst = assert.rejects(first, /hash failure/);
  const second = executor.run(async () => { order.push(2); return 2; });
  let overflowRan = false;
  await assert.rejects(executor.run(async () => { overflowRan = true; }), ResourceBusyError);
  assert.deepEqual(order, [1]);
  active.release(); await rejectedFirst;
  assert.equal(await second, 2); assert.equal(overflowRan, false); assert.deepEqual(order, [1, 2]);
  assert.equal(await executor.run(async () => 3), 3);
});

test('expired hash waiters never run and free their queue slots', async () => {
  const executor = new BoundedExecutor(1, 1, 20); const active = gate();
  const first = executor.run(async () => active.wait);
  let expiredRan = false;
  await assert.rejects(executor.run(async () => { expiredRan = true; }), ResourceBusyError);
  const replacement = executor.run(async () => 'replacement');
  active.release(); await first;
  assert.equal(await replacement, 'replacement'); assert.equal(expiredRan, false);
});

test('public cache coalesces misses, expires and does not retain failures or invalidated in-flight work', async () => {
  const cache = new ShortCache<number>(50); let reads = 0;
  const active = gate();
  const load = async () => { reads++; await active.wait; return reads; };
  const requests = Array.from({ length: 30 }, () => cache.get('db', load));
  active.release(); await Promise.all(requests); assert.equal(reads, 1);
  assert.equal(await cache.get('db', async () => ++reads), 1);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(await cache.get('db', async () => ++reads), 2);
  cache.invalidate('db');
  await assert.rejects(cache.get('db', async () => { throw new Error('offline'); }), /offline/);
  assert.equal(await cache.get('db', async () => ++reads), 3);
  const stale = gate();
  const old = cache.get('other', async () => { await stale.wait; return 1; });
  cache.invalidate('other');
  assert.equal(await cache.get('other', async () => 2), 2);
  stale.release(); assert.equal(await old, 1);
  assert.equal(await cache.get('other', async () => 3), 2);
});


test('student admission accepts a 1,000-request burst, bounds overflow, and recovers', async () => {
  const held = gate(); let active = 0; let maximum = 0;
  const work = Array.from({ length: 1042 }, () => studentLoginWork.run(async () => {
    active++; maximum = Math.max(maximum, active);
    try { await held.wait; } finally { active--; }
  }));
  const all = Promise.allSettled(work);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(maximum, 16);
  held.release();
  const results = await all;
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1040);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason instanceof ResourceBusyError).length, 2);
  assert.equal(maximum, 16); assert.equal(active, 0);
  assert.equal(await studentLoginWork.run(async () => 'ready'), 'ready');
});

test('session admission buffers 1,000 simultaneous queries with only 16 active', async () => {
  const held = gate(); let active = 0; let maximum = 0;
  const work = Array.from({ length: 1000 }, () => sessionWork.run(async () => {
    active++; maximum = Math.max(maximum, active);
    try { await held.wait; } finally { active--; }
  }));
  const all = Promise.all(work);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(maximum, 16);
  held.release(); await all;
  assert.equal(active, 0); assert.equal(maximum, 16);
});
