import { duplicateDrawCodeError } from '../src/lib/drawScope';
import { database } from './database';
import type { DomainConfig, ProjectItem } from '../src/types';
import { removeLegacyCredentials, type StoredProject } from './credentials';
import { normalizeOriginalCodes } from '../src/lib/originalCodes';
import { domainCodeCollisionError, sortDomainConfigs } from '../src/lib/domainCodes';
import { normalizeProfessorName } from '../src/lib/lottery';
import { LotteryAllocationError, validateGroupCapacities } from '../src/lib/groupCapacities';
import { ApiError } from './errors';
import type { AuditEvent, AuditActor } from './audit';
export { ApiError } from './errors';

// Drop the retired key when reading databases that have not migrated yet.
function stripLegacyDrawOrder<T extends ProjectItem>(project: T): T {
  const { draw_order: retired, ...current } = project as T & { draw_order?: unknown };
  return current as T;
}

export interface DatabaseState {
  projects: StoredProject[];
  domainConfigs: DomainConfig[];
  version: number;
  lastUpdated: string;
}

export function createStore() {
  const db = database();
  return {
    async load(): Promise<DatabaseState> {
      const state = await db.call('load', {});
      return { ...state, projects: normalizeOriginalCodes(state.projects.map(stripLegacyDrawOrder), state.domainConfigs), domainConfigs: sortDomainConfigs(state.domainConfigs) };
    },
    publicResults: (field = '') => db.call('publicResults', { field }),
    async health() { await db.call('health', {}); },
    async findProject(key: 'id' | 'leader_key', value: string): Promise<StoredProject | undefined> {
      return (await db.call('findProject', { key, value })) || undefined;
    },
    async save(state: DatabaseState, expectedVersion: number, audit?: AuditEvent, actor?: AuditActor): Promise<DatabaseState> {
      const domainConfigs = sortDomainConfigs(state.domainConfigs);
      const projects = normalizeOriginalCodes(removeLegacyCredentials(state.projects), domainConfigs);
      return db.call('save', { state: { ...state, projects, domainConfigs }, expectedVersion, audit, actor });
    },
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
    if (p.assigned_group != null && (!Number.isSafeInteger(p.assigned_group) || p.assigned_group < 1)) throw new ApiError(400, '場次必須為正整數。');
    if (p.password != null && typeof p.password !== 'string') throw new ApiError(400, '密碼格式不正確。');
    if (p.leader_name != null && (typeof p.leader_name !== 'string' || p.leader_name.length > 128)) throw new ApiError(400, '組長姓名須為 128 字元以內的文字。');
    if (p.draw_time != null && (typeof p.draw_time !== 'string' || Number.isNaN(Date.parse(p.draw_time)))) throw new ApiError(400, '抽籤時間格式不正確。');
    if (p.draw_code != null && (typeof p.draw_code !== 'string' || p.draw_code.length > 512)) throw new ApiError(400, '抽籤編號格式不正確。');
    if (p.evaluators != null && (!Array.isArray(p.evaluators) || p.evaluators.length > 100 || p.evaluators.some((x: unknown) => typeof x !== 'string' || x.length > 128))) throw new ApiError(400, '評審格式不正確。');
    const leader = p.leader_id.trim().toLowerCase();
    if (leaders.has(leader)) throw new ApiError(400, '組長學號不得重複。');
    leaders.add(leader);
    ids.add(p.id);
  }
  const duplicate = duplicateDrawCodeError(value);
  if (duplicate) throw new ApiError(400, duplicate);
}

export function validateDomains(value: unknown): asserts value is DomainConfig[] {
  if (!Array.isArray(value)) throw new ApiError(400, '領域設定必須為陣列。');
  if (value.length > 100) throw new ApiError(400, '領域設定最多 100 筆。');
  const ids = new Set<string>();
  const fields = new Set<string>();
  for (const c of value) {
    if (!c || typeof c.id !== 'string' || !c.id.trim() || typeof c.field !== 'string' || !c.field.trim() || c.id.length > 512 || c.field.length > 512 || ids.has(c.id) || fields.has(c.field) || !Number.isInteger(c.groupCount) || c.groupCount < 1 || c.groupCount > 50) throw new ApiError(400, '領域 ID、名稱不得重複，組數須為 1 至 50。');
    if (c.code !== undefined && (typeof c.code !== 'string' || !/^[A-Z]$/.test(c.code))) throw new ApiError(400, '領域對應字母須為 A 至 Z 的單一大寫英文字母。');
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
  const collision = domainCodeCollisionError(fields, value);
  if (collision) throw new ApiError(400, collision);
}
