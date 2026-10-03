import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseExcelFile, createExportWorkbook, REQUIRED_OUTPUT_HEADERS } from '../src/lib/excel';
import { preserveImportedProjectIds } from '../src/lib/importProjects';

const row = { 序號: '1', 學制: '四技', 系所: '資管', 班級: '甲', 指導老師: '王教授', 領域: '企業智慧化', 編號: 'P1', 專題名稱: '中文測試', 組長學號: '12345678', 組長密碼: 'Strong-password-123' };
function makeFile(rows: Record<string, string>[]): File {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '名冊');
  return new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], '名冊.xlsx');
}
test('patched SheetJS imports Chinese rosters and exports without credential fields', async () => {
  assert.equal(XLSX.version, '0.20.3');
  const parsed = await parseExcelFile(makeFile([row]));
  assert.equal(parsed.success, true); assert.equal(parsed.projects![0].project_title, '中文測試');
  assert.equal(parsed.projects![0].password, row.組長密碼);
  assert.equal(parsed.projects![0].original_code, 'A01');
  const wb = createExportWorkbook(parsed.projects!);
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const readback = XLSX.read(bytes, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(readback.Sheets[readback.SheetNames[0]]);
  assert.deepEqual(Object.keys(rows[0]), REQUIRED_OUTPUT_HEADERS);
  assert.equal(rows[0].專題名稱, '中文測試'); assert.equal(rows[0].組長密碼, undefined);
  assert.equal(rows[0].編號, 'A01');
  assert.equal(rows[0].password_hash, undefined);
});
test('imports never invent predictable passwords and reject weak passwords or excessive files', async () => {
  const blank = await parseExcelFile(makeFile([{ ...row, 組長密碼: '' }]));
  assert.equal(blank.success, true); assert.equal(blank.projects![0].password, '');
  const weak = await parseExcelFile(makeFile([{ ...row, 組長密碼: '5678' }]));
  assert.equal(weak.success, false);
  assert.equal((await parseExcelFile(makeFile([{ ...row, 組長密碼: 'Abc1234' }]))).success, false);
  const eightCharacter = await parseExcelFile(makeFile([{ ...row, 組長密碼: 'Abc12345' }]));
  assert.equal(eightCharacter.success, true); assert.equal(eightCharacter.projects![0].password, 'Abc12345');
  assert.equal((await parseExcelFile(makeFile([{ ...row, 組長密碼: row.組長學號 }]))).success, false);
  const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'oversized.xlsx');
  assert.equal((await parseExcelFile(oversized)).success, false);
  assert.equal((await parseExcelFile(makeFile(Array.from({ length: 2001 }, () => row)))).success, false);
});

test('replacing a roster keeps stable IDs for matching student leaders', async () => {
  const before = (await parseExcelFile(makeFile([row]))).projects!;
  const next = (await parseExcelFile(makeFile([{ ...row, 專題名稱: '更新專題' }, { ...row, 組長學號: 'new-leader', 專題名稱: '新專題' }]))).projects!;
  const reconciled = preserveImportedProjectIds(next, before);
  assert.equal(reconciled[0].id, before[0].id);
  assert.equal(reconciled[0].project_title, '更新專題');
  assert.equal(reconciled[1].id, next[1].id);
});

test('exported file follows numeric draw codes across domains and places undrawn projects last', async () => {
  const base = (await parseExcelFile(makeFile([row]))).projects![0];
  const codes = ['Z01', 'B03', 'A100', 'B01', 'A03', 'A99', 'A01', 'A02', 'B02', 'C01', 'A10', null, undefined, ''];
  const projects = codes.map((code, i) => ({
    ...base, id: `export-${i}`, seq_no: String(codes.length - i), original_code: `P${codes.length - i}`,
    draw_order: code ? 1 : null, draw_code: code,
  }));
  const before = structuredClone(projects);
  const bytes = XLSX.write(createExportWorkbook(projects), { type: 'array', bookType: 'xlsx' });
  const workbook = XLSX.read(bytes, { type: 'array' });
  const exported = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[workbook.SheetNames[0]]);
  assert.deepEqual(exported.map(p => p['+編號(抽籤後)']), ['A01', 'A02', 'A03', 'A10', 'A99', 'A100', 'B01', 'B02', 'B03', 'C01', 'Z01', '未抽籤', '未抽籤', '未抽籤']);
  assert.deepEqual(exported.slice(-3).map(p => p.編號), ['P1', 'P2', 'P3']);
  assert.deepEqual(projects, before);
});

test('equal draw codes and all-undrawn rosters retain deterministic original-code and sequence ordering', async () => {
  const base = (await parseExcelFile(makeFile([row]))).projects![0];
  const projects = [
    { ...base, id: 'a', seq_no: '10', original_code: 'A10', draw_code: 'Z01' },
    { ...base, id: 'b', seq_no: '2', original_code: 'A02', draw_code: 'Z01' },
    { ...base, id: 'c', seq_no: '1', original_code: 'A02', draw_code: 'Z01' },
  ];
  for (const items of [projects, projects.map(p => ({ ...p, draw_code: null }))]) {
    const workbook = createExportWorkbook(items);
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[workbook.SheetNames[0]]);
    assert.deepEqual(rows.map(p => p.序號), ['1', '2', '10']);
  }
});
