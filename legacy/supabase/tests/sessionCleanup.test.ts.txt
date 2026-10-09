import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { cleanupExpiredSessions, SESSION_CLEANUP_BATCH_SIZE, startSessionCleanup } from '../server/sessionCleanup';

type Row = { token_hash: string; expires_at: string };
const now = Date.parse('2026-10-03T00:00:00Z');
const row = (id: number, expired = true): Row => ({ token_hash: id.toString(16).padStart(64, '0'), expires_at: new Date(now + (expired ? -1000 : 1000)).toISOString() });
function database(student: Row[], staff: Row[], options: { fail?: string; renew?: boolean } = {}) {
  const tables: Record<string, Row[]> = { ntcust_student_sessions: student, ntcust_staff_sessions: staff };
  const calls: Array<{ table: string; method: string; url: URL }> = [];
  const client = createClient('http://cleanup.test', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)); const table = url.pathname.split('/').at(-1)!;
      const method = init?.method || 'GET'; calls.push({ table, method, url });
      assert.ok(table in tables, 'cleanup must not access projects or other data');
      assert.equal(url.searchParams.get('expires_at'), `lte.${new Date(now).toISOString()}`);
      if (table === options.fail) return Response.json({ message: 'private error details' }, { status: 503 });
      if (method === 'GET') {
        assert.equal(url.searchParams.get('select'), 'token_hash');
        assert.equal(url.searchParams.get('limit'), String(SESSION_CLEANUP_BATCH_SIZE));
        const selected = tables[table].filter(r => Date.parse(r.expires_at) <= now).slice(0, SESSION_CLEANUP_BATCH_SIZE).map(r => ({ token_hash: r.token_hash }));
        if (options.renew && selected.length) tables[table][0].expires_at = new Date(now + 1000).toISOString();
        return Response.json(selected);
      }
      assert.equal(method, 'DELETE');
      const ids = url.searchParams.get('token_hash')!;
      assert.ok(ids.startsWith('in.('), 'deletion must be restricted to selected tokens');
      const count = tables[table].filter(r => Date.parse(r.expires_at) <= now && ids.includes(r.token_hash)).length;
      tables[table] = tables[table].filter(r => !(Date.parse(r.expires_at) <= now && ids.includes(r.token_hash)));
      return new Response(null, { status: 204, headers: { 'Content-Range': `*/${count}` } });
    } },
  });
  return { client, tables, calls };
}

test('cleanup removes bounded expired batches in both tables and retains active sessions and backlog', async () => {
  const db = database([...Array.from({ length: 505 }, (_, i) => row(i)), row(1000, false)], [row(2000), row(2001, false)]);
  const result = await cleanupExpiredSessions(db.client, now);
  assert.deepEqual(result, { ntcust_student_sessions: 500, ntcust_staff_sessions: 1 });
  assert.equal(db.tables.ntcust_student_sessions.length, 6);
  assert.deepEqual(db.tables.ntcust_staff_sessions, [row(2001, false)]);
  assert.ok(db.tables.ntcust_student_sessions.some(r => r.token_hash === row(1000).token_hash));
  assert.equal(db.calls.filter(call => call.method === 'DELETE').length, 6);
  assert.ok(db.calls.every(call => call.url.href.length < 8000), 'batch filters must fit a normal HTTP URL');
  await cleanupExpiredSessions(db.client, now);
  assert.deepEqual(db.tables.ntcust_student_sessions, [row(1000, false)]);
});

test('cleanup rechecks expiry after selection and issues no deletion when there are no expired rows', async () => {
  const renewed = database([row(1)], [], { renew: true });
  assert.equal((await cleanupExpiredSessions(renewed.client, now)).ntcust_student_sessions, 0);
  assert.equal(renewed.tables.ntcust_student_sessions.length, 1);
  const empty = database([row(1, false)], []);
  await cleanupExpiredSessions(empty.client, now);
  assert.ok(empty.calls.every(call => call.method === 'GET'));
});

test('cleanup reports sanitized failures while still cleaning the other session table', async () => {
  const db = database([row(1)], [row(2)], { fail: 'ntcust_student_sessions' });
  await assert.rejects(cleanupExpiredSessions(db.client, now), error => error instanceof Error && /清理失敗/.test(error.message) && !error.message.includes('private'));
  assert.equal(db.tables.ntcust_student_sessions.length, 1);
  assert.equal(db.tables.ntcust_staff_sessions.length, 0);
});

test('Node scheduler starts immediately, prevents overlap, retries failure and can be stopped', async () => {
  let release!: () => void;
  let calls = 0;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const stop = startSessionCleanup(async () => { calls++; if (calls === 1) { await blocked; throw new Error('test'); } }, 5);
  try {
    assert.equal(calls, 1);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls, 1);
    release();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(calls >= 2);
    stop(); const stoppedAt = calls;
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(calls, stoppedAt);
  } finally { stop(); release(); }
});
