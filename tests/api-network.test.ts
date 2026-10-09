import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, ApiRequestError } from '../src/lib/api';
import { getAuthSession, saveAuthSession, clearAuthSession } from '../src/lib/auth';
import { issueLoginChallenge, verifyLoginProof } from '../server/loginChallenge';
import { withRuntime } from '../server/runtime';

test('explicit pre-auth challenge is solved once without replaying network failures or arbitrary writes', async () => {
  const originalFetch = globalThis.fetch;
  const context = { scope: 'student', account: 'victim', ip: '127.0.0.1', password: 'correct-password' };
  const env = { SESSION_SECRET: 'browser-proof-test-secret' };
  const challenge = withRuntime(env, () => issueLoginChallenge(context));
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (calls === 1) return Response.json({ success: false, loginChallenge: challenge }, { status: 429 });
    const body = JSON.parse(String(init?.body));
    assert.equal(body.password, context.password);
    assert.equal(withRuntime(env, () => verifyLoginProof(body.loginProof, context)), true);
    return Response.json({ success: true });
  };
  try {
    assert.deepEqual(await apiRequest('/api/student/verify', { leaderId: context.account, password: context.password }), { success: true });
    assert.equal(calls, 2);
    calls = 0;
    await assert.rejects(apiRequest('/api/lottery/draw', { version: 1 }), (error: any) => error.status === 429);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('cancelling a login challenge prevents credential resubmission', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++; controller.abort();
    return Response.json({ success: false, loginChallenge: { token: 'x.' + 'a'.repeat(64), bits: 16 } }, { status: 429 });
  };
  try {
    await assert.rejects(apiRequest('/api/student/verify', { leaderId: 'victim', password: 'password' }, { signal: controller.signal }), /已取消/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('unsupported challenge is bounded and shows a verification error without resubmission', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ success: false, loginChallenge: { token: 'x.' + 'a'.repeat(64), bits: 24 } }, { status: 429 });
  };
  try {
    await assert.rejects(apiRequest('/api/student/verify', { leaderId: 'victim', password: 'password' }), /登入驗證無法完成/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('network failures show Chinese messages without clearing the staff session', async () => {
  const originalFetch = globalThis.fetch;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalSession = getAuthSession();
  const session = { role: 'admin' as const, username: 'preview', displayName: '管理員', loginTime: '', expiresAt: 9999999999 };
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  saveAuthSession(session);
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
    await assert.rejects(apiRequest('/api/state'), (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 0);
      assert.equal(error.message, '目前沒有網路連線，請檢查 Wi-Fi 或行動網路。');
      return true;
    });
    assert.equal(getAuthSession(), session);

    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    await assert.rejects(apiRequest('/api/student/me'), /無法連線至伺服器，請檢查網路連線或稍後再試。/);
    await assert.rejects(apiRequest('/api/lottery/draw', { field: 'ALL', version: 1 }), /無法確認操作是否完成，恢復連線後請重新載入確認結果/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
    if (originalSession) saveAuthSession(originalSession);
    else clearAuthSession();
  }
});

test('server validation messages and status remain available', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: false, error: '資料已更新，請重新整理。' }), { status: 409 });
  try {
    await assert.rejects(apiRequest('/api/projects', { version: 1 }), (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 409);
      assert.equal(error.message, '資料已更新，請重新整理。');
      return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});

test('read, login and write have separate deadlines', async () => {
  const { API_TIMEOUTS, requestTimeoutMs } = await import('../src/lib/api');
  assert.equal(requestTimeoutMs('/api/state', false), API_TIMEOUTS.read);
  assert.equal(requestTimeoutMs('/api/student/verify', true), API_TIMEOUTS.studentLogin);
  assert.equal(requestTimeoutMs('/api/student/me', false), API_TIMEOUTS.studentRead);
  assert.equal(requestTimeoutMs('/api/auth/verify', true), API_TIMEOUTS.login);
  assert.equal(requestTimeoutMs('/api/lottery/draw', true), API_TIMEOUTS.write);
});

test('timeout aborts a stalled fetch, leaves auth intact and never repeats a write', async () => {
  const originalFetch = globalThis.fetch;
  const originalSession = getAuthSession();
  const session = { role: 'admin' as const, username: 'test', displayName: '管理員', loginTime: '', expiresAt: 9999999999 };
  let calls = 0;
  let signal: AbortSignal | undefined;
  globalThis.fetch = (async (_url, options) => {
    calls++; signal = options?.signal as AbortSignal;
    // Intentionally ignore abort: caller must still finish at its deadline.
    return await new Promise<Response>(() => {});
  }) as typeof fetch;
  saveAuthSession(session);
  try {
    await assert.rejects(apiRequest('/api/lottery/draw', { version: 1 }, { timeoutMs: 15 }), /操作等候逾時.*無法確認.*請勿直接重複送出/);
    assert.equal(calls, 1);
    assert.equal(signal?.aborted, true);
    assert.equal(getAuthSession(), session);
  } finally { globalThis.fetch = originalFetch; if (originalSession) saveAuthSession(originalSession); else clearAuthSession(); }
});

test('deadline also covers stalled response JSON and ignores a late 401', async () => {
  const originalFetch = globalThis.fetch;
  const originalSession = getAuthSession();
  const session = { role: 'admin' as const, username: 'test', displayName: '管理員', loginTime: '', expiresAt: 9999999999 };
  let finishBody!: (value: unknown) => void;
  globalThis.fetch = async () => {
    const response = new Response(null, { status: 401 });
    response.json = () => new Promise(resolve => { finishBody = resolve; });
    return response;
  };
  saveAuthSession(session);
  try {
    await assert.rejects(apiRequest('/api/state', undefined, { timeoutMs: 15 }), /讀取逾時/);
    finishBody({ success: false, error: 'late expired' });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(getAuthSession(), session, 'late response must not expire the current session');
  } finally { globalThis.fetch = originalFetch; if (originalSession) saveAuthSession(originalSession); else clearAuthSession(); }
});

test('caller cancellation aborts transport; pre-cancelled request never sends', async () => {
  const { ApiRequestCancelledError } = await import('../src/lib/api');
  const originalFetch = globalThis.fetch;
  let calls = 0; let signal: AbortSignal | undefined;
  globalThis.fetch = (async (_url, options) => { calls++; signal = options?.signal as AbortSignal; return await new Promise<Response>(() => {}); }) as typeof fetch;
  try {
    const controller = new AbortController();
    const promise = apiRequest('/api/student/me', undefined, { signal: controller.signal, timeoutMs: 1000 });
    controller.abort();
    await assert.rejects(promise, ApiRequestCancelledError);
    assert.equal(signal?.aborted, true);
    await assert.rejects(apiRequest('/api/student/me', undefined, { signal: controller.signal }), ApiRequestCancelledError);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('successful response removes caller cancellation listeners and clears deadline', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let signal: AbortSignal | undefined;
  let added = 0; let removed = 0;
  const originalAdd = controller.signal.addEventListener.bind(controller.signal);
  const originalRemove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = ((...args: Parameters<AbortSignal['addEventListener']>) => { added++; originalAdd(...args); }) as AbortSignal['addEventListener'];
  controller.signal.removeEventListener = ((...args: Parameters<AbortSignal['removeEventListener']>) => { removed++; originalRemove(...args); }) as AbortSignal['removeEventListener'];
  globalThis.fetch = (async (_url, options) => { signal = options?.signal as AbortSignal; return new Response('{"success":true}'); }) as typeof fetch;
  try {
    await apiRequest('/api/state', undefined, { signal: controller.signal, timeoutMs: 15 });
    controller.abort();
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(signal?.aborted, false);
    assert.equal(added, 1); assert.equal(removed, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('an old request cannot clear a newly established staff session', async () => {
  const originalFetch = globalThis.fetch;
  const originalSession = getAuthSession();
  const oldSession = { role: 'admin' as const, username: 'old', displayName: '', loginTime: '', expiresAt: 9999999999 };
  const newSession = { ...oldSession, username: 'new' };
  let resolve!: (response: Response) => void;
  globalThis.fetch = () => new Promise<Response>(done => { resolve = done; });
  saveAuthSession(oldSession);
  try {
    const request = apiRequest('/api/state');
    saveAuthSession(newSession);
    resolve(new Response('{"success":false,"error":"expired"}', { status: 401 }));
    await assert.rejects(request, /expired/);
    assert.equal(getAuthSession(), newSession);
  } finally { globalThis.fetch = originalFetch; if (originalSession) saveAuthSession(originalSession); else clearAuthSession(); }
});

test('student reads retry a busy response once, while logins and other statuses are never replayed', async () => {
  const originalFetch = globalThis.fetch;
  const originalRandom = Math.random;
  Math.random = () => 0;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return calls === 1 ? new Response('{"success":false,"error":"busy"}', { status: 503, headers: { 'Retry-After': '0' } })
        : new Response('{"success":true,"project":{"project_title":"own project"}}');
    };
    assert.equal((await apiRequest<any>('/api/student/me')).project.project_title, 'own project');
    assert.equal(calls, 2);
    for (const status of [401, 429, 503]) {
      calls = 0;
      globalThis.fetch = async () => { calls++; return new Response('{"success":false,"error":"rejected"}', { status, headers: { 'Retry-After': '0' } }); };
      await assert.rejects(apiRequest('/api/student/verify', { leaderId: 'student', password: 'secret' }), ApiRequestError);
      assert.equal(calls, 1, 'login must never be replayed');
      if (status !== 503) {
        calls = 0;
        await assert.rejects(apiRequest('/api/student/me'), ApiRequestError);
        assert.equal(calls, 1);
      }
    }
    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('{"success":false,"error":"busy"}', { status: 503, headers: { 'Retry-After': '0' } }); };
    await assert.rejects(apiRequest('/api/student/me'), ApiRequestError);
    assert.equal(calls, 2, 'a second 503 ends the bounded retry');
  } finally { globalThis.fetch = originalFetch; Math.random = originalRandom; }
});

test('student read retry respects the deadline, long Retry-After, and cancellation during backoff', async () => {
  const { ApiRequestCancelledError } = await import('../src/lib/api');
  const originalFetch = globalThis.fetch;
  const originalRandom = Math.random;
  Math.random = () => 0;
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return new Response('{"success":false,"error":"busy"}', { status: 503, headers: { 'Retry-After': '60' } }); };
    await assert.rejects(apiRequest('/api/student/me'), ApiRequestError);
    assert.equal(calls, 1, 'do not retry earlier than a long server delay');
    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('{"success":false,"error":"busy"}', { status: 503, headers: { 'Retry-After': '2' } }); };
    await assert.rejects(apiRequest('/api/student/me', undefined, { timeoutMs: 100 }), ApiRequestError);
    assert.equal(calls, 1, 'do not start a retry beyond the original deadline');
    calls = 0;
    const controller = new AbortController();
    const pending = apiRequest('/api/student/me', undefined, { timeoutMs: 10000, signal: controller.signal });
    const aborted = assert.rejects(pending, ApiRequestCancelledError);
    await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort();
    await aborted;
    assert.equal(calls, 1, 'cancelling backoff must prevent another fetch');
  } finally { globalThis.fetch = originalFetch; Math.random = originalRandom; }
});

test('student read retries a transient transport failure once', async () => {
  const originalFetch = globalThis.fetch;
  const originalRandom = Math.random;
  Math.random = () => 0;
  let calls = 0;
  try {
    globalThis.fetch = async () => { if (++calls === 1) throw new TypeError('connection reset'); return new Response('{"success":true}'); };
    await apiRequest('/api/student/me');
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; Math.random = originalRandom; }
});
