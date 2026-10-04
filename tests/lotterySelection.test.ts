import test from 'node:test';
import assert from 'node:assert/strict';
import { getDrawableFields } from '../src/lib/lotterySelection';

test('any saved result locks its entire domain, including partially drawn domains', () => {
  const fields = ['A', 'B', 'C'];
  const projects = [
    { field: 'A', draw_order: 1 },
    { field: 'A', draw_order: null },
    { field: 'B', draw_order: null },
    { field: 'C', draw_order: 2 },
  ];
  assert.deepEqual(getDrawableFields(fields, projects), ['B']);
  assert.deepEqual(getDrawableFields(['A', 'B'], projects), ['B']);
  assert.deepEqual(getDrawableFields(['A', 'C'], projects), []);
  assert.deepEqual(fields, ['A', 'B', 'C']);
});

test('resetting saved results unlocks a domain without unlocking others', () => {
  const projects = [{ field: 'A', draw_order: 1 }, { field: 'B', draw_order: 1 }];
  assert.deepEqual(getDrawableFields(['A', 'B'], projects), []);
  const reset = projects.map(project => project.field === 'A' ? { ...project, draw_order: null } : project);
  assert.deepEqual(getDrawableFields(['A', 'B'], reset), ['A']);
  assert.deepEqual(getDrawableFields(['A', 'B'], []), ['A', 'B']);
});
