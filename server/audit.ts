import { ApiError } from './errors';
import { auditActionLabels, type AuditAction } from '../src/lib/auditTypes';
export interface AuditActor { userId: string; email: string; role: 'admin' | 'stage' }
export interface AuditEvent { actor: AuditActor; action: AuditAction; details: { fields?: string[]; project_count?: number; version?: number; summary?: string } }
export function auditQuery(query: Record<string, unknown>, now = Date.now()) {
  for (const value of Object.values(query)) if (typeof value !== 'string') throw new ApiError(400, '篩選格式不正確。');
  const q = String(query.q || '').trim();
  const action = String(query.action || ''); const role = String(query.role || '');
  const from = query.from ? Date.parse(String(query.from)) : now - 30 * 86400000;
  const to = query.to ? Date.parse(String(query.to)) : now;
  const before = String(query.before || '');
  if (q.length > 128 || /[\x00-\x1f]/.test(q) || (action && !Object.hasOwn(auditActionLabels, action)) ||
    (role && !['admin','stage'].includes(role)) || !Number.isFinite(from) || !Number.isFinite(to) ||
    from > to || to - from > 366 * 86400000 || (before && !/^[1-9]\d{0,18}$/.test(before))) {
    throw new ApiError(400, '請確認搜尋、操作類型與日期範圍，日期範圍最多一年。');
  }
  return { q: q.replace(/[\\%_]/g, '\\$&'), action, role, from: new Date(from).toISOString(), to: new Date(to).toISOString(), before };
}
