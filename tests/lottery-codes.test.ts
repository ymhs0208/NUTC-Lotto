import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateDomainSubgroups, executeAllDomainsIndependentLottery, getDomainCode } from '../src/lib/lottery';
import { createExportWorkbook } from '../src/lib/excel';
import * as XLSX from 'xlsx';
import type { ProjectItem } from '../src/types';
import { domainCodeCollisionError, sortDomainConfigs } from '../src/lib/domainCodes';
import { validateDomains } from '../server/store';
import { LotteryAllocationError } from '../src/lib/groupCapacities';
import { normalizeOriginalCodes } from '../src/lib/originalCodes';
import { testLottery } from '../src/lib/lotteryTest';

const fields = ['企業智慧化', '數位內容與多媒體應用', '網路應用與資通安全', '嵌入式系統與行動計算', '智慧運算創新應用', '智慧流通應用與研究', '進修部'];
const makeProject = (field: string, index: number): ProjectItem => ({
  id: `${field}-${index}`, seq_no: String(index + 1), field, leader_id: `${field}-${index}`,
  education_system: '', department: '', class_name: '', advisor: '', original_code: '', project_title: '測試',
});

test('domain order follows configured letters, preserves data and ignores former array position', () => {
  const configs = [
    { id: 'custom', field: '舊自訂領域', groupCount: 2 },
    { id: 'z', field: '企業智慧化', code: 'Z', groupCount: 3 },
    { id: 'h', field: '其他領域', code: 'H', groupCount: 1 },
    { id: 'a', field: 'A.企業智慧化', groupCount: 2 },
    { id: 'g', field: '進修部', groupCount: 1 },
  ];
  const before = structuredClone(configs);
  const sorted = sortDomainConfigs(configs);
  assert.deepEqual(sorted.map(c => c.id), ['a', 'g', 'h', 'z', 'custom']);
  assert.deepEqual(configs, before);
  assert.deepEqual(sortDomainConfigs([...configs].reverse()), sorted);
  assert.deepEqual(sortDomainConfigs(sorted), sorted);
  const changed = configs.map(c => c.id === 'z' ? { ...c, code: 'B' } : c);
  assert.deepEqual(sortDomainConfigs(changed).map(c => c.id), ['a', 'z', 'g', 'h', 'custom']);
});

test('aliases and custom prefix collisions reject configuration and formal allocation without changing data', () => {
  for (const names of [
    ['企業智慧化', 'A.企業智慧化'], ['嵌入式系統與行動計算', 'D.嵌入式系統與行動計算、'],
    ['企業智慧化', ' 企業智慧化 '], ['自訂領域甲', '自訂領域乙'],
  ]) {
    const configs = names.map((field, i) => ({ id: String(i), field, groupCount: 1 }));
    const projects = names.map(makeProject);
    const before = structuredClone({ projects, configs });
    assert.match(domainCodeCollisionError(names)!, /相同抽籤編號前綴/);
    assert.throws(() => validateDomains(configs), /相同抽籤編號前綴/);
    assert.throws(() => executeAllDomainsIndependentLottery(projects, configs), LotteryAllocationError);
    // One selected domain must also check the other configured namespace.
    assert.throws(() => executeAllDomainsIndependentLottery([projects[0]], configs), LotteryAllocationError);
    assert.deepEqual({ projects, configs }, before);
  }
  assert.equal(domainCodeCollisionError(['企業智慧化', '企業智慧化', '進修部']), null);
  assert.equal(domainCodeCollisionError(['自訂甲領域', '自訂乙領域']), null);
  validateDomains([{ id: 'a', field: 'A.企業智慧化', groupCount: 1 }]);
});

test('explicit unique letters override aliases and custom prefixes in roster, test and formal draw', () => {
  const names = ['企業智慧化', 'A.企業智慧化', '自訂領域甲', '自訂領域乙'];
  const configs = names.map((field, i) => ({ id: String(i), field, code: ['A', 'H', 'I', 'Z'][i], groupCount: 1 }));
  validateDomains(configs);
  const projects = names.map(makeProject);
  assert.deepEqual(normalizeOriginalCodes(projects, configs).map(p => p.original_code), ['A01', 'H01', 'I01', 'Z01']);
  const allocated = executeAllDomainsIndependentLottery(projects, configs).updatedProjects;
  assert.deepEqual(allocated.map(p => p.draw_code), ['A01', 'H01', 'I01', 'Z01']);
  const trial = testLottery(projects, configs, 'ALL', 1);
  assert.equal(trial.errorCount, 0);
  assert.deepEqual(trial.domains.flatMap(d => d.preview.map(p => p.drawCode)), ['A01', 'H01', 'I01', 'Z01']);
  for (const code of ['', 'a', 'AA', '1', 1, null]) {
    assert.throws(() => validateDomains([{ ...configs[0], code }]), /單一大寫英文字母/);
  }
  assert.throws(() => validateDomains([{ ...configs[0], code: 'H' }, configs[1]]), /相同抽籤編號前綴/);
  const changed = normalizeOriginalCodes(normalizeOriginalCodes(projects, configs), configs.map(c => c.id === '1' ? { ...c, code: 'J' } : c));
  assert.equal(changed[1].original_code, 'J01');
  assert.deepEqual(changed.map(p => p.id), projects.map(p => p.id));
});

test('all seven domains have unique compact codes across groups and keep local presentation order', () => {
  const projects = fields.flatMap(field => Array.from({ length: 12 }, (_, i) => makeProject(field, i)));
  const { updatedProjects } = executeAllDomainsIndependentLottery(projects,
    fields.map((field, i) => ({ id: `d${i}`, field, groupCount: 3 })));
  assert.equal(new Set(updatedProjects.map(p => p.draw_code)).size, projects.length);
  fields.forEach((field, i) => {
    const prefix = String.fromCharCode(65 + i);
    const domain = updatedProjects.filter(p => p.field === field);
    assert.deepEqual(domain.map(p => p.draw_code).sort(), Array.from({ length: 12 }, (_, n) => `${prefix}${String(n + 1).padStart(2, '0')}`));
    for (let group = 1; group <= 3; group++) {
      assert.equal(new Set(domain.filter(p => p.assigned_group === group).map(p => p.draw_code)).size, 4);
      assert.ok(domain.every(p => !('draw_order' in p)));
    }
  });
  const workbook = createExportWorkbook(updatedProjects);
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[workbook.SheetNames[0]]);
  assert.deepEqual(new Set(rows.map(row => row['編號(抽籤後)'])), new Set(updatedProjects.map(p => p.draw_code)));
});

test('domain labels tolerate supplied prefixes and punctuation; numbering does not wrap at 99', () => {
  assert.equal(getDomainCode('D.嵌入式系統與行動計算、'), 'D');
  assert.equal(getDomainCode('  企業智慧化  '), 'A');
  const drawn = allocateDomainSubgroups(Array.from({ length: 101 }, (_, i) => makeProject('企業智慧化', i)), 3, '企業智慧化');
  assert.equal(new Set(drawn.map(p => p.draw_code)).size, 101);
  assert.equal(drawn[0].draw_code, 'A01');
  assert.equal(drawn[100].draw_code, 'A101');
});
