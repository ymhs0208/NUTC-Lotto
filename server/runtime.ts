import type { DurableObjectNamespace } from '@cloudflare/workers-types/index.ts';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RuntimeEnvironment {
  SESSION_SECRET?: string;
  SETUP_TOKEN?: string;
  LOTTERY_DATABASE?: DurableObjectNamespace;
  NODE_ENV?: string;
  LOGIN_LIMITER?: DurableObjectNamespace;
}
const context = new AsyncLocalStorage<RuntimeEnvironment>();
export function runtimeEnv(): RuntimeEnvironment { return context.getStore() || process.env; }
export function withRuntime<T>(env: RuntimeEnvironment, fn: () => T): T { return context.run(env, fn); }
