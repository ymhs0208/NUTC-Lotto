export const auditActionLabels = {
  roster: '儲存專題名冊', domains: '修改領域設定', login: '成功登入', logout: '成功登出', shared_password_generate: '產生共用密碼',
  shared_password_clear: '停用共用密碼', staff_account_update: '更新工作人員帳號', data_import: '移轉資料', draw: '抽籤', reset: '重設抽籤結果',
} as const;
export type AuditAction = keyof typeof auditActionLabels;
export interface AuditRow {
  id: number | string; occurred_at: string; actor_email: string; actor_role: 'admin' | 'stage';
  action: AuditAction; details: { fields?: string[]; project_count?: number; version?: number; summary?: string };
}
