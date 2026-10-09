import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint } from '../server/credentials';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const directory = new URL('../supabase/migrations/', import.meta.url);
const project = (id: string, leader = id) => ({
  id, leader_id: leader, seq_no: id, education_system: '四技', department: '資管',
  class_name: '甲', advisor: '王教授', field: '企業智慧化', original_code: `A${id}`,
  project_title: `專題 ${id}`, assigned_group: 2, draw_code: 'A01',
  draw_time: '2026-10-02T00:00:00.000Z', evaluators: ['李教授'],
  password_hash: `scrypt-v1$${'a'.repeat(32)}$${'b'.repeat(64)}`,
});
async function database() {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key);');
  for (const file of (await readdir(directory)).sort().filter(file => file.endsWith('.sql') && file.startsWith('20261001'))) {
    await db.exec(await readFile(new URL(file, directory), 'utf8'));
  }
  return db;
}
async function migrate(db: PGlite) {
  await db.exec(await readFile(new URL('202610020001_project_rows.sql', directory), 'utf8'));
}
async function snapshot(db: PGlite): Promise<any> {
  return (await db.query<{ state: any }>('select public.ntcust_load_lottery_state() as state')).rows[0].state;
}
async function save(db: PGlite, projects: unknown[], domains: unknown[], version: number): Promise<any> {
  return (await db.query<{ state: any }>('select public.ntcust_save_lottery_state($1::jsonb, $2::jsonb, $3) as state',
    [JSON.stringify(projects), JSON.stringify(domains), version])).rows[0].state;
}

