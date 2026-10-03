import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Agent } from 'node:https';
import { localWorker } from './local-worker';
import { hashPassword } from '../server/credentials';

const count = Number(process.argv.find(arg => arg.startsWith('--students='))?.split('=')[1] || 300);
if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Students must be 1-1000');
const worker = await localWorker();
const agents = Array.from({ length: count }, () => new Agent({ keepAlive: true, maxSockets: 1, rejectUnauthorized: false }));
try {
  await worker.start();
  assert.equal((await worker.setup({ action: 'accounts', accounts: [{ id: 'load-admin', email: 'load@example.edu.tw', role: 'admin', password_hash: await hashPassword('Local-benchmark-password') }] })).status, 200);
  const admin = await worker.request('/api/auth/verify', { username: 'load@example.edu.tw', password: 'Local-benchmark-password', targetView: 'admin' });
  assert.equal(admin.status, 200);
  const projects = Array.from({ length: count }, (_, i) => ({ id: `load-${i}`, leader_id: `student-${i}`, seq_no: String(i), education_system: '四技', department: '測試', class_name: '測試', advisor: '測試老師', field: '企業智慧化', original_code: '', project_title: `測試專題 ${i + 1}` }));
  const saved = await worker.request('/api/projects', { version: 0, projects }, admin.cookie); assert.equal(saved.status, 200);
  const shared = await worker.request('/api/student/shared-password', { version: saved.data.version, action: 'generate' }, admin.cookie); assert.equal(shared.status, 200);
  // Prepare each simulated browser connection before measuring the login wave.
  for (let i = 0; i < count; i += 25) await Promise.all(agents.slice(i, i + 25).map(agent => worker.request('/api/student/me', undefined, undefined, {}, agent)));
  const warmupFailures = [];
  for (let round = 0; round < 2; round++) {
    const checks = await Promise.allSettled(agents.map(agent => worker.request('/api/student/me', undefined, undefined, {}, agent)));
    warmupFailures.push(checks.filter(result => result.status !== 'fulfilled' || result.value.status !== 401).length);
  }
  const started = performance.now();
  const results = await Promise.all(projects.map(async (project, i) => {
    const start = performance.now();
    try {
    const login = await worker.request('/api/student/verify', { leaderId: project.leader_id, password: shared.data.password }, undefined, {}, agents[i]);
    const elapsed = performance.now() - start;
    const me = login.status === 200 ? await worker.request('/api/student/me', undefined, login.cookie, {}, agents[i]) : undefined;
    return { login: login.status, query: me?.status, correct: me?.data.project?.leader_id === project.leader_id, cookie: login.cookie, elapsed };
    } catch {
      return { login: 0, query: 0, correct: false, cookie: '', elapsed: performance.now() - start };
    }
  }));
  const latencies = results.map(r => r.elapsed).sort((a, b) => a - b);
  console.log(JSON.stringify({ runtime: 'Cloudflare Workers + SQLite Durable Object (local)', students: count, warmupFailures, loginSuccess: results.filter(r => r.login === 200).length, querySuccess: results.filter(r => r.query === 200 && r.correct).length, uniqueCookies: new Set(results.filter(r => r.cookie).map(r => r.cookie)).size, p95LoginMs: Math.round(latencies[Math.ceil(count * .95) - 1]), maxLoginMs: Math.round(latencies.at(-1)!), totalMs: Math.round(performance.now() - started) }, null, 2));
  if (results.some(r => r.login !== 200 || r.query !== 200 || !r.correct)) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(worker.logs().slice(-3000));
  process.exitCode = 1;
} finally { agents.forEach(agent => agent.destroy()); await worker.dispose(); }
