import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createStore } from '../server/store';
import { withRuntime } from '../server/runtime';

test('snapshot RPC uses one DB request, includes more than 1000 results and never falls back on permission errors', async () => {
  let calls = 0;
  let version = 1;
  let denied = false;
  const rows = Array.from({ length: 1201 }, (_, i) => ({ draw_code: `A${i + 1}`, assigned_group: 1, project_title: '專題', leader_name: ' 林同學 ' }));
  const mock = http.createServer(async (req, res) => {
    assert.equal(req.url, '/rest/v1/rpc/ntcust_public_results_snapshot_v2');
    let input = ''; for await (const chunk of req) input += chunk;
    const body = JSON.parse(input);
    assert.equal(body.p_field, '智慧');
    calls++;
    res.setHeader('Content-Type', 'application/json');
    if (denied) { res.writeHead(403); res.end(JSON.stringify({ code: '42501' })); return; }
    res.end(JSON.stringify({ version, domain_configs: [{ id: 'a', field: '智慧', groupCount: 1 }], results: body.p_known_version === version ? null : version === 1 ? rows : [] }));
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  try {
    await withRuntime({ SUPABASE_URL: `http://127.0.0.1:${(mock.address() as { port: number }).port}`, SUPABASE_SECRET_KEY: 'test-secret' }, async () => {
      const first = await createStore().publicResults('智慧');
      assert.equal(calls, 1); assert.equal(first.results.length, 1201);
      assert.equal(first.results[0].leader_name, '林同學');
      assert.equal((await createStore().publicResults('智慧')).results.length, 1201);
      assert.equal(calls, 2);
      version++;
      assert.deepEqual((await createStore().publicResults('智慧')).results, []);
      assert.equal(calls, 3);
      denied = true;
      await assert.rejects(createStore().publicResults('智慧'), /抽籤結果暫時無法讀取/);
      assert.equal(calls, 4);
    });
  } finally { await new Promise<void>(resolve => mock.close(() => resolve())); }
});

test('public queries project only requested fields, paginate beyond 1000 rows and detect external resets', async () => {
  let version = 1;
  let reads = 0;
  let rows = Array.from({ length: 1201 }, (_, index) => ({
    draw_code: `A${index + 1}`, assigned_group: 1, project_title: `專題${index + 1}`, leader_name: '林同學',
  }));
  const mock = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/rest/v1/rpc/ntcust_public_results_snapshot_v2') { res.writeHead(404); res.end(JSON.stringify({ code: 'PGRST202' })); return; }
    if (url.pathname === '/rest/v1/ntcust_lottery_state') {
      assert.equal(url.searchParams.get('select'), 'version,domain_configs');
      res.end(JSON.stringify({ version, domain_configs: [{ id: 'a', field: '智慧', groupCount: 1 }] })); return;
    }
    assert.equal(url.pathname, '/rest/v1/ntcust_projects');
    assert.equal(url.searchParams.get('document->>field'), 'eq.智慧');
    assert.equal(url.searchParams.get('document->assigned_group'), 'gt.0');
    assert.equal(url.searchParams.get('select'), 'draw_code:document->>draw_code,assigned_group:document->assigned_group,project_title:document->>project_title,leader_name:document->>leader_name');
    reads++;
    const offset = Number(url.searchParams.get('offset') || 0);
    assert.equal(Number(url.searchParams.get('limit')), 500);
    res.end(JSON.stringify(rows.slice(offset, offset + 500)));
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const address = mock.address() as { port: number };
  try {
    await withRuntime({ SUPABASE_URL: `http://127.0.0.1:${address.port}`, SUPABASE_SECRET_KEY: 'test-secret' }, async () => {
      const first = await createStore().publicResults('智慧');
      assert.equal(first.results.length, 1201);
      assert.equal(reads, 3);
      assert.equal((await createStore().publicResults('智慧')).results.length, 1201);
      assert.equal(reads, 3, 'new store instances share cached results');
      version++; rows = [];
      assert.deepEqual((await createStore().publicResults('智慧')).results, []);
      assert.equal(reads, 4, 'external version change bypasses the old cache immediately');
    });
  } finally { await new Promise<void>(resolve => mock.close(() => resolve())); }
});
