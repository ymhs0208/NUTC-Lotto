import express, { type Request, type Response, type NextFunction } from 'express';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { createStore, ApiError, validateProjects, validateDomains, type DatabaseState } from './store';
import { projectDto, stageProjectDto, studentProjectDto, publicStudentProjectDto, prepareProjects, verifyStudentPassword, verifyPassword, fingerprint, invalidateSharedPasswordVerification, hashPassword, sharedPasswordHash } from './credentials';
import { createStudentSession, getStudentProject, clearStudentSession } from './studentSessions';
import { createStaffSession, getStaffSession, clearStaffSession } from './staffSessions';
import { loginLimiter, anonymousLimiter, sessionLimiter } from './rateLimit';
import { readSessionToken, sessionScopeForPath } from './sessionSecurity';
import { studentLoginWork, staffLoginWork } from './loginAdmission';
import { ResourceBusyError } from './resourceLimits';
import { runtimeEnv } from './runtime';
import { publicError } from './errors';
import { executeAllDomainsIndependentLottery } from '../src/lib/lottery';
import { LotteryAllocationError } from '../src/lib/groupCapacities';
import { resolveLotteryFields } from './lotteryScope';
import { domainDeletionError } from '../src/lib/domainDeletion';
import { testLottery } from '../src/lib/lotteryTest';
import { getDomainCode } from '../src/lib/domainCodes';
import { relabelDomainResults } from '../src/lib/drawCodes';

export const app = express();
const SHARED_PASSWORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
app.disable('x-powered-by');
app.use('/api', (_req, res, next) => {
  res.locals.requestId = randomUUID();
  res.setHeader('X-Request-ID', res.locals.requestId);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use('/api', (req, res, next) => {
  if (req.method === 'POST') {
    if (!req.is('application/json')) return res.status(400).json({ success: false, error: '請使用有效的 JSON 物件。' });
    const origin = req.get('origin');
    if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ success: false, error: '不允許跨站操作。' });
    if (origin) {
      try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ success: false, error: '不允許跨站操作。' }); }
      catch { return res.status(403).json({ success: false, error: '不允許跨站操作。' }); }
    }
  }
  next();
});
const studentSessionLimit = sessionLimiter('student');
const staffSessionLimit = sessionLimiter('staff');
// Runs before auth/database access, including the pre-body roster authorization.
app.use('/api', (req, res, next) => {
  const path = req.path.toLowerCase().replace(/\/+$/, '');
  const scope = sessionScopeForPath(path);
  if (!scope) return next();
  // Clearing a missing/invalid cookie is safe and needs no database or limiter.
  if (path.endsWith('/logout') && !readSessionToken(req, scope)) return next();
  (scope === 'student' ? studentSessionLimit : staffSessionLimit)(req, res, next);
});
// Authenticate account setup before accepting its body.
app.post('/api/cloudflare/setup', (req, _res, next) => {
  const secret = runtimeEnv().SETUP_TOKEN;
  const bearer = req.get('authorization')?.replace(/^Bearer /, '');
  if (!secret || secret.length < 32) return next(new ApiError(404, '找不到此端點。'));
  if (!bearer || !timingSafeEqual(Buffer.from(fingerprint(secret), 'hex'), Buffer.from(fingerprint(bearer), 'hex'))) return next(new ApiError(401, '帳號設定憑證不正確。'));
  next();
});
// Authenticate roster writes before accepting their larger body allowance.
app.post('/api/projects', (req, _res, next) => { void authorize(req, true).then(() => next()).catch(next); });
const loginJson = express.json({ limit: '4kb' });
const rosterJson = express.json({ limit: '5mb' });
const smallJson = express.json({ limit: '64kb' });
app.use((req, res, next) => {
  const path = req.path.toLowerCase().replace(/\/+$/, '');
  const parser = ['/api/auth/verify', '/api/student/verify'].includes(path) ? loginJson
    : path === '/api/projects' && req.method === 'POST' ? rosterJson : smallJson;
  parser(req, res, next);
});
app.use('/api', (req, res, next) => {
  if (req.method === 'POST' && (!req.body || Array.isArray(req.body))) {
    res.status(400).json({ success: false, error: '請使用有效的 JSON 物件。' }); return;
  }
  next();
});
const route = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { Promise.resolve(handler(req, res)).catch(next); };

const loginRoute = (scope: 'staff' | 'student', handler: (req: Request, res: Response) => Promise<unknown>) =>
  route((req, res) => (scope === 'student' ? studentLoginWork : staffLoginWork).run(() => handler(req, res)));

