import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordHashLimits } from '../server/credentials';
import { STUDENT_LOGIN_LIMITS } from '../server/loginAdmission';
import { SESSION_WORK_LIMITS } from '../server/sessionSecurity';
import { API_TIMEOUTS, requestTimeoutMs } from '../src/lib/api';

test('password verification bounds Node and Workers concurrency separately', () => {
  const workers = { LOGIN_LIMITER: {} as any };
  assert.equal(passwordHashLimits({}).concurrency, 8);
  assert.equal(passwordHashLimits(workers).concurrency, 1);
  assert.equal(passwordHashLimits({ PASSWORD_HASH_CONCURRENCY: '2' }).concurrency, 2);
  assert.equal(passwordHashLimits({ ...workers, PASSWORD_HASH_CONCURRENCY: '2' }).concurrency, 2);
  for (const invalid of ['0', '-1', '1.5', 'Infinity', '4x', ' 2', '9']) {
    assert.throws(() => passwordHashLimits({ PASSWORD_HASH_CONCURRENCY: invalid }), /設定無效/);
  }
  for (const unsafe of ['3', '4', '8']) {
    assert.throws(() => passwordHashLimits({ ...workers, PASSWORD_HASH_CONCURRENCY: unsafe }), /設定無效/);
  }
});

test('student client deadlines cover queue waits and upstream work without extending staff deadlines', () => {
  const twoLoginCalls = 2 * 5000;
  const twoLimiterCalls = 2 * 2000;
  assert.ok(API_TIMEOUTS.studentLogin > STUDENT_LOGIN_LIMITS.waitMs + passwordHashLimits({}).waitMs + twoLoginCalls + twoLimiterCalls);
  // Missing lookup RPC can require the RPC attempt + two indexed upstream reads.
  assert.ok(API_TIMEOUTS.studentRead > SESSION_WORK_LIMITS.waitMs + 3 * 5000 + 2000);
  assert.equal(requestTimeoutMs('/api/student/me', false), API_TIMEOUTS.studentRead);
  assert.equal(requestTimeoutMs('/api/student/verify', true), API_TIMEOUTS.studentLogin);
  assert.equal(requestTimeoutMs('/api/auth/verify', true), 45000);
  assert.equal(requestTimeoutMs('/api/lottery/draw', true), 60000);
});
