export interface ProjectItem {
  id: string; // 唯一識別碼
  seq_no: string; // 序號 (Excel 欄位)
  education_system: string; // 學制 (四技/二技/碩士/進修部)
  department: string; // 系所 (資訊管理系/資訊工程系...)
  class_name: string; // 班級 (資管四甲...)
  advisor: string; // 指導老師
  field: string; // 領域 (企業智慧化/嵌入式系統與行動計算...)
  original_code: string; // 原始編號 e.g. A01，依領域自動編號
  project_title: string; // 專題名稱
  leader_id: string; // 組長學號
  password?: string; // 僅供設定新密碼的輸入，API 不回傳
  password_set?: boolean; // 管理員可查看是否已設定密碼
  
  // 抽籤產生的結果
  assigned_group?: number | null; // 分組場次/組別 (第 1 組、第 2 組...)
  draw_order?: number | null; // 組內報告順序 (1, 2, 3...)
  draw_code?: string | null; // 抽籤後編號 e.g. "A01"，領域內跨組連續編號
  draw_time?: string | null; // 抽籤時間戳記
  evaluators?: string[]; // 負責評分的教授名單 (符合利益迴避)
}

export interface DomainStats {
  field: string;
  count: number; // 計數 - 專題名稱
  groupCount: number; // 組數
}

export interface DomainConfig {
  id: string;
  field: string;
  drawPrefix?: string; // 自訂抽籤結果英文字母；未設定沿用領域預設值
  groupCount: number; // 評審分組組數
  groupCapacities?: Record<number, number>; // 指定各組專題件數；未設定沿用自動分組
  evaluatorsPerGroup?: Record<number, string[]>; // 每一個分組 (1..N) 的評分教授清單
}

export type ViewMode = 'student' | 'stage' | 'admin' | 'logs' | 'results';

// Explicit public result contract; no student or staff credentials.
export interface PublicDrawResult {
  leader_name?: string; // 未提供姓名時，結果頁沿用參考版的空值顯示
  draw_code: string;
  assigned_group: number | null;
  project_title: string;
}

export interface PublicResultsResponse {
  domains: string[];
  results: PublicDrawResult[];
  version?: number;
}
