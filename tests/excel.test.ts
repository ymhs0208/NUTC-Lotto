import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseExcelFile, createExportWorkbook, createInputTemplateWorkbook, REQUIRED_INPUT_HEADERS, REQUIRED_OUTPUT_HEADERS } from '../src/lib/excel';
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
  assert.equal(rows[0].原始編號, 'A01');
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
  assert.deepEqual(exported.map(p => p['抽籤編號']), ['A01', 'A02', 'A03', 'A10', 'A99', 'A100', 'B01', 'B02', 'B03', 'C01', 'Z01', '未抽籤', '未抽籤', '未抽籤']);
  assert.deepEqual(exported.slice(-3).map(p => p.原始編號), ['P1', 'P2', 'P3']);
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

test('template uses current configured fields, preserves blank passwords and imports new and legacy original-code headers', async () => {
  const configs = [{ id: 'd1', field: '進修部', drawPrefix: 'Z', groupCount: 2 }, { id: 'd2', field: '自訂領域', groupCount: 1 }];
  const workbook = createInputTemplateWorkbook(configs);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });
  assert.deepEqual(Object.keys(rows[0]), REQUIRED_INPUT_HEADERS);
  assert.deepEqual(rows.map(row => row.領域), ['進修部', '自訂領域']);
  // Custom draw prefixes do not change the existing backend's original-code rules.
  assert.equal(rows[0].原始編號, 'G01');
  assert.equal(rows[1].原始編號, '');
  assert.ok(rows.every(row => row.組長密碼 === ''));
  const imported = await parseExcelFile(new File([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })], '範本.xlsx'));
  assert.equal(imported.success, true);
  assert.deepEqual(imported.projects!.map(project => project.field), rows.map(row => row.領域));
  assert.equal(imported.projects![0].original_code, 'G01');
  const empty = createInputTemplateWorkbook([]);
  assert.deepEqual(XLSX.utils.sheet_to_json(empty.Sheets[empty.SheetNames[0]], { header: 1 })[0], REQUIRED_INPUT_HEADERS);
});

test('export and reimport retain actual session and within-session order instead of deriving order from draw code', async () => {
  const base = (await parseExcelFile(makeFile([row]))).projects![0];
  const projects = [
    { ...base, id: 'drawn', assigned_group: 2, draw_order: 2, draw_code: 'A32' },
    { ...base, id: 'undrawn', leader_id: 'other-leader', original_code: 'A02', assigned_group: null, draw_order: null, draw_code: null },
  ];
  const workbook = createExportWorkbook(projects);
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const sheet = XLSX.read(bytes, { type: 'array' });
  const exported = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet.Sheets[sheet.SheetNames[0]], { defval: '' });
  assert.equal(exported[0].抽籤編號, 'A32');
  assert.equal(exported[0].報告場次, '第二場次');
  assert.equal(exported[0].組內順序, 2);
  assert.equal(exported[1].抽籤編號, '未抽籤');
  assert.equal(exported[1].報告場次, '待分配');
  assert.equal(exported[1].組內順序, '待抽籤');
  const parsed = await parseExcelFile(new File([bytes], '結果.xlsx'));
  assert.equal(parsed.success, true);
  assert.equal(parsed.projects![0].assigned_group, 2);
  assert.equal(parsed.projects![0].draw_order, 2);
  assert.equal(parsed.projects![0].draw_code, 'A32');
  assert.equal(parsed.projects![1].assigned_group, null);
  assert.equal(parsed.projects![1].draw_order, null);
  assert.equal(parsed.projects![1].draw_code, null);
  assert.ok(parsed.projects!.every(project => !project.password));
  const empty = createExportWorkbook([]);
  assert.deepEqual(XLSX.utils.sheet_to_json(empty.Sheets[empty.SheetNames[0]], { header: 1 })[0], REQUIRED_OUTPUT_HEADERS);
});

test('legacy draw headers remain readable and malformed session/order values fail before import', async () => {
  const legacy = await parseExcelFile(makeFile([{ ...row, '+編號(抽籤後)': 'A03' }]));
  assert.equal(legacy.success, true);
  assert.equal(legacy.projects![0].draw_code, 'A03');
  assert.equal(legacy.projects![0].draw_order, 3);
  const undrawn = await parseExcelFile(makeFile([{ ...row, '+編號(抽籤後)': '未抽籤' }]));
  assert.equal(undrawn.projects![0].draw_code, null);
  for (const labels of [
    { 報告場次: '第51場次', 組內順序: '1' },
    { 報告場次: '第一場次', 組內順序: '0' },
    { 報告場次: '第一場次', 組內順序: '2.5' },
  ]) assert.equal((await parseExcelFile(makeFile([{ ...row, ...labels, 抽籤編號: 'A01' }]))).success, false);
});

test('imports grouping sessions written as Chinese groups, session labels and full-width numbers', async () => {
  for (const [value, expected] of [['第一組', 1], ['第二場', 2], ['三', 3], ['第十二組', 12], ['第五十場次', 50], ['第０２組', 2], ['01', 1]] as const) {
    const parsed = await parseExcelFile(makeFile([{ ...row, 分組場次: value, 組內順序: '1', 抽籤編號: 'A01' }]));
    assert.equal(parsed.success, true, `${value}: ${parsed.error}`);
    assert.equal(parsed.projects![0].assigned_group, expected);
    assert.equal(parsed.projects![0].draw_order, 1);
  }
});

test('blank or pending report-session columns do not hide populated grouping-session columns', async () => {
  for (const blank of ['', '待分配']) {
    const parsed = await parseExcelFile(makeFile([{ ...row, 報告場次: blank, 分組場次: '第二組' }]));
    assert.equal(parsed.success, true, parsed.error);
    assert.equal(parsed.projects![0].assigned_group, 2);
  }
  const conflict = await parseExcelFile(makeFile([{ ...row, 報告場次: '第一場次', 分組場次: '第二組' }]));
  assert.equal(conflict.success, false);
  assert.match(conflict.error!, /第 2 列.*不一致/);
  for (const invalid of ['第零組', '第51組', '0', '2.5', '第一組／第二組']) {
    assert.equal((await parseExcelFile(makeFile([{ ...row, 分組場次: invalid }]))).success, false, invalid);
  }
});

test('Chinese grouping sessions survive Excel import, database save and state reload', { timeout: 180000 }, async () => {
  const { localWorker } = await import('../scripts/local-worker');
  const { hashPassword } = await import('../server/credentials');
  const worker = await localWorker();
  try {
    const parsed = await parseExcelFile(makeFile([{ ...row, 分組場次: '第一場次', 抽籤編號: 'A01', 組內順序: '1' }]));
    assert.equal(parsed.success, true, parsed.error);
    assert.equal(parsed.projects![0].assigned_group, 1);
    await worker.start();
    await worker.setup({ action: 'accounts', accounts: [{ id: 'import-admin', email: 'import@example.edu.tw', role: 'admin', password_hash: await hashPassword('Abc12345') }] });
    const login = await worker.request('/api/auth/verify', { username: 'import@example.edu.tw', password: 'Abc12345', targetView: 'admin' });
    assert.equal(login.status, 200);
    const saved = await worker.request('/api/projects', { version: 0, projects: parsed.projects }, login.cookie);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const reloaded = await worker.request('/api/state', undefined, login.cookie);
    assert.equal(reloaded.data.projects[0].assigned_group, 1);
    assert.equal(reloaded.data.projects[0].draw_order, 1);
    assert.equal(reloaded.data.projects[0].draw_code, 'A01');
  } finally { await worker.dispose(); }
});
