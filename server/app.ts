import { hasDrawData, duplicateDrawCodeError, projectFieldChangeError } from '../src/lib/drawScope';
import express, { type Request, type Response, type NextFunction } from 'express';
import { database } from './database';
import { verifyPassword } from './credentials';
import { randomUUID, randomBytes } from 'node:crypto';
import { createStore, ApiError, validateProjects, validateDomains, type DatabaseState } from './store';
import { projectDto, stageProjectDto, studentProjectDto, publicStudentProjectDto, prepareProjects, verifyStudentPassword, invalidateSharedPasswordVerification, hashPassword, sharedPasswordHash } from './credentials';
import { createStudentSession, getStudentProject, clearStudentSession } from './studentSessions';
import { createStaffSession, getStaffSession, clearStaffSession } from './staffSessions';
import { loginLimiter, anonymousLimiter, sessionLimiter } from './rateLimit';
import { readSessionToken, sessionScopeForPath, sessionWork } from './sessionSecurity';
import { studentLoginWork, staffLoginWork } from './loginAdmission';
import { ResourceBusyError } from './resourceLimits';
import { runtimeEnv } from './runtime';
import { publicError } from './errors';
import { auditQuery, type AuditActor } from './audit';
import { auditActionLabels, type AuditAction } from '../src/lib/auditTypes';
import { executeAllDomainsIndependentLottery } from '../src/lib/lottery';
import { LotteryAllocationError } from '../src/lib/groupCapacities';
import { resolveLotteryFields } from './lotteryScope';
import { domainDeletionError } from '../src/lib/domainDeletion';
import { testLottery } from '../src/lib/lotteryTest';
import { domainCodeCollisionError, getDrawCodeNamespace, sortDomainConfigs } from '../src/lib/domainCodes';
import type { ProjectItem } from '../src/types';

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
// Authenticate roster writes before accepting their larger body allowance.
app.post(['/api/projects', '/api/data/import'], (req, _res, next) => { void authorize(req, true).then(() => next()).catch(next); });
const loginJson = express.json({ limit: '4kb' });
const rosterJson = express.json({ limit: '5mb' });
const smallJson = express.json({ limit: '64kb' });
app.use((req, res, next) => {
  const path = req.path.toLowerCase().replace(/\/+$/, '');
  const parser = ['/api/auth/verify', '/api/student/verify'].includes(path) ? loginJson
    : ['/api/projects', '/api/data/import'].includes(path) && req.method === 'POST' ? rosterJson : smallJson;
  parser(req, res, next);
});
app.use('/api', (req, res, next) => {
  if (req.method === 'POST' && (!req.body || Array.isArray(req.body))) {
    res.status(400).json({ success: false, error: '請使用有效的 JSON 物件。' }); return;
  }
  next();
});
// Reject blank login fields before rate-limit buckets, queues or upstream work.
app.use((req, _res, next) => {
  const path = req.path.toLowerCase().replace(/\/+$/, '');
  if (req.method !== 'POST' || !['/api/auth/verify', '/api/student/verify'].includes(path)) return next();
  const staff = path === '/api/auth/verify';
  const account = staff ? req.body?.username : req.body?.leaderId;
  if (typeof account !== 'string' || !account.trim()) {
    return next(new ApiError(400, staff ? '請輸入登入 Email。' : '請輸入組長學號。'));
  }
  if (typeof req.body?.password !== 'string' || !req.body.password.trim()) {
    return next(new ApiError(400, staff ? '請輸入通行密碼。' : '請輸入大會提供的密碼登入。'));
  }
  next();
});
const route = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { Promise.resolve(handler(req, res)).catch(next); };

const loginRoute = (scope: 'staff' | 'student', handler: (req: Request, res: Response) => Promise<unknown>) =>
  route((req, res) => (scope === 'student' ? studentLoginWork : staffLoginWork).run(() => handler(req, res)));

