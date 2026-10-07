import { runtimeEnv } from './runtime';
import type { DomainConfig, ProjectItem, PublicResultsResponse } from '../src/types';
import type { StoredProject } from './credentials';
import type { StaffAccount, StaffSession, StudentSession } from './cloudflareDatabase';
import { normalizeProfessorName } from '../src/lib/lottery';
import { LotteryAllocationError, validateGroupCapacities } from '../src/lib/groupCapacities';
import { ApiError } from './errors';
import { getDomainCode } from '../src/lib/domainCodes';
import type { StaffAuditInput, StaffLogPage } from '../src/types/staffLogs';
export { ApiError } from './errors';

export interface DatabaseState {
  projects: StoredProject[];
  domainConfigs: DomainConfig[];
  version: number;
  lastUpdated: string;
}

export function createStore() {
  const namespace = runtimeEnv().LOTTERY_DATABASE;
  if (!namespace) throw new ApiError(503, '尚未設定 Cloudflare 資料庫，請使用 npm run dev。');
  const database = namespace.get(namespace.idFromName('lottery-v1'));
  async function call<T>(operation: string, args: object = {}): Promise<T> {
    try {
      const response = await database.fetch('https://database.internal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, args }), signal: AbortSignal.timeout(10000) as unknown as import('@cloudflare/workers-types').AbortSignal,
      });
      const result = await response.json() as { data: T; error?: string };
      if (!response.ok) throw new ApiError(response.status, result.error || '資料庫暫時無法使用。');
      return result.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, '資料庫暫時無法使用。');
    }
  }
  return {
    publicResults: (field: string) => call<PublicResultsResponse>('publicResults', { field }),
    load: () => call<DatabaseState>('load'),
    health: async () => { if (!await call<boolean>('health')) throw new ApiError(503, '資料庫暫時無法使用。'); },
    findProject: (key: 'id' | 'leader_key', value: string) => call<StoredProject | null>('findProject', { key, value }),
    save: (state: DatabaseState, expectedVersion: number, audit?: StaffAuditInput) => call<DatabaseState>('save', { state, expectedVersion, audit }),
    staffLogs: (filters: { before?: number; action?: string; email?: string }) => call<StaffLogPage>('staffLogs', filters),
    findAccount: (key: 'id' | 'email', value: string) => call<StaffAccount | null>('findAccount', { key, value }),
    putAccounts: (accounts: StaffAccount[]) => call<{ count: number }>('accounts', { accounts }),
    putSession: (scope: 'student' | 'staff', tokenHash: string, session: StudentSession | StaffSession) => call<boolean>('putSession', { scope, tokenHash, session }),
    deleteSession: (scope: 'student' | 'staff', tokenHash: string, auditLogout = true) => call<boolean>('deleteSession', { scope, tokenHash, auditLogout }),
    getStaffSession: (tokenHash: string) => call<StaffSession | null>('getSession', { scope: 'staff', tokenHash }),
    studentLookup: (tokenHash: string) => call<{ project: StoredProject; credential_version: string } | null>('studentLookup', { tokenHash }),
  };
}