async function authorize(req: Request, adminOnly = false) {
  const role = (await getStaffSession(req))!.profile.role;
  if (adminOnly && role !== 'admin') throw new ApiError(403, '此操作僅限管理員。');
  return role;
}
function staffState(state: DatabaseState, role: 'admin' | 'stage') {
  const base = {
    success: true, version: state.version, lastUpdated: state.lastUpdated,
    sharedPasswordEnabled: !!sharedPasswordHash(state.projects),
  };
  if (role === 'stage') return {
    ...base,
    domainConfigs: state.domainConfigs.map(c => ({ id: c.id, field: c.field, drawPrefix: c.drawPrefix, groupCount: c.groupCount, ...(c.groupCapacities ? { groupCapacities: c.groupCapacities } : {}) })),
    projects: state.projects.map(stageProjectDto),
  };
  return {
    ...base, domainConfigs: state.domainConfigs,
    projects: state.projects.map(p => ({ ...projectDto(p), password_set: !!p.password_hash && !p.password })),
  };
}
async function saveStaffOperation(req: Request, store: ReturnType<typeof createStore>, state: DatabaseState) {
  const session = (await getStaffSession(req))!;
  const action = req.path === '/api/projects' ? 'roster' : req.path === '/api/domain-configs' ? 'domains'
    : req.path === '/api/student/shared-password' ? (req.body.action === 'clear' ? 'password_clear' : 'password_generate')
    : req.path === '/api/lottery/draw' ? 'draw' : 'reset';
  const fields = action === 'draw' || action === 'reset'
    ? resolveLotteryFields(req.body, [...new Set([...state.domainConfigs.map(c => c.field), ...state.projects.map(p => p.field)])]) : null;
  const count = fields ? state.projects.filter(p => fields.has(p.field)).length : state.projects.length;
  const summary = fields ? `${count} 件專題；領域：${[...fields].join('、')}` : `${count} 件專題；${state.domainConfigs.length} 個領域`;
  return store.save(state, state.version, { actorId: session.userId, action, summary: summary.slice(0, 4096) });
}
function checkVersion(req: Request, state: DatabaseState) {
  if (!Number.isInteger(req.body.version)) throw new ApiError(400, '缺少資料版本，請重新整理。');
  if (req.body.version !== state.version) throw new ApiError(409, '資料已由其他人更新，請重新整理後再操作。');
}