test('PostgreSQL migrates the roster and atomically persists indexed project rows', async () => {
  const db = await database();
  try {
    const projects = [project('01', '\t Student-A \u3000'), project('02', 'student-b')];
    await db.query('update public.ntcust_lottery_state set projects = $1::jsonb, version = 7', [JSON.stringify(projects)]);
    await migrate(db);
    const initial = await snapshot(db);
    assert.equal(initial.version, 7);
    assert.deepEqual(initial.projects, projects); // Includes hashes, reviewers and draw results.
    const rows = await db.query<{ id: string; leader_key: string }>('select id, leader_key from public.ntcust_projects order by position');
    assert.deepEqual(rows.rows, [{ id: '01', leader_key: 'student-a' }, { id: '02', leader_key: 'student-b' }]);
    const indexes = await db.query<{ indexdef: string }>("select indexdef from pg_indexes where tablename = 'ntcust_projects'");
    assert.ok(indexes.rows.some(row => row.indexdef.includes('UNIQUE INDEX') && row.indexdef.includes('(id)')));
    assert.ok(indexes.rows.some(row => row.indexdef.includes('UNIQUE INDEX') && row.indexdef.includes('(leader_key)')));
    // ID remains text: Excel imports are not restricted to UUID identifiers.
    assert.deepEqual((await db.query<{ document: unknown }>('select document from public.ntcust_projects where id = $1', ['01'])).rows[0].document, projects[0]);
    const configs = [...initial.domain_configs].reverse();
    const swapped = [{ ...projects[1], leader_id: projects[0].leader_id }, { ...projects[0], leader_id: projects[1].leader_id }];
    const saved = await save(db, swapped, configs, 7);
    assert.equal(saved.version, 8);
    assert.deepEqual((await snapshot(db)).projects, swapped);
    assert.deepEqual((await snapshot(db)).domain_configs, configs);
    await assert.rejects(save(db, projects, [], 7), (error: any) => error.code === '40001');
    assert.deepEqual(await snapshot(db), saved);
    // A failing row must roll back both the roster and settings/version.
    await assert.rejects(save(db, [project('03'), { ...project('04'), password: 'plaintext' }], [], 8));
    assert.deepEqual(await snapshot(db), saved);
    await assert.rejects(save(db, [project('03', ' SAME '), project('04', 'same')], [], 8));
    assert.deepEqual(await snapshot(db), saved);
    await assert.rejects(save(db, [project('03'), project('03', 'other')], [], 8));
    assert.deepEqual(await snapshot(db), saved);
    await assert.rejects(save(db, [{ ...project('03'), shared_password_mode: true }, project('04')], [], 8));
    assert.deepEqual(await snapshot(db), saved);
    // Config-only saves do not rewrite unchanged project rows.
    const beforeXmin = (await db.query('select id, xmin::text as revision from public.ntcust_projects order by id')).rows;
    await save(db, swapped, configs, 8);
    assert.deepEqual((await db.query('select id, xmin::text as revision from public.ntcust_projects order by id')).rows, beforeXmin);
    await save(db, [swapped[0]], configs, 9);
    assert.equal((await snapshot(db)).projects.length, 1);
    await save(db, [], configs, 10);
    assert.deepEqual((await snapshot(db)).projects, []);
    // Only the backend may read rows or invoke the roster RPCs. Even its role
    // cannot bypass the transactional write path with an ordinary REST update.
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from public.ntcust_projects'));
      await assert.rejects(db.query('select public.ntcust_load_lottery_state()'));
      await assert.rejects(save(db, [], [], 11));
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.deepEqual((await snapshot(db)).projects, []);
    await assert.rejects(db.query('delete from public.ntcust_projects'));
    await assert.rejects(db.query('update public.ntcust_lottery_state set version = 0'));
    assert.equal((await save(db, projects, configs, 11)).version, 12);
    await db.exec('reset role');
    const largeRoster = Array.from({ length: 2000 }, (_, n) => project(`large-${n}`));
    await save(db, largeRoster, configs, 12);
    await db.exec('analyze public.ntcust_projects');
    for (const key of ['id', 'leader_key']) {
      const plan = await db.query<Record<string, string>>(`explain select document from public.ntcust_projects where ${key} = $1`, ['large-1000']);
      assert.match(plan.rows.map(row => row['QUERY PLAN']).join('\n'), /Index Scan/);
    }
    const competingWrites = await Promise.allSettled([
      save(db, largeRoster.slice(0, 1), configs, 13),
      save(db, largeRoster.slice(1, 2), configs, 13),
    ]);
    assert.equal(competingWrites.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = competingWrites.find(result => result.status === 'rejected') as PromiseRejectedResult;
    assert.equal(rejected.reason.code, '40001');
    assert.equal((await snapshot(db)).version, 14);

  } finally { await db.close(); }
});

test('failed migration preserves the old roster and does not leave half-created tables', async () => {
  const db = await database();
  try {
    const projects = [project('01', 'same'), project('02', ' SAME ')];
    await db.query('update public.ntcust_lottery_state set projects = $1::jsonb', [JSON.stringify(projects)]);
    await assert.rejects(migrate(db));
    await db.exec('rollback');
    assert.deepEqual((await db.query<{ projects: any }>('select projects from public.ntcust_lottery_state')).rows[0].projects, projects);
    assert.equal((await db.query<{ table: string | null }>("select to_regclass('public.ntcust_projects')::text as table")).rows[0].table, null);
  } finally { await db.close(); }
});

test('student lookup joins only the token owner, excludes expired/revoked sessions and restricts RPC access', async () => {
  const db = await database();
  try {
    const projects = [project('01'), project('02')];
    await db.query('update public.ntcust_lottery_state set projects = $1::jsonb', [JSON.stringify(projects)]);
    await migrate(db);
    await db.exec(await readFile(new URL('202610020002_student_lookup.sql', directory), 'utf8'));
    const token = 'a'.repeat(64); const expired = 'b'.repeat(64);
    await db.query("insert into public.ntcust_student_sessions values ($1, '02', 'credential-version', now() + interval '1 hour'), ($2, '01', 'expired-version', now() - interval '1 second')", [token, expired]);
    const lookup = async (key: string) => (await db.query<{ result: any }>('select public.ntcust_student_lookup($1) as result', [key])).rows[0].result;
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(lookup(token), (error: any) => error.code === '42501');
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.deepEqual(await lookup(token), { project: projects[1], credential_version: 'credential-version' });
    assert.equal(await lookup(expired), null);
    assert.equal(await lookup('c'.repeat(64)), null);
    await db.exec('reset role');
    await db.query('delete from public.ntcust_student_sessions where token_hash = $1', [token]);
    await db.exec('set role service_role');
    assert.equal(await lookup(token), null);
    await db.exec('reset role');
  } finally { await db.close(); }
});


test('student login finalization rechecks credentials, replaces sessions atomically and denies public execution', async () => {
  const db = await database();
  try {
    const p = { ...project('01', ' Student-A '), shared_password_mode: true };
    await db.query('update public.ntcust_lottery_state set projects = $1::jsonb', [JSON.stringify([p])]);
    await migrate(db);
    await db.exec(await readFile(new URL('202610030001_student_login_finalize.sql', directory), 'utf8'));
    const old = 'a'.repeat(64); const fresh = 'b'.repeat(64); const other = 'c'.repeat(64);
    await db.query("insert into public.ntcust_student_sessions values ($1, '01', $2, now() + interval '1 hour')", [old, fingerprint(p.password_hash)]);
    const finalize = async (overrides: any = {}) => {
      const params = { id: p.id, leader: 'student-a', hash: p.password_hash, shared: true,
        token: fresh, version: fingerprint(p.password_hash), old, ...overrides };
      return (await db.query<{ result: any }>('select public.ntcust_student_login_finalize($1,$2,$3,$4,$5,$6,$7) as result',
        [params.id, params.leader, params.hash, params.shared, params.token, params.version, params.old])).rows[0].result;
    };
    const sessions = async () => (await db.query<{ token_hash: string; credential_version: string; expires_at: string }>('select * from public.ntcust_student_sessions order by token_hash')).rows;
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(finalize(), (e: any) => e.code === '42501');
      await db.exec('reset role');
    }
    const before = await sessions();
    for (const changes of [{ id: 'missing' }, { leader: 'changed' }, { shared: false },
      { hash: p.password_hash.replace(/b/g, 'c'), version: fingerprint(p.password_hash.replace(/b/g, 'c')) }]) {
      await assert.rejects(finalize(changes), (e: any) => e.code === 'PT401');
      assert.deepEqual(await sessions(), before);
    }
    for (const changes of [{ token: 'invalid' }, { version: 'd'.repeat(64) }, { old: fresh }]) {
      await assert.rejects(finalize(changes), (e: any) => e.code === '22023');
      assert.deepEqual(await sessions(), before);
    }
    // Simulate a credential edit after backend verification.
    await db.query("update public.ntcust_projects set document = document - 'password_hash' - 'shared_password_mode' where id = '01'");
    await assert.rejects(finalize(), (e: any) => e.code === 'PT401');
    assert.deepEqual(await sessions(), before);
    await db.query("update public.ntcust_projects set document = $1::jsonb where id = '01'", [JSON.stringify(p)]);
    await db.exec('set role service_role');
    assert.deepEqual(await finalize(), p);
    await db.exec('reset role');
    const replaced = await sessions();
    assert.equal(replaced.length, 1); assert.equal(replaced[0].token_hash, fresh);
    assert.equal(replaced[0].credential_version, fingerprint(p.password_hash));
    const expiry = Date.parse(String(replaced[0].expires_at));
    assert.ok(Math.abs(expiry - Date.now() - 3600000) < 5000);
    await assert.rejects(finalize({ old: null }), (e: any) => e.code === '23505');
    assert.deepEqual(await sessions(), replaced);
    assert.deepEqual(await finalize({ token: other, old: null }), p);
    // Duplicate insertion must preserve another valid session selected for removal.
    const concurrent = await sessions();
    await assert.rejects(finalize({ old: other }), (e: any) => e.code === '23505');
    assert.deepEqual(await sessions(), concurrent);
  } finally { await db.close(); }
});


