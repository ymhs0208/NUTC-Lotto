import { randomUUID } from 'node:crypto';
import { ApiError } from './errors';
import { fingerprint, sharedPasswordHash, type StoredProject } from './credentials';
import { validateDomains, validateProjects, type DatabaseState } from './store';
import { publicResults } from './publicResults';
import { auditActionLabels, type AuditRow } from '../src/lib/auditTypes';
import type { AuditActor, AuditEvent } from './audit';
import type { DatabaseCommands, DatabaseGateway, StaffAccount, StaffProfile, AuditFilters } from './databaseTypes';

export type SqlValue = string | number | null;
export interface SqlDriver {
  exec<T = Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): T[];
  transaction<T>(callback: () => T): T;
}
const HASH = /^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{64}$/;
const INITIAL_DOMAINS = [
  ['企業智慧化', 2], ['嵌入式系統與行動計算', 2], ['智慧流通應用與研究', 2],
  ['智慧運算創新應用', 5], ['進修部', 1], ['網路應用與資通安全', 5], ['數位內容與多媒體應用', 2],
].map(([field, groupCount], i) => ({ id: `domain-${i + 1}`, field: String(field), groupCount: Number(groupCount), evaluatorsPerGroup: {} }));
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS lottery_state (id INTEGER PRIMARY KEY CHECK(id=1), domain_configs TEXT NOT NULL CHECK(json_valid(domain_configs)), version INTEGER NOT NULL CHECK(version>=0), updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, leader_key TEXT NOT NULL UNIQUE, position INTEGER NOT NULL, field TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)) CHECK(json_type(document,'$.password') IS NULL))`,
  `CREATE INDEX IF NOT EXISTS projects_position ON projects(position)`,
  `CREATE INDEX IF NOT EXISTS projects_field ON projects(field)`,
  `CREATE TABLE IF NOT EXISTS staff_accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('admin','stage')), password_hash TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)), credential_version INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS staff_sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, credential_version INTEGER NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS staff_sessions_expiry ON staff_sessions(expires_at)`,
  `CREATE INDEX IF NOT EXISTS staff_sessions_account ON staff_sessions(account_id)`,
  `CREATE TABLE IF NOT EXISTS student_sessions (token_hash TEXT PRIMARY KEY, project_id TEXT NOT NULL, credential_version TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS student_sessions_expiry ON student_sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS staff_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at TEXT NOT NULL, actor_email TEXT NOT NULL, actor_role TEXT NOT NULL, action TEXT NOT NULL, details TEXT NOT NULL CHECK(json_valid(details)), search_text TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS staff_audit_time ON staff_audit(occurred_at)`,
];

/** Every multi-statement operation is synchronous inside transactionSync on Workers. */
export class SQLiteDatabase implements DatabaseGateway {
  constructor(public sql: SqlDriver, bootstrap: { email?: string; passwordHash?: string } = {}, private now = () => Date.now()) {
    sql.transaction(() => {
      const tables = new Set(sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map(t => t.name));
      const legacy = tables.has('metadata') && !tables.has('schema_version');
      if (legacy && tables.has('projects')) {
        const columns = sql.exec<{ name: string }>('PRAGMA table_info(projects)');
        if (!columns.some(c => c.name === 'field')) {
          sql.exec("ALTER TABLE projects ADD COLUMN field TEXT NOT NULL DEFAULT ''");
          sql.exec("UPDATE projects SET field=COALESCE(json_extract(document,'$.field'),'')");
        }
      }
      for (const statement of SCHEMA) sql.exec(statement);
      const version = sql.exec<{ version: number }>('SELECT version FROM schema_version WHERE id=1')[0]?.version;
      if (version !== undefined && version !== 1) throw new Error('Unsupported SQLite schema version');
      sql.exec('INSERT OR IGNORE INTO schema_version VALUES(1,1)');
      sql.exec('INSERT OR IGNORE INTO lottery_state VALUES(1,?,0,?)', JSON.stringify(INITIAL_DOMAINS), new Date(this.now()).toISOString());
      if (legacy) {
        // Preserve the existing repository's lottery-v1 SQLite data atomically.
        sql.exec('INSERT OR REPLACE INTO lottery_state SELECT id,domains,version,updated_at FROM metadata');
        if (tables.has('accounts')) {
          for (const row of sql.exec<{ document: string }>('SELECT document FROM accounts')) {
            const account = JSON.parse(row.document) as StaffAccount;
            if (!HASH.test(account.password_hash) || !['admin', 'stage'].includes(account.role)) throw new Error('Invalid legacy account');
            sql.exec('INSERT INTO staff_accounts(id,email,role,password_hash) VALUES(?,?,?,?)', account.id, this.email(account.email), account.role, account.password_hash);
          }
        }
        if (tables.has('staff_logs')) {
          for (const log of sql.exec<{ id: number; created_at: string; email: string; role: string; action: string; summary: string; version: number | null }>('SELECT * FROM staff_logs ORDER BY id')) {
            const action = log.action === 'password_generate' ? 'shared_password_generate' : log.action === 'password_clear' ? 'shared_password_clear' : log.action;
            const details = { summary: log.summary, ...(log.version !== null ? { version: log.version } : {}) };
            sql.exec('INSERT INTO staff_audit(id,occurred_at,actor_email,actor_role,action,details,search_text) VALUES(?,?,?,?,?,?,?)', log.id, log.created_at, log.email, log.role, action, JSON.stringify(details), [log.email, log.role, log.summary].join(' ').toLowerCase());
          }
        }
        // Old sessions remain archived in their old table but are no longer accepted.
      }
      // Seed once. Keeping bootstrap secrets must never reset existing credentials.
      const count = sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM staff_accounts')[0].count;
      if (!count && bootstrap.email && bootstrap.passwordHash) {
        const email = this.email(bootstrap.email);
        if (!HASH.test(bootstrap.passwordHash)) throw new Error('Invalid bootstrap password hash');
        sql.exec('INSERT INTO staff_accounts(id,email,role,password_hash) VALUES(?,?,?,?)', randomUUID(), email, 'admin', bootstrap.passwordHash);
      }
    });
  }
  async call<K extends keyof DatabaseCommands>(command: K, args: DatabaseCommands[K]['args']): Promise<DatabaseCommands[K]['result']> {
    // No await in the callback: requests cannot interleave with reads/checks/writes.
    return this.sql.transaction(() => this.dispatch(command, args)) as DatabaseCommands[K]['result'];
  }
  private email(value: string) {
    const email = value.trim().toLowerCase();
    if (email.length > 256 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, '請輸入有效的 Email。');
    return email;
  }
  private actor(actor: AuditActor, adminOnly = false): StaffAccount {
    const account = this.sql.exec<StaffAccount>('SELECT * FROM staff_accounts WHERE id=? AND disabled=0', actor.userId)[0];
    if (!account || account.email !== actor.email || account.role !== actor.role) throw new ApiError(403, '帳號權限已變更，請重新登入。');
    if (adminOnly && account.role !== 'admin') throw new ApiError(403, '此操作僅限管理員。');
    return account;
  }
  private load(): DatabaseState {
    const state = this.sql.exec<{ domain_configs: string; version: number; updated_at: string }>('SELECT * FROM lottery_state WHERE id=1')[0];
    return { projects: this.sql.exec<{ document: string }>('SELECT document FROM projects ORDER BY position').map(p => JSON.parse(p.document)),
      domainConfigs: JSON.parse(state.domain_configs), version: state.version, lastUpdated: state.updated_at };
  }
  private project(key: 'id' | 'leader_key', value: string): StoredProject | null {
    if (!['id', 'leader_key'].includes(key)) throw new ApiError(400, '查詢欄位無效。');
    const row = this.sql.exec<{ document: string }>(`SELECT document FROM projects WHERE ${key}=?`, value)[0];
    return row ? JSON.parse(row.document) : null;
  }
  private record(event: AuditEvent) {
    this.actor(event.actor);
    const details = event.details;
    // Only known details are stored, never credentials or a supplied free-form object.
    const safe = { ...(details.fields ? { fields: details.fields } : {}), ...(details.project_count !== undefined ? { project_count: details.project_count } : {}),
      ...(details.version !== undefined ? { version: details.version } : {}), summary: auditActionLabels[event.action] };
    this.sql.exec('INSERT INTO staff_audit(occurred_at,actor_email,actor_role,action,details,search_text) VALUES(?,?,?,?,?,?)',
      new Date(this.now()).toISOString(), event.actor.email, event.actor.role, event.action, JSON.stringify(safe),
      [event.actor.email, event.actor.role, safe.summary, ...(safe.fields || [])].join(' ').toLowerCase());
  }
  private save(state: DatabaseState, expectedVersion: number, audit?: AuditEvent, actor?: AuditActor) {
    if (actor) this.actor(actor, !audit || !['draw', 'reset'].includes(audit.action));
    if (audit) this.actor(audit.actor, !['draw', 'reset'].includes(audit.action));
    const current = this.sql.exec<{ version: number }>('SELECT version FROM lottery_state WHERE id=1')[0].version;
    if (!Number.isSafeInteger(expectedVersion) || current !== expectedVersion) throw new ApiError(409, '資料已由其他人更新，請重新整理後再操作。');
    validateDomains(state.domainConfigs);
    validateProjects(state.projects.map(({ password_hash, shared_password_mode, ...p }) => p));
    for (const p of state.projects) {
      if (p.password || (p.password_hash !== undefined && !HASH.test(p.password_hash))) throw new ApiError(400, '學生密碼格式無效。');
    }
    sharedPasswordHash(state.projects);
    for (const project of state.projects) {
      const config = state.domainConfigs.find(c => c.field === project.field);
      if (project.assigned_group != null && (!config || project.assigned_group > config.groupCount)) throw new ApiError(400, '專題場次超過領域設定，請確認名冊。');
    }
    const existing = this.sql.exec<{ id: string; leader_key: string; document: string; position: number }>('SELECT * FROM projects');
    const incoming = new Map(state.projects.map((p, position) => [p.id, { p, position }]));
    // Remove vanished IDs and changed leader keys first, allowing atomic swaps.
    for (const row of existing) {
      const next = incoming.get(row.id);
      if (!next || next.p.leader_id.trim().toLowerCase() !== row.leader_key) this.sql.exec('DELETE FROM projects WHERE id=?', row.id);
    }
    const previous = new Map(existing.map(p => [p.id, p]));
    for (const [id, { p, position }] of incoming) {
      const document = JSON.stringify(p);
      if (document === previous.get(id)?.document && position === previous.get(id)?.position) continue;
      this.sql.exec(`INSERT INTO projects(id,leader_key,position,field,document) VALUES(?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET leader_key=excluded.leader_key,position=excluded.position,field=excluded.field,document=excluded.document`,
        id, p.leader_id.trim().toLowerCase(), position, p.field, document);
    }
    const lastUpdated = new Date(this.now()).toISOString();
    this.sql.exec('UPDATE lottery_state SET domain_configs=?,version=?,updated_at=? WHERE id=1', JSON.stringify(state.domainConfigs), current + 1, lastUpdated);
    if (audit) this.record(audit);
    return { ...state, version: current + 1, lastUpdated };
  }
  private profile(account: StaffAccount, createdAt: string, expiresAt: number): StaffProfile {
    return { id: account.id, email: account.email, role: account.role, created_at: createdAt, expires_at: expiresAt };
  }
  private audit(filters: AuditFilters) {
    const where = ['occurred_at>=?', 'occurred_at<=?']; const values: SqlValue[] = [filters.from, filters.to];
    if (filters.q) { where.push("search_text LIKE ? ESCAPE '\\'"); values.push(`%${filters.q.toLowerCase()}%`); }
    if (filters.action) { where.push('action=?'); values.push(filters.action); }
    if (filters.role) { where.push('actor_role=?'); values.push(filters.role); }
    if (filters.before) { where.push('id<?'); values.push(filters.before); }
    const rows = this.sql.exec<Omit<AuditRow, 'details'> & { details: string }>(`SELECT id,occurred_at,actor_email,actor_role,action,details FROM staff_audit WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 51`, ...values);
    const records = rows.slice(0, 50).map(p => ({ ...p, details: JSON.parse(p.details) }));
    return { records, nextCursor: rows.length > 50 ? String(records[49].id) : null };
  }
  private dispatch(command: keyof DatabaseCommands, input: unknown): unknown {
    // Dispatch is reachable only over a private DO binding, never from public URLs.
    const args = input as any;
    switch (command) {
      case 'health': this.sql.exec('SELECT version FROM lottery_state WHERE id=1'); return true;
      case 'load': return this.load();
      case 'save': return this.save(args.state, args.expectedVersion, args.audit, args.actor);
      case 'findProject': return this.project(args.key, args.value);
      case 'publicResults': {
        const meta = this.sql.exec<{ domain_configs: string; version: number }>('SELECT domain_configs,version FROM lottery_state WHERE id=1')[0];
        const configs = JSON.parse(meta.domain_configs);
        const fields = this.sql.exec<{ field: string }>('SELECT DISTINCT field FROM projects');
        // This SQL query does not return student IDs or password hashes to the API.
        const rows = this.sql.exec<StoredProject>(`SELECT id,json_extract(document,'$.draw_code') AS draw_code,
          json_extract(document,'$.assigned_group') AS assigned_group, json_extract(document,'$.project_title') AS project_title,
          COALESCE(json_extract(document,'$.leader_name'),'') AS leader_name, field FROM projects
          WHERE field=? AND json_extract(document,'$.assigned_group')>0 AND COALESCE(json_extract(document,'$.draw_code'),'')<>''`, args.field);
        return { ...publicResults(rows, [...configs, ...fields.filter(f => !configs.some((c: any) => c.field === f.field)).map(f => ({ id: f.field, field: f.field, groupCount: 1 }))], args.field), version: meta.version };
      }
      case 'findStaff': return this.sql.exec<StaffAccount>('SELECT * FROM staff_accounts WHERE email=? AND disabled=0', this.email(args.email))[0] || null;
      case 'startStaffSession': {
        const account = this.sql.exec<StaffAccount>('SELECT * FROM staff_accounts WHERE id=? AND disabled=0', args.accountId)[0];
        if (!account || account.password_hash !== args.passwordHash || account.credential_version !== args.credentialVersion) throw new ApiError(401, '帳號或密碼已更新，請重新登入。');
        const now = this.now(); const createdAt = new Date(now).toISOString(); const expiresAt = now + 3600000;
        this.sql.exec('INSERT INTO staff_sessions VALUES(?,?,?,?,?)', args.tokenHash, account.id, account.credential_version, createdAt, expiresAt);
        if (args.oldTokenHash) this.sql.exec('DELETE FROM staff_sessions WHERE token_hash=?', args.oldTokenHash);
        this.record({ actor: { userId: account.id, email: account.email, role: account.role }, action: 'login', details: {} });
        return this.profile(account, createdAt, expiresAt);
      }
      case 'staffSession': {
        const row = this.sql.exec<StaffAccount & { created_at: string; expires_at: number }>(`SELECT a.*,s.created_at,s.expires_at FROM staff_sessions s JOIN staff_accounts a ON a.id=s.account_id
          WHERE s.token_hash=? AND s.expires_at>? AND a.disabled=0 AND s.credential_version=a.credential_version`, args.tokenHash, this.now())[0];
        return row ? this.profile(row, row.created_at, row.expires_at) : null;
      }
      case 'endStaffSession': {
        const profile = this.dispatch('staffSession', args) as StaffProfile | null;
        this.sql.exec('DELETE FROM staff_sessions WHERE token_hash=?', args.tokenHash);
        if (profile) this.record({ actor: { userId: profile.id, email: profile.email, role: profile.role }, action: 'logout', details: {} });
        return true;
      }
      case 'startStudentSession': {
        const expected = args.project as StoredProject;
        const current = this.project('id', expected.id);
        if (!current?.password_hash || current.password || current.password_hash !== expected.password_hash ||
          current.leader_id.trim().toLowerCase() !== expected.leader_id.trim().toLowerCase() ||
          (current.shared_password_mode === true) !== (expected.shared_password_mode === true)) throw new ApiError(401, '學生資料或密碼已更新或停用，請重新登入。');
        this.sql.exec('INSERT INTO student_sessions VALUES(?,?,?,?)', args.tokenHash, current.id, fingerprint(current.password_hash), this.now() + 3600000);
        if (args.oldTokenHash) this.sql.exec('DELETE FROM student_sessions WHERE token_hash=?', args.oldTokenHash);
        return current;
      }
      case 'studentSession': {
        const row = this.sql.exec<{ document: string; credential_version: string }>(`SELECT p.document,s.credential_version FROM student_sessions s JOIN projects p ON p.id=s.project_id WHERE s.token_hash=? AND s.expires_at>?`, args.tokenHash, this.now())[0];
        const p = row ? JSON.parse(row.document) as StoredProject : null;
        return p?.password_hash && !p.password && fingerprint(p.password_hash) === row.credential_version ? p : null;
      }
      case 'endStudentSession': this.sql.exec('DELETE FROM student_sessions WHERE token_hash=?', args.tokenHash); return true;
      case 'audit': return this.audit(args);
      case 'cleanupSessions': {
        const counts = { ntcust_student_sessions: 0, ntcust_staff_sessions: 0 };
        for (const table of ['student_sessions', 'staff_sessions'] as const) {
          const deleted = this.sql.exec(`DELETE FROM ${table} WHERE token_hash IN (SELECT token_hash FROM ${table} WHERE expires_at<=? ORDER BY expires_at LIMIT 500) RETURNING token_hash`, this.now());
          counts[`ntcust_${table}`] = deleted.length;
        }
        return counts;
      }
      case 'cleanupAudit': {
        // Subtract calendar months in Taiwan and clamp the day (e.g. May 31 -> Feb 28).
        const taiwan = new Date(this.now() + 8 * 3600000);
        const cutoff = new Date(Date.UTC(taiwan.getUTCFullYear(), taiwan.getUTCMonth() - 3, 1, taiwan.getUTCHours(), taiwan.getUTCMinutes(), taiwan.getUTCSeconds(), taiwan.getUTCMilliseconds()));
        const days = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
        cutoff.setUTCDate(Math.min(taiwan.getUTCDate(), days));
        const iso = new Date(cutoff.getTime() - 8 * 3600000).toISOString();
        const deleted = this.sql.exec('DELETE FROM staff_audit WHERE id IN (SELECT id FROM staff_audit WHERE occurred_at<? ORDER BY occurred_at,id LIMIT 2500) RETURNING id', iso).length;
        return { enabled: true, deleted };
      }
      case 'staffAccounts': this.actor(args.actor, true); return this.sql.exec('SELECT id,email,role,disabled FROM staff_accounts ORDER BY email');
      case 'setStaffAccount': {
        this.actor(args.actor, true); const email = this.email(args.email);
        if (!['admin', 'stage'].includes(args.role) || typeof args.disabled !== 'boolean' || (args.passwordHash && !HASH.test(args.passwordHash))) throw new ApiError(400, '帳號設定無效。');
        const existing = this.sql.exec<StaffAccount>('SELECT * FROM staff_accounts WHERE email=?', email)[0];
        if (existing?.role === 'admin' && !existing.disabled && (args.disabled || args.role !== 'admin')) {
          const admins = this.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM staff_accounts WHERE role='admin' AND disabled=0")[0].count;
          if (admins <= 1) throw new ApiError(409, '必須保留至少一個啟用的管理員帳號。');
        }
        if (!existing && !args.passwordHash) throw new ApiError(400, '新增帳號必須設定密碼。');
        this.record({ actor: args.actor, action: 'staff_account_update', details: { fields: [email] } });
        if (existing) {
          this.sql.exec('UPDATE staff_accounts SET role=?,password_hash=?,disabled=?,credential_version=credential_version+1 WHERE id=?', args.role, args.passwordHash || existing.password_hash, args.disabled ? 1 : 0, existing.id);
          this.sql.exec('DELETE FROM staff_sessions WHERE account_id=?', existing.id);
        } else this.sql.exec('INSERT INTO staff_accounts(id,email,role,password_hash,disabled) VALUES(?,?,?,?,?)', randomUUID(), email, args.role, args.passwordHash, args.disabled ? 1 : 0);
        return true;
      }
      case 'importState': {
        this.actor(args.actor, true);
        const current = this.load();
        if (current.version !== 0 || current.projects.length) throw new ApiError(409, '資料庫已有資料，停止移轉以避免覆蓋。');
        return this.save(args.state, 0, { actor: args.actor, action: 'data_import', details: { project_count: args.state.projects.length } }, args.actor);
      }
      default: throw new ApiError(400, '資料庫操作無效。');
    }
  }
}
