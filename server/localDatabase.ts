// Node-only adapter. Workers never import node:sqlite or touch local files.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SQLiteDatabase, type SqlDriver, type SqlValue } from './sqliteDatabase';
export function openLocalDatabase(filename = 'data/lottery.sqlite', bootstrap: { email?: string; passwordHash?: string } = {}) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const connection = new DatabaseSync(filename);
  connection.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');
  const driver: SqlDriver = {
    exec<T>(query: string, ...bindings: SqlValue[]): T[] { return connection.prepare(query).all(...bindings) as T[]; },
    transaction<T>(callback: () => T): T {
      connection.exec('BEGIN IMMEDIATE');
      try { const result = callback(); connection.exec('COMMIT'); return result; }
      catch (error) { connection.exec('ROLLBACK'); throw error; }
    },
  };
  const database = new SQLiteDatabase(driver, bootstrap);
  return { database, connection, close: () => connection.close() };
}
