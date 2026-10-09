import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOriginalCodes } from '../src/lib/originalCodes';
import type { ProjectItem } from '../src/types';

const project = (id: string, field: string, original_code = ''): ProjectItem => ({
  id, field, original_code, seq_no: id, leader_id: id, project_title: '測試',
  advisor: '', class_name: '', department: '', education_system: '',
});

test('original codes use all seven domain letters, resolve duplicates and preserve unrelated data', () => {
  const fields = ['企業智慧化', '數位內容與多媒體應用', '網路應用與資通安全', 'D.嵌入式系統與行動計算、', '智慧運算創新應用', '智慧流通應用與研究', '進修部'];
  const input = fields.flatMap((field, i) => [project(`${i}-1`, field, 'old-1'), project(`${i}-2`, field, 'old-2')]);
  const codes = normalizeOriginalCodes(input).map(p => p.original_code);
  assert.deepEqual(codes, fields.flatMap((_, i) => [`${String.fromCharCode(65 + i)}01`, `${String.fromCharCode(65 + i)}02`]));
  assert.equal(input[0].original_code, 'old-1');
  const stored = { ...project('a', '企業智慧化', 'A03'), password_hash: 'preserved', draw_code: 'A12', assigned_group: 3 };
  const normalized = normalizeOriginalCodes([stored, { ...stored, id: 'b' }, { ...stored, id: 'c', field: '進修部' }]);
  assert.deepEqual(normalized.map(p => p.original_code), ['A03', 'A01', 'G01']);
  assert.equal(normalized[0].password_hash, 'preserved');
  assert.equal(normalized[0].draw_code, 'A12');
  assert.equal(normalized[0].draw_code, 'A12');
  assert.equal(normalized[0].assigned_group, 3);
});

test('valid original codes remain stable on reorder/deletion/append; aliases and 100+ entries stay unique', () => {
  const initial = normalizeOriginalCodes([project('1', '企業智慧化'), project('2', '企業智慧化'), project('3', '企業智慧化')]);
  const changed = normalizeOriginalCodes([initial[2], initial[0], project('4', 'A.企業智慧化')]);
  assert.deepEqual(changed.map(p => p.original_code), ['A03', 'A01', 'A02']);
  assert.deepEqual(normalizeOriginalCodes(changed), changed);
  const many = normalizeOriginalCodes(Array.from({ length: 101 }, (_, i) => project(String(i), '企業智慧化')));
  assert.equal(many[100].original_code, 'A101');
  assert.equal(new Set(many.map(p => p.original_code)).size, 101);
  assert.equal(normalizeOriginalCodes([project('custom', '__proto__', 'CUSTOM-01')])[0].original_code, 'CUSTOM-01');
});
