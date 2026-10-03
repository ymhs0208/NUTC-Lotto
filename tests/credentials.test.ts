import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, prepareProjects, removeLegacyCredentials } from '../server/credentials';
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
  await assert.rejects(prepareProjects([{ ...p, password: 'Abc1234' }], []), /8 至 128/);
  await assert.rejects(prepareProjects([{ ...p, password: p.leader_id }], []), /不可使用學號/);
  const [eightCharacter] = await prepareProjects([{ ...p, password: 'Abc12345' }], []);
  assert.ok(await verifyPassword('Abc12345', eightCharacter.password_hash));
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
    const position = `${item.field}/${item.assigned_group}/${item.draw_order}`;
    assert.equal(positions.has(position), false); positions.add(position);
  }
  for (const summary of result.domainSummaries) {
    assert.equal(summary.count, 5); assert.equal(summary.groupCount, configs.find(c => c.field === summary.field)!.groupCount);
  }
});
