import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResultSlides } from '../src/lib/resultPresentation';
import type { ProjectItem, DomainConfig } from '../src/types';
const domains = [{ field: 'B' }, { field: 'A' }] as DomainConfig[];
const item = (id: string, field: string, group: number | null, order: number | null) => ({ id, field, assigned_group: group, draw_code: order != null && order > 0 ? `${field}${order}` : null, project_title: id } as ProjectItem);

test('presentation follows configured domains, numeric groups and numeric draw codes without changing input', () => {
  const projects = [item('a', 'A', 1, 1), item('b10', 'B', 10, 1), item('b2', 'B', 2, 2), item('b1', 'B', 2, 1), item('pending', 'B', null, null), item('extra', 'C', 1, 1)];
  const original = JSON.stringify(projects);
  const slides = buildResultSlides(projects, domains, 'ALL', 1);
  assert.deepEqual(slides.map((slide) => slide.items[0].id), ['b1', 'b2', 'b10', 'a', 'extra']);
  assert.equal(slides[0].groupTotal, 2);
  assert.equal(slides[1].page, 1);
  assert.equal(slides[1].pages, 2);
  assert.equal(JSON.stringify(projects), original);
  assert.deepEqual(buildResultSlides(projects, domains, 'A').flatMap((slide) => slide.items.map((p) => p.id)), ['a']);
});
test('614 projects in 19 groups appear exactly once at every supported viewport page size', () => {
  const projects = Array.from({ length: 614 }, (_, i) => item(`p${i}`, i % 19 < 9 ? 'A' : 'B', i % 19 + 1, Math.floor(i / 19) + 1)).reverse();
  for (const size of [1, 2, 3, 4, 5, 6, 8, 10]) {
    const slides = buildResultSlides(projects, domains, 'ALL', size);
    assert.equal(new Set(slides.map((slide) => JSON.stringify([slide.field, slide.group]))).size, 19);
    const ids = slides.flatMap((slide) => slide.items.map((p) => p.id));
    assert.equal(ids.length, 614);
    assert.equal(new Set(ids).size, 614);
    assert.equal(new Set(slides.map((slide) => slide.key)).size, slides.length);
    for (const slide of slides) {
      assert.ok(slide.items.length <= size);
      assert.ok(slide.items.every((p) => p.field === slide.field && p.assigned_group === slide.group));
      assert.deepEqual(slide.items.map((p) => p.draw_code!), slide.items.map((p) => p.draw_code!).sort(new Intl.Collator('zh-TW', { numeric: true }).compare));
    }
  }
});
test('empty, unsaved or invalid assignments never enter presentation', () => {
  assert.deepEqual(buildResultSlides([], domains), []);
  assert.deepEqual(buildResultSlides([item('x', 'A', 0, 1), item('y', 'A', 1, -1), item('z', 'A', 1.5, 1)], domains), []);
  assert.throws(() => buildResultSlides([], domains, 'ALL', 0));
});

test('multiple-domain presentation excludes every unselected domain', () => {
  const projects = [item('a', 'A', 1, 1), item('b', 'B', 1, 1), item('c', 'C', 1, 1)];
  assert.deepEqual(buildResultSlides(projects, domains, ['A', 'C']).flatMap(page => page.items.map(p => p.id)), ['a', 'c']);
  assert.deepEqual(buildResultSlides(projects, domains, []), []);
});
