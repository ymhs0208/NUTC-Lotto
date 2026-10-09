import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLocalDatabase } from '../server/localDatabase';
import { SQLiteDatabase } from '../server/sqliteDatabase';
import { fingerprint } from '../server/credentials';
import { auditQuery, type AuditActor } from '../server/audit';
import type { StoredProject } from '../server/credentials';
const hash = `scrypt-v1$${'a'.repeat(32)}$${'b'.repeat(64)}`;
const project = (id: string): StoredProject => ({ id, leader_id: `student-${id}`, seq_no: id, education_system: '四技', department: '資管', class_name: '甲', advisor: '',
  field: '測試', original_code: `A${id}`, project_title: `專題 ${id}`, leader_name: '林同學', password_hash: hash });
const domains = [{ id: 'a', field: '測試', code: 'A', groupCount: 2, evaluatorsPerGroup: {} }];
async function fixture() {
  const local = openLocalDatabase(':memory:', { email: 'admin@test.local', passwordHash: hash });
  const account = (await local.database.call('findStaff', { email: 'admin@test.local' }))!;
  const actor: AuditActor = { userId: account.id, email: account.email, role: account.role };
  return { ...local, actor, account, state: { projects: [project('1'), project('2')], domainConfigs: domains, version: 0, lastUpdated: '' } };
}
test('SQLite persists across restart; bootstrap never resets an existing account', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lottery-sqlite-')); const file = join(dir, 'state.sqlite');
  let local = openLocalDatabase(file, { email: 'admin@test.local', passwordHash: hash });
  try {
    const initial = await local.database.call('load', {});
    await local.database.call('save', { state: { ...initial, projects: [project('1')], domainConfigs: domains }, expectedVersion: 0 });
    local.close(); local = openLocalDatabase(file, { email: 'new@test.local', passwordHash: hash });
    assert.equal((await local.database.call('load', {})).projects[0].id, '1');
    assert.equal((await local.database.call('load', {})).version, 1);
    assert.equal(await local.database.call('findStaff', { email: 'new@test.local' }), null);
  } finally { local.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('version checks, leader swaps and audit failure are atomic', async () => {
  const f = await fixture(); const db = f.database;
  try {
    const first = await db.call('save', { state: f.state, expectedVersion: 0 });
    await assert.rejects(db.call('save', { state: first, expectedVersion: 0 }), /其他人更新/);
    const swapped = { ...first, projects: [{ ...first.projects[0], leader_id: first.projects[1].leader_id }, { ...first.projects[1], leader_id: first.projects[0].leader_id }] };
    const saved = await db.call('save', { state: swapped, expectedVersion: 1 });
    assert.equal((await db.call('findProject', { key: 'leader_key', value: 'student-1' }))?.id, '2');
    f.connection.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON staff_audit BEGIN SELECT RAISE(ABORT, 'private database failure'); END");
    await assert.rejects(db.call('save', { state: { ...saved, projects: [{ ...saved.projects[0], project_title: '不應儲存' }] }, expectedVersion: 2,
      audit: { actor: f.actor, action: 'draw', details: { project_count: 1 } } }));
    assert.deepEqual(await db.call('load', {}), saved);
    f.connection.exec('DROP TRIGGER fail_audit');
    const outcomes = await Promise.allSettled([db.call('save', { state: saved, expectedVersion: 2 }), db.call('save', { state: saved, expectedVersion: 2 })]);
    assert.equal(outcomes.filter(p => p.status === 'fulfilled').length, 1);
  } finally { f.close(); }
});
test('student finalize rechecks credentials; password changes and deletion revoke access', async () => {
  const f = await fixture(); const db = f.database; const tokenHash = fingerprint('student-token');
  try {
    let state = await db.call('save', { state: f.state, expectedVersion: 0 });
    const old = state.projects[0];
    await db.call('startStudentSession', { project: old, tokenHash, oldTokenHash: null });
    assert.equal((await db.call('studentSession', { tokenHash }))?.id, old.id);
    const nextHash = `scrypt-v1$${'c'.repeat(32)}$${'d'.repeat(64)}`;
    state = await db.call('save', { state: { ...state, projects: state.projects.map(p => ({ ...p, password_hash: nextHash })) }, expectedVersion: 1 });
    assert.equal(await db.call('studentSession', { tokenHash }), null);
    await assert.rejects(db.call('startStudentSession', { project: old, tokenHash: fingerprint('new'), oldTokenHash: tokenHash }), /更新或停用/);
    assert.equal(f.connection.prepare('SELECT count(*) AS count FROM student_sessions').get()!.count, 1);
    await db.call('startStudentSession', { project: state.projects[0], tokenHash: fingerprint('next'), oldTokenHash: tokenHash });
    assert.equal(await db.call('studentSession', { tokenHash }), null);
    await db.call('save', { state: { ...state, projects: [] }, expectedVersion: 2 });
    assert.equal(await db.call('studentSession', { tokenHash: fingerprint('next') }), null);
  } finally { f.close(); }
});
test('staff session creation and audit rollback together; role changes revoke sessions and retain an admin', async () => {
  const f = await fixture(); const db = f.database; const tokenHash = fingerprint('staff-token');
  const login = { accountId: f.account.id, passwordHash: hash, credentialVersion: 1, tokenHash, oldTokenHash: null };
  try {
    f.connection.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON staff_audit BEGIN SELECT RAISE(ABORT, 'failure'); END");
    await assert.rejects(db.call('startStaffSession', login));
    assert.equal(await db.call('staffSession', { tokenHash }), null);
    f.connection.exec('DROP TRIGGER fail_audit');
    await db.call('startStaffSession', login);
    await assert.rejects(db.call('setStaffAccount', { actor: f.actor, email: f.account.email, role: 'stage', disabled: false }), /至少一個/);
    await db.call('setStaffAccount', { actor: f.actor, email: 'stage@test.local', role: 'stage', passwordHash: hash, disabled: false });
    const stage = (await db.call('findStaff', { email: 'stage@test.local' }))!;
    await assert.rejects(db.call('staffAccounts', { actor: { userId: stage.id, email: stage.email, role: stage.role } }), /管理員/);
    await db.call('setStaffAccount', { actor: f.actor, email: f.account.email, role: 'admin', disabled: false, passwordHash: hash });
    assert.equal(await db.call('staffSession', { tokenHash }), null);
    await assert.rejects(db.call('startStaffSession', login), /更新/);
    const logs = await db.call('audit', auditQuery({}));
    assert.equal(logs.records.length, 3);
    assert.ok(!JSON.stringify(logs).includes(hash));
  } finally { f.close(); }
});
test('public results include more than 1000 rows, numeric order, only four public columns and fresh versions', async () => {
  const f = await fixture();
  try {
    const projects = Array.from({ length: 1201 }, (_, i) => ({ ...project(String(i)), assigned_group: 1, draw_code: `A${i + 1}` }));
    const state = await f.database.call('save', { state: { ...f.state, projects }, expectedVersion: 0 });
    const result = await f.database.call('publicResults', { field: '測試' });
    assert.equal(result.results.length, 1201); assert.equal(result.results[0].draw_code, 'A1'); assert.equal(result.results[1200].draw_code, 'A1201');
    assert.deepEqual(Object.keys(result.results[0]).sort(), ['assigned_group', 'draw_code', 'leader_name', 'project_title']);
    assert.equal(result.version, 1);
    await f.database.call('save', { state: { ...state, projects: [] }, expectedVersion: 1 });
    assert.deepEqual((await f.database.call('publicResults', { field: '測試' })).results, []);
    assert.equal((await f.database.call('publicResults', { field: '測試' })).version, 2);
  } finally { f.close(); }
});
test('cleanup bounds expired rows, preserves active rows and uses Taiwan calendar-month audit retention', async () => {
  const f = await fixture(); const now = Date.parse('2026-05-31T16:30:00.000Z');
  const db = new SQLiteDatabase(f.database.sql, {}, () => now);
  try {
    for (let i = 0; i < 505; i++) f.connection.prepare('INSERT INTO student_sessions VALUES(?,?,?,?)').run(fingerprint(String(i)), '1', 'version', now - 1);
    f.connection.prepare('INSERT INTO student_sessions VALUES(?,?,?,?)').run(fingerprint('active'), '1', 'version', now + 1);
    assert.equal((await db.call('cleanupSessions', {})).ntcust_student_sessions, 500);
    assert.equal((await db.call('cleanupSessions', {})).ntcust_student_sessions, 5);
    assert.equal(f.connection.prepare('SELECT COUNT(*) AS count FROM student_sessions').get()!.count, 1);
    // June 1 00:30 Taiwan -> March 1 00:30 Taiwan.
    for (const date of ['2026-02-28T16:29:59.999Z', '2026-02-28T16:30:00.000Z']) f.connection.prepare('INSERT INTO staff_audit(occurred_at,actor_email,actor_role,action,details,search_text) VALUES(?,?,?,?,?,?)').run(date, f.actor.email, 'admin', 'login', '{}', '');
    assert.equal((await db.call('cleanupAudit', {})).deleted, 1);
    assert.equal(f.connection.prepare('SELECT occurred_at FROM staff_audit').get()!.occurred_at, '2026-02-28T16:30:00.000Z');
  } finally { f.close(); }
});
test('literal audit search escapes wildcards and cursor pagination is stable', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 53; i++) f.connection.prepare('INSERT INTO staff_audit(occurred_at,actor_email,actor_role,action,details,search_text) VALUES(?,?,?,?,?,?)').run(new Date().toISOString(), f.actor.email, 'admin', 'draw', '{}', '測試 100%_完成');
    const first = await f.database.call('audit', auditQuery({ q: '100%_' }));
    assert.equal(first.records.length, 50); assert.ok(first.nextCursor);
    const next = await f.database.call('audit', auditQuery({ before: first.nextCursor!, q: '100%_' }));
    assert.equal(next.records.length, 3); assert.equal(next.nextCursor, null);
    assert.equal((await f.database.call('audit', auditQuery({ q: '100XX' }))).records.length, 0);
  } finally { f.close(); }
});
test('existing repository SQLite upgrades atomically and preserves accounts, results, versions and logs', async () => {
  const local = openLocalDatabase(':memory:');
  try {
    local.connection.exec(`DROP TABLE schema_version; DROP TABLE lottery_state; DROP TABLE projects;
      CREATE TABLE metadata(id INTEGER PRIMARY KEY, domains TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE projects(id TEXT PRIMARY KEY,leader_key TEXT NOT NULL UNIQUE,position INTEGER NOT NULL,document TEXT NOT NULL);
      CREATE TABLE accounts(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,document TEXT NOT NULL);
      CREATE TABLE staff_logs(id INTEGER PRIMARY KEY,created_at TEXT NOT NULL,email TEXT NOT NULL,role TEXT NOT NULL,action TEXT NOT NULL,summary TEXT NOT NULL,version INTEGER);`);
    local.connection.prepare('INSERT INTO metadata VALUES(1,?,?,?)').run(JSON.stringify(domains), 42, '2026-10-08T00:00:00.000Z');
    const p = { ...project('1'), assigned_group: 1, draw_code: 'A01', draw_order: 1 };
    local.connection.prepare('INSERT INTO projects VALUES(?,?,?,?)').run(p.id, p.leader_id, 0, JSON.stringify(p));
    local.connection.prepare('INSERT INTO accounts VALUES(?,?,?)').run('existing-admin', 'admin@test.local', JSON.stringify({ id: 'existing-admin', email: 'admin@test.local', role: 'admin', password_hash: hash }));
    local.connection.prepare('INSERT INTO staff_logs VALUES(?,?,?,?,?,?,?)').run(9, '2026-10-08T00:00:00.000Z', 'admin@test.local', 'admin', 'password_generate', '產生學生共用密碼', 42);
    const upgraded = new SQLiteDatabase(local.database.sql, { email: 'new@test.local', passwordHash: hash });
    const state = await upgraded.call('load', {});
    assert.equal(state.version, 42); assert.equal(state.projects[0].draw_code, 'A01');
    assert.equal((await upgraded.call('publicResults', { field: '測試' })).results.length, 1);
    assert.equal((await upgraded.call('findStaff', { email: 'admin@test.local' }))?.id, 'existing-admin');
    assert.equal(await upgraded.call('findStaff', { email: 'new@test.local' }), null);
    const audit = await upgraded.call('audit', auditQuery({ from: '2026-10-01', to: '2026-10-09' }));
    assert.equal(audit.records[0].id, 9); assert.equal(audit.records[0].action, 'shared_password_generate');
    const restarted = new SQLiteDatabase(local.database.sql);
    assert.equal((await restarted.call('load', {})).version, 42);
    assert.equal((await restarted.call('audit', auditQuery({ from: '2026-10-01', to: '2026-10-09' }))).records.length, 1);
  } finally { local.close(); }
});
