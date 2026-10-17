import { Agent, createServer, request as httpRequest } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../server/credentials';
import { PASSWORD_POOL_BINDINGS } from '../server/passwordVerification';

const { values } = parseArgs({ options: {
  users: { type: 'string', default: '1000' }, pools: { type: 'string', default: '4' }, output: { type: 'string' },
} });
const users = Number(values.users); const pools = Number(values.pools);
if (!Number.isInteger(users) || users < 1 || users > 1000 || ![1, 4].includes(pools)) throw new Error('Expected --users=1..1000 --pools=1|4');
const dir = await mkdtemp(join(tmpdir(), 'lottery-password-load-'));
// Keep enough connections to saturate the 16-active backend without measuring
// Wrangler's development HTTP proxy/socket burst limits.
const connectionLimit = Math.min(32, users);
const agent = new Agent({ keepAlive: true, maxSockets: connectionLimit });
let child: ChildProcess | undefined; let logs = '';
try {
  const password = 'Synthetic-password-load-123';
  const key = randomBytes(32).toString('hex');
  const encoded = await hashPassword(password);
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const names = Array.from({ length: pools }, (_, i) => `password-benchmark-${i}`);
  const config = {
    name: 'password-benchmark-api', main: resolve('tests/fixtures/passwordPoolBenchmark.ts'),
    compatibility_date: '2026-10-01', compatibility_flags: ['nodejs_compat'],
    vars: { BENCHMARK_KEY: key },
    durable_objects: { bindings: [
      { name: 'BENCHMARK_API', class_name: 'PasswordBenchmarkApi' },
      ...PASSWORD_POOL_BINDINGS.map((name, i) => ({ name, class_name: 'PasswordVerifier', script_name: names[i % pools] })),
    ] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['PasswordBenchmarkApi'] }],
  };
  const mainPath = join(dir, 'main.json'); await writeFile(mainPath, JSON.stringify(config));
  const configArgs = ['--config', mainPath];
  for (let i = 0; i < pools; i++) {
    const pool = JSON.parse(await readFile(`wrangler.password-${i}.jsonc`, 'utf8'));
    pool.name = names[i]; pool.main = resolve('worker/passwordVerifier.ts');
    const path = join(dir, `pool-${i}.json`); await writeFile(path, JSON.stringify(pool));
    configArgs.push('--config', path);
  }
  child = spawn(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'dev', ...configArgs,
    '--port', String(port), '--local', '--persist-to', join(dir, 'state')], {
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', data => { logs = (logs + String(data)).slice(-12000); });
  child.stderr?.on('data', data => { logs = (logs + String(data)).slice(-12000); });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`Local runtime exited: ${logs}`);
    try { ready = (await fetch(base + '/ready', { headers: { Authorization: `Bearer ${key}` } })).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error(`Local runtime not ready: ${logs}`);
  type Sample = { status: number; valid: boolean; ms: number; failure?: string };
  async function call(index: number, warmup = false): Promise<Sample> {
    const start = performance.now();
    return new Promise(resolve => {
      const body = warmup ? undefined : JSON.stringify({ password, encoded });
      const request = httpRequest(base + (warmup ? '/ready' : '/verify'), {
        agent, method: warmup ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) },
        signal: AbortSignal.timeout(180000),
      }, response => {
        const chunks: Buffer[] = [];
        const fail = (error?: Error) => resolve({ status: response.statusCode || 0, valid: false, ms: performance.now() - start, failure: error?.message || 'Response stream failed' });
        response.on('data', data => chunks.push(Buffer.from(data))); response.on('error', fail);
        response.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            resolve({ status: response.statusCode || 0, valid: warmup ? data.ready === true : data.valid === true, ms: performance.now() - start });
          } catch { fail(new Error('Invalid JSON response')); }
        });
      });
      request.on('error', error => resolve({ status: 0, valid: false, ms: performance.now() - start, failure: (error as NodeJS.ErrnoException).code || error.message }));
      request.end(body);
    });
  }
  const warmup = await Promise.all(Array.from({ length: connectionLimit }, (_, i) => call(i, true)));
  if (warmup.some(s => !s.valid || s.status !== 200)) throw new Error('Unable to prepare local connections');
  const start = performance.now();
  const samples = await Promise.all(Array.from({ length: users }, (_, i) => call(i)));
  const elapsedMs = Math.round(performance.now() - start);
  const times = samples.map(s => s.ms).sort((a, b) => a - b);
  const percentile = (p: number) => Math.round(times[Math.max(0, Math.ceil(times.length * p) - 1)]);
  const report = {
    environment: 'local Wrangler/workerd; verification only, not production capacity or billing evidence',
    users, pools, objectsPerPool: 1, clientConnectionLimit: connectionLimit, activeLoginLimit: 16, hashConcurrencyPerObject: 1, connectionsPreopened: true, clientRetries: false,
    successful: samples.filter(s => s.status === 200 && s.valid).length, elapsedMs,
    statuses: samples.reduce<Record<string, number>>((acc, s) => { acc[s.status] = (acc[s.status] || 0) + 1; return acc; }, {}),
    failures: samples.reduce<Record<string, number>>((acc, s) => { if (s.failure) acc[s.failure] = (acc[s.failure] || 0) + 1; return acc; }, {}),
    latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: percentile(1) },
  };
  const json = JSON.stringify(report, null, 2);
  console.log(json);
  if (values.output) await writeFile(values.output, json + '\n');
  if (report.successful !== users) { console.error(logs.slice(-4000)); process.exitCode = 1; }
} finally {
  agent.destroy();
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  await rm(dir, { recursive: true, force: true });
}
