import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDomains, validateProjects } from '../server/store';
import { hashPassword } from '../server/credentials';
import { localWorker } from '../scripts/local-worker';

const project = { id: 'p1', seq_no: '1', education_system: '四技', department: '資管', class_name: '四甲', advisor: '王教授', field: '測試領域', original_code: 'T01', project_title: '測試專題', leader_id: '12345678', evaluators: [] };
const domains = [{ id: 'd1', field: '測試領域', groupCount: 2, evaluatorsPerGroup: { 1: ['李教授'], 2: ['陳教授'] } }];

test('roster and evaluator validation rejects malformed data', () => {
  validateProjects([project]); validateDomains(domains);
  for (const bad of [[project, project], [{ ...project, password_hash: 'injected' }], [{ ...project, shared_password_mode: true }], [{ ...project, draw_order: -1 }], [{ ...project, password: {} }], [{ ...project, leader_name: {} }], [{ ...project, leader_name: 'a'.repeat(129) }]]) assert.throws(() => validateProjects(bad));
  for (const group of ['0', '-1', '3', '50', '01', '1.5', '1e0', ' 1', '', '999999999999999999999999']) assert.throws(() => validateDomains([{ ...domains[0], evaluatorsPerGroup: { [group]: ['李教授'] } }]));
  for (const evaluatorsPerGroup of ['invalid', [], { 1: 'invalid' }, { 1: [123] }]) assert.throws(() => validateDomains([{ ...domains[0], evaluatorsPerGroup }]));
});

test('roster imports enforce the merged domain limit atomically and remain editable at 100 domains', { timeout: 180000 }, async () => {
  const worker = await localWorker();
  try {
    await worker.start();
    await worker.setup({ action: 'accounts', accounts: [{
      id: 'limit-admin', email: 'limit@example.edu.tw', role: 'admin', password_hash: await hashPassword('Abc12345'),
    }] });
    const login = await worker.request('/api/auth/verify', { username: 'limit@example.edu.tw', password: 'Abc12345', targetView: 'admin' });
    assert.equal(login.status, 200);
    const req = (path: string, body?: unknown) => worker.request(path, body, login.cookie);
    const configs = Array.from({ length: 99 }, (_, i) => ({ id: `d${i}`, field: `領域${i}`, groupCount: 2 }));
    assert.equal((await req('/api/domain-configs', { version: 0, domainConfigs: configs })).status, 200);
    const stored = { ...project, field: '領域0', password: 'Xyz12345' };
    assert.equal((await req('/api/projects', { version: 1, projects: [stored] })).status, 200);
    const before = (await req('/api/state')).data;
    const imported = (i: number, field: string) => ({ ...project, id: `new${i}`, leader_id: `student${i}`, field });
    const overflow = await req('/api/projects', {
      version: before.version, projects: [imported(1, '領域99'), imported(2, '領域100')],
    });
    assert.equal(overflow.status, 400);
    assert.match(overflow.data.error, /領域設定最多 100 筆/);
    assert.deepEqual((await req('/api/state')).data, before);
    assert.equal((await worker.request('/api/student/verify', { leaderId: stored.leader_id, password: stored.password })).status, 200);
    const atLimit = await req('/api/projects', {
      version: before.version, projects: [before.projects[0], imported(1, '領域99'), imported(2, '領域99')],
    });
    assert.equal(atLimit.status, 200);
    assert.equal(atLimit.data.domainConfigs.length, 100);
    assert.equal(atLimit.data.domainConfigs.filter((c: any) => c.field === '領域99').length, 1);
    assert.deepEqual(atLimit.data.domainConfigs.slice(0, 99), configs);
    const edited = await req('/api/domain-configs', {
      version: atLimit.data.version, domainConfigs: atLimit.data.domainConfigs.map((c: any) => c.id === 'd0' ? { ...c, drawPrefix: 'Z' } : c),
    });
    assert.equal(edited.status, 200);
    const beyondLimit = await req('/api/projects', {
      version: edited.data.version, projects: [...edited.data.projects, imported(3, '領域100')],
    });
    assert.equal(beyondLimit.status, 400);
    assert.deepEqual((await req('/api/state')).data, edited.data);
  } finally { await worker.dispose(); }
});

