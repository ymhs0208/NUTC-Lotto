import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { LotteryDatabase } from '../server/cloudflareDatabase';

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
  const object = new LotteryDatabase({ storage } as unknown as DurableObjectState);
  const call = async (operation: string, args = {}) => {
    const response = await object.fetch(new Request('https://internal', { method: 'POST', body: JSON.stringify({ operation, args }) }));
    return { status: response.status, ...await response.json() as any };
  };
  return { sqlite, object, call, alarmCalls };
}
const project = (id: string) => ({ id, leader_id: `student-${id}`, seq_no: id, education_system: '四技', department: '資管', class_name: '甲', advisor: '王教授', field: '企業智慧化', original_code: '', project_title: `專題 ${id}`, assigned_group: 1, draw_order: 1, draw_code: 'A01', evaluators: ['李教授'], password_hash: `scrypt-v1$${'a'.repeat(32)}$${'b'.repeat(64)}` });

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
    assert.equal((await call('publicResults')).data.length, 2000);
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
