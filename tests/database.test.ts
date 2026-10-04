import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { LotteryDatabase } from '../server/cloudflareDatabase';
import { staffLogCutoff } from '../server/logRetention';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  let alarm: number | null = null;
  const alarmCalls: number[] = [];
  const storage = {
    sql: { exec(query: string, ...bindings: any[]) {
      if (!bindings.length && query.includes('CREATE TABLE')) { sqlite.exec(query); return { toArray: () => [] }; }
      const statement = sqlite.prepare(query);
      if (/^SELECT/i.test(query)) return { toArray: () => statement.all(...bindings) };
      statement.run(...bindings); return { toArray: () => [] };
    } },
    transactionSync<T>(callback: () => T): T {
      sqlite.exec('BEGIN');
      try { const value = callback(); sqlite.exec('COMMIT'); return value; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    async getAlarm() { return alarm; },
    async setAlarm(value: number) { alarm = value; alarmCalls.push(value); },
  };
  const object = new LotteryDatabase({ storage, blockConcurrencyWhile: (callback: () => Promise<unknown>) => callback() } as unknown as DurableObjectState);
  const call = async (operation: string, args = {}) => {
    const response = await object.fetch(new Request('https://internal', { method: 'POST', body: JSON.stringify({ operation, args }) }));
    return { status: response.status, ...await response.json() as any };
  };
  return { sqlite, object, call, alarmCalls };
}
const project = (id: string) => ({ id, leader_id: `student-${id}`, seq_no: id, education_system: '四技', department: '資管', class_name: '甲', advisor: '王教授', field: '企業智慧化', original_code: '', project_title: `專題 ${id}`, assigned_group: 1, draw_order: 1, draw_code: 'A01', evaluators: ['李教授'], password_hash: `scrypt-v1$${'a'.repeat(32)}$${'b'.repeat(64)}` });

test('log retention uses three calendar months including month-end and leap years', () => {
  for (const [now, cutoff] of [
    ['2026-10-04T03:00:00.000Z', '2026-07-04T03:00:00.000Z'],
    ['2026-05-31T03:00:00.000Z', '2026-02-28T03:00:00.000Z'],
    ['2024-05-31T03:00:00.000Z', '2024-02-29T03:00:00.000Z'],
    ['2026-01-31T03:00:00.000Z', '2025-10-31T03:00:00.000Z'],
  ]) assert.equal(staffLogCutoff(new Date(now)), cutoff);
});

test('alarm removes only expired logs and keeps scheduling without any sessions', async () => {
  const { sqlite, call, object, alarmCalls } = database();
  try {
    const state = { projects: [project('1')], domainConfigs: [] };
    await call('save', { state, expectedVersion: 0 });
    const before = (await call('load')).data;
    const account = { id: 'admin', email: 'admin@example.edu.tw', role: 'admin', password_hash: project('1').password_hash };
    await call('accounts', { accounts: [account] });
    await call('save', { state, expectedVersion: 1, audit: { actorId: account.id, action: 'roster', summary: '1 件專題' } });
    assert.equal(alarmCalls.length, 1);
    sqlite.prepare('UPDATE staff_logs SET created_at = ?').run('2000-01-01T00:00:00.000Z');
    sqlite.prepare('INSERT INTO staff_logs (created_at, actor_id, email, role, action, summary) VALUES (?, ?, ?, ?, ?, ?)').run(new Date().toISOString(), account.id, account.email, account.role, 'login', '新紀錄');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n, 0);
    await object.alarm();
    assert.equal(alarmCalls.length, 2);
    assert.deepEqual((await call('staffLogs')).data.logs.map((log: any) => log.summary), ['新紀錄']);
    assert.deepEqual((await call('load')).data.projects, before.projects);
    assert.deepEqual((await call('findAccount', { key: 'id', value: account.id })).data, account);
    sqlite.prepare('UPDATE staff_logs SET created_at = ?').run('2000-01-01T00:00:00.000Z');
    await object.alarm();
    assert.equal((await call('staffLogs')).data.logs.length, 0);
    assert.equal(alarmCalls.length, 2);
  } finally { sqlite.close(); }
});