test('Workers persists data, authenticates staff/students and atomically enforces versions', { timeout: 180000 }, async () => {
  const worker = await localWorker();
  try {
    await worker.start();
    const req = worker.request;
    assert.equal((await req('/api/state')).status, 401);
    assert.equal((await req('/api/cloudflare/setup', { action: 'accounts' })).status, 401);
    const passwordHash = await hashPassword('Abc12345');
    const accounts = [{ id: 'admin-id', email: 'admin@example.edu.tw', role: 'admin', password_hash: passwordHash }, { id: 'stage-id', email: 'stage@example.edu.tw', role: 'stage', password_hash: passwordHash }];
    assert.equal((await worker.setup({ action: 'accounts', accounts })).status, 200);
    const login = (username: string, targetView = 'admin', password = 'Abc12345') => req('/api/auth/verify', { username, password, targetView, remember: true });
    assert.equal((await login('admin@example.edu.tw', 'admin', 'wrong')).status, 401);
    assert.equal((await login('stage@example.edu.tw')).status, 403);
    const admin = await login(' ADMIN@example.edu.tw '); assert.equal(admin.status, 200);
    assert.match(admin.headers['set-cookie']!.at(-1)!, /HttpOnly/); assert.match(admin.headers['set-cookie']!.at(-1)!, /Secure/);
    assert.equal(admin.data.session.access_token, undefined);
    const stage = await login('stage@example.edu.tw', 'stage'); assert.equal(stage.status, 200);
    const adminCookie = admin.cookie; const stageCookie = stage.cookie;
    assert.equal((await req('/api/staff-logs')).status, 401);
    assert.equal((await req('/api/staff-logs', undefined, stageCookie)).status, 403);
    const loginLogs = (await req('/api/staff-logs?action=login', undefined, adminCookie)).data;
    assert.equal(loginLogs.logs.length, 2);
    assert.equal((await req('/api/staff-logs?before=invalid', undefined, adminCookie)).status, 400);
    const empty = (await req('/api/state', undefined, adminCookie)).data;
    assert.equal(empty.version, 0); assert.deepEqual(empty.projects, []); assert.equal(empty.domainConfigs.length, 7);
    const configured = await req('/api/domain-configs', { version: 0, domainConfigs: domains }, adminCookie); assert.equal(configured.status, 200);
    const roster = [{ ...project, password: 'Xyz12345' }, { ...project, id: 'p2', leader_id: '87654321', original_code: 'T02', project_title: '第二組專題', password: 'Xyz12345' }];
    assert.equal((await req('/api/projects', { version: 1, projects: roster }, adminCookie)).status, 200);
    const initial = (await req('/api/state', undefined, adminCookie)).data;
    assert.equal(initial.version, 2); assert.equal(initial.projects[0].password_hash, undefined); assert.equal(initial.projects[0].password_set, true);
    const stageState = (await req('/api/state', undefined, stageCookie)).data;
    assert.deepEqual(Object.keys(stageState.projects[0]).sort(), ['assigned_group', 'draw_code', 'draw_order', 'field', 'id', 'project_title']);
    assert.equal(stageState.domainConfigs[0].evaluatorsPerGroup, undefined);
    assert.equal((await req('/api/projects', { version: 2, projects: initial.projects }, stageCookie)).status, 403);
    assert.equal((await req('/api/domain-configs', { version: 2, domainConfigs: domains }, adminCookie, { Origin: 'https://evil.invalid' })).status, 403);
    const competing = await Promise.all([req('/api/domain-configs', { version: 2, domainConfigs: domains }, adminCookie), req('/api/domain-configs', { version: 2, domainConfigs: domains }, adminCookie)]);
    assert.deepEqual(competing.map(r => r.status).sort(), [200, 409]);
    const student = await req('/api/student/verify', { leaderId: project.leader_id, password: 'Xyz12345' });
    assert.equal(student.status, 200); assert.equal(student.data.project.leader_id, project.leader_id); assert.equal(student.data.project.advisor, ''); assert.equal(student.data.project.password_hash, undefined);
    const otherStudent = await req('/api/student/verify', { leaderId: '87654321', password: 'Xyz12345' }); assert.equal(otherStudent.status, 200); assert.notEqual(student.cookie, otherStudent.cookie);
    assert.equal((await req('/api/student/me?projectId=p2', undefined, student.cookie)).data.project.leader_id, project.leader_id);
    const beforeTest = (await req('/api/state', undefined, adminCookie)).data;
    assert.equal((await req('/api/lottery/test', { version: beforeTest.version }, stageCookie)).status, 403);
    assert.equal((await req('/api/lottery/test', { version: beforeTest.version }, adminCookie)).status, 200);
    assert.equal((await req('/api/state', undefined, adminCookie)).data.version, beforeTest.version);
    const drawn = await req('/api/lottery/draw', { version: beforeTest.version }, stageCookie);
    const drawLogs = (await req('/api/staff-logs?action=draw', undefined, adminCookie)).data.logs;
    assert.equal(drawLogs.length, 1); assert.equal(drawLogs[0].role, 'stage'); assert.equal(drawLogs[0].version, drawn.data.version);
    assert.equal(drawn.status, 200);
    for (const cookie of [undefined, adminCookie, stageCookie, student.cookie]) {
      const removed = await req('/api/public-results', undefined, cookie);
      assert.equal(removed.status, 404);
      assert.equal(removed.data.success, false);
      assert.equal(removed.data.results, undefined);
    }
    assert.equal((await req('/api/student/me', undefined, student.cookie)).data.project.draw_code, drawn.data.projects.find((p: any) => p.id === project.id).draw_code);
    assert.equal((await req('/api/lottery/reset', { version: beforeTest.version }, stageCookie)).status, 409);
    const current = (await req('/api/state', undefined, adminCookie)).data;
    const relabeled = await req('/api/domain-configs', { version: current.version, domainConfigs: [{ ...domains[0], drawPrefix: 'Z' }] }, adminCookie);
    assert.equal(relabeled.status, 200);
    assert.equal(relabeled.data.domainConfigs[0].drawPrefix, 'Z');
    assert.equal((await req('/api/state', undefined, stageCookie)).data.domainConfigs[0].drawPrefix, 'Z');
    relabeled.data.projects.forEach((p: any) => {
      const before = current.projects.find((old: any) => old.id === p.id);
      assert.match(p.draw_code, /^Z\d{2}$/);
      assert.equal(p.assigned_group, before.assigned_group);
      assert.equal(p.draw_order, before.draw_order);
      assert.equal(p.draw_time, before.draw_time);
      assert.equal(p.original_code, before.original_code);
    });
    Object.assign(current, relabeled.data);
    const resetPassword = await req('/api/projects', { version: current.version, projects: current.projects.map((p: any) => p.id === 'p1' ? { ...p, password: 'Changed-student-password' } : p) }, adminCookie);
    assert.equal(resetPassword.status, 200);
    assert.equal((await req('/api/student/me', undefined, student.cookie)).status, 401);
    assert.equal((await req('/api/student/me', undefined, otherStudent.cookie)).status, 200);
    const shared = await req('/api/student/shared-password', { version: resetPassword.data.version, action: 'generate' }, adminCookie);
    assert.equal(shared.status, 200); assert.equal(shared.data.password.length, 8);
    assert.equal((await req('/api/student/me', undefined, otherStudent.cookie)).status, 401);
    const sharedLogin = await req('/api/student/verify', { leaderId: project.leader_id, password: shared.data.password }); assert.equal(sharedLogin.status, 200); assert.equal(sharedLogin.data.sharedPasswordMode, true);
    await worker.stop(); await worker.start();
    const persisted = await req('/api/state', undefined, adminCookie); assert.equal(persisted.status, 200); assert.equal(persisted.data.version, shared.data.version); assert.ok(persisted.data.projects[0].draw_code);
    assert.equal((await req('/api/student/me', undefined, sharedLogin.cookie)).status, 200);
    const clear = await req('/api/student/shared-password', { version: shared.data.version, action: 'clear' }, adminCookie); assert.equal(clear.status, 200);
    const persistedLogs = (await req('/api/staff-logs', undefined, adminCookie)).data.logs;
    for (const action of ['login', 'roster', 'domains', 'draw', 'password_generate', 'password_clear']) assert.ok(persistedLogs.some((row: any) => row.action === action));
    assert.ok(!JSON.stringify(persistedLogs).includes(shared.data.password));
    assert.equal((await req('/api/student/me', undefined, sharedLogin.cookie)).status, 401);
    assert.equal((await req('/api/auth/logout', {}, stageCookie)).status, 200); assert.equal((await req('/api/state', undefined, stageCookie)).status, 401);
    assert.equal((await worker.setup({ action: 'accounts', accounts: [{ ...accounts[0], password_hash: await hashPassword('Rotated-staff-password') }] })).status, 200);
    assert.equal((await req('/api/state', undefined, adminCookie)).status, 401);
  } finally { await worker.dispose(); }
});
