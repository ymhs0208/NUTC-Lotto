import { createServer } from 'node:http';
import { handleAsNodeRequest } from 'cloudflare:node';
import type { DurableObjectNamespace, DurableObjectState, Fetcher } from '@cloudflare/workers-types/index.ts';
import { app } from '../server/app';
import { frontendCacheControl } from '../server/frontendAssets';
import { withRuntime, type RuntimeEnvironment } from '../server/runtime';

interface Env extends RuntimeEnvironment { ASSETS: Fetcher; LOGIN_LIMITER: DurableObjectNamespace; API_BACKEND: DurableObjectNamespace; }
export { LotteryDatabase } from '../server/cloudflareDatabase';
createServer(app).listen(8080);
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
    if (url.protocol !== 'https:') {
      if (isApi) return new Response('HTTPS required', { status: 403 });
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 308);
    }

    const forward = { method: request.method, headers: Object.fromEntries(request.headers) };
    let response;
    if (!isApi) {
      response = await env.ASSETS.fetch(request.url, forward);
      if (url.pathname.startsWith('/assets/') && /text\/html/i.test(response.headers.get('Content-Type') || '')) {
        response = new Response('Page asset not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
    } else {
      // Keep users behind one campus NAT from queuing on a single API object.
      // State lives in LOTTERY_DATABASE; counters live in LOGIN_LIMITER.
      const shard = crypto.getRandomValues(new Uint8Array(1))[0];
      response = await env.API_BACKEND.get(env.API_BACKEND.idFromName(`api-${shard}`)).fetch(request.url, { ...forward, body: request.body });
    }
    const secureResponse = new Response(response.body as unknown as ReadableStream<Uint8Array> | null, response as unknown as Response);
    if (!isApi && secureResponse.ok) {
      const cache = frontendCacheControl(url.pathname, secureResponse.headers.get('Content-Type') || '');
      if (cache) secureResponse.headers.set('Cache-Control', cache);
    }
    secureResponse.headers.set('Strict-Transport-Security', 'max-age=31536000');
    secureResponse.headers.set('X-Content-Type-Options', 'nosniff');
    secureResponse.headers.set('X-Frame-Options', 'DENY');
    return secureResponse;
  },
};

// Give password hashing the DO CPU budget while keeping the SQLite object responsive.
export class ApiBackend {
  constructor(_ctx: DurableObjectState, private env: Env) {}
  async fetch(request: Request) {
    // Validate/limit in Express before hash admission. The credentials module
    // bounds scrypt work across all API objects sharing this isolate.
    return withRuntime(
      { ...this.env, NODE_ENV: 'production' }, () => handleAsNodeRequest(8080, request),
    );
  }
}

// Shared atomic counters survive isolate restarts. Only hashed account/IP keys are used.
export class LoginLimiter {
  constructor(private ctx: DurableObjectState) {}
  async fetch(request: Request) {
    const { limit, windowMs, budgets } = await request.json() as { limit: number; windowMs: number; budgets?: Array<{ key: string; limit: number }> };
    if (budgets) return this.checkSessionBudgets(budgets, windowMs);
    const now = Date.now();
    const result = await this.ctx.storage.transaction(async tx => {
      const stored = await tx.get<{ count: number; resetAt: number }>('bucket');
      const bucket = stored && stored.resetAt > now ? stored : { count: 0, resetAt: now + windowMs };
      if (bucket.count >= limit) return { success: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
      bucket.count++;
      await tx.put('bucket', bucket);
      await tx.setAlarm(bucket.resetAt);
      return { success: true, retryAfter: 0 };
    });
    return Response.json(result);
  }
  private async checkSessionBudgets(budgets: Array<{ key: string; limit: number }>, windowMs: number) {
    // Session requests have exactly three server-generated budgets; callers are internal bindings.
    if (budgets.length !== 3 || windowMs !== 60000 || budgets.some(b => !b.key.startsWith('session:') || !Number.isInteger(b.limit) || b.limit < 1)) return new Response('Invalid budgets', { status: 400 });
    const now = Date.now();
    const result = await this.ctx.storage.transaction(async tx => {
      const resetAt = await tx.get<number>('resetAt');
      const expires = resetAt && resetAt > now ? resetAt : now + windowMs;
      if (resetAt && resetAt <= now) {
        // Transactional cleanup keeps rollover atomic with incoming requests.
        for (;;) {
          const page = await tx.list({ limit: 1000 });
          if (!page.size) break;
          await tx.delete([...page.keys()]);
        }
      }
      const keys = budgets.map(b => b.key);
      const stored = await tx.get<{ count: number; resetAt: number }>(keys);
      const retryAfter = Math.ceil((expires - now) / 1000);
      if (budgets.some(b => (stored.get(b.key)?.count || 0) >= b.limit)) return { success: false, retryAfter };
      const count = await tx.get<number>('count') || 0;
      const additions = keys.filter(key => !stored.has(key)).length;
      if (count + additions > 10000) return { success: false, retryAfter };
      const updates = Object.fromEntries(keys.map(key => [key, { count: (stored.get(key)?.count || 0) + 1, resetAt: expires }]));
      await tx.put({ ...updates, count: count + additions, resetAt: expires });
      await tx.setAlarm(expires);
      return { success: true, retryAfter: 0 };
    });
    return Response.json(result);
  }
  async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      const resetAt = await this.ctx.storage.get<number>('resetAt');
      if (resetAt && resetAt > Date.now()) await this.ctx.storage.setAlarm(resetAt);
      else await this.ctx.storage.deleteAll();
    });
  }
}
