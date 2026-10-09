import { database } from './database';
import type { DatabaseGateway } from './databaseTypes';
export const AUDIT_CLEANUP_BATCH_SIZE = 500;
export const AUDIT_CLEANUP_MAX_BATCHES = 5;
export async function cleanupExpiredAudit(db: DatabaseGateway = database()) {
  return db.call('cleanupAudit', {});
}
