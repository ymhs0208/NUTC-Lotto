import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SharedPasswordVerifier } from '../server/sharedPasswordVerifier';
import { ResourceBusyError } from '../server/resourceLimits';

function gate() {
  let release!: () => void;
  return { wait: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}

test('1,000 identical shared credentials coalesce once and success expires after the short TTL', async () => {
  let calls = 0; let now = 0; const held = gate();
  const verifier = new SharedPasswordVerifier(async () => { calls++; await held.wait; return true; }, 30, 32, () => now);
  const logins = Array.from({ length: 1000 }, () => verifier.verify('common-password', 'hash-v1'));
  await Promise.resolve(); assert.equal(calls, 1);
  held.release(); assert.ok((await Promise.all(logins)).every(Boolean));
  now = 29; assert.equal(await verifier.verify('common-password', 'hash-v1'), true); assert.equal(calls, 1);
  now = 30; assert.equal(await verifier.verify('common-password', 'hash-v1'), true); assert.equal(calls, 2);
});

test('incorrect passwords and verification errors are never retained', async () => {
  let calls = 0;
  const verifier = new SharedPasswordVerifier(async password => {
    calls++; if (password === 'failure') throw new Error('verification unavailable');
    return password === 'correct';
  });
  assert.deepEqual(await Promise.all(Array.from({ length: 20 }, () => verifier.verify('wrong', 'hash'))), Array(20).fill(false));
  assert.equal(calls, 1);
  assert.equal(await verifier.verify('wrong', 'hash'), false); assert.equal(calls, 2);
  await assert.rejects(verifier.verify('failure', 'hash'), /unavailable/);
  await assert.rejects(verifier.verify('failure', 'hash'), /unavailable/); assert.equal(calls, 4);
  assert.equal(await verifier.verify('correct', 'hash'), true); assert.equal(calls, 5);
});

test('current stored hash isolates credential versions and rotation invalidates pending successes', async () => {
  let calls = 0; let held: ReturnType<typeof gate> | undefined;
  const verifier = new SharedPasswordVerifier(async (password, encoded) => {
    calls++; if (held) await held.wait;
    return password === (encoded === 'hash-v1' ? 'old-password' : 'new-password');
  });
  assert.equal(await verifier.verify('old-password', 'hash-v1'), true);
  assert.equal(await verifier.verify('old-password', 'hash-v2'), false);
  assert.equal(await verifier.verify('new-password', 'hash-v2'), true); assert.equal(calls, 3);
  verifier.invalidate(); held = gate();
  const pending = verifier.verify('new-password', 'hash-v2');
  await Promise.resolve(); verifier.invalidate(); held.release();
  assert.equal(await pending, false, 'in-flight success must not survive invalidation');
  held = undefined;
  assert.equal(await verifier.verify('new-password', 'hash-v2'), true); assert.equal(calls, 5);
  verifier.invalidate();
  assert.equal(await verifier.verify('new-password', 'hash-v2'), true); assert.equal(calls, 6);
});

test('distinct in-flight credentials have a bounded cache and reject overflow without extra verification', async () => {
  let calls = 0; const held = gate();
  const verifier = new SharedPasswordVerifier(async () => { calls++; await held.wait; return true; }, 30000, 2);
  const first = verifier.verify('first', 'hash'); const second = verifier.verify('second', 'hash');
  await assert.rejects(verifier.verify('third', 'hash'), ResourceBusyError); assert.equal(calls, 2);
  held.release(); await Promise.all([first, second]);
  assert.equal(await verifier.verify('third', 'hash'), true); assert.equal(calls, 3);
});
