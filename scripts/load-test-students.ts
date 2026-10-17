import { Agent, createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { app } from '../server/app';
import { openLocalDatabase } from '../server/localDatabase';
import { hashPassword, passwordHashLimits } from '../server/credentials';
import { withRuntime } from '../server/runtime';
import { API_TIMEOUTS } from '../src/lib/api';

// Intentionally has no target URL option: this test never contacts a live site,
// loads .env files, or opens an existing database.
const { values } = parseArgs({ options: { users: { type: 'string', default: '1000' }, mode: { type: 'string', default: 'shared' } } });
const count = Number(values.users);
if (!Number.isInteger(count) || count < 1 || count > 2000 || !['shared', 'individual'].includes(values.mode!)) {
  throw new Error('Usage: npm run test:load -- --users=1000 --mode=shared|individual (1–2000 users)');
}
const directory = await mkdtemp(join(tmpdir(), 'lottery-load-'));
const local = openLocalDatabase(join(directory, 'test.sqlite'));
const env = { DATABASE: local.database, SESSION_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'test' };
const server = createServer((req, res) => withRuntime(env, () => app(req, res)));
// Retain each user's connection through the individual-password hashing burst.
server.keepAliveTimeout = API_TIMEOUTS.studentLogin + 30000;
const agents = Array.from({ length: count }, () => new Agent({ keepAlive: true, maxSockets: 1 }));
type Sample = { status: number; ms: number; valid: boolean; cookie: string; failure?: string };
const summarize = (samples: Sample[]) => {
  const times = samples.map(s => s.ms).sort((a, b) => a - b);
  const percentile = (p: number) => Math.round(times[Math.max(0, Math.ceil(times.length * p) - 1)] || 0);
  return {
    total: samples.length, successful: samples.filter(s => s.valid).length,
    statuses: samples.reduce<Record<string, number>>((acc, s) => { acc[s.status] = (acc[s.status] || 0) + 1; return acc; }, {}),
    failures: samples.reduce<Record<string, number>>((acc, s) => { if (s.failure) acc[s.failure] = (acc[s.failure] || 0) + 1; return acc; }, {}),
    latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: percentile(1) },
  };
};
try {
  const password = 'Synthetic-load-password-123';
  const hash = await withRuntime(env, () => hashPassword(password));
  const initial = await local.database.call('load', {});
  await local.database.call('save', {
    expectedVersion: initial.version,
    state: { ...initial, domainConfigs: [{ id: 'load', field: '壓測', code: 'A', groupCount: 1 }],
      // Individual mode bypasses the shared verifier: every login really hashes.
      projects: Array.from({ length: count }, (_, i) => ({
        id: `load-${i}`, seq_no: String(i), education_system: '四技', department: '測試', class_name: '甲', advisor: '',
        field: '壓測', original_code: `A${String(i + 1).padStart(4, '0')}`,
        project_title: `Synthetic project ${i}`, leader_id: `load-student-${i}`, password_hash: hash,
        ...(values.mode === 'shared' ? { shared_password_mode: true } : {}),
      })),
    },
  });
  await new Promise<void>(resolve => server.listen({ port: 0, host: '127.0.0.1', backlog: 2048 }, resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function request(index: number, cookie?: string): Promise<Sample> {
    const start = performance.now();
    const reading = cookie !== undefined;
    try {
      const response = await new Promise<{ status: number; cookie: string; data: any }>((resolve, reject) => {
        const body = !reading ? JSON.stringify({ leaderId: `load-student-${index}`, password }) : undefined;
        const request = httpRequest(base + (reading ? '/api/student/me' : '/api/student/verify'), {
          agent: agents[index],
          method: reading ? 'GET' : 'POST',
          headers: reading ? { Cookie: cookie } : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body!) },
          signal: AbortSignal.timeout(reading ? API_TIMEOUTS.studentRead : API_TIMEOUTS.studentLogin),
        }, res => {
          const chunks: Buffer[] = [];
          res.on('data', chunk => chunks.push(Buffer.from(chunk)));
          res.on('error', reject);
          res.on('end', () => {
            try { resolve({ status: res.statusCode || 0, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] || '', data: JSON.parse(Buffer.concat(chunks).toString()) }); }
            catch (error) { reject(error); }
          });
        });
        request.on('error', reject);
        request.end(body);
      });
      const data = response.data;
      const sessionCookie = reading ? cookie : response.cookie;
      return { status: response.status, ms: performance.now() - start, cookie: sessionCookie,
        valid: response.status === 200 && data.success === true && data.project?.project_title === `Synthetic project ${index}` && !!sessionCookie };
    } catch (error) {
      const failure = error instanceof Error ? String((error.cause as { code?: string } | undefined)?.code || error.message) : 'Unknown transport error';
      return { status: 0, ms: performance.now() - start, cookie: '', valid: false, failure };
    }
  }
  // Open connections in small batches so the local OS accept backlog does not
  // turn a login benchmark into a TCP SYN burst test. No database work or token
  // budget is consumed by this unauthenticated 401 warmup.
  for (let offset = 0; offset < count; offset += 64) {
    const warmup = await Promise.all(Array.from({ length: Math.min(64, count - offset) }, (_, i) => request(offset + i, '')));
    if (warmup.some(s => s.status !== 401)) throw new Error('Unable to prepare load-test connections');
  }
  const start = performance.now();
  const logins = await Promise.all(Array.from({ length: count }, (_, i) => request(i)));
  const reads = await Promise.all(logins.flatMap((login, i) => login.valid ? [request(i, login.cookie)] : []));
  console.log(JSON.stringify({
    environment: 'local Node + real temporary SQLite; not Cloudflare capacity evidence',
    node: process.version, mode: values.mode, users: count, hashConcurrency: passwordHashLimits(env).concurrency,
    clientRetries: false, connectionsPreopened: true, elapsedMs: Math.round(performance.now() - start),
    login: summarize(logins), query: summarize(reads),
  }, null, 2));
  if (logins.some(s => !s.valid) || reads.length !== count || reads.some(s => !s.valid)) process.exitCode = 1;
} finally {
  for (const agent of agents) agent.destroy();
  server.closeAllConnections();
  if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  local.close();
  await rm(directory, { recursive: true, force: true });
}
