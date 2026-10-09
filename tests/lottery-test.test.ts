import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testLottery } from '../src/lib/lotteryTest';
import type { DomainConfig, ProjectItem } from '../src/types';

const projects: ProjectItem[] = Array.from({ length: 3 }, (_, i) => ({
  id: `p${i}`, seq_no: String(i), leader_id: `s${i}`, field: '企業智慧化', original_code: `A0${i + 1}`, project_title: `專題${i}`, advisor: '王教授',
  education_system: '', department: '', class_name: '', assigned_group: 8, draw_code: 'original-draw', draw_time: '2026-10-01T00:00:00Z',
}));
const config: DomainConfig = { id: 'a', field: '企業智慧化', groupCount: 2, groupCapacities: { 1: 1, 2: 2 }, evaluatorsPerGroup: { 1: ['李教授'], 2: ['陳教授'] } };

test('test draw runs the current allocator on already-drawn projects without changing inputs', () => {
  const before = structuredClone({ projects, config });
  const result = testLottery(projects, [config], 'ALL', 7);
  assert.equal(result.errorCount, 0); assert.equal(result.warningCount, 0);
  assert.equal(result.version, 7); assert.equal(result.projectCount, 3);
  assert.deepEqual(result.domains[0].groups.map(g => g.count), [1, 2]);
  assert.deepEqual(result.domains[0].preview.map(p => p.drawCode), ['A01', 'A02', 'A03']);
  assert.deepEqual({ projects, config }, before);
  assert.deepEqual(Object.keys(result.domains[0].preview[0]).sort(), ['drawCode', 'group', 'originalCode', 'title']);
});

test('test draw reports wrong totals and infeasible capacity constraints, and still tests other domains', () => {
  const other = { ...projects[0], id: 'g', field: '進修部', original_code: 'G01' };
  const result = testLottery([...projects, other], [{ ...config, groupCapacities: { 1: 2, 2: 2 } }, { id: 'g', field: '進修部', groupCount: 1, evaluatorsPerGroup: { 1: ['李教授'] } }], 'ALL', 1);
  assert.equal(result.errorCount, 1);
  assert.match(result.domains[0].issues[0].message, /共 4 件.*名冊有 3 件/);
  assert.equal(result.domains[0].preview.length, 0);
  assert.equal(result.domains[1].preview.length, 1);
  const impossible = testLottery(projects, [{ ...config, evaluatorsPerGroup: { 1: ['王教授'], 2: ['陳教授'] } }], config.field, 1);
  assert.equal(impossible.errorCount, 1); assert.match(impossible.domains[0].issues[0].message, /迴避/);
});

test('test draw detects legacy advisor conflicts, duplicate codes, and missing reviewers', () => {
  const conflicts = testLottery(projects, [{ ...config, groupCapacities: undefined, evaluatorsPerGroup: { 1: ['王教授'], 2: ['王教授'] } }], 'ALL', 1);
  assert.equal(conflicts.errorCount, 3);
  assert.ok(conflicts.domains[0].issues.every(i => /利益衝突/.test(i.message)));
  const aliases = testLottery([projects[0], { ...projects[1], field: 'A.企業智慧化' }], [{ ...config, groupCapacities: undefined }, { id: 'alias', field: 'A.企業智慧化', groupCount: 1 }], 'ALL', 1);
  assert.ok(aliases.errorCount >= 1);
  assert.ok(aliases.domains.every(d => d.issues.some(i => /相同抽籤編號前綴/.test(i.message))));
  assert.ok(aliases.domains.every(d => d.preview.length === 0));
  const singleAlias = testLottery([projects[0], { ...projects[1], field: 'A.企業智慧化' }], [config], '企業智慧化', 1);
  assert.match(singleAlias.domains[0].issues[0].message, /相同抽籤編號前綴/);
  const selected = testLottery([projects[0], { ...projects[1], field: '進修部' }], [], '進修部', 1);
  assert.equal(selected.projectCount, 1); assert.equal(selected.domains.length, 1);
  assert.equal(selected.domains[0].field, '進修部');
  assert.ok(selected.domains[0].issues.some(i => /預設 2 組/.test(i.message)));
});
