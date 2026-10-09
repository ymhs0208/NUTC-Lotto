import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateDomainSubgroups, isAdvisorConflict, executeAllDomainsIndependentLottery } from '../src/lib/lottery';
import { LotteryAllocationError } from '../src/lib/groupCapacities';
import { validateDomains } from '../server/store';
import type { ProjectItem } from '../src/types';

const make = (i: number, advisor = ''): ProjectItem => ({ id: `p${i}`, seq_no: String(i + 1), leader_id: `s${i}`, field: '企業智慧化', original_code: `A${i + 1}`, project_title: `專題${i}`, advisor, education_system: '', department: '', class_name: '' });

test('explicit capacities produce exact counts including zero, preserve projects and keep unique positions', () => {
  const projects = Array.from({ length: 6 }, (_, i) => make(i));
  const before = structuredClone(projects);
  const drawn = allocateDomainSubgroups(projects, 3, '企業智慧化', {}, { 1: 1, 2: 0, 3: 5 });
  assert.deepEqual([1, 2, 3].map(g => drawn.filter(p => p.assigned_group === g).length), [1, 0, 5]);
  assert.equal(new Set(drawn.map(p => p.id)).size, 6);
  assert.deepEqual(drawn.map(p => p.draw_code), ['A01', 'A02', 'A03', 'A04', 'A05', 'A06']);
  assert.equal(new Set(drawn.filter(p => p.assigned_group === 3).map(p => p.draw_code)).size, 5);
  assert.ok(drawn.every(p => !('draw_order' in p)));
  assert.deepEqual(projects, before);
});

test('explicit allocation satisfies feasible balanced constraints across randomized runs', () => {
  const projects = ['丙', '丙', '乙', '乙', '甲', '甲'].map((advisor, i) => make(i, advisor));
  const evaluators = { 1: ['甲'], 2: ['乙'], 3: ['丙'] };
  for (let run = 0; run < 100; run++) {
    const drawn = allocateDomainSubgroups(projects, 3, '企業智慧化', evaluators, { 1: 2, 2: 2, 3: 2 });
    assert.deepEqual([1, 2, 3].map(g => drawn.filter(p => p.assigned_group === g).length), [2, 2, 2]);
    assert.ok(drawn.every(p => !isAdvisorConflict(p.advisor, p.evaluators)));
  }
});

test('capacity matching agrees with exhaustive feasibility for all four-project three-group constraint graphs', () => {
  const capacities = { 1: 1, 2: 1, 3: 2 };
  for (let graph = 0; graph < 7 ** 4; graph++) {
    let rest = graph;
    const masks = Array.from({ length: 4 }, () => { const mask = rest % 7 + 1; rest = Math.floor(rest / 7); return mask; });
    const projects = masks.map((_, i) => make(i, `指導${i}`));
    const evaluators = Object.fromEntries([1, 2, 3].map(g => [g, projects.filter((_, i) => !(masks[i] & (1 << (g - 1)))).map(p => p.advisor)]));
    const feasible = (index: number, counts: number[]): boolean => index === 4 || [0, 1, 2].some(g => {
      if (!(masks[index] & (1 << g)) || counts[g] >= capacities[(g + 1) as 1 | 2 | 3]) return false;
      const next = [...counts]; next[g]++;
      return feasible(index + 1, next);
    });
    if (feasible(0, [0, 0, 0])) {
      const drawn = allocateDomainSubgroups(projects, 3, '企業智慧化', evaluators, capacities);
      assert.deepEqual([1, 2, 3].map(g => drawn.filter(p => p.assigned_group === g).length), [1, 1, 2]);
      assert.ok(drawn.every(p => !isAdvisorConflict(p.advisor, p.evaluators)));
    } else {
      assert.throws(() => allocateDomainSubgroups(projects, 3, '企業智慧化', evaluators, capacities), LotteryAllocationError);
    }
  }
});

test('invalid capacities, wrong totals, and impossible reviewer constraints fail before results are returned', () => {
  const domain = { id: 'd', field: '企業智慧化', groupCount: 2 };
  for (const value of [null, [], {}, { 1: 1 }, { 1: -1, 2: 2 }, { 1: 0.5, 2: 2 }, { 1: '1', 2: 2 }, { 1: 1, 3: 2 }, { '01': 1, 2: 2 }, { 1: 2001, 2: 0 }]) {
    assert.throws(() => validateDomains([{ ...domain, groupCapacities: value }]));
  }
  validateDomains([{ ...domain, groupCapacities: { 1: 0, 2: 2 } }]);
  const projects = [make(0, '王'), make(1, '王')];
  assert.throws(() => allocateDomainSubgroups(projects, 2, domain.field, {}, { 1: 1, 2: 2 }), /共 3 件.*名冊有 2 件/);
  assert.throws(() => allocateDomainSubgroups(projects, 2, domain.field, { 1: ['王'], 2: [] }, { 1: 1, 2: 1 }), /迴避/);
  assert.throws(() => allocateDomainSubgroups(projects, 2, domain.field, { 1: ['王'], 2: ['王'] }, { 1: 1, 2: 1 }), /迴避/);
});

test('whole-school lottery uses each domain capacity configuration independently', () => {
  const projects = Array.from({ length: 5 }, (_, i) => make(i));
  projects[3].field = projects[4].field = '進修部';
  const result = executeAllDomainsIndependentLottery(projects, [
    { id: 'a', field: '企業智慧化', groupCount: 2, groupCapacities: { 1: 1, 2: 2 } },
    { id: 'g', field: '進修部', groupCount: 2, groupCapacities: { 1: 2, 2: 0 } },
  ]);
  assert.equal(result.conflictCount, 0);
  assert.deepEqual([1, 2].map(g => result.updatedProjects.filter(p => p.field === '企業智慧化' && p.assigned_group === g).length), [1, 2]);
  assert.ok(result.updatedProjects.filter(p => p.field === '進修部').every(p => p.assigned_group === 1));
});
