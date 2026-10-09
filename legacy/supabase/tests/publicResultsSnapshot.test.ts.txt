import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('snapshot SQL returns only public fields in numeric order and restricts execution to the backend', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.ntcust_lottery_state(id integer primary key, version integer, domain_configs jsonb, updated_at timestamptz);
      insert into public.ntcust_lottery_state values(1, 5, '[{"id":"a","field":"智慧","groupCount":10}]', now());
      create table public.ntcust_projects(document jsonb, id text generated always as (document->>'id') stored primary key);`);
    const rows = Array.from({ length: 1201 }, (_, i) => ({ id: String(i), field: '智慧', assigned_group: i < 600 ? 2 : 10, draw_code: `A${i + 1}`, project_title: '專題', leader_name: '林同學', leader_id: 'secret-id', password_hash: 'secret' }));
    rows.push({ ...rows[0], id: 'pending', draw_code: '' });
    rows.push({ ...rows[0], id: 'other', field: '系統' });
    await db.query('insert into public.ntcust_projects(document) select value from jsonb_array_elements($1::jsonb)', [JSON.stringify(rows)]);
    const sql = await readFile(new URL('../supabase/migrations/202610080001_remove_draw_order.sql', import.meta.url), 'utf8');
    await db.exec(sql); await db.exec(sql);
    const read = async (field: string, known: number | null = null) => (await db.query<{ result: any }>('select public.ntcust_public_results_snapshot_v2($1,$2) as result', [field, known])).rows[0].result;
    await db.exec('set role service_role;');
    const result = await read('智慧');
    assert.equal(result.version, 7); assert.equal(result.results.length, 1201);
    assert.equal(result.results[0].draw_code, 'A1'); assert.equal(result.results[599].draw_code, 'A600'); assert.equal(result.results[600].assigned_group, 10);
    assert.deepEqual(Object.keys(result.results[0]).sort(), ['assigned_group', 'draw_code', 'leader_name', 'project_title']);
    assert.equal((await read('智慧', 7)).results, null);
    assert.deepEqual((await read('')).results, []);
    assert.deepEqual((await read('未知')).results, []);
    await db.exec('reset role; update public.ntcust_lottery_state set version = 8; delete from public.ntcust_projects; set role service_role;');
    assert.deepEqual((await read('智慧', 7)).results, []);
    for (const role of ['anon', 'authenticated']) {
      await db.exec('reset role; set role ' + role);
      await assert.rejects(read('智慧'), /permission denied/);
    }
  } finally { await db.close(); }
});
