import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { cleanupExpiredAudit } from '../server/auditCleanup';
import { runScheduledMaintenance } from '../server/sessionCleanup';

function database(responses: Array<number | { code: string; message?: string }>) {
  let calls = 0;
  const client = createClient('http://cleanup.test', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      assert.equal(new URL(String(input)).pathname, '/rest/v1/rpc/ntcust_cleanup_staff_audit');
      assert.equal(init?.method, 'POST');
      assert.deepEqual(JSON.parse(String(init?.body || '{}')), {}, 'no client-controlled cutoff');
      const response = responses[calls++] ?? 0;
      return Response.json(response, { status: typeof response === 'number' ? 200 : 400 });
    } },
  });
  return { client, calls: () => calls };
}

test('audit cleanup caps work and resumes backlog next run', async () => {
  const db = database([500, 500, 500, 500, 500, 11]);
  assert.deepEqual(await cleanupExpiredAudit(db.client), { enabled: true, deleted: 2500 });
  assert.equal(db.calls(), 5);
  assert.deepEqual(await cleanupExpiredAudit(db.client), { enabled: true, deleted: 11 });
  assert.equal(db.calls(), 6);
});

test('missing audit cleanup migration skips without hiding other failures or malformed counts', async () => {
  assert.deepEqual(await cleanupExpiredAudit(database([{ code: 'PGRST202' }]).client), { enabled: false, deleted: 0 });
  for (const response of [{ code: '42501', message: 'secret database error' }, -1, 501, 1.5]) {
    await assert.rejects(cleanupExpiredAudit(database([response]).client), error => {
      assert.equal((error as Error).message, '操作紀錄清理失敗，將於下一次排程重試。');
      return true;
    });
  }
});

test('session and audit scheduled maintenance run independently after either failure', async () => {
  for (const failed of ['session', 'audit']) {
    const called: string[] = [];
    const run = (name: string) => async () => {
      called.push(name);
      if (name === failed) throw new Error('private failure');
      return { deleted: 0 };
    };
    await assert.rejects(runScheduledMaintenance(run('session'), run('audit')), /定期資料清理失敗/);
    assert.deepEqual(called.sort(), ['audit', 'session']);
  }
});
