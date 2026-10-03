import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, ApiRequestError, API_TIMEOUTS, isRequestCancelled } from '../src/lib/api';
import { getAuthSession, saveAuthSession, clearAuthSession } from '../src/lib/auth';

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

test('deadline aborts a stalled connection and never retries a write or clears authentication', async () => {
  const originalFetch = globalThis.fetch;
  const originalSession = getAuthSession();
  const session = { role: 'admin' as const, username: 'test', displayName: '', loginTime: '', expiresAt: Date.now() + 60000 };
  saveAuthSession(session);
  let calls = 0;
  let signal: AbortSignal | undefined;
  globalThis.fetch = async (_url, init) => {
    calls++;
    signal = init?.signal as AbortSignal;
    return new Promise<Response>(() => {});
  };
  try {
    await assert.rejects(apiRequest('/api/lottery/draw', { version: 1 }, { timeoutMs: 15 }), (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.kind, 'timeout');
      assert.equal(error.status, 0);
      assert.match(error.message, /無法確認操作是否完成.*重新載入確認結果/);
      return true;
    });
    assert.equal(signal?.aborted, true);
    assert.equal(calls, 1);
    assert.equal(getAuthSession(), session);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSession) saveAuthSession(originalSession); else clearAuthSession();
  }
});

test('deadline covers response body parsing, including a body that ignores the abort signal', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }) as Response;
  try {
    await assert.rejects(apiRequest('/api/state', undefined, { timeoutMs: 15 }), (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.kind, 'timeout');
      assert.match(error.message, /請求逾時/);
      assert.doesNotMatch(error.message, /無法確認操作是否完成/);
      return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});

test('caller cancellation aborts pending fetches; an already-aborted caller never starts fetch', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let signal: AbortSignal | undefined;
  globalThis.fetch = async (_url, init) => {
    calls++; signal = init?.signal as AbortSignal;
    return new Promise<Response>(() => {});
  };
  try {
    const caller = new AbortController();
    const pending = apiRequest('/api/state', undefined, { signal: caller.signal });
    caller.abort();
    await assert.rejects(pending, isRequestCancelled);
    assert.equal(signal?.aborted, true);
    await assert.rejects(apiRequest('/api/state', undefined, { signal: caller.signal }), isRequestCancelled);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('cancellation during body parsing cannot apply a late unauthorized response', async () => {
  const originalFetch = globalThis.fetch;
  const originalSession = getAuthSession();
  const session = { role: 'admin' as const, username: 'test', displayName: '', loginTime: '', expiresAt: Date.now() + 60000 };
  saveAuthSession(session);
  let finish!: (body: unknown) => void;
  const started = new Promise<void>(resolve => {
    globalThis.fetch = async () => ({
      ok: false, status: 401, json: () => { resolve(); return new Promise(body => { finish = body; }); },
    }) as Response;
  });
  try {
    const caller = new AbortController();
    const pending = apiRequest('/api/state', undefined, { signal: caller.signal });
    await started;
    caller.abort();
    await assert.rejects(pending, isRequestCancelled);
    finish({ success: false, error: 'expired' });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(getAuthSession(), session);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSession) saveAuthSession(originalSession); else clearAuthSession();
  }
});

test('successful requests clear deadlines and detach caller cancellation listeners', async () => {
  const originalFetch = globalThis.fetch;
  let signal: AbortSignal | undefined;
  globalThis.fetch = async (_url, init) => {
    signal = init?.signal as AbortSignal;
    return Response.json({ success: true, version: 1 });
  };
  try {
    const caller = new AbortController();
    assert.equal((await apiRequest('/api/state', undefined, { signal: caller.signal, timeoutMs: 15 })).version, 1);
    caller.abort();
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(signal?.aborted, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('default deadlines leave room for login admission and password hashing', async t => {
  const originalFetch = globalThis.fetch;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.fetch = async () => new Promise<Response>(() => {});
  try {
    for (const [url, body, deadline] of [
      ['/api/state', undefined, API_TIMEOUTS.read],
      ['/api/student/verify', { leaderId: 'test' }, API_TIMEOUTS.login],
      ['/api/projects', { version: 1 }, API_TIMEOUTS.write],
    ] as const) {
      const pending = apiRequest(url, body);
      const rejected = assert.rejects(pending, (error: unknown) => error instanceof ApiRequestError && error.kind === 'timeout');
      t.mock.timers.tick(deadline);
      await rejected;
    }
    await assert.rejects(apiRequest('/api/state', undefined, { timeoutMs: 0 }), RangeError);
    await assert.rejects(apiRequest('/api/state', undefined, { timeoutMs: Infinity }), RangeError);
  } finally { globalThis.fetch = originalFetch; t.mock.timers.reset(); }
});
