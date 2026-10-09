import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, prepareProjects, removeLegacyCredentials, studentProjectDto, publicStudentProjectDto } from '../server/credentials';
import { executeAllDomainsIndependentLottery } from '../src/lib/lottery';

const p = { id: 'p1', seq_no: '1', education_system: '四技', department: '資管', class_name: '甲', advisor: '王教授', field: '__proto__', original_code: 'P1', project_title: '測試', leader_id: '12345678' };
test('student passwords are salted, verified exactly, and never retained in plaintext', async () => {
  const a = await hashPassword('Secure-password-123');
  const b = await hashPassword('Secure-password-123');
  assert.notEqual(a, b); assert.ok(await verifyPassword('Secure-password-123', a));
  assert.equal(await verifyPassword('wrong', a), false);
  assert.equal(await verifyPassword('Secure-password-123 ', a), false);
  assert.equal(await verifyPassword('5678'), false);
  const [stored] = await prepareProjects([{ ...p, password: 'Secure-password-123' }], []);
  assert.equal(stored.password, undefined); assert.ok(stored.password_hash);
  const [preserved] = await prepareProjects([{ ...p, project_title: '修改標題', password: '' }], [stored]);
  assert.equal(preserved.password_hash, stored.password_hash);
  const [changedLeader] = await prepareProjects([{ ...p, leader_id: '87654321' }], [stored]);
  assert.equal(changedLeader.password_hash, undefined);
  await assert.rejects(prepareProjects([{ ...p, password: '5678' }], []), /8 至 128/);
  const [legacy] = removeLegacyCredentials([{ ...p, password: 'old-password' }]);
  assert.equal(legacy.password, undefined); assert.equal(legacy.password_hash, undefined);
});
test('special domain names stay isolated and use their own subgroup/reviewer settings', () => {
  const fields = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
  const configs = fields.map((field, i) => ({ id: `d-${i}`, field, groupCount: i + 1,
    evaluatorsPerGroup: Object.fromEntries(Array.from({ length: i + 1 }, (_, g) => [g + 1, [`${field}-評審-${g + 1}`]])),
  }));
  const projects = fields.flatMap((field, i) => Array.from({ length: 5 }, (_, j) => ({
    ...p, id: `p-${i}-${j}`, seq_no: String(i * 5 + j + 1), field,
  })));
  const before = JSON.stringify(projects);
  const result = executeAllDomainsIndependentLottery(projects, configs);
  assert.equal(result.updatedProjects.length, projects.length);
  assert.equal(new Set(result.updatedProjects.map(p => p.id)).size, projects.length);
  assert.equal(JSON.stringify(projects), before);
  const positions = new Set<string>();
  for (const item of result.updatedProjects) {
    const cfg = configs.find(c => c.field === item.field)!;
    assert.ok(item.assigned_group! >= 1 && item.assigned_group! <= cfg.groupCount);
    assert.deepEqual(item.evaluators, cfg.evaluatorsPerGroup[item.assigned_group!]);
    const position = `${item.field}/${item.assigned_group}/${item.draw_code}`;
    assert.equal(positions.has(position), false); positions.add(position);
  }
  for (const summary of result.domainSummaries) {
    assert.equal(summary.count, 5); assert.equal(summary.groupCount, configs.find(c => c.field === summary.field)!.groupCount);
  }
});

test('student DTOs omit roster identifiers and secrets in both credential modes', () => {
  const stored = { ...p, password: 'private', password_hash: 'private-hash',
    assigned_group: 2, draw_code: 'A03', draw_time: '2026-10-04T00:00:00Z',
    evaluators: ['評審'], unexpected_private_field: 'private-extra' };
  const individual = studentProjectDto(stored);
  const shared = publicStudentProjectDto(stored);
  assert.deepEqual(Object.keys(individual).sort(), ['leader_id_masked', 'project_title', 'field', 'isDrawn', 'draw_code', 'assigned_group', 'draw_time', 'evaluators'].sort());
  assert.deepEqual(Object.keys(shared).sort(), ['leader_id_masked', 'project_title', 'field', 'isDrawn', 'draw_code', 'assigned_group'].sort());
  for (const result of [individual, shared]) {
    assert.equal(result.isDrawn, true);
    assert.equal(result.draw_code, 'A03');
    assert.equal(result.assigned_group, 2);
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
  assert.deepEqual(publicStudentProjectDto({ ...stored, draw_code: null }), {
    leader_id_masked: '****5678', project_title: p.project_title, field: '', isDrawn: false, draw_code: null, assigned_group: null,
  });
  assert.equal(studentProjectDto({ ...stored, draw_code: null }).isDrawn, false);
  assert.equal(studentProjectDto({ ...stored, draw_code: null }).assigned_group, null);
});

test('student ID masking exposes only the final four characters and conceals short IDs', () => {
  for (const [id, expected] of [['1123456789', '******6789'], [' 12345678 ', '****5678'], ['12345', '*2345'], ['1234', '****'], ['123', '****'], ['', '****']]) {
    for (const dto of [studentProjectDto, publicStudentProjectDto]) {
      const result = dto({ ...p, leader_id: id });
      assert.equal(result.leader_id_masked, expected);
      assert.equal('leader_id' in result, false);
    }
  }
});

test('individual student passwords accept eight characters and reject shorter or invalid values', async () => {
  const [stored] = await prepareProjects([{ ...p, password: 'Pass123!' }], []);
  assert.ok(await verifyPassword('Pass123!', stored.password_hash));
  for (const password of ['Pass12!', '       x', 'x'.repeat(129), p.leader_id]) {
    await assert.rejects(prepareProjects([{ ...p, password }], []), /8 至 128/);
  }
});
