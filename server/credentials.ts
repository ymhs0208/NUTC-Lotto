import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import type { ProjectItem } from '../src/types';
import { ApiError } from './errors';
import { SharedPasswordVerifier } from './sharedPasswordVerifier';
import { BoundedExecutor } from './resourceLimits';

export type StoredProject = ProjectItem & { password_hash?: string; shared_password_mode?: boolean };
const COST = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const HASH_FORMAT = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{64})$/;
// Shared by every API object in this isolate, including login and admin resets.
const hashExecutor = new BoundedExecutor(1, 32, 8000);
const derive = (password: string, salt: string) => hashExecutor.run(() => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 32, COST, (error, result) => error ? reject(error) : resolve(result));
}));

export function validatePassword(password: string, leaderId: string): void {
  if (password.trim().length < 8 || password.length > 128 || password === leaderId || password === leaderId.slice(-4)) {
    throw new ApiError(400, '學生密碼須為 8 至 128 字元，不可使用學號或學號後四碼。');
  }
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `scrypt-v1$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded?: string): Promise<boolean> {
  const match = typeof encoded === 'string' ? encoded.match(HASH_FORMAT) : null;
  // Also derive for unknown accounts, avoiding a cheap timing distinction.
  const actual = await derive(password, match?.[1] || '0'.repeat(32));
  return !!match && timingSafeEqual(actual, Buffer.from(match[2], 'hex'));
}
const sharedVerifier = new SharedPasswordVerifier(verifyPassword);
export function invalidateSharedPasswordVerification(): void { sharedVerifier.invalidate(); }
export function verifyStudentPassword(password: string, project?: StoredProject): Promise<boolean> {
  const encoded = project?.password ? undefined : project?.password_hash;
  if (project?.shared_password_mode === true && encoded && HASH_FORMAT.test(encoded)) {
    return sharedVerifier.verify(password, encoded);
  }
  return verifyPassword(password, encoded);
}

export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Explicit allowlist: no password, hash, arbitrary Excel columns or future private fields in DTOs.
export function projectDto(p: ProjectItem): ProjectItem {
  return {
    id: p.id, seq_no: p.seq_no, education_system: p.education_system, department: p.department,
    class_name: p.class_name, advisor: p.advisor, field: p.field, original_code: p.original_code,
    project_title: p.project_title, leader_id: p.leader_id,
    ...(typeof p.leader_name === 'string' ? { leader_name: p.leader_name.trim() } : {}),
    assigned_group: p.assigned_group ?? null, draw_order: p.draw_order ?? null,
    draw_code: p.draw_code ?? null, draw_time: p.draw_time ?? null, evaluators: p.evaluators || [],
  };
}

// The stage needs only the presentation order and title, never the student roster.
export function stageProjectDto(p: ProjectItem) {
  return {
    id: p.id, field: p.field, project_title: p.project_title,
    assigned_group: p.assigned_group ?? null, draw_order: p.draw_order ?? null,
    draw_code: p.draw_code ?? null,
  };
}

export function studentProjectDto(p: ProjectItem): ProjectItem {
  return {
    ...projectDto(p),
    seq_no: '', education_system: '', department: '', class_name: '', advisor: '',
  };
}

export function publicStudentProjectDto(p: ProjectItem): ProjectItem {
  const drawn = !!p.draw_order;
  return {
    id: '', seq_no: '', education_system: '', department: '', class_name: '', advisor: '',
    field: drawn ? p.field : '', original_code: drawn ? p.original_code : '',
    project_title: p.project_title, leader_id: p.leader_id, assigned_group: drawn ? p.assigned_group ?? null : null,
    draw_order: drawn ? p.draw_order ?? null : null, draw_code: drawn ? p.draw_code ?? null : null,
    draw_time: null, evaluators: [],
  };
}

export function sharedPasswordHash(projects: StoredProject[]): string | undefined {
  const shared = projects.filter(p => p.shared_password_mode === true);
  if (!shared.length) return undefined;
  const hash = shared[0].password_hash;
  if (shared.length !== projects.length || !hash || !HASH_FORMAT.test(hash) || projects.some(p => p.password_hash !== hash || p.password)) {
    throw new ApiError(503, '共用密碼設定不一致，請聯絡管理員。');
  }
  return hash;
}

// Existing plaintext credentials are considered compromised and must be reset.
export function removeLegacyCredentials(projects: StoredProject[]): StoredProject[] {
  return projects.map(p => ({
    ...projectDto(p),
    ...(!p.password && typeof p.password_hash === 'string' && HASH_FORMAT.test(p.password_hash) ? {
      password_hash: p.password_hash,
      ...(p.shared_password_mode === true ? { shared_password_mode: true } : {}),
    } : {}),
  }));
}

export async function prepareProjects(input: ProjectItem[], existing: StoredProject[]): Promise<StoredProject[]> {
  const sharedHash = sharedPasswordHash(existing);
  if (sharedHash && input.some(p => p.password)) throw new ApiError(400, '共用密碼啟用中，無法設定個別學生密碼。');
  const oldById = new Map(removeLegacyCredentials(existing).map(p => [p.id, p]));
  // Validate the whole batch before spending CPU on password hashing.
  for (const p of input) if (p.password) validatePassword(p.password, p.leader_id);
  const result: StoredProject[] = [];
  for (const p of input) {
    if (sharedHash) {
      result.push({ ...projectDto(p), password_hash: sharedHash, shared_password_mode: true });
      continue;
    }
    const old = oldById.get(p.id);
    const hash = p.password ? await hashPassword(p.password)
      : old?.leader_id === p.leader_id ? old.password_hash : undefined;
    result.push({ ...projectDto(p), ...(hash ? { password_hash: hash } : {}) });
  }
  return result;
}