const staffIdentities = new WeakMap<Request, NonNullable<Awaited<ReturnType<typeof getStaffSession>>>>();
async function staffIdentity(req: Request) {
  const cached = staffIdentities.get(req);
  if (cached) return cached;
  const identity = (await getStaffSession(req))!;
  staffIdentities.set(req, identity);
  return identity;
}
async function auditActor(req: Request): Promise<AuditActor> {
  const identity = await staffIdentity(req);
  return { userId: identity.userId, email: identity.profile.username, role: identity.profile.role };
}
async function stateAudit(req: Request, action: AuditAction, fields: string[], count: number, version: number) {
  return { actor: await auditActor(req), action, details: { fields, project_count: count, version: version + 1, summary: auditActionLabels[action] } };
}
async function authorize(req: Request, adminOnly = false) {
  const role = (await staffIdentity(req)).profile.role;
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
    domainConfigs: state.domainConfigs.map(c => ({ id: c.id, field: c.field, groupCount: c.groupCount, ...(c.code ? { code: c.code } : {}), ...(c.groupCapacities ? { groupCapacities: c.groupCapacities } : {}) })),
    projects: state.projects.map(stageProjectDto),
  };
  return {
    ...base, domainConfigs: state.domainConfigs,
    projects: state.projects.map(p => ({ ...projectDto(p), password_set: !!p.password_hash && !p.password })),
  };
}
function checkVersion(req: Request, state: DatabaseState) {
  if (!Number.isInteger(req.body.version)) throw new ApiError(400, '缺少資料版本，請重新整理。');
  if (req.body.version !== state.version) throw new ApiError(409, '資料已由其他人更新，請重新整理後再操作。');
}

