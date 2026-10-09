import type { DurableObjectNamespace } from '@cloudflare/workers-types/index.ts';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RuntimeEnvironment {
  SESSION_SECRET?: string;
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD_HASH?: string;
  LOTTERY_DATABASE?: DurableObjectNamespace;
  DATABASE?: import('./databaseTypes').DatabaseGateway;
  NODE_ENV?: string;
  PASSWORD_HASH_CONCURRENCY?: string;
  CAMPUS_NETWORK_ONLY?: string;
  LOGIN_LIMITER?: DurableObjectNamespace;
}
const context = new AsyncLocalStorage<RuntimeEnvironment>();
export function runtimeEnv(): RuntimeEnvironment { return context.getStore() || process.env; }
export function withRuntime<T>(env: RuntimeEnvironment, fn: () => T): T { return context.run(env, fn); }
