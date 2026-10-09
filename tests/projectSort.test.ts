import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectItem } from '../src/types';
import { sortProjects, type ProjectSortKey } from '../src/lib/projectSort';

const base: ProjectItem = {
  id: 'a', seq_no: '10', education_system: '', department: '', class_name: '', advisor: '王老師',
  field: '智慧運算', original_code: 'P-10', project_title: '專題10', leader_id: '10',
  assigned_group: null, draw_code: null, evaluators: [], password_set: true,
};
const projects: ProjectItem[] = [
  base,
  { ...base, id: 'b', seq_no: '2', advisor: '李老師', field: '企業智慧', original_code: 'P-2', project_title: '專題2', leader_id: '2', assigned_group: 2, draw_code: '第2組-序號2', evaluators: ['李老師'], password_set: false },
  { ...base, id: 'c', seq_no: '1', advisor: '陳老師', field: '進修部', original_code: 'P-11', project_title: '專題11', leader_id: '11', assigned_group: 1, draw_code: '第1組-序號11', evaluators: ['陳老師'], password_set: true },
];
const ids = (items: ProjectItem[]) => items.map(item => item.id);

test('roster sorting handles numeric text, undrawn values, status and both directions without changing the source', () => {
  assert.deepEqual(ids(sortProjects(projects, 'seq_no', 'ascending')), ['c', 'b', 'a']);
  assert.deepEqual(ids(sortProjects(projects, 'seq_no', 'descending')), ['a', 'b', 'c']);
  assert.deepEqual(ids(sortProjects(projects, 'draw_code', 'ascending')), ['c', 'b', 'a']);
  assert.deepEqual(ids(sortProjects(projects, 'draw_code', 'descending')), ['b', 'c', 'a']);
  assert.deepEqual(ids(sortProjects(projects, 'assigned_group', 'ascending')), ['c', 'b', 'a']);
  assert.deepEqual(ids(sortProjects(projects, 'assigned_group', 'descending')), ['b', 'c', 'a']);
  assert.equal(sortProjects(projects, 'evaluators', 'ascending').at(-1)?.id, 'a');
  assert.equal(sortProjects(projects, 'evaluators', 'descending').at(-1)?.id, 'a');
  assert.deepEqual(ids(sortProjects(projects, 'password_set', 'ascending')), ['b', 'a', 'c']);
  const remainingKeys: ProjectSortKey[] = ['field', 'original_code', 'project_title', 'leader_id', 'advisor'];
  for (const key of remainingKeys) {
    const ascending = sortProjects(projects, key, 'ascending');
    const descending = sortProjects(projects, key, 'descending');
    assert.deepEqual(ids(descending), ids(ascending).reverse(), key);
  }
  assert.deepEqual(ids(projects), ['a', 'b', 'c']);
});