app.get('/api/health', anonymousLimiter('health', 120, 3600), route(async (_req, res) => {
  await createStore().health();
  res.json({ status: 'ok' });
}));
app.get('/api/public/results', anonymousLimiter('results', 1200, 12000), route(async (req, res) => {
  const field = req.query.field;
  if (field !== undefined && (typeof field !== 'string' || field.length > 512)) throw new ApiError(400, '請選擇有效的領域。');
  res.json({ success: true, ...await createStore().publicResults(field as string | undefined) });
}));
app.post('/api/auth/verify', loginLimiter('staff'), loginRoute('staff', async (req, res) => {
  const { username, password, targetView } = req.body;
  if (typeof username !== 'string' || username.length > 256 || typeof password !== 'string' || password.length > 128 || !['admin', 'stage'].includes(targetView)) throw new ApiError(400, '請輸入 Email、密碼與有效的登入頁面。');
  const account = await database().call('findStaff', { email: username });
  const valid = await verifyPassword(password, account?.password_hash);
  if (!valid || !account) throw new ApiError(401, 'Email 或密碼不正確。');
  if (targetView === 'admin' && account.role !== 'admin') throw new ApiError(403, '此帳號尚未獲得操作權限。');
  const session = await createStaffSession(req, res, account, req.body.remember === true);
  res.json({ success: true, session });
}));
app.get('/api/auth/me', route(async (req, res) => {
  res.json({ success: true, session: (await getStaffSession(req))!.profile });
}));
app.post('/api/auth/logout', route(async (req, res) => {
  let actor: AuditActor | undefined;
  if (readSessionToken(req, 'staff')) {
    try { actor = await auditActor(req); }
    catch (error) { if (!(error instanceof ApiError) || ![401, 403].includes(error.status)) throw error; }
  }
  await clearStaffSession(req, res, actor);
  res.json({ success: true });
}));
app.post('/api/student/verify', loginLimiter('student', 10, 1200), loginRoute('student', async (req, res) => {
  const { leaderId, password } = req.body;
  if (typeof leaderId !== 'string' || leaderId.length > 128 || typeof password !== 'string' || password.length > 128) throw new ApiError(400, '請輸入有效的組長學號與密碼。');
  const store = createStore();
  let project = await store.findProject('leader_key', leaderId.trim().toLowerCase());
  const valid = await verifyStudentPassword(password, project);
  if (!valid || !project) throw new ApiError(401, '學號或密碼不正確，若仍無法登入，請洽大會管理員。');
  // The RPC rechecks credentials and replaces the session atomically.
  project = await createStudentSession(req, res, project);
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
app.get('/api/staff-audit', route(async (req, res) => {
  await authorize(req, true);
  const filters = auditQuery(req.query);
  const result = await sessionWork.run(() => database().call('audit', filters));
  res.json({ success: true, enabled: true, ...result });
}));
app.get('/api/state', route(async (req, res) => {
  const role = await authorize(req);
  res.json(staffState(await createStore().load(), role));
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
  // Validate the complete configuration before preparing passwords or saving
  // anything. Existing empty domains also count towards the setting limit.
  const domainConfigs = [...state.domainConfigs];
  for (const p of req.body.projects) {
    if (!domainConfigs.some(c => c.field === p.field)) domainConfigs.push({ id: `domain-${crypto.randomUUID()}`, field: p.field, groupCount: 2, evaluatorsPerGroup: {} });
  }
  validateDomains(domainConfigs);
  const previousById = new Map(state.projects.map(p => [p.id, p]));
  const previousByLeader = new Map(state.projects.map(p => [p.leader_id.trim().toLowerCase(), p]));
  const configsByField = new Map(domainConfigs.map(c => [c.field, c]));
  for (const project of req.body.projects) {
    // Imported files may replace IDs; match the existing student as well.
    for (const previous of [previousById.get(project.id), previousByLeader.get(project.leader_id.trim().toLowerCase())]) {
      const changeError = previous && projectFieldChangeError(previous, project.field);
      if (changeError) throw new ApiError(409, changeError);
    }
    const cfg = configsByField.get(project.field)!;
    if (project.assigned_group != null && project.assigned_group > cfg.groupCount) {
      throw new ApiError(400, `「${project.field}」僅設定 ${cfg.groupCount} 組，專題「${project.project_title}」的第 ${project.assigned_group} 場次無效，請確認名冊或先重設抽籤結果。`);
    }
  }
  const projects = req.body.projects.map((project: ProjectItem) => ({
    ...project,
    evaluators: project.assigned_group
      ? configsByField.get(project.field)!.evaluatorsPerGroup?.[project.assigned_group] || []
      : [],
  }));
  state.projects = await prepareProjects(projects, state.projects);
  state.domainConfigs = domainConfigs;
  res.json(staffState(await store.save(state, state.version, undefined, await auditActor(req)), 'admin'));
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
    const saved = await store.save(state, state.version, await stateAudit(req, 'shared_password_clear', [], state.projects.length, state.version));
    invalidateSharedPasswordVerification();
    res.json(staffState(saved, 'admin'));
    return;
  }
  const password = Array.from(randomBytes(8), byte => SHARED_PASSWORD_ALPHABET[byte & 31]).join('');
  const password_hash = await hashPassword(password);
  state.projects = state.projects.map(p => ({ ...projectDto(p), password_hash, shared_password_mode: true }));
  const saved = await store.save(state, state.version, await stateAudit(req, 'shared_password_generate', [], state.projects.length, state.version));
  invalidateSharedPasswordVerification();
  res.json({ ...staffState(saved, 'admin'), password });
}));
app.post('/api/domain-configs', route(async (req, res) => {
  await authorize(req, true);
  validateDomains(req.body.domainConfigs);
  const store = createStore();
  const state = await store.load();
  checkVersion(req, state);
  for (const next of req.body.domainConfigs) {
    const previous = state.domainConfigs.find(c => c.id === next.id);
    if (previous && getDrawCodeNamespace(previous.field, state.domainConfigs) !== getDrawCodeNamespace(next.field, req.body.domainConfigs)
      && state.projects.some(p => p.field === previous.field && (hasDrawData(p)))) {
      throw new ApiError(409, `「${previous.field}」已有抽籤結果，請先重設此領域再修改對應字母。`);
    }
  }
  const renamed = req.body.renamedField;
  if (renamed && (typeof renamed.oldName !== 'string' || typeof renamed.newName !== 'string')) throw new ApiError(400, '領域更名格式不正確。');
  const deletionError = domainDeletionError(state.projects, state.domainConfigs, req.body.domainConfigs);
  if (deletionError) throw new ApiError(409, deletionError);
  if (renamed) state.projects = state.projects.map(p => p.field === renamed.oldName ? { ...p, field: renamed.newName } : p);
  const removedFields = state.domainConfigs.filter(c => !req.body.domainConfigs.some((next: { id: string }) => next.id === c.id)).map(c => c.field);
  state.domainConfigs = sortDomainConfigs(req.body.domainConfigs);
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
  const collision = domainCodeCollisionError([...state.domainConfigs.map(c => c.field), ...state.projects.map(p => p.field)], state.domainConfigs);
  if (collision) throw new ApiError(400, collision);
  res.json(staffState(await store.save(state, state.version, undefined, await auditActor(req)), 'admin'));
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
  if (pool.some(hasDrawData)) throw new ApiError(409, '此範圍已有抽籤結果，請先重設再抽籤。');
  const collision = domainCodeCollisionError([...state.domainConfigs.map(c => c.field), ...state.projects.map(p => p.field)], state.domainConfigs);
  if (collision) throw new ApiError(400, collision);
  try {
    const allocated = executeAllDomainsIndependentLottery(pool, state.domainConfigs).updatedProjects;
    const byId = new Map(allocated.map(p => [p.id, p]));
    state.projects = state.projects.map(p => byId.get(p.id) || p);
    const duplicate = duplicateDrawCodeError(state.projects);
    if (duplicate) throw new LotteryAllocationError(`${duplicate}結果未儲存，請先修正或重設衝突領域。`);
  } catch (error) {
    if (error instanceof LotteryAllocationError) throw new ApiError(400, error.message);
    throw error;
  }
  const saved = await store.save(state, state.version, await stateAudit(req, 'draw', [...fields], pool.length, state.version));
  res.json({ ...staffState(saved, role), summary: `抽籤完成，${pool.length} 件專題結果已儲存。` });
}));
app.post('/api/lottery/reset', route(async (req, res) => {
  const role = await authorize(req);
  const store = createStore();
  const state = await store.load();
  checkVersion(req, state);
  const fields = resolveLotteryFields(req.body, [...new Set([...state.domainConfigs.map(c => c.field), ...state.projects.map(p => p.field)])]);
  state.projects = state.projects.map(p => fields.has(p.field) ? { ...p, assigned_group: null, draw_code: null, draw_time: null, evaluators: [] } : p);
  res.json(staffState(await store.save(state, state.version, await stateAudit(req, 'reset', [...fields], state.projects.filter(p => fields.has(p.field)).length, state.version)), role));
}));
app.get('/api/staff-accounts', route(async (req, res) => {
  await authorize(req, true);
  res.json({ success: true, accounts: await database().call('staffAccounts', { actor: await auditActor(req) }) });
}));
app.post('/api/staff-accounts', route(async (req, res) => {
  await authorize(req, true);
  const { email, role, password, disabled } = req.body;
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 256 || !['admin', 'stage'].includes(role) || typeof disabled !== 'boolean' ||
    (password !== undefined && (typeof password !== 'string' || password.trim().length < 12 || password.length > 128))) throw new ApiError(400, '請填寫有效帳號、角色與至少 12 字元的密碼。');
  const passwordHash = password ? await hashPassword(password) : undefined;
  await database().call('setStaffAccount', { actor: await auditActor(req), email, role, passwordHash, disabled });
  res.json({ success: true });
}));
app.get('/api/data/export', route(async (req, res) => {
  await authorize(req, true);
  res.setHeader('Content-Disposition', 'attachment; filename="lottery-backup.json"');
  res.json({ success: true, format: 'lottery-sqlite-v1', ...await createStore().load() });
}));
app.post('/api/data/import', route(async (req, res) => {
  await authorize(req, true);
  const source = req.body;
  if (!Array.isArray(source.projects) || !Array.isArray(source.domainConfigs)) throw new ApiError(400, '移轉資料格式無效。');
  // Migration intentionally drops old credentials; set new student passwords after import.
  validateProjects(source.projects.map((p: any) => {
    if (!p || typeof p !== 'object') return p;
    const { password_hash, shared_password_mode, ...publicFields } = p;
    return publicFields;
  }));
  const projects = source.projects.map(projectDto);
  validateProjects(projects); validateDomains(source.domainConfigs);
  const state = { projects, domainConfigs: sortDomainConfigs(source.domainConfigs), version: 0, lastUpdated: new Date().toISOString() };
  const result = await database().call('importState', { actor: await auditActor(req), state });
  res.json(staffState(result, 'admin'));
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
