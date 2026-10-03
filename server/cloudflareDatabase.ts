import type { DurableObjectState } from '@cloudflare/workers-types';
import type { DatabaseState, PublicResult } from './store';
import type { StoredProject } from './credentials';
import { normalizeOriginalCodes } from '../src/lib/originalCodes';
import { removeLegacyCredentials, projectDto, sharedPasswordHash } from './credentials';
import { validateDomains, validateProjects } from './store';
import { ApiError } from './errors';

export interface StaffAccount {
  id: string;
  email: string;
  role: 'admin' | 'stage';
  password_hash: string;
}
export interface StaffSession {
  user_id: string;
  credential_version: string;
  expires_at: string;
  created_at: string;
}
export interface StudentSession {
  project_id: string;
  credential_version: string;
  expires_at: string;
}
type Session = StaffSession | StudentSession;

// A single SQLite object owns state, accounts and sessions. API hashing stays sharded.
export class LotteryDatabase {
  constructor(private ctx: DurableObjectState) {
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS metadata (id INTEGER PRIMARY KEY CHECK(id = 1), domains TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, leader_key TEXT NOT NULL UNIQUE, position INTEGER NOT NULL, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (scope TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, document TEXT NOT NULL, PRIMARY KEY(scope, token_hash));
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    `);
    ctx.storage.sql.exec('INSERT OR IGNORE INTO metadata VALUES (1, ?, 0, ?)', JSON.stringify(defaultDomains), new Date().toISOString());
  }

  private one<T>(sql: string, ...bindings: (string | number)[]): T | undefined {
    return this.ctx.storage.sql.exec(sql, ...bindings).toArray()[0] as T | undefined;
  }
  private document<T>(sql: string, ...bindings: (string | number)[]): T | undefined {
    const row = this.one<{ document: string }>(sql, ...bindings);
    return row ? JSON.parse(row.document) : undefined;
  }
  private load(): DatabaseState {
    const metadata = this.one<{ domains: string; version: number; updated_at: string }>('SELECT * FROM metadata WHERE id = 1')!;
    const projects = this.ctx.storage.sql.exec('SELECT document FROM projects ORDER BY position').toArray().map(row => JSON.parse(String(row.document)) as StoredProject);
    return { projects: normalizeOriginalCodes(projects), domainConfigs: JSON.parse(metadata.domains), version: metadata.version, lastUpdated: metadata.updated_at };
  }
  private save(state: DatabaseState, expectedVersion: number): DatabaseState {
    validateDomains(state.domainConfigs);
    validateProjects(state.projects.map(projectDto));
    const projects = normalizeOriginalCodes(removeLegacyCredentials(state.projects));
    sharedPasswordHash(projects);
    return this.ctx.storage.transactionSync(() => {
      const current = this.one<{ version: number }>('SELECT version FROM metadata WHERE id = 1')!;
      if (current.version !== expectedVersion) {
        throw new ApiError(409, '資料已由其他人更新，請重新整理後再操作。');
      }
      // Delete/reinsert inside the transaction permits swapping unique student IDs.
      this.ctx.storage.sql.exec('DELETE FROM projects');
      projects.forEach((p, position) => this.ctx.storage.sql.exec('INSERT INTO projects VALUES (?, ?, ?, ?)', p.id, p.leader_id.trim().toLowerCase(), position, JSON.stringify(p)));
      const version = current.version + 1;
      const lastUpdated = new Date().toISOString();
      this.ctx.storage.sql.exec('UPDATE metadata SET domains = ?, version = ?, updated_at = ? WHERE id = 1', JSON.stringify(state.domainConfigs), version, lastUpdated);
      return { projects, domainConfigs: state.domainConfigs, version, lastUpdated };
    });
  }

  async fetch(request: Request): Promise<Response> {
    // This object is reachable only through its Worker binding, never a public URL.
    try {
      const { operation, args = {} } = await request.json() as { operation: string; args: any };
      let data: unknown;
      switch (operation) {
        case 'health': data = !!this.one('SELECT id FROM metadata WHERE id = 1'); break;
        case 'load': data = this.load(); break;
        case 'save': data = this.save(args.state, args.expectedVersion); break;
        case 'publicResults': {
          data = this.ctx.storage.sql.exec(`SELECT json_extract(document, '$.field') AS field, json_extract(document, '$.original_code') AS original_code, json_extract(document, '$.assigned_group') AS assigned_group, json_extract(document, '$.draw_order') AS draw_order, json_extract(document, '$.draw_code') AS draw_code FROM projects WHERE json_extract(document, '$.draw_order') IS NOT NULL ORDER BY position`).toArray() as unknown as PublicResult[];
          break;
        }
        case 'findProject': {
          if (args.key !== 'id' && args.key !== 'leader_key') throw new ApiError(400, '無效查詢。');
          data = this.document(`SELECT document FROM projects WHERE ${args.key} = ?`, args.value); break;
        }
        case 'findAccount': {
          if (args.key !== 'id' && args.key !== 'email') throw new ApiError(400, '無效查詢。');
          data = this.document(`SELECT document FROM accounts WHERE ${args.key} = ?`, args.value); break;
        }
        case 'accounts': {
          const accounts = args.accounts as StaffAccount[];
          if (!Array.isArray(accounts) || accounts.length < 1 || accounts.length > 100 || accounts.some(a => !a || typeof a.id !== 'string' || !a.id || a.id.length > 512 || typeof a.email !== 'string' || a.email.length > 256 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email) || a.email !== a.email.trim().toLowerCase() || !['admin', 'stage'].includes(a.role) || !/^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(a.password_hash)) || new Set(accounts.map(a => a.email)).size !== accounts.length) throw new ApiError(400, '工作人員帳號格式不正確。');
          this.ctx.storage.transactionSync(() => accounts.forEach(a => {
            const old = this.document<StaffAccount>('SELECT document FROM accounts WHERE email = ?', a.email);
            const account = { ...a, id: old?.id || a.id };
            this.ctx.storage.sql.exec('INSERT INTO accounts VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET document = excluded.document', account.id, account.email, JSON.stringify(account));
          }));
          data = { count: accounts.length }; break;
        }
        case 'putSession': {
          const session = args.session as Session;
          this.ctx.storage.sql.exec('INSERT INTO sessions VALUES (?, ?, ?, ?)', args.scope, args.tokenHash, session.expires_at, JSON.stringify(session));
          if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 60 * 60 * 1000);
          data = true; break;
        }
        case 'deleteSession': this.ctx.storage.sql.exec('DELETE FROM sessions WHERE scope = ? AND token_hash = ?', args.scope, args.tokenHash); data = true; break;
        case 'getSession': data = this.document('SELECT document FROM sessions WHERE scope = ? AND token_hash = ? AND expires_at > ?', args.scope, args.tokenHash, new Date().toISOString()); break;
        case 'studentLookup': {
          const row = this.one<{ document: string; credential_version: string }>(`SELECT p.document, json_extract(s.document, '$.credential_version') AS credential_version FROM sessions s JOIN projects p ON p.id = json_extract(s.document, '$.project_id') WHERE s.scope = 'student' AND s.token_hash = ? AND s.expires_at > ?`, args.tokenHash, new Date().toISOString());
          data = row ? { project: JSON.parse(row.document), credential_version: row.credential_version } : null; break;
        }
        default: throw new ApiError(400, '無效資料庫操作。');
      }
      return Response.json({ data: data ?? null });
    } catch (error) {
      return Response.json({ error: error instanceof ApiError && error.status < 500 ? error.message : '資料庫暫時無法使用。' }, { status: error instanceof ApiError ? error.status : 503 });
    }
  }
  async alarm() {
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE expires_at <= ?', new Date().toISOString());
    if (this.one('SELECT token_hash FROM sessions LIMIT 1')) await this.ctx.storage.setAlarm(Date.now() + 60 * 60 * 1000);
  }
}

const defaultDomains = [
  ['企業智慧化', 2], ['嵌入式系統與行動計算', 2], ['智慧流通應用與研究', 2],
  ['智慧運算創新應用', 5], ['進修部', 1], ['網路應用與資通安全', 5], ['數位內容與多媒體應用', 2],
].map(([field, groupCount], i) => ({ id: `domain-${i + 1}`, field, groupCount, evaluatorsPerGroup: {} }));
