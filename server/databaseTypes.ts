import type { DatabaseState } from './store';
import type { StoredProject } from './credentials';
import type { AuditActor, AuditEvent, auditQuery } from './audit';
import type { AuditRow } from '../src/lib/auditTypes';
import type { PublicResultsResponse } from '../src/types';

export interface StaffAccount { id: string; email: string; role: 'admin' | 'stage'; password_hash: string; disabled: number; credential_version: number }
export type StaffProfile = Pick<StaffAccount, 'id' | 'email' | 'role'> & { created_at: string; expires_at: number };
export type AuditFilters = ReturnType<typeof auditQuery>;
export interface DatabaseCommands {
  health: { args: Record<string, never>; result: boolean };
  load: { args: Record<string, never>; result: DatabaseState };
  save: { args: { state: DatabaseState; expectedVersion: number; audit?: AuditEvent; actor?: AuditActor }; result: DatabaseState };
  publicResults: { args: { field: string }; result: PublicResultsResponse };
  findProject: { args: { key: 'id' | 'leader_key'; value: string }; result: StoredProject | null };
  findStaff: { args: { email: string }; result: StaffAccount | null };
  startStaffSession: { args: { accountId: string; passwordHash: string; credentialVersion: number; tokenHash: string; oldTokenHash: string | null }; result: StaffProfile };
  staffSession: { args: { tokenHash: string }; result: StaffProfile | null };
  endStaffSession: { args: { tokenHash: string }; result: boolean };
  startStudentSession: { args: { project: StoredProject; tokenHash: string; oldTokenHash: string | null }; result: StoredProject };
  studentSession: { args: { tokenHash: string }; result: StoredProject | null };
  endStudentSession: { args: { tokenHash: string }; result: boolean };
  audit: { args: AuditFilters; result: { records: AuditRow[]; nextCursor: string | null } };
  cleanupSessions: { args: Record<string, never>; result: { ntcust_student_sessions: number; ntcust_staff_sessions: number } };
  cleanupAudit: { args: Record<string, never>; result: { enabled: true; deleted: number } };
  staffAccounts: { args: { actor: AuditActor }; result: Array<Pick<StaffAccount, 'id' | 'email' | 'role' | 'disabled'>> };
  setStaffAccount: { args: { actor: AuditActor; email: string; role: 'admin' | 'stage'; passwordHash?: string; disabled: boolean }; result: boolean };
  importState: { args: { actor: AuditActor; state: DatabaseState }; result: DatabaseState };
}
export interface DatabaseGateway {
  call<K extends keyof DatabaseCommands>(command: K, args: DatabaseCommands[K]['args']): Promise<DatabaseCommands[K]['result']>;
}
