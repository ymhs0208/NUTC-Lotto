/** Local-only login benchmark: synthetic students and a simulated Supabase HTTP service. */
import http from 'node:http';
import https from 'node:https';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { STUDENT_LOGIN_LIMITS } from '../server/loginAdmission';
import { SESSION_WORK_LIMITS } from '../server/sessionSecurity';
import { API_TIMEOUTS, requestTimeoutMs } from '../src/lib/api';
import { hashPassword, fingerprint, publicStudentProjectDto, studentProjectDto, passwordHashLimits, type StoredProject } from '../server/credentials';

const mode = process.argv.includes('--workers') ? 'Workers' : 'Node';
const delayArg = process.argv.find(arg => arg.startsWith('--db-delay-ms='));
const delayMs = Number(delayArg?.split('=')[1] || 30);
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 1000) throw new Error('Database delay must be 0–1000 ms');
const queryDelayMs = Number(process.argv.find(arg => arg.startsWith('--query-db-delay-ms='))?.split('=')[1] ?? delayMs);
if (!Number.isInteger(queryDelayMs) || queryDelayMs < 0 || queryDelayMs > 1000) throw new Error('Query database delay must be 0–1000 ms');
const sharedPassword = !process.argv.includes('--individual-passwords');
const queryRounds = Number(process.argv.find(arg => arg.startsWith('--query-rounds='))?.split('=')[1] ?? 1);
if (!Number.isInteger(queryRounds) || queryRounds < 0 || queryRounds > 7) throw new Error('Query rounds must be 0–7');
const count = Number(process.argv.find(arg => arg.startsWith('--students='))?.split('=')[1] || 300);
if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Students must be 1–1000');
const commonPassword = 'local-load-test-password';
const passwordHash = await hashPassword(commonPassword);
const projects: StoredProject[] = Array.from({ length: count }, (_, n) => ({
  id: `load-project-${n}`, leader_id: `load-student-${n}`, project_title: `測試專題 ${n + 1}`,
  seq_no: String(n + 1), education_system: '四技', department: '測試', class_name: '測試', advisor: '測試老師',
  field: '企業智慧化', original_code: `A${String(n + 1).padStart(2, '0')}`, password_hash: passwordHash,
  shared_password_mode: sharedPassword, assigned_group: 1, draw_code: `A${String(n + 1).padStart(2, '0')}`,
  draw_time: null, evaluators: [],
}));
const byId = new Map(projects.map(p => [p.id, p]));
const byLeader = new Map(projects.map(p => [p.leader_id, p]));
const sessions = new Map<string, { project_id: string; credential_version: string; expires_at: string }>();
let dbActive = 0; let dbPeak = 0;
let measured = false;
const dbRequests: Array<{ type: string; started: number; duration: number }> = [];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const mock = http.createServer(async (req, res) => {
  const started = performance.now(); const recording = measured;
  let type = 'unexpected';
  if (recording) { dbActive++; dbPeak = Math.max(dbPeak, dbActive); }
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const url = new URL(req.url!, 'http://localhost');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'HEAD') {
      type = 'health'; res.setHeader('Content-Range', '0-0/1'); res.end(); return;
    }
    await sleep(url.pathname === '/rest/v1/rpc/ntcust_student_lookup' ? queryDelayMs : delayMs);
    if (url.pathname === '/rest/v1/ntcust_projects') {
      const id = url.searchParams.get('id')?.slice(3);
      const leader = url.searchParams.get('leader_key')?.slice(3);
      type = id !== undefined ? 'credentialRecheck' : 'leaderLookup';
      const p = id !== undefined ? byId.get(id) : byLeader.get(leader || '');
      res.end(JSON.stringify(p ? { document: p } : null)); return;
    }
    if (url.pathname === '/rest/v1/ntcust_student_sessions' && req.method === 'POST') {
      type = 'sessionInsert'; sessions.set(body.token_hash, body);
      res.writeHead(201); res.end('{}'); return;
    }
    if (url.pathname === '/rest/v1/rpc/ntcust_student_login_finalize') {
      type = 'loginFinalize';
      const p = byId.get(body.p_project_id);
      if (!p || p.leader_id !== body.p_leader_key || p.password_hash !== body.p_password_hash ||
        (p.shared_password_mode === true) !== body.p_shared_password_mode) {
        res.writeHead(401); res.end(JSON.stringify({ code: 'PT401' })); return;
      }
      sessions.set(body.p_token_hash, { project_id: p.id, credential_version: body.p_credential_version,
        expires_at: new Date(Date.now() + 3600000).toISOString() });
      if (body.p_old_token_hash) sessions.delete(body.p_old_token_hash);
      res.end(JSON.stringify(p)); return;
    }
    if (url.pathname === '/rest/v1/rpc/ntcust_student_lookup') {
      type = 'resultLookup';
      const session = sessions.get(body.p_token_hash);
      const p = session && Date.parse(session.expires_at) > Date.now() ? byId.get(session.project_id) : undefined;
      res.end(JSON.stringify(p && fingerprint(p.password_hash!) === session!.credential_version
        ? { project: p, credential_version: session!.credential_version } : null)); return;
    }
    res.writeHead(404); res.end('{}');
  } catch {
    res.writeHead(500); res.end('{}');
  } finally {
    if (recording) { dbActive--; dbRequests.push({ type, started, duration: performance.now() - started }); }
  }
});
mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
const mockPort = (mock.address() as { port: number }).port;
const reserve = http.createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
const port = (reserve.address() as { port: number }).port;
await new Promise<void>(resolve => reserve.close(() => resolve()));
const persistence = await mkdtemp(join(tmpdir(), 'lottery-login-load-'));
const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), SUPABASE_URL: `http://127.0.0.1:${mockPort}`,
  CAMPUS_NETWORK_ONLY: process.env.CAMPUS_NETWORK_ONLY,
  SUPABASE_SECRET_KEY: 'local-load-test-secret', SUPABASE_PUBLISHABLE_KEY: 'local-load-test-publishable',
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', WRANGLER_SEND_METRICS: 'false' };
if (mode === 'Workers') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Local self-signed cert only.
const args = mode === 'Workers' ? ['node_modules/wrangler/bin/wrangler.js', 'dev', '--ip', '127.0.0.1', '--port', String(port),
  '--local-protocol', 'https', '--persist-to', persistence,
  '--var', `SUPABASE_URL:${env.SUPABASE_URL}`, '--var', `SUPABASE_SECRET_KEY:${env.SUPABASE_SECRET_KEY}`,
  '--var', `SUPABASE_PUBLISHABLE_KEY:${env.SUPABASE_PUBLISHABLE_KEY}`,
  ...(process.env.CAMPUS_NETWORK_ONLY ? ['--var', `CAMPUS_NETWORK_ONLY:${process.env.CAMPUS_NETWORK_ONLY}`] : []),
  ...(process.env.PASSWORD_HASH_CONCURRENCY ? ['--var', `PASSWORD_HASH_CONCURRENCY:${process.env.PASSWORD_HASH_CONCURRENCY}`] : [])] : ['scripts/start-server.mjs'];
