export const staffActions = {
  login: '登入', logout: '登出', roster: '儲存專題名冊', domains: '修改領域設定',
  password_generate: '產生學生共用密碼', password_clear: '清除學生共用密碼',
  draw: '執行抽籤', reset: '重設抽籤',
} as const;
export type StaffAction = keyof typeof staffActions;
export interface StaffAuditInput { actorId: string; action: StaffAction; summary: string }
export interface StaffLog {
  id: number; created_at: string; email: string; role: 'admin' | 'stage';
  action: StaffAction; summary: string; version: number | null;
}
export interface StaffLogPage { logs: StaffLog[]; nextCursor: number | null }
