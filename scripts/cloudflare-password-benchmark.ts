import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { hashPassword } from '../server/credentials';
import { PASSWORD_POOL_BINDINGS } from '../server/passwordVerification';

// Explicit opt-in: creates billable temporary Cloudflare services, then removes them.
const { values } = parseArgs({ options: {
  run: { type: 'boolean', default: false }, users: { type: 'string', default: '1000' }, output: { type: 'string' },
} });
const users = Number(values.users);
if (!values.run || !Number.isInteger(users) || users < 1 || users > 1000) throw new Error('Requires --run --users=1..1000; creates temporary Cloudflare services and usage');
const dir = await mkdtemp(join(tmpdir(), 'lottery-cloud-password-'));
const prefix = `nutc-pw-bench-${randomBytes(4).toString('hex')}`;
const key = randomBytes(32).toString('hex');
const targets: Array<{ name: string; path: string }> = [];
const report: any = { environment: 'Cloudflare isolated verification benchmark; not full login or billing evidence', users, prefix, results: [], cleanup: [] };
const cli = resolve('node_modules/wrangler/bin/wrangler.js');
async function wrangler(args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', data => { output += String(data); }); child.stderr.on('data', data => { output += String(data); });
    child.once('error', reject);
    child.stdin.on('error', reject);
    child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(output.slice(-4000))));
    child.stdin.end(input || '');
  });
}
try {
  const password = 'Synthetic-cloud-password-123';
  const encoded = await hashPassword(password);
  const names = Array.from({ length: 4 }, (_, i) => `${prefix}-${i}`);
  for (let i = 0; i < 4; i++) {
    const config = JSON.parse(await readFile(`wrangler.password-${i}.jsonc`, 'utf8'));
    config.name = names[i]; config.main = resolve('worker/passwordVerifier.ts');
    const path = join(dir, `pool-${i}.json`); await writeFile(path, JSON.stringify(config));
    targets.push({ name: config.name, path });
    await wrangler(['deploy', '--config', path]);
    console.log(`Created temporary verification service ${i + 1}/4`);
  }
  const config = {
    name: prefix, main: resolve('tests/fixtures/passwordPoolBenchmark.ts'),
    compatibility_date: '2026-10-01', compatibility_flags: ['nodejs_compat'], workers_dev: true, preview_urls: false,
    durable_objects: { bindings: [
      { name: 'BENCHMARK_API', class_name: 'PasswordBenchmarkApi' },
      ...PASSWORD_POOL_BINDINGS.map((name, i) => ({ name, class_name: 'PasswordVerifier', script_name: names[i] })),
    ] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['PasswordBenchmarkApi'] }],
  };
  const path = join(dir, 'gateway.json'); await writeFile(path, JSON.stringify(config));
  targets.push({ name: prefix, path });
  const deployment = await wrangler(['deploy', '--config', path]);
  const base = deployment.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0];
  if (!base) throw new Error('Deployment did not return a workers.dev URL');
  // Until this secret is set the gateway returns 403 for every request.
  await wrangler(['secret', 'put', 'BENCHMARK_KEY', '--config', path], key + '\n');
  console.log('Created protected temporary benchmark gateway');
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try { ready = (await fetch(base + '/ready', { headers, signal: AbortSignal.timeout(5000) })).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error('Temporary benchmark gateway not ready');
  const forbidden = await fetch(base + '/ready', { signal: AbortSignal.timeout(10000) });
  if (forbidden.status !== 403) throw new Error('Benchmark gateway did not reject unauthenticated requests');
  for (const pools of [1, 4]) {
    console.log(`Testing ${users} verifications with ${pools} service(s)`);
    const started = performance.now();
    const samples: Array<{ status: number; valid: boolean; ms: number; completedMs: number }> = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(32, users) }, async () => {
      for (;;) {
        const index = next++; if (index >= users) return;
        const requestStart = performance.now();
        let status = 0; let valid = false;
        try {
          const response = await fetch(base + '/verify', {
            method: 'POST', headers: { ...headers, 'X-Benchmark-Pools': String(pools) },
            body: JSON.stringify({ password, encoded }), signal: AbortSignal.timeout(180000),
          });
          status = response.status;
          const data = await response.json(); valid = data.valid === true;
        } catch {}
        samples.push({ status, valid, ms: performance.now() - requestStart, completedMs: performance.now() - started });
        if (samples.length % 250 === 0) console.log(`${pools} service(s): ${samples.length}/${users} completed`);
      }
    }));
    const percentile = (key: 'ms' | 'completedMs', p: number) => {
      const sorted = samples.map(s => s[key]).sort((a, b) => a - b);
      return Math.round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]);
    };
    const result = {
      pools, objectsPerPool: 1, clientConcurrency: Math.min(32, users), activeLoginLimit: 16, retries: false,
      successful: samples.filter(s => s.status === 200 && s.valid).length, elapsedMs: Math.round(performance.now() - started),
      statuses: samples.reduce<Record<string, number>>((acc, s) => { acc[s.status] = (acc[s.status] || 0) + 1; return acc; }, {}),
      requestLatencyMs: { p50: percentile('ms', 0.5), p95: percentile('ms', 0.95), p99: percentile('ms', 0.99) },
      completionLatencyMs: { p50: percentile('completedMs', 0.5), p95: percentile('completedMs', 0.95), p99: percentile('completedMs', 0.99) },
    };
    report.results.push(result); console.log(JSON.stringify(result));
    if (result.successful !== users) process.exitCode = 1;
  }
} catch (error) {
  report.error = error instanceof Error ? error.message : 'Unknown benchmark error';
  console.error(report.error); process.exitCode = 1;
} finally {
  for (const target of targets.reverse()) {
    if (!(target.name === prefix || target.name.startsWith(prefix + '-'))) throw new Error('Invalid cleanup target');
    try {
      await wrangler(['delete', target.name, '--config', target.path, '--force']);
      report.cleanup.push({ name: target.name, deleted: true });
    } catch (error) {
      report.cleanup.push({ name: target.name, deleted: false });
      console.error(`Unable to remove temporary service ${target.name}: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    }
  }
  console.log(JSON.stringify(report, null, 2));
  if (values.output) await writeFile(values.output, JSON.stringify(report, null, 2) + '\n');
  // Retain configs only if cleanup failed, to allow recovery without exposing the key.
  if (report.cleanup.every((item: any) => item.deleted)) await rm(dir, { recursive: true, force: true });
  else console.error(`Temporary cleanup configs retained at ${dir}`);
}
