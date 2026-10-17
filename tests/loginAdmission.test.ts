import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { app } from '../server/app';
import { withRuntime } from '../server/runtime';
import { STUDENT_LOGIN_LIMITS, studentLoginWork } from '../server/loginAdmission';
import { ResourceBusyError } from '../server/resourceLimits';
import type { DatabaseGateway } from '../server/databaseTypes';

test('only a student login rejected before its handler starts may be retried', async () => {
  let dbCalls = 0;
  const database: DatabaseGateway = { async call() { dbCalls++; throw new ResourceBusyError(); } };
  const server = createServer((req, res) => withRuntime({ DATABASE: database }, () => app(req, res)));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const login = () => fetch(base + '/api/student/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leaderId: 'admission-test-student', password: 'test-password' }),
  });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const occupied = Array.from({ length: STUDENT_LOGIN_LIMITS.concurrency + STUDENT_LOGIN_LIMITS.maxWaiting },
    () => studentLoginWork.run(async () => held));
  const all = Promise.all(occupied);
  try {
    const rejected = await login();
    assert.equal(rejected.status, 503);
    assert.equal(rejected.headers.get('Retry-After'), '2');
    assert.equal((await rejected.json()).loginRetrySafe, true);
    assert.equal(dbCalls, 0);
    release(); await all;
    const started = await login();
    assert.equal(started.status, 503);
    assert.equal((await started.json()).loginRetrySafe, undefined);
    assert.equal(dbCalls, 1);
  } finally {
    release(); await all;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
