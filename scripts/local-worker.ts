import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';

export async function localWorker() {
  const reserve = http.createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const persistence = await mkdtemp(join(tmpdir(), 'lottery-cloudflare-'));
  const token = 'test-setup-token-at-least-32-characters';
  let child: ChildProcess | undefined;
  let log = '';
  const request = (path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}, agent?: https.Agent) => new Promise<{ status: number; data: any; cookie: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request(`https://127.0.0.1:${port}${path}`, {
      method: raw === undefined ? 'GET' : 'POST', rejectUnauthorized: false, agent,
      headers: { 'Content-Type': 'application/json', ...(raw ? { 'Content-Length': Buffer.byteLength(raw) } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => text += chunk); res.on('error', reject);
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, data: JSON.parse(text), cookie: res.headers['set-cookie']?.at(-1)?.split(';')[0] || '', headers: res.headers }); }
        catch { reject(new Error(`Non-JSON response: ${res.statusCode}: ${text.slice(0, 500)}`)); }
      });
    });
    req.on('error', reject); req.setTimeout(45000, () => req.destroy(new Error('Request timed out'))); req.end(raw);
  });
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    }
    child = undefined;
  }
  async function start() {
    log = '';
    child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0', '--local-protocol', 'https', '--persist-to', persistence,
      '--var', 'SESSION_SECRET:test-session-secret-at-least-32-characters', '--var', `SETUP_TOKEN:${token}`], {
      env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout!.on('data', data => log += data); child.stderr!.on('data', data => log += data);
    for (let i = 0; i < 300; i++) {
      if (child.exitCode !== null) throw new Error(`Wrangler failed: ${log.slice(-3000)}`);
      try { if ((await request('/api/health')).status === 200) return; } catch { /* Wait for local workerd. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Wrangler startup timed out: ${log.slice(-3000)}`);
  }
  return { request, start, stop, logs: () => log, setup: (body: unknown) => request('/api/cloudflare/setup', body, undefined, { Authorization: `Bearer ${token}` }),
    dispose: async () => { await stop(); await rm(persistence, { recursive: true, force: true }); } };
}