export function validateProjects(value: unknown): asserts value is ProjectItem[] {
  if (!Array.isArray(value)) throw new ApiError(400, '專題名冊必須為陣列。');
  if (value.length > 2000) throw new ApiError(400, '專題名冊最多 2000 筆。');
  const ids = new Set<string>();
  const leaders = new Set<string>();
  const textFields = ['id', 'seq_no', 'education_system', 'department', 'class_name', 'advisor', 'field', 'original_code', 'project_title', 'leader_id'];
  for (const p of value) {
    if (!p || typeof p !== 'object' || 'password_hash' in p || 'shared_password_mode' in p || textFields.some(key => typeof p[key] !== 'string') || !p.id.trim() || !p.project_title.trim() || !p.leader_id.trim() || ids.has(p.id)) {
      throw new ApiError(400, '專題欄位不完整或 ID 重複。');
    }
    if (textFields.some(key => p[key].length > (key === 'project_title' ? 2000 : key === 'leader_id' ? 128 : 512))) throw new ApiError(400, '專題文字欄位過長。');
    for (const key of ['draw_order', 'assigned_group']) {
      if (p[key] != null && (!Number.isInteger(p[key]) || p[key] < 1)) throw new ApiError(400, '抽籤順位與組別必須為正整數。');
    }
    if (p.password != null && typeof p.password !== 'string') throw new ApiError(400, '密碼格式不正確。');
    if (p.draw_time != null && (typeof p.draw_time !== 'string' || Number.isNaN(Date.parse(p.draw_time)))) throw new ApiError(400, '抽籤時間格式不正確。');
    if (p.draw_code != null && (typeof p.draw_code !== 'string' || p.draw_code.length > 512)) throw new ApiError(400, '抽籤編號格式不正確。');
    if (p.evaluators != null && (!Array.isArray(p.evaluators) || p.evaluators.length > 100 || p.evaluators.some((x: unknown) => typeof x !== 'string' || x.length > 128))) throw new ApiError(400, '評審格式不正確。');
    const leader = p.leader_id.trim().toLowerCase();
    if (leaders.has(leader)) throw new ApiError(400, '組長學號不得重複。');
    leaders.add(leader);
    ids.add(p.id);
  }
}

export function validateDomains(value: unknown): asserts value is DomainConfig[] {
  if (!Array.isArray(value)) throw new ApiError(400, '領域設定必須為陣列。');
  if (value.length > 100) throw new ApiError(400, '領域設定最多 100 筆。');
  const ids = new Set<string>();
  const fields = new Set<string>();
  const prefixes = new Set<string>();
  for (const c of value) {
    if (!c || typeof c.id !== 'string' || !c.id.trim() || typeof c.field !== 'string' || !c.field.trim() || c.id.length > 512 || c.field.length > 512 || ids.has(c.id) || fields.has(c.field) || !Number.isInteger(c.groupCount) || c.groupCount < 1 || c.groupCount > 50) throw new ApiError(400, '領域 ID、名稱不得重複，組數須為 1 至 50。');
    if (c.drawPrefix !== undefined && (typeof c.drawPrefix !== 'string' || !/^[A-Z]$/.test(c.drawPrefix))) throw new ApiError(400, '抽籤結果字母須為 A 至 Z 的單一大寫英文字母。');
    const prefix = getDomainCode(c.field, c.drawPrefix);
    if (prefix && prefixes.has(prefix)) throw new ApiError(400, `抽籤結果字母 ${prefix} 重複，請為各領域設定不同字母。`);
    if (prefix) prefixes.add(prefix);
    if (c.groupCapacities !== undefined) {
      try { validateGroupCapacities(c.groupCapacities, c.groupCount, c.field); }
      catch (error) {
        if (error instanceof LotteryAllocationError) throw new ApiError(400, error.message);
        throw error;
      }
    }
    if (c.evaluatorsPerGroup != null && (typeof c.evaluatorsPerGroup !== 'object' || Array.isArray(c.evaluatorsPerGroup))) throw new ApiError(400, '評審設定格式不正確。');
    for (const [group, names] of Object.entries(c.evaluatorsPerGroup || {})) {
      if (!/^[1-9]\d*$/.test(group) || Number(group) > c.groupCount) {
        throw new ApiError(400, `「${c.field}」僅設定 ${c.groupCount} 組，評審名單包含無效組別，請重新確認。`);
      }
      if (!Array.isArray(names) || names.length > 100 || names.some(name => typeof name !== 'string' || name.length > 128)) throw new ApiError(400, '評審設定格式不正確。');
      if (Array.isArray(names) && names.some((name: string) => !normalizeProfessorName(name))) {
        throw new ApiError(400, `「${c.field}」第 ${group} 組的評審姓名不可空白或僅有職稱，請填寫完整姓名。`);
      }
    }
    ids.add(c.id); fields.add(c.field);
  }
}