test('staff audit is append-only, backend-only and committed atomically with actions', async () => {
  const db = await database();
  try {
    await migrate(db);
    await db.exec(await readFile(new URL('202610040001_staff_audit.sql', directory), 'utf8'));
    const userId = '11111111-1111-4111-8111-111111111111';
    const actor = { userId, email: 'admin@test.local', role: 'admin' };
    const token = 'a'.repeat(64);
    await db.query('insert into auth.users(id) values ($1)', [userId]);
    const session = { token_hash: token, user_id: userId, access_token: 'private-access-token', expires_at: new Date(Date.now() + 3600000).toISOString() };
    const rows = async () => (await db.query<{ action: string; actor_email: string; details: any }>('select action,actor_email,details from public.ntcust_staff_audit order by id')).rows;
    const auditedSave = async (action: string, version: number, details: any = { summary: action, fields: ['企業智慧化'], project_count: 1 }) =>
      db.query('select public.ntcust_save_lottery_state_audited($1::jsonb,$2::jsonb,$3,$4::jsonb,$5,$6::jsonb)', [JSON.stringify([project('01')]), '[]', version, JSON.stringify(actor), action, JSON.stringify(details)]);
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(rows(), (e: any) => e.code === '42501');
      await assert.rejects(db.query('select public.ntcust_start_staff_session($1::jsonb,$2::jsonb,null)', [JSON.stringify(session), JSON.stringify(actor)]), (e: any) => e.code === '42501');
      await assert.rejects(auditedSave('draw',0), (e: any) => e.code === '42501');
      await assert.rejects(db.query('select public.ntcust_end_staff_session($1,$2::jsonb)', [token,JSON.stringify(actor)]), (e: any) => e.code === '42501');
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    await db.query('select public.ntcust_start_staff_session($1::jsonb,$2::jsonb,null)', [JSON.stringify(session), JSON.stringify(actor)]);
    for (const [version, action] of ['draw','reset','shared_password_generate','shared_password_clear'].entries()) await auditedSave(action, version);
    assert.equal((await rows()).length,5);
    const before = await snapshot(db);
    await assert.rejects(auditedSave('draw',3), (e: any) => e.code === '40001');
    await assert.rejects(auditedSave('draw',4,{ password: 'do-not-log' }), (e: any) => e.code === '22023');
    for (const details of [{ fields: 'bad' }, {fields: [1]}, {summary: {}}, {project_count: -1}, {project_count: 2001}, {version: 0}]) {
      await assert.rejects(auditedSave('draw',4,details));
    }
    assert.deepEqual(await snapshot(db),before);
    assert.equal((await rows()).length,5);
    await assert.rejects(db.query("update public.ntcust_staff_audit set actor_email='forged'"), (e: any) => e.code === '42501');
    await assert.rejects(db.query('delete from public.ntcust_staff_audit'), (e: any) => e.code === '42501');
    await db.query('select public.ntcust_end_staff_session($1,$2::jsonb)', [token,JSON.stringify({ ...actor, userId: 'wrong-user' })]);
    assert.equal((await rows()).length,5);
    await assert.rejects(db.query('select public.ntcust_end_staff_session($1,$2::jsonb)', [token,JSON.stringify({ ...actor, email: '' })]));
    await db.query('select public.ntcust_end_staff_session($1,$2::jsonb)', [token,JSON.stringify(actor)]);
    await db.query('select public.ntcust_end_staff_session($1,$2::jsonb)', [token,JSON.stringify(actor)]);
    const events=await rows();
    assert.deepEqual(events.map(row=>row.action),['login','draw','reset','shared_password_generate','shared_password_clear','logout']);
    assert.ok(events.every(row=>row.actor_email===actor.email));
    assert.equal(JSON.stringify(events).includes('private-access-token'),false);
    assert.equal(JSON.stringify(events).includes(project('01').password_hash),false);
    assert.equal(JSON.stringify(events).includes(token),false);
    assert.equal((await db.query('select * from public.ntcust_staff_sessions')).rows.length,0);
    // Invalid logging also rolls back a new login, preserving the old session.
    await assert.rejects(db.query('select public.ntcust_start_staff_session($1::jsonb,$2::jsonb,null)', [JSON.stringify(session),JSON.stringify({ ...actor, email: '' })]));
    assert.equal((await db.query('select * from public.ntcust_staff_sessions')).rows.length,0);
    assert.equal((await rows()).length,6);
    await db.exec('reset role');
  } finally { await db.close(); }
});

