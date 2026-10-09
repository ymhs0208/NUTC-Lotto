import * as XLSX from 'xlsx';
import { ProjectItem, DomainConfig } from '../types';
import { normalizeOriginalCodes } from './originalCodes';
import { formatSessionLabel } from './sessionLabel';
import { duplicateDrawCodeError } from './drawScope';

export const REQUIRED_INPUT_HEADERS = [
  '序號',
  '學制',
  '系所',
  '班級',
  '指導老師',
  '領域',
  '編號',
  '專題名稱',
  '組長學號',
  '組長姓名',
  '組長密碼'
];

export const REQUIRED_OUTPUT_HEADERS = [
  '序號',
  '學制',
  '系所',
  '班級',
  '指導老師',
  '領域',
  '編號',
  '專題名稱',
  '組長學號',
  '組長姓名',
  '編號(抽籤後)',
  '場次'
];

export { preserveImportedProjectIds } from './importProjects';

// Helper to normalize header keys (stripping spaces, parentheses differences)
function normalizeKey(str: string): string {
  return String(str || '').trim().replace(/\s+/g, '');
}

function parseImportedSession(raw: unknown, rowNumber: number): number | null {
  const value = String(raw ?? '').normalize('NFKC').replace(/\s+/g, '');
  if (!value || ['未抽籤', '待抽籤', '待分配', '場次尚未提供', '—', '-'].includes(value)) return null;
  const ordinal = value.replace(/^第/, '').replace(/(?:場次|場|組)$/, '');
  for (let session = 1; session <= 50; session++) {
    if (ordinal === formatSessionLabel(session).slice(1, -2)) return session;
  }
  const session = /^\d+$/.test(ordinal) ? Number(ordinal) : NaN;
  if (!Number.isSafeInteger(session) || session < 1 || session > 50) {
    throw new Error(`第 ${rowNumber} 列場次格式不正確，請填入 1 至 50 或「第一場次」等場次名稱。`);
  }
  return session;
}

/**
 * Parse an uploaded Excel file (.xlsx, .xls, .csv) into ProjectItem[]
 */
