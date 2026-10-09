import test from 'node:test';
import assert from 'node:assert/strict';
import { domainDeletionError } from '../src/lib/domainDeletion';
import type { ProjectItem } from '../src/types';

const configs = [{ id: 'a', field: '企業智慧化', groupCount: 2 }, { id: 'b', field: '進修部', groupCount: 2 }];
const project = { field: configs[0].field } as ProjectItem;

test('deleting a domain blocks complete and partial draw results in the original snapshot', () => {
  for (const result of [{ assigned_group: 1 }, { draw_code: 'A01' }, { draw_time: '2026-10-02T00:00:00Z' }]) {
    assert.match(domainDeletionError([{ ...project, ...result }], configs, [configs[1]])!, /企業智慧化.*重設.*刪除/);
  }
});

test('reset/empty domains may be deleted, while retained drawn domains do not block deletion', () => {
  const reset = { ...project, assigned_group: null, draw_code: null, draw_time: null };
  assert.equal(domainDeletionError([reset, { ...project, field: configs[1].field, draw_code: 'A01' }], configs, [configs[1]]), null);
  assert.equal(domainDeletionError([], configs, []), null);
});

test('reordering or renaming the same domain identity preserves the ability to edit drawn domains', () => {
  assert.equal(domainDeletionError([{ ...project, draw_code: 'A01' }], configs, [...configs].reverse()), null);
  assert.equal(domainDeletionError([{ ...project, draw_code: 'A01' }], configs, [{ ...configs[0], field: '更名領域' }, configs[1]]), null);
});
