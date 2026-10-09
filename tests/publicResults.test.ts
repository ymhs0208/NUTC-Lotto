import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicResults } from '../server/publicResults';
import { projectDto } from '../server/credentials';

const base = { id: 'p1', seq_no: '1', education_system: '四技', department: '資管', class_name: '甲', advisor: '王教授', field: '智慧', original_code: 'A01', project_title: '專題', leader_id: '12345678', leader_name: ' 林同學 ', password: 'secret', assigned_group: 1, draw_code: 'A01' };
const configs = [{ id: 'a', field: '智慧', groupCount: 2 }, { id: 'b', field: '系統', groupCount: 1 }];

test('public results expose only four requested fields, scoped to drawn projects in the selected domain', () => {
  const projects = [
    { ...base, id: 'p3', assigned_group: 2, draw_code: 'A10' },
    { ...base, id: 'p2', draw_code: 'A02' }, base,
    { ...base, id: 'other', field: '系統', draw_code: 'B01' },
    { ...base, id: 'pending', draw_code: null },
    { ...base, id: 'no-code', draw_code: null },
  ];
  const before = structuredClone(projects);
  const data = publicResults(projects, configs, '智慧');
  assert.deepEqual(data.domains, ['智慧', '系統']);
  assert.deepEqual(data.results.map(result => result.draw_code), ['A01', 'A02', 'A10']);
  assert.deepEqual(data.results[0], { draw_code: 'A01', assigned_group: 1, project_title: '專題', leader_name: '林同學' });
  assert.deepEqual(projects, before);
  assert.deepEqual(publicResults(projects, configs).results, []);
  assert.deepEqual(publicResults(projects, configs, '未知').results, []);
});

test('leader names survive roster serialization and old rosters remain usable', () => {
  assert.equal(projectDto(base).leader_name, '林同學');
  const legacy = { ...base, leader_name: undefined };
  assert.equal(projectDto(legacy).leader_name, '');
  assert.deepEqual(publicResults([legacy], configs, '智慧').results[0], {
    draw_code: 'A01', assigned_group: 1, project_title: '專題', leader_name: '',
  });
  assert.deepEqual(publicResults([{ ...legacy, assigned_group: null }], configs, '智慧').results, []);
});
