import { database } from './database';
import type { DatabaseGateway } from './databaseTypes';
import { cleanupExpiredAudit } from './auditCleanup';

export const SESSION_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
export const SESSION_CLEANUP_BATCH_SIZE = 100;
export const SESSION_CLEANUP_MAX_BATCHES = 5;
/** A bounded atomic delete in the database object; clients cannot choose the cutoff. */
export async function cleanupExpiredSessions(db: DatabaseGateway = database()) {
  return db.call('cleanupSessions', {});
}

export async function runSessionCleanup() {
  const counts = await cleanupExpiredSessions();
  console.info('Expired session cleanup completed:', counts);
  return counts;
}

/** Each maintenance job still runs if the other fails. Never log database error details. */
export async function runScheduledMaintenance(
  sessions: () => Promise<unknown> = runSessionCleanup,
  audit: () => Promise<unknown> = cleanupExpiredAudit,
) {
  const results = await Promise.allSettled([sessions(), audit()]);
  if (results[1].status === 'fulfilled') console.info('Staff audit cleanup completed:', results[1].value);
  if (results.some(result => result.status === 'rejected')) {
    throw new Error('定期資料清理失敗，將於下一次排程重試。');
  }
}

/** Node production: run at startup, then every ten minutes, without overlaps. */
export function startSessionCleanup(run: () => Promise<unknown> = runScheduledMaintenance, intervalMs = SESSION_CLEANUP_INTERVAL_MS) {
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try { await run(); }
    catch { console.error('Scheduled maintenance failed; retrying at the next scheduled interval.'); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
