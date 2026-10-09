import type { DurableObjectState } from '@cloudflare/workers-types/index.ts';
import { SQLiteDatabase, type SqlDriver } from '../server/sqliteDatabase';
import { ApiError } from '../server/errors';
import type { DatabaseCommands } from '../server/databaseTypes';

/** One stable object owns the activity's tables, versions and atomic writes. */
export class LotteryDatabase {
  private db: SQLiteDatabase;
  constructor(ctx: DurableObjectState, env: { ADMIN_EMAIL?: string; ADMIN_PASSWORD_HASH?: string }) {
    const driver: SqlDriver = {
      exec<T>(query: string, ...bindings: Array<string | number | null>) { return ctx.storage.sql.exec(query, ...bindings).toArray() as T[]; },
      transaction<T>(callback: () => T): T { return ctx.storage.transactionSync(callback); },
    };
    this.db = new SQLiteDatabase(driver, { email: env.ADMIN_EMAIL, passwordHash: env.ADMIN_PASSWORD_HASH });
  }
  async alarm() { await this.db.call('cleanupSessions', {}); await this.db.call('cleanupAudit', {}); }
  async fetch(request: Request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/command') return new Response('Not found', { status: 404 });
    try {
      const { command, args } = await request.json() as { command: keyof DatabaseCommands; args: never };
      const result = await this.db.call(command, args);
      return Response.json({ result });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 503;
      return Response.json({ error: status < 500 ? (error as Error).message : '資料庫暫時無法使用。' }, { status });
    }
  }
}
