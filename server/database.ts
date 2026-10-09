import { runtimeEnv } from './runtime';
import { ApiError } from './errors';
import type { DatabaseCommands, DatabaseGateway } from './databaseTypes';

/** The database binding is private. No public route forwards arbitrary commands. */
export function database(): DatabaseGateway {
  const env = runtimeEnv();
  if (env.DATABASE) return env.DATABASE;
  const namespace = env.LOTTERY_DATABASE;
  if (!namespace) throw new ApiError(503, '尚未設定 SQLite 資料庫。');
  const stub = namespace.get(namespace.idFromName('lottery-v1'));
  return {
    async call<K extends keyof DatabaseCommands>(command: K, args: DatabaseCommands[K]['args']) {
      // Mutations are never retried automatically: a timeout may follow a commit.
      let response: Response;
      try {
        response = await stub.fetch('https://database.internal/command', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command, args }), signal: AbortSignal.timeout(30000) as unknown as import('@cloudflare/workers-types/index.ts').AbortSignal,
        }) as unknown as Response;
      } catch { throw new ApiError(503, '資料庫暫時無法使用。'); }
      const value = await response.json() as { result?: DatabaseCommands[K]['result']; error?: string };
      if (!response.ok) throw new ApiError(response.status < 500 ? response.status : 503, value.error || '資料庫暫時無法使用。');
      return value.result!;
    },
  };
}
