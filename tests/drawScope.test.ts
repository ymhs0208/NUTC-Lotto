import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectItem } from '../src/types';
import { getAvailableDrawFields, getSelectedDrawFields, getResettableFields, getIncompleteDrawFields, isCompleteDrawResult, duplicateDrawCodeError, projectFieldChangeError } from '../src/lib/drawScope';
import { executeAllDomainsIndependentLottery } from '../src/lib/lottery';

const project = (id: string, field: string): ProjectItem => ({
  id, field, leader_id: id, project_title: id, seq_no: id,
  education_system: '', department: '', class_name: '', advisor: '', original_code: id,
});

test('draw code uniqueness covers partial results and equivalent spellings without changing the roster', () => {
  for (const code of ['A01', ' a01 ', 'A1']) {
    const roster = [{ ...project('1', 'A'), draw_code: 'A01', assigned_group: 1 },
      { ...project('2', 'B'), draw_code: code, assigned_group: null }];
    const before = structuredClone(roster);
    assert.match(duplicateDrawCodeError(roster)!, /抽籤編號.*重複/);
    assert.deepEqual(roster, before);
  }
  assert.equal(duplicateDrawCodeError([{ draw_code: null }, {}, { draw_code: ' ' },
    { draw_code: 'A01' }, { draw_code: 'A02' }, { draw_code: 'A100' }, { draw_code: 'B01' }]), null);
});

test('a project can change fields only after all draw data is reset, including partial results', () => {
  const original = project('1', '企業智慧化');
  for (const result of [{ assigned_group: 2 }, { draw_code: 'A01' }, { draw_time: '2026-10-09T00:00:00Z' }]) {
    const drawn = { ...original, ...result };
    assert.match(projectFieldChangeError(drawn, '進修部')!, /已有抽籤資料.*先重設.*企業智慧化/);
    assert.equal(projectFieldChangeError(drawn, drawn.field), null);
  }
  assert.equal(projectFieldChangeError(original, '進修部'), null);
  assert.equal(projectFieldChangeError({ ...original, assigned_group: null, draw_code: null, draw_time: null }, '進修部'), null);
});

test('session-only imports are incomplete, remain resettable and become drawable after reset', () => {
  const imported = [{ ...project('1', 'A'), assigned_group: 1 }, project('2', 'A')];
  assert.deepEqual(getIncompleteDrawFields(['A'], imported), ['A']);
  assert.ok(imported.every(p => !isCompleteDrawResult(p)));
  assert.deepEqual(getSelectedDrawFields(['A'], imported, null), []);
  assert.deepEqual(getResettableFields(['A'], imported), ['A']);
  const reset = imported.map(p => ({ ...p, assigned_group: null, draw_code: null, draw_time: null }));
  assert.deepEqual(getIncompleteDrawFields(['A'], reset), []);
  assert.deepEqual(getSelectedDrawFields(['A'], reset, null), ['A']);
});

test('only complete assignments count as finished; mixed domains and missing data remain incomplete', () => {
  const complete = { ...project('1', 'A'), assigned_group: 2, draw_code: 'A03' };
  assert.equal(isCompleteDrawResult(complete), true);
  assert.deepEqual(getIncompleteDrawFields(['A'], [complete]), []);
  assert.deepEqual(getIncompleteDrawFields(['A'], [complete, project('2', 'A')]), ['A']);
  for (const missing of [{ assigned_group: null }, { draw_code: '' }, { draw_code: ' ' }, { assigned_group: 1.5 }]) {
    const partial = { ...complete, ...missing };
    assert.equal(isCompleteDrawResult(partial), false);
    assert.deepEqual(getIncompleteDrawFields(['A'], [partial]), ['A']);
  }
  const all = [complete, { ...project('2', 'B'), assigned_group: 1 }, project('3', 'C')];
  assert.deepEqual(getIncompleteDrawFields(['A', 'B', 'C'], all), ['B']);
  assert.deepEqual(getAvailableDrawFields(['A', 'B', 'C'], all), ['C']);
  assert.deepEqual(getIncompleteDrawFields(['A'], all), []);
});

test('all/single/multiple scopes exclude completed domains and partial results', () => {
  const fields = ['A', 'B', 'C'];
  for (const result of [{ assigned_group: 1 }, { draw_code: 'A01' }, { draw_time: '2026-10-04T00:00:00Z' }]) {
    const projects = [{ ...project('1', 'A'), ...result }, project('2', 'A'), project('3', 'B'), project('4', 'C')];
    assert.deepEqual(getAvailableDrawFields(fields, projects), ['B', 'C']);
    assert.deepEqual(getSelectedDrawFields(fields, projects, null), ['B', 'C']);
    assert.deepEqual(getSelectedDrawFields(fields, projects, ['A', 'B']), ['B']);
    assert.deepEqual(getSelectedDrawFields(fields, projects, ['A']), []);
    assert.deepEqual(getSelectedDrawFields(fields, projects, []), []);
    assert.deepEqual(getSelectedDrawFields(fields, projects, ['missing']), []);
  }
});

test('completing one scope disables it; resetting restores selection without touching other results', () => {
  const fields = ['企業智慧化', '數位內容與多媒體應用'];
  const configs = fields.map((field, i) => ({ id: String(i), field, code: i === 0 ? 'A' : 'B', groupCount: 1 }));
  const original = [project('1', fields[0]), project('2', fields[1])];
  const first = executeAllDomainsIndependentLottery([original[0]], configs).updatedProjects[0];
  const afterFirst = [first, original[1]];
  const nextFields = getSelectedDrawFields(fields, afterFirst, null);
  assert.deepEqual(nextFields, [fields[1]]);
  const next = executeAllDomainsIndependentLottery(afterFirst.filter(p => nextFields.includes(p.field)), configs).updatedProjects;
  const finished = [first, ...next];
  assert.deepEqual(getAvailableDrawFields(fields, finished), []);
  assert.deepEqual(getSelectedDrawFields(fields, finished, null), []);
  const reset = [{ ...first, assigned_group: null, draw_code: null, draw_time: null }, ...next];
  assert.deepEqual(getSelectedDrawFields(fields, reset, null), [fields[0]]);
  assert.deepEqual(finished[0], first);
  assert.ok(next[0].draw_code);
  assert.deepEqual(getAvailableDrawFields(fields, original), fields);
});


test('reset selection lists completed domains globally even while draw scope targets an undrawn domain', () => {
  const fields = ['A', 'B', 'C'];
  const projects = [{ ...project('1', 'A'), draw_code: 'A01' }, project('2', 'B'), { ...project('3', 'C'), draw_code: 'C01' }];
  assert.deepEqual(getSelectedDrawFields(fields, projects, ['B']), ['B']);
  assert.deepEqual(getResettableFields(fields, projects), ['A', 'C']);
  const resetA = projects.map(p => p.field === 'A' ? { ...p, draw_code: null } : p);
  assert.deepEqual(getResettableFields(fields, resetA), ['C']);
  assert.deepEqual(getAvailableDrawFields(fields, resetA), ['A', 'B']);
  assert.deepEqual(resetA[2], projects[2]);
});