app.get('/api/health', anonymousLimiter('health', 120, 3600), route(async (_req, res) => {
  await createStore().health();
  res.json({ status: 'ok' });
}));
app.post('/api/cloudflare/setup', route(async (req, res) => {
  const store = createStore();
  if (req.body.action === 'accounts') {
    res.json({ success: true, ...await store.putAccounts(req.body.accounts) });
  } else throw new ApiError(400, '無效帳號設定操作。');
}));
app.post('/api/auth/verify', loginLimiter('staff'), loginRoute('staff', async (req, res) => {
  const { username, password, targetView } = req.body;
  if (typeof username !== 'string' || username.length > 256 || typeof password !== 'string' || password.length > 128 || !['admin', 'stage'].includes(targetView)) throw new ApiError(400, '請輸入 Email、密碼與有效的登入頁面。');
  const account = await createStore().findAccount('email', username.trim().toLowerCase());
  if (!await verifyPassword(password, account?.password_hash) || !account) throw new ApiError(401, 'Email 或密碼不正確。');
  if (targetView === 'admin' && account.role !== 'admin') throw new ApiError(403, '此帳號尚未獲得操作權限。');
  const session = await createStaffSession(req, res, account, req.body.remember === true);
  res.json({ success: true, session });
}));
app.get('/api/auth/me', route(async (req, res) => {
  res.json({ success: true, session: (await getStaffSession(req))!.profile });
}));
app.post('/api/auth/logout', route(async (req, res) => {
  await clearStaffSession(req, res);
  res.json({ success: true });
}));
app.post('/api/student/verify', loginLimiter('student', 10, 1200), loginRoute('student', async (req, res) => {
  const { leaderId, password } = req.body;
  if (typeof leaderId !== 'string' || leaderId.length > 128 || typeof password !== 'string' || password.length > 128) throw new ApiError(400, '請輸入有效的組長學號與密碼。');
  const store = createStore();
  let project = await store.findProject('leader_key', leaderId.trim().toLowerCase());
  const valid = await verifyStudentPassword(password, project ?? undefined);
  if (!valid || !project) throw new ApiError(401, '學號或密碼不正確，尚未設定密碼者請洽大會管理員。');
  if (project.shared_password_mode === true) {
    // Other shards may rotate/disable credentials while this request waits.
    const current = await store.findProject('id', project.id);
    if (!current || current.password || current.shared_password_mode !== true || current.password_hash !== project.password_hash || current.leader_id.trim().toLowerCase() !== leaderId.trim().toLowerCase()) {
      throw new ApiError(401, '共用密碼已更新或停用，請使用最新密碼重新登入。');
    }
    project = current;
  }
  await createStudentSession(req, res, project);
  res.json({ success: true, sharedPasswordMode: project.shared_password_mode === true, project: project.shared_password_mode ? publicStudentProjectDto(project) : studentProjectDto(project) });
}));
app.get('/api/student/me', route(async (req, res) => {
  const project = await getStudentProject(req);
  res.json({ success: true, sharedPasswordMode: project.shared_password_mode === true, project: project.shared_password_mode ? publicStudentProjectDto(project) : studentProjectDto(project) });
}));
app.post('/api/student/logout', route(async (req, res) => {
  await clearStudentSession(req, res);
  res.json({ success: true });
}));
app.get('/api/state', route(async (req, res) => {
  const role = await authorize(req);
  res.json(staffState(await createStore().load(), role));
}));
app.get('/api/staff-logs', route(async (req, res) => {
  await authorize(req, true);
  if (Object.values(req.query).some(value => typeof value !== 'string')) throw new ApiError(400, '紀錄查詢條件不正確。');
  const result = await createStore().staffLogs({ before: req.query.before === undefined ? undefined : Number(req.query.before), action: req.query.action as string | undefined, email: req.query.email as string | undefined });
  res.json({ success: true, ...result });
}));
app.get('/api/projects', route(async (req, res) => {
  await authorize(req, true);
  res.json(staffState(await createStore().load(), 'admin'));
}));
app.get('/api/domain-configs', route(async (req, res) => {
  await authorize(req, true);
  const state = await createStore().load();
  res.json({ success: true, domainConfigs: state.domainConfigs, version: state.version });
}));
app.post('/api/projects', route(async (req, res) => {
  validateProjects(req.body.projects);
  if (runtimeEnv().LOGIN_LIMITER && req.body.projects.filter((p: { password?: string }) => p.password).length > 100) throw new ApiError(400, '單次最多設定 100 組學生密碼，請分批設定；無密碼名冊仍可匯入 2000 筆。');
  const store = createStore();
  const state = await store.load();
  checkVersion(req, state);
  // Validate the merged configuration before hashing passwords or saving the roster.
  const knownFields = new Set(state.domainConfigs.map(c => c.field));
  for (const p of req.body.projects) {
    if (!knownFields.has(p.field)) {
      state.domainConfigs.push({ id: `domain-${crypto.randomUUID()}`, field: p.field, groupCount: 2, evaluatorsPerGroup: {} });
      knownFields.add(p.field);
    }
  }
  validateDomains(state.domainConfigs);
  state.projects = await prepareProjects(req.body.projects, state.projects);
  res.json(staffState(await saveStaffOperation(req, store, state), 'admin'));
}));
app.post('/api/student/shared-password', route(async (req, res) => {
  await authorize(req, true);
  if (req.body.action !== 'generate' && req.body.action !== 'clear') throw new ApiError(400, '共用密碼操作無效。');
  const store = createStore();
  const state = await store.load();
  checkVersion(req, state);
  sharedPasswordHash(state.projects);
  if (!state.projects.length) throw new ApiError(400, '請先匯入學生名冊。');
  if (req.body.action === 'clear') {
    state.projects = state.projects.map(p => ({ ...projectDto(p) }));
    const saved = await saveStaffOperation(req, store, state);
    invalidateSharedPasswordVerification();
    res.json(staffState(saved, 'admin'));
    return;
  }
  const password = Array.from(randomBytes(8), byte => SHARED_PASSWORD_ALPHABET[byte & 31]).join('');
  const password_hash = await hashPassword(password);
  state.projects = state.projects.map(p => ({ ...projectDto(p), password_hash, shared_password_mode: true }));
  const saved = await saveStaffOperation(req, store, state);
  invalidateSharedPasswordVerification();
  res.json({ ...staffState(saved, 'admin'), password });
}));
app.post('/api/domain-configs', route(async (req, res) => {
  await authorize(req, true);
  validateDomains(req.body.domainConfigs);
  const store = createStore();
  const state = await store.load();
  checkVersion(req, state);
  const renamed = req.body.renamedField;
  if (renamed && (typeof renamed.oldName !== 'string' || typeof renamed.newName !== 'string')) throw new ApiError(400, '領域更名格式不正確。');
  const deletionError = domainDeletionError(state.projects, state.domainConfigs, req.body.domainConfigs);
  if (deletionError) throw new ApiError(409, deletionError);
  const changedPrefixes = (req.body.domainConfigs as typeof state.domainConfigs).filter(cfg => {
    const previous = state.domainConfigs.find(c => c.id === cfg.id);
    return previous && getDomainCode(previous.field, previous.drawPrefix) !== getDomainCode(cfg.field, cfg.drawPrefix);
  });
  if (renamed) state.projects = state.projects.map(p => p.field === renamed.oldName ? { ...p, field: renamed.newName } : p);
  const removedFields = state.domainConfigs.filter(c => !req.body.domainConfigs.some((next: { id: string }) => next.id === c.id)).map(c => c.field);
  state.domainConfigs = req.body.domainConfigs;
  state.projects = state.projects.map(p => {
    const updated = removedFields.includes(p.field) ? { ...p, field: state.domainConfigs[0]?.field || '未分類領域' } : p;
    const cfg = state.domainConfigs.find(c => c.field === updated.field);
    // Validate the resulting assignment before saving any configuration or project changes.
    if (updated.assigned_group && (!cfg || updated.assigned_group > cfg.groupCount)) {
      throw new ApiError(409, `「${updated.field}」仍有第 ${updated.assigned_group} 組的抽籤結果，無法移除該組；請先重設此領域再修改分組設定。`);
    }
    return updated.assigned_group && cfg ? { ...updated, evaluators: cfg.evaluatorsPerGroup?.[updated.assigned_group] || [] } : updated;
  });
  for (const cfg of state.domainConfigs) {
    const drawn = state.projects.filter(p => p.field === cfg.field && p.assigned_group);
    if (cfg.groupCapacities && drawn.length && Array.from({ length: cfg.groupCount }, (_, i) => i + 1)
      .some(group => drawn.filter(p => p.assigned_group === group).length !== cfg.groupCapacities![group])) {
      throw new ApiError(409, `「${cfg.field}」已有抽籤結果與各組設定件數不符，請先重設此領域再修改每組件數。`);
    }
  }
  for (const cfg of changedPrefixes) state.projects = relabelDomainResults(state.projects, cfg.field, cfg.drawPrefix);
  res.json(staffState(await saveStaffOperation(req, store, state), 'admin'));
}));
app.post('/api/lottery/test', route(async (req, res) => {
  await authorize(req, true);
  const state = await createStore().load();
  checkVersion(req, state);
  const field = req.body.field ?? 'ALL';
  if (typeof field !== 'string' || !field.trim()) throw new ApiError(400, '請選擇有效的測試領域。');
  if (!state.projects.some(p => field === 'ALL' || p.field === field)) throw new ApiError(400, '目前範圍內沒有專題可測試。');
  res.json(testLottery(state.projects, state.domainConfigs, field, state.version));
}));
app.post('/api/lottery/draw', route(async (req, res) => {
  const role = await authorize(req);
  const store = createStore();
  const state = await store.load();
  checkVersion(req, state);
  const fields = resolveLotteryFields(req.body, [...new Set([...state.domainConfigs.map(c => c.field), ...state.projects.map(p => p.field)])]);
  const pool = state.projects.filter(p => fields.has(p.field));
  if (!pool.length) throw new ApiError(400, '目前範圍內沒有專題。');
  if (pool.some(p => p.draw_order)) throw new ApiError(409, '此範圍已有抽籤結果，請先重設再抽籤。');
  try {
    const allocated = executeAllDomainsIndependentLottery(pool, state.domainConfigs).updatedProjects;
    const byId = new Map(allocated.map(p => [p.id, p]));
    state.projects = state.projects.map(p => byId.get(p.id) || p);
  } catch (error) {
    if (error instanceof LotteryAllocationError) throw new ApiError(400, error.message);
    throw error;
  }
  const saved = await saveStaffOperation(req, store, state);
  res.json({ ...staffState(saved, role), summary: `抽籤完成，${pool.length} 件專題結果已儲存。` });
}));
app.post('/api/lottery/reset', route(async (req, res) => {
  const role = await authorize(req);
  const store = createStore();
  const state = await store.load();
  checkVersion(req, state);
  const fields = resolveLotteryFields(req.body, [...new Set([...state.domainConfigs.map(c => c.field), ...state.projects.map(p => p.field)])]);
  state.projects = state.projects.map(p => fields.has(p.field) ? { ...p, assigned_group: null, draw_order: null, draw_code: null, draw_time: null, evaluators: [] } : p);
  res.json(staffState(await saveStaffOperation(req, store, state), role));
}));
app.use('/api', (_req, res) => { res.status(404).json({ success: false, error: '找不到此 API。' }); });
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const requestId = res.locals.requestId || randomUUID();
  res.setHeader('X-Request-ID', requestId);
  if (err instanceof ResourceBusyError) res.setHeader('Retry-After', err.retryAfter);
  const { status, body } = publicError(err, requestId);
  if (status >= 500) console.error('API request failed:', {
    requestId, status, type: err instanceof ApiError ? 'ApiError' : 'UnexpectedError',
  });
  res.status(status).json(body);
});