test('staff audit retention preserves the calendar cutoff and restricts bounded deletion to the backend', async () => {
  const db = await database();
  try {
    await migrate(db);
    await db.exec(await readFile(new URL('202610040001_staff_audit.sql', directory), 'utf8'));
    await db.exec(await readFile(new URL('202610040002_staff_audit_retention.sql', directory), 'utf8'));
    // PostgreSQL calendar subtraction clamps month-end and respects leap years.
    const dates = await db.query<{ cutoff: string }>(`select to_char((value::timestamptz at time zone 'Asia/Taipei') - interval '3 months', 'YYYY-MM-DD HH24:MI:SS') as cutoff
      from (values ('2026-05-31T16:00:00Z'),('2024-05-31T04:00:00Z'),('2026-05-31T04:00:00Z')) t(value)`);
    assert.deepEqual(dates.rows.map(row => row.cutoff.slice(0,10)), ['2026-03-01','2024-02-29','2026-02-28']);
    // current_timestamp is stable throughout the transaction for exact-boundary checks.
    await db.exec('begin');
    await db.exec(`insert into public.ntcust_staff_audit (occurred_at,actor_id,actor_email,actor_role,action)
      select (((current_timestamp at time zone 'Asia/Taipei') - interval '3 months') at time zone 'Asia/Taipei') + offset_value,
      'actor','admin@test','admin','login'
      from (values (interval '-1 microsecond'),(interval '0'),(interval '1 microsecond')) t(offset_value)`);
    for (const role of ['anon','authenticated']) {
      await db.exec(`savepoint permission_check; set local role ${role}`);
      await assert.rejects(db.query('select public.ntcust_cleanup_staff_audit()'), (e: any) => e.code === '42501');
      await db.exec('rollback to savepoint permission_check; reset role');
    }
    await db.exec('set local role service_role');
    const purge = async () => (await db.query<{ deleted: number }>('select public.ntcust_cleanup_staff_audit() as deleted')).rows[0].deleted;
    assert.equal(await purge(), 1);
    assert.equal((await db.query('select * from public.ntcust_staff_audit')).rows.length, 2);
    assert.equal(await purge(), 0);
    await db.exec('savepoint direct_delete');
    await assert.rejects(db.query('delete from public.ntcust_staff_audit'), (e: any) => e.code === '42501');
    await db.exec('rollback to savepoint direct_delete; reset role');
    await db.exec(`insert into public.ntcust_staff_audit (occurred_at,actor_id,actor_email,actor_role,action)
      select current_timestamp - interval '4 months','actor','stage@test','stage','draw' from generate_series(1,505)`);
    await db.exec('set local role service_role');
    assert.equal(await purge(), 500);
    assert.equal(await purge(), 5);
    assert.equal(await purge(), 0);
    assert.equal((await db.query('select * from public.ntcust_staff_audit')).rows.length, 2);
    await db.exec('reset role; commit');
  } finally { await db.close(); }
});