export async function parseExcelFile(file: File, configs: DomainConfig[] = []): Promise<{
  success: boolean;
  projects?: ProjectItem[];
  error?: string;
  rowCount?: number;
}> {
  try {
    if (file.size > 5 * 1024 * 1024) return { success: false, error: '匯入檔案不得超過 5 MB。' };
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array', sheetRows: 2002, cellFormula: false, cellHTML: false });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return { success: false, error: 'Excel 檔案內無任何工作表 (Sheet)' };
    }

    const worksheet = workbook.Sheets[firstSheetName];
    const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    if (!rawRows || rawRows.length === 0) {
      return { success: false, error: 'Excel 工作表內沒有資料行' };
    }

    // Inspect first row headers
    const sampleRow = rawRows[0];
    const normalizedKeys = Object.keys(sampleRow).map(k => ({
      original: k,
      normalized: normalizeKey(k)
    }));

    const findKey = (target: string): string | undefined => {
      const normTarget = normalizeKey(target);
      const found = normalizedKeys.find(k => k.normalized === normTarget);
      return found?.original;
    };

    const seqKey = findKey('序號');
    const eduKey = findKey('學制');
    const deptKey = findKey('系所');
    const classKey = findKey('班級');
    const advisorKey = findKey('指導老師');
    const fieldKey = findKey('領域');
    const codeKey = findKey('編號');
    const titleKey = findKey('專題名稱');
    const leaderKey = findKey('組長學號');
    const leaderNameKey = findKey('組長姓名') || findKey('組長名');
    const passwordKey = findKey('組長密碼') || findKey('密碼') || findKey('登入密碼');
    // Check if there is already a draw code column in this excel
    const drawCodeKey = findKey('編號(抽籤後)') || findKey('+編號(抽籤後)') || findKey('抽籤後編號') || findKey('抽籤序號');
    const sessionKeys = ['分組場次', '場次', '報告場次', '組別'].map(findKey).filter((key): key is string => !!key);

    // Validation warning
    if (!titleKey || !leaderKey) {
      return {
        success: false,
        error: `Excel 欄位缺失！必須包含「專題名稱」與「組長學號」欄位。\n目前辨識到的欄位有：${Object.keys(sampleRow).join(', ')}`
      };
    }

    if (rawRows.length > 2000) return { success: false, error: '名冊最多 2000 筆，請縮小檔案後再匯入。' };
    const projects: ProjectItem[] = [];

    rawRows.forEach((row, index) => {
      const title = String(row[titleKey || ''] || '').trim();
      const leaderId = String(row[leaderKey || ''] || '').trim();

      // Skip completely empty rows
      if (!title && !leaderId) return;

      const seqNo = seqKey && row[seqKey] ? String(row[seqKey]).trim() : String(index + 1);
      const eduSys = eduKey && row[eduKey] ? String(row[eduKey]).trim() : '日間部四技';
      const dept = deptKey && row[deptKey] ? String(row[deptKey]).trim() : '資訊系所';
      const className = classKey && row[classKey] ? String(row[classKey]).trim() : '四年甲班';
      const advisor = advisorKey && row[advisorKey] ? String(row[advisorKey]).trim() : '指導教授群';
      const field = fieldKey && row[fieldKey] ? String(row[fieldKey]).trim() : '綜合領域';
      const originalCode = codeKey && row[codeKey] ? String(row[codeKey]).trim() : `PRJ-${String(index + 1).padStart(2, '0')}`;
      const rawDrawCode = drawCodeKey ? String(row[drawCodeKey] ?? '').trim() : '';
      const drawCodeVal = !rawDrawCode || ['未抽籤', '待抽籤', '待分配', '編號未設定', '—', '-'].includes(rawDrawCode) ? null : rawDrawCode;
      const sessions = sessionKeys.map(key => parseImportedSession(row[key], index + 2)).filter((session): session is number => session !== null);
      if (new Set(sessions).size > 1) throw new Error(`第 ${index + 2} 列的場次欄位不一致，請確認分組場次、場次、報告場次或組別的值。`);
      const parsedPassword = passwordKey && row[passwordKey] ? String(row[passwordKey]).trim() : '';
      const password = parsedPassword;
      if (password && (password.length < 8 || password.length > 128 || password === leaderId)) throw new Error(`第 ${index + 2} 列密碼須為 8 至 128 字元且不可使用學號。`);

      projects.push({
        id: `imported-${Date.now()}-${index + 1}`,
        seq_no: seqNo,
        education_system: eduSys,
        department: dept,
        class_name: className,
        advisor: advisor,
        field: field,
        original_code: originalCode,
        project_title: title,
        leader_id: leaderId,
        leader_name: leaderNameKey ? String(row[leaderNameKey] || '').trim() : '',
        password: password,
        assigned_group: sessions[0] ?? null,
        draw_code: drawCodeVal || null,
        draw_time: drawCodeVal ? new Date().toISOString() : null,
      });
    });

    if (projects.length === 0) {
      return { success: false, error: '未成功讀取到有效專題資料列' };
    }

    const duplicate = duplicateDrawCodeError(projects);
    if (duplicate) throw new Error(duplicate);

    return {
      success: true,
      projects: normalizeOriginalCodes(projects, configs),
      rowCount: projects.length,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Excel 檔案解析失敗：${errorMsg}`,
    };
  }
}

/**
 * Export projects to Excel with exact columns:
 * 序號 學制 系所 班級 指導老師 領域 編號 專題名稱 組長學號 組長姓名 編號(抽籤後) 場次
 */
export function createExportWorkbook(projects: ProjectItem[]): XLSX.WorkBook {
  // Export by drawn identifier (A01, A02, ... A100, B01); undrawn rows go last.
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  const sortedProjects = [...projects].sort((a, b) => {
    const left = a.draw_code?.trim() || '';
    const right = b.draw_code?.trim() || '';
    if (!!left !== !!right) return left ? -1 : 1;
    return collator.compare(left, right)
      || collator.compare(a.original_code, b.original_code)
      || collator.compare(a.seq_no, b.seq_no);
  });

  const rows = sortedProjects.map((p) => {
    return {
      '序號': p.seq_no,
      '學制': p.education_system,
      '系所': p.department,
      '班級': p.class_name,
      '指導老師': p.advisor,
      '領域': p.field,
      '編號': p.original_code,
      '專題名稱': p.project_title,
      '組長學號': p.leader_id,
      '組長姓名': p.leader_name || '',
      '編號(抽籤後)': p.draw_code || (p.assigned_group ? '編號未設定' : '未抽籤'),
      '場次': p.assigned_group ? formatSessionLabel(p.assigned_group) : (p.draw_code ? '場次尚未提供' : '未抽籤'),
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows, { header: REQUIRED_OUTPUT_HEADERS });

  // Set column widths for better readability
  worksheet['!cols'] = [
    { wch: 8 },  // 序號
    { wch: 12 }, // 學制
    { wch: 16 }, // 系所
    { wch: 12 }, // 班級
    { wch: 15 }, // 指導老師
    { wch: 22 }, // 領域
    { wch: 12 }, // 編號
    { wch: 45 }, // 專題名稱
    { wch: 14 }, // 組長學號
    { wch: 14 }, // 組長姓名
    { wch: 18 }, // 編號(抽籤後)
    { wch: 18 }, // 場次
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '專題抽籤順序表');

  return workbook;
}

export function exportToExcel(projects: ProjectItem[], filenamePrefix = '台中科技大學專題展報告抽籤結果'): void {
  const workbook = createExportWorkbook(projects);
  const nowStr = new Date().toISOString().slice(0, 10);
  const fullFileName = `${filenamePrefix}_${nowStr}.xlsx`;
  XLSX.writeFile(workbook, fullFileName);
}

/**
 * Generate and download an empty or template input Excel file
 */
export function createInputTemplateWorkbook(): XLSX.WorkBook {
  const templateRows = [
    {
      '序號': '1',
      '學制': '日間部四技',
      '系所': '資訊管理系',
      '班級': '資管四甲',
      '指導老師': '王教授',
      '領域': '智慧運算創新應用',
      '編號': 'E01',
      '專題名稱': '基於生成式AI之智慧排程平台',
      '組長學號': '110214101',
      '組長姓名': '王小明',
      '組長密碼': '',
    },
    {
      '序號': '2',
      '學制': '日間部四技',
      '系所': '資訊工程系',
      '班級': '資工四乙',
      '指導老師': '李副教授',
      '領域': '企業智慧化',
      '編號': 'A01',
      '專題名稱': '智慧倉儲即時物聯網監控與調度系統',
      '組長學號': '110211102',
      '組長姓名': '陳小華',
      '組長密碼': '',
    }
  ];

  const ws = XLSX.utils.json_to_sheet(templateRows, { header: REQUIRED_INPUT_HEADERS });
  ws['!cols'] = [
    { wch: 8 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 15 },
    { wch: 20 }, { wch: 12 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 12 }
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '專題匯入範本');
  return wb;
}

export function downloadInputTemplate(): void {
  XLSX.writeFile(createInputTemplateWorkbook(), '台中科技大學專題名冊匯入範本.xlsx');
}