let child: ChildProcess | undefined; let log = '';
const base = `${mode === 'Workers' ? 'https' : 'http'}://127.0.0.1:${port}`;
type ApiResponse = { status: number; elapsed: number; data?: any; cookie?: string; retryAfter: number; error?: string };
const agents = new Map(projects.map(p => [p.leader_id, mode === 'Workers'
  ? new https.Agent({ keepAlive: true, maxSockets: 1, rejectUnauthorized: false })
  : new http.Agent({ keepAlive: true, maxSockets: 1 })]));
let staleConnectionRetries = 0;
const request = (path: string, body?: Record<string, string>, cookie?: string, agent?: http.Agent, method?: string, transportAttempt = 0): Promise<ApiResponse> => {
  const start = performance.now(); const rawBody = body ? JSON.stringify(body) : undefined;
  return new Promise(resolve => {
    const req = (mode === 'Workers' ? https : http).request(`${base}${path}`, {
      method: method || (body ? 'POST' : 'GET'), agent, ...(mode === 'Workers' ? { rejectUnauthorized: false } : {}),
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.44',
        ...(rawBody ? { 'Content-Length': Buffer.byteLength(rawBody) } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    }, res => {
      let raw = ''; res.setEncoding('utf8'); res.on('data', chunk => raw += chunk);
      res.on('error', error => resolve({ status: 0, elapsed: performance.now() - start, error: String(error), retryAfter: 0 }));
      res.on('end', () => {
        let data: any;
        try { data = JSON.parse(raw); } catch {
          if (method !== 'OPTIONS') return resolve({ status: res.statusCode || 0, elapsed: performance.now() - start, error: `non-json: ${raw.split('\n')[0].slice(0, 160)}`, retryAfter: 0 });
        }
        resolve({ status: res.statusCode || 0, elapsed: performance.now() - start, data,
          cookie: res.headers['set-cookie']?.at(-1)?.split(';')[0], retryAfter: Number(res.headers['retry-after'] || 0) });
      });
    });
    req.on('error', error => {
      // Node's low-level client does not replay a GET after an idle keep-alive
      // socket closes. Retry that specific race once, and report it explicitly.
      if (transportAttempt === 0 && !body && (!method || method === 'GET') && req.reusedSocket && (error as NodeJS.ErrnoException).code === 'ECONNRESET') {
        staleConnectionRetries++;
        const failedMs = performance.now() - start;
        void request(path, body, cookie, agent, method, 1).then(retried => resolve({ ...retried, elapsed: failedMs + retried.elapsed }));
        return;
      }
      resolve({ status: 0, elapsed: performance.now() - start, error: String(error), retryAfter: 0 });
    });
    req.setTimeout(requestTimeoutMs(path, !!body), () => req.destroy(new Error('Request timed out')));
    req.end(rawBody);
  });
};
const percentiles = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const p = (n: number) => sorted.length ? Math.round(sorted[Math.max(0, Math.ceil(sorted.length * n) - 1)]) : null;
  return { p50Ms: p(.5), p95Ms: p(.95), maxMs: p(1) };
};
const statuses = (responses: Array<{ status: number }>) => responses.reduce<Record<string, number>>((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
try {
  child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout!.on('data', data => log += data); child.stderr!.on('data', data => log += data);
  let ready = false;
  for (let n = 0; n < 400; n++) {
    if (child.exitCode !== null) throw new Error(`Server startup failed: ${log}`);
    if ((await request('/api/health')).status === 200) { ready = true; break; }
    await sleep(50);
  }
  if (!ready) throw new Error(`Server startup timed out: ${log}`);
  // Each browser first opens the page, keeping its own connection. Prepare in
  // small batches so the local OS SYN backlog is not the login bottleneck.
  for (let offset = 0; offset < count; offset += 25) {
    await Promise.all(projects.slice(offset, offset + 25).map(p => request('/api/student/me', undefined, undefined, agents.get(p.leader_id))));
  }
  // Warm the local dev proxy's internal pool before measuring application load.
  // Unsigned session checks perform no database work and are safe to repeat.
  const warmupErrors: number[] = [];
  if (mode === 'Workers') {
    for (let round = 0; round < 2; round++) {
      const checks = await Promise.all(projects.map(p => request('/api/student/me', undefined, undefined, agents.get(p.leader_id))));
      warmupErrors.push(checks.filter(r => r.status !== 401).length);
    }
  }
  measured = true;
  staleConnectionRetries = 0;
  const started = performance.now();
  const lookups: Array<{ status: number; elapsed: number; matches: boolean; error?: string }> = [];
  const query = async (entry: { project: StoredProject; response: ApiResponse }) => {
    const result = await request('/api/student/me', undefined, entry.response.cookie, agents.get(entry.project.leader_id));
    // The API intentionally masks leader IDs. Compare the full expected DTO,
    // including each synthetic student's unique title/code, to detect mixups.
    const expected = sharedPassword ? publicStudentProjectDto(entry.project) : studentProjectDto(entry.project);
    const matches = JSON.stringify(result.data?.project) === JSON.stringify(expected);
    lookups.push({ status: result.status, elapsed: result.elapsed, matches, error: result.error });
  };
  const first = await Promise.all(projects.map(async project => {
    const response = await request('/api/student/verify', { leaderId: project.leader_id, password: commonPassword }, undefined, agents.get(project.leader_id));
    const entry = { project, response };
    if (response.status === 200 && response.cookie) await query(entry);
    return entry;
  }));
  const burstMs = performance.now() - started;
  // Simulate one deliberate retry after the server's Retry-After, not unlimited retry traffic.
  const retryCandidates = first.filter(r => r.response.status === 503 && !r.response.error);
  const firstOk = first.filter(r => r.response.status === 200 && r.response.cookie);
  const firstDb = dbRequests.length;
  const retryStarted = performance.now();
  if (retryCandidates.length) await sleep(Math.max(2, ...retryCandidates.map(r => r.response.retryAfter)) * 1000);
  const retries = await Promise.all(retryCandidates.map(async entry => {
    const response = await request('/api/student/verify', { leaderId: entry.project.leader_id, password: commonPassword }, undefined, agents.get(entry.project.leader_id));
    const retried = { project: entry.project, response };
    if (response.status === 200 && response.cookie) await query(retried);
    return retried;
  }));
  const retryOk = retries.filter(r => r.response.status === 200 && r.response.cookie);
  const retryPhaseMs = Math.round(performance.now() - retryStarted);
  const successful = [...firstOk, ...retryOk];
  const refreshBursts = [];
  for (let round = 0; round < queryRounds; round++) {
    const start = performance.now();
    const before = lookups.length;
    await Promise.all(successful.map(query));
    const responses = lookups.slice(before);
    refreshBursts.push({ round: round + 1, attempted: responses.length, statuses: statuses(responses),
      successful: responses.filter(r => r.status === 200 && r.matches).length,
      incorrectResults: responses.filter(r => r.status === 200 && !r.matches).length,
      sampleErrors: [...new Set(responses.map(r => r.error).filter(Boolean))].slice(0, 5),
      latency: percentiles(responses.map(r => r.elapsed)), elapsedMs: Math.round(performance.now() - start) });
  }
  const requestTimes = dbRequests.map(r => r.started).sort((a, b) => a - b);
  let peakRequestsPerSecond = 0; let left = 0;
  for (let right = 0; right < requestTimes.length; right++) {
    while (requestTimes[right] - requestTimes[left] >= 1000) left++;
    peakRequestsPerSecond = Math.max(peakRequestsPerSecond, right - left + 1);
  }
  const result = { mode, students: count, campusNetworkOnly: env.CAMPUS_NETWORK_ONLY === 'true', sameSourceIp: true, sharedPassword, cacheInitiallyCold: true, connectionsPrewarmed: true, workerPoolWarmupErrors: warmupErrors,
    studentLoginAdmission: STUDENT_LOGIN_LIMITS, sessionWorkLimits: SESSION_WORK_LIMITS,
    passwordHashLimits: passwordHashLimits({ ...env, ...(mode === 'Workers' ? { LOGIN_LIMITER: {} as any } : {}) }),
    apiTimeouts: API_TIMEOUTS, simulatedDatabaseDelayMs: delayMs, simulatedQueryDelayMs: queryDelayMs, nodeVersion: process.version,
    firstAttempt: { statuses: statuses(first.map(r => r.response)), successful: firstOk.length,
      successPercent: Number((firstOk.length / count * 100).toFixed(1)), burstMs: Math.round(burstMs),
      successfulLatency: percentiles(firstOk.map(r => r.response.elapsed)), allLatency: percentiles(first.map(r => r.response.elapsed)),
      transportOrNonJsonErrors: first.filter(r => r.response.error).length,
      sampleErrors: [...new Set(first.map(r => r.response.error).filter(Boolean))].slice(0, 5), databaseRequestsIncludingQueries: firstDb },
    oneBusyRetry: { attempted: retries.length, statuses: statuses(retries.map(r => r.response)), additionalSuccessful: retryOk.length,
      successfulLatency: percentiles(retryOk.map(r => r.response.elapsed)), phaseMs: retryPhaseMs },
    final: { successfulLogins: successful.length, successfulQueries: lookups.filter(r => r.status === 200 && r.matches).length,
      uniqueCookies: new Set(successful.map(r => r.response.cookie)).size, incorrectStudentResults: lookups.filter(r => r.status === 200 && !r.matches).length,
      remainingStudents: count - successful.length, elapsedMs: Math.round(performance.now() - started), queryStatuses: statuses(lookups), queryLatency: percentiles(lookups.map(r => r.elapsed)) },
    refreshBursts, staleConnectionRetries,
    database: { totalRequests: dbRequests.length, types: dbRequests.reduce<Record<string, number>>((acc, r) => { acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {}),
      peakConcurrentRequests: dbPeak, peakRequestsPerSecond, latency: percentiles(dbRequests.map(r => r.duration)), persistedSessions: sessions.size },
    limitation: 'Local API benchmark with simulated Supabase HTTP responses; not production Supabase CPU/IO, campus network, or browser rendering. Measures current bounded login queues and limits.' };
  const path = resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length) || `STUDENT_LOGIN_LOAD_${mode.toUpperCase()}_${delayMs}MS.json`);
  await writeFile(path, JSON.stringify(result, null, 2) + '\n');
  await writeFile(path.replace('.json', '.runtime.log'), log);
  console.log(JSON.stringify({ path, ...result }, null, 2));
  if (result.final.incorrectStudentResults || result.final.uniqueCookies !== result.final.successfulLogins || result.database.types.unexpected) process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  for (const agent of agents.values()) agent.destroy();
  await rm(persistence, { recursive: true, force: true });
  await new Promise<void>(resolve => mock.close(() => resolve()));
}
