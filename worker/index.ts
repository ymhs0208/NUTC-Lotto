export { LotteryDatabase } from './databaseObject';
import { createServer } from 'node:http';
import { handleAsNodeRequest } from 'cloudflare:node';
import type { DurableObjectNamespace, DurableObjectState, Fetcher } from '@cloudflare/workers-types/index.ts';
import { app } from '../server/app';
import { frontendCacheControl } from '../server/frontendAssets';
import { withRuntime, type RuntimeEnvironment } from '../server/runtime';
import { runScheduledMaintenance } from '../server/sessionCleanup';
import { decideLoginBudgets, type LoginBudget, type LoginBucket } from '../server/loginBudgets';

interface Env extends RuntimeEnvironment { ASSETS: Fetcher; LOGIN_LIMITER: DurableObjectNamespace; API_BACKEND: DurableObjectNamespace; }
createServer(app).listen(8080);
export default {
  async scheduled(_controller: unknown, env: Env) {
    await withRuntime({ ...env, NODE_ENV: 'production' }, runScheduledMaintenance);
  },
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
      // These objects are stateless; the shared login counter lives in LOGIN_LIMITER.
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

// Give password hashing the DO CPU budget; business data lives in the dedicated SQLite database object.
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
    const { limit, windowMs, budgets, loginBudgets, proof } = await request.json() as { limit: number; windowMs: number; budgets?: Array<{ key: string; limit: number }>; loginBudgets?: LoginBudget[]; proof?: boolean };
    if (loginBudgets) return this.checkLoginBudgets(loginBudgets, windowMs, proof === true);
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
  private async checkLoginBudgets(budgets: LoginBudget[], windowMs: number, proof: boolean) {
    const first = /^(staff|student):ip:[a-f0-9]{64}$/.exec(budgets[0]?.key || '');
    const validKeys = (budgets.length === 1 && /^student:account:[a-f0-9]{64}$/.test(budgets[0].key))
      || (budgets.length === 2 && first && new RegExp(`^${first[1]}:account:[a-f0-9]{64}$`).test(budgets[1].key));
    if (!validKeys
      || windowMs !== 900000 || budgets.some(b => !Number.isInteger(b.limit) || b.limit < 1)) return new Response('Invalid login budgets', { status: 400 });
    const now = Date.now();
    const decision = await this.ctx.storage.transaction(async tx => {
      const resetAt = await tx.get<number>('resetAt');
      if (resetAt && resetAt <= now) {
        for (;;) {
          const page = await tx.list({ limit: 1000 });
          if (!page.size) break;
          await tx.delete([...page.keys()]);
        }
      }
      const stored = await tx.get<LoginBucket>(budgets.map(b => b.key));
      const additions = budgets.filter(b => !stored.has(b.key)).length;
      const expires = resetAt && resetAt > now ? resetAt : now + windowMs;
      for (const b of budgets) if (!stored.has(b.key)) stored.set(b.key, { count: 0, resetAt: expires });
      const result = decideLoginBudgets(budgets, stored, now, windowMs, proof);
      if (result.updates) {
        const count = await tx.get<number>('count') || 0;
        if (count + additions > 10000) return { success: false, retryAfter: Math.ceil(((resetAt || now + windowMs) - now) / 1000) };
        await tx.put({ ...Object.fromEntries(result.updates), count: count + additions, resetAt: expires });
        await tx.setAlarm(expires);
      }
      return result.decision;
    });
    return Response.json(decision);
  }
  private async checkSessionBudgets(budgets: Array<{ key: string; limit: number }>, windowMs: number) {
    // Campus students omit the IP budget. Token and aggregate budgets remain mandatory.
    const scope = /^session:(staff|student):token:[a-f0-9]{64}$/.exec(budgets[0]?.key || '');
    const validKeys = scope && budgets.at(-1)?.key === 'session:global'
      && ((budgets.length === 2 && scope[1] === 'student')
        || (budgets.length === 3 && new RegExp(`^session:${scope[1]}:ip:[a-f0-9]{64}$`).test(budgets[1].key)));
    if (!validKeys || windowMs !== 60000 || budgets.some(b => !Number.isInteger(b.limit) || b.limit < 1)) return new Response('Invalid budgets', { status: 400 });
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
