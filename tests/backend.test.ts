import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { app } from '../server/app';
import { withRuntime } from '../server/runtime';
import { openLocalDatabase } from '../server/localDatabase';
import { hashPassword } from '../server/credentials';
const workers = process.env.CLOUDFLARE_TEST === '1';
if (workers) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const password = 'Test-secure-password-123';
const roster = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, seq_no: String(i), education_system: '四技', department: '資管', class_name: '甲', advisor: '',
  field: '測試', original_code: `A0${i + 1}`, project_title: `測試專題 ${i}`, leader_id: `student-${i}`, leader_name: '林同學', password }));
const domains = [{ id: 'a', field: '測試', code: 'A', groupCount: 2, evaluatorsPerGroup: {} }];

test(`independent SQLite backend works without external services (${workers ? 'Workers' : 'Node'})`, { timeout: 180000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lottery-api-')); const hash = await hashPassword(password);
  const env = { SESSION_SECRET: 'synthetic-session-secret-for-integration-tests', ADMIN_EMAIL: 'admin@test.local', ADMIN_PASSWORD_HASH: hash, NODE_ENV: 'production' };
  let child: ChildProcess | undefined; let logs = ''; let base = ''; let port = 0;
  const local = workers ? undefined : openLocalDatabase(join(dir, 'database.sqlite'), { email: env.ADMIN_EMAIL, passwordHash: hash });
  const nodeServer = createServer((req, res) => withRuntime({ ...env, DATABASE: local?.database }, () => app(req, res)));
  async function startWorker() {
    child = spawn(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'dev', '--config', join(dir, 'wrangler.json'), '--port', String(port), '--local-protocol', 'https', '--persist-to', join(dir, 'state'),
      '--var', `SESSION_SECRET:${env.SESSION_SECRET}`, '--var', `ADMIN_EMAIL:${env.ADMIN_EMAIL}`, '--var', `ADMIN_PASSWORD_HASH:${hash}`], { cwd: process.cwd(), env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', chunk => { logs += String(chunk); }); child.stderr?.on('data', chunk => { logs += String(chunk); });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(`Worker exited: ${logs}`);
      try { const r = await fetch(base + '/api/health'); if (r.ok) return; } catch {}
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(`Worker not ready: ${logs}`);
  }
  async function stopWorker() {
    if (child && child.exitCode === null) { const closed = once(child, 'exit'); child.kill('SIGTERM'); await closed; }
  }
  try {
    await new Promise<void>(r => nodeServer.listen(0, '127.0.0.1', r));
    port = (nodeServer.address() as { port: number }).port;
    base = `${workers ? 'https' : 'http'}://127.0.0.1:${port}`;
    if (workers) {
      await new Promise<void>(r => nodeServer.close(() => r()));
      const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
      delete config.routes; config.main = resolve('worker/index.ts'); config.assets.directory = resolve('dist'); config.name = 'lottery-test';
      await writeFile(join(dir, 'wrangler.json'), JSON.stringify(config));
      await startWorker();
    }
    const call = async (path: string, body?: Record<string, unknown>, cookie = '') => {
      const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const data = await response.json();
      return { response, data, status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
    };
    assert.equal((await call('/api/state')).status, 401);
    assert.equal((await call('/api/auth/verify', { username: 'admin@test.local', password: 'incorrect', targetView: 'admin' })).status, 401);
    const admin = await call('/api/auth/verify', { username: 'admin@test.local', password, targetView: 'admin', remember: true });
    assert.equal(admin.status, 200, JSON.stringify(admin.data));
    assert.ok(admin.cookie); assert.match(admin.response.headers.get('set-cookie')!, /HttpOnly/i);
    const stagePassword = 'Stage123';
    assert.equal((await call('/api/staff-accounts', { email: 'stage@test.local', password: 'Stage12', role: 'stage', disabled: false }, admin.cookie)).status, 400);
    assert.equal((await call('/api/staff-accounts', { email: 'stage@test.local', password: stagePassword, role: 'stage', disabled: false }, admin.cookie)).status, 200);
    const stage = await call('/api/auth/verify', { username: 'stage@test.local', password: stagePassword, targetView: 'stage' });
    assert.equal(stage.status, 200); assert.equal((await call('/api/projects', undefined, stage.cookie)).status, 403);
    assert.equal((await call('/api/staff-accounts', undefined, stage.cookie)).status, 403);
    assert.equal((await call('/api/data/import', { projects: [], domainConfigs: domains }, stage.cookie)).status, 403);
    const config = await call('/api/domain-configs', { version: 0, domainConfigs: domains }, admin.cookie);
    assert.equal(config.status, 200, JSON.stringify(config.data));
    const saved = await call('/api/projects', { version: 1, projects: roster }, admin.cookie);
    assert.equal(saved.status, 200, JSON.stringify(saved.data)); assert.equal(saved.data.version, 2);
    assert.ok(!JSON.stringify(saved.data).includes('scrypt-v1')); assert.ok(!JSON.stringify(saved.data).includes(password));
    const stageState = await call('/api/state', undefined, stage.cookie);
    assert.deepEqual(Object.keys(stageState.data.projects[0]).sort(), ['assigned_group', 'draw_code', 'field', 'id', 'project_title']);
    const student = await call('/api/student/verify', { leaderId: 'student-0', password });
    assert.equal(student.status, 200, JSON.stringify(student.data)); assert.ok(student.cookie);
    assert.equal((await call('/api/student/me', undefined, student.cookie)).data.project.project_title, '測試專題 0');
    assert.equal((await call('/api/auth/me', undefined, student.cookie)).status, 401);
    const concurrent = await Promise.all([call('/api/projects', { version: 2, projects: saved.data.projects }, admin.cookie), call('/api/projects', { version: 2, projects: saved.data.projects }, admin.cookie)]);
    assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
    const draw = await call('/api/lottery/draw', { version: 3, field: '測試' }, stage.cookie);
    assert.equal(draw.status, 200, JSON.stringify(draw.data));
    const publicResult = await call('/api/public/results?field=' + encodeURIComponent('測試'));
    assert.equal(publicResult.data.results.length, 4);
    assert.deepEqual(Object.keys(publicResult.data.results[0]).sort(), ['assigned_group', 'draw_code', 'leader_name', 'project_title']);
    assert.equal((await call('/api/lottery/draw', { version: 4, field: '測試' }, stage.cookie)).status, 409);
    const audits = await call('/api/staff-audit', undefined, admin.cookie);
    assert.ok(audits.data.records.some((r: any) => r.action === 'draw'));
    assert.ok(!JSON.stringify(audits.data).includes(hash));
    const shared = await call('/api/student/shared-password', { version: 4, action: 'generate' }, admin.cookie);
    assert.equal(shared.status, 200);
    assert.equal((await call('/api/student/me', undefined, student.cookie)).status, 401);
    const newStudent = await call('/api/student/verify', { leaderId: 'student-1', password: shared.data.password });
    assert.equal(newStudent.status, 200);
    assert.deepEqual(Object.keys(newStudent.data.project).sort(), ['assigned_group', 'draw_code', 'field', 'isDrawn', 'leader_id_masked', 'project_title']);
    assert.equal((await call('/api/student/logout', {}, newStudent.cookie)).status, 200);
    assert.equal((await call('/api/student/me', undefined, newStudent.cookie)).status, 401);
    const backup = await call('/api/data/export', undefined, admin.cookie);
    assert.equal(backup.status, 200); assert.equal(backup.data.format, 'lottery-sqlite-v1'); assert.equal(backup.data.projects.length, 4);
    assert.equal((await call('/api/data/export', undefined, stage.cookie)).status, 403);
    assert.equal((await call('/api/data/import', { projects: roster, domainConfigs: domains }, admin.cookie)).status, 409);
    const reset = await call('/api/lottery/reset', { version: 5, field: '測試' }, stage.cookie);
    assert.equal(reset.status, 200, JSON.stringify(reset.data));
    assert.equal((await call('/api/public/results?field=' + encodeURIComponent('測試'))).data.results.length, 0);
    if (workers) {
      await stopWorker(); await startWorker();
      assert.equal((await call('/api/state', undefined, admin.cookie)).data.version, 6);
      assert.equal((await call('/api/state', undefined, admin.cookie)).data.projects.length, 4);
      assert.equal((await fetch(base + '/admin')).status, 200);
      assert.equal((await fetch(base + '/command', { method: 'POST', body: JSON.stringify({ command: 'load', args: {} }) })).status, 405);
    }
    assert.equal((await call('/api/staff-accounts', { email: 'stage@test.local', role: 'stage', disabled: true }, admin.cookie)).status, 200);
    assert.equal((await call('/api/state', undefined, stage.cookie)).status, 401);
    assert.equal((await call('/api/staff-accounts', { email: 'admin@test.local', role: 'stage', disabled: false }, admin.cookie)).status, 409);
    const tampered = admin.cookie.slice(0, -1) + (admin.cookie.endsWith('a') ? 'b' : 'a');
    assert.equal((await call('/api/state', undefined, tampered)).status, 401);
    assert.equal((await call('/api/auth/logout', {}, admin.cookie)).status, 200);
    assert.equal((await call('/api/state', undefined, admin.cookie)).status, 401);
  } finally {
    await stopWorker();
    if (nodeServer.listening) await new Promise<void>(r => nodeServer.close(() => r()));
    local?.close(); await rm(dir, { recursive: true, force: true });
  }
});

test('JSON migration preserves results, drops legacy credentials and refuses overwrites', { skip: workers }, async () => {
  const hash = await hashPassword(password);
  const local = openLocalDatabase(':memory:', { email: 'migration@test.local', passwordHash: hash });
  const server = createServer((req, res) => withRuntime({ SESSION_SECRET: 'synthetic-import-secret', DATABASE: local.database }, () => app(req, res)));
  try {
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const login = await fetch(base + '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'migration@test.local', password, targetView: 'admin' }) });
    assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const importData = (projects: unknown[]) => fetch(base + '/api/data/import', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ projects, domainConfigs: domains }) });
    assert.equal((await importData([null])).status, 400);
    assert.equal((await importData([{ ...roster[0], assigned_group: 3 }])).status, 400);
    assert.equal((await local.database.call('load', {})).version, 0);
    const project = { ...roster[0], password_hash: hash, shared_password_mode: true, assigned_group: 1, draw_code: 'A01', draw_time: new Date().toISOString(), evaluators: ['李教授'] };
    const imported = await importData([project]); assert.equal(imported.status, 200);
    const state = await local.database.call('load', {});
    assert.equal(state.projects[0].draw_code, 'A01'); assert.deepEqual(state.projects[0].evaluators, ['李教授']);
    assert.equal(state.projects[0].password, undefined); assert.equal(state.projects[0].password_hash, undefined); assert.equal(state.projects[0].shared_password_mode, undefined);
    assert.equal((await importData([project])).status, 409);
    const audit = await fetch(base + '/api/staff-audit', { headers: { Cookie: cookie } });
    assert.ok((await audit.json()).records.some((row: any) => row.action === 'data_import'));
  } finally { await new Promise<void>(r => server.close(() => r())); local.close(); }
});