test('staff audit logs persist atomically, paginate, filter and exclude credentials', async () => {
  const { sqlite, call, object } = database();
  try {
    const account = { id: 'admin', email: 'admin@example.edu.tw', role: 'admin', password_hash: project('1').password_hash };
    await call('accounts', { accounts: [account] });
    const session = { user_id: account.id, credential_version: 'private-credential', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString() };
    assert.equal((await call('putSession', { scope: 'staff', tokenHash: 'private-token', session })).status, 200);
    for (let version = 0; version < 55; version++) {
      assert.equal((await call('save', { state: { projects: [], domainConfigs: [] }, expectedVersion: version, audit: { actorId: account.id, action: 'roster', summary: '0 件專題' } })).status, 200);
    }
    const page = (await call('staffLogs')).data;
    assert.equal(page.logs.length, 50); assert.ok(page.nextCursor);
    const next = (await call('staffLogs', { before: page.nextCursor })).data;
    assert.equal(next.logs.length, 6); assert.equal(next.nextCursor, null);
    assert.ok(next.logs.every((row: any) => row.id < page.nextCursor));
    assert.equal((await call('staffLogs', { action: 'login', email: 'ADMIN@' })).data.logs.length, 1);
    assert.equal((await call('staffLogs', { email: '%_' })).data.logs.length, 0);
    assert.equal((await call('staffLogs', { before: -1 })).status, 400);
    assert.equal((await call('staffLogs', { action: 'invalid' })).status, 400);
    const audit = { actorId: account.id, action: 'reset', summary: '失敗操作' };
    assert.equal((await call('save', { state: { projects: [], domainConfigs: [] }, expectedVersion: 0, audit })).status, 409);
    sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON staff_logs WHEN NEW.action = 'reset' BEGIN SELECT RAISE(ABORT, 'forced rollback'); END;");
    assert.equal((await call('save', { state: { projects: [project('1')], domainConfigs: [] }, expectedVersion: 55, audit })).status, 503);
    assert.equal((await call('load')).data.version, 55);
    assert.deepEqual((await call('load')).data.projects, []);
    assert.equal((await call('staffLogs', { action: 'reset' })).data.logs.length, 0);
    await call('deleteSession', { scope: 'staff', tokenHash: 'private-token' });
    await call('deleteSession', { scope: 'staff', tokenHash: 'private-token' });
    assert.equal((await call('staffLogs', { action: 'logout' })).data.logs.length, 1);
    await object.alarm();
    const serialized = JSON.stringify((await call('staffLogs')).data);
    for (const secret of ['private-token', 'private-credential', 'password_hash', account.password_hash]) assert.ok(!serialized.includes(secret));
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM staff_logs').get()!.count, 57);
  } finally { sqlite.close(); }
});

test('SQLite preserves credentials/results, enforces versions and rolls back failed transactions', async () => {
  const { sqlite, call } = database();
  try {
    const state = { projects: [project('1'), project('2')], domainConfigs: [], version: 7, lastUpdated: '2026-10-02T00:00:00.000Z' };
    assert.equal((await call('save', { state, expectedVersion: 0 })).status, 200);
    const loaded = (await call('load')).data;
    assert.equal(loaded.projects[0].password_hash, state.projects[0].password_hash); assert.equal(loaded.version, 1);
    const swapped = loaded.projects.map((p: any, i: number) => ({ ...p, leader_id: loaded.projects[1 - i].leader_id }));
    assert.equal((await call('save', { state: { ...loaded, projects: swapped }, expectedVersion: 1 })).status, 200);
    const saved = (await call('load')).data;
    assert.equal((await call('save', { state: loaded, expectedVersion: 1 })).status, 409);
    assert.equal((await call('save', { state: { ...saved, projects: [project('same'), project('same')] }, expectedVersion: 2 })).status, 400);
    sqlite.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON projects WHEN NEW.id = 'fail' BEGIN SELECT RAISE(ABORT, 'forced rollback'); END;");
    assert.equal((await call('save', { state: { ...saved, projects: [project('new'), project('fail')] }, expectedVersion: 2 })).status, 503);
    assert.deepEqual((await call('load')).data, saved);
    const large = Array.from({ length: 2000 }, (_, i) => project(`large-${i}`));
    assert.equal((await call('save', { state: { ...saved, projects: large }, expectedVersion: 2 })).status, 200);
    const lookup = await call('findProject', { key: 'leader_key', value: 'student-large-1000' }); assert.equal(lookup.data.id, 'large-1000');
    assert.equal((await call('publicResults')).status, 400);
    const latest = (await call('load')).data;
    assert.equal((await call('save', { state: { ...latest, projects: [] }, expectedVersion: 3 })).status, 200);
    assert.deepEqual((await call('load')).data.projects, []);
  } finally { sqlite.close(); }
});

test('SQLite joins only session owner, excludes revoked/expired sessions and cleans up expiry', async () => {
  const { sqlite, call, object, alarmCalls } = database();
  try {
    await call('save', { state: { projects: [project('1'), project('2')], domainConfigs: [] }, expectedVersion: 0 });
    const session = { project_id: '2', credential_version: 'version', expires_at: new Date(Date.now() + 3600000).toISOString() };
    await call('putSession', { scope: 'student', tokenHash: 'active', session });
    await call('putSession', { scope: 'student', tokenHash: 'expired', session: { ...session, expires_at: '2000-01-01T00:00:00.000Z' } });
    assert.equal(alarmCalls.length, 1); // New logins must not postpone expiry cleanup.
    assert.equal((await call('studentLookup', { tokenHash: 'active' })).data.project.id, '2');
    assert.equal((await call('studentLookup', { tokenHash: 'expired' })).data, null);
    assert.equal((await call('getSession', { scope: 'staff', tokenHash: 'active' })).data, null);
    await object.alarm(); assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sessions').get()!.n, 1);
    await call('deleteSession', { scope: 'student', tokenHash: 'active' }); assert.equal((await call('studentLookup', { tokenHash: 'active' })).data, null);
  } finally { sqlite.close(); }
});
