import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('public index supports domain filtering and numeric ordering without a sort, and follows resets', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.ntcust_lottery_state(id integer primary key, version integer, updated_at timestamptz, domain_configs jsonb);
      insert into public.ntcust_lottery_state values(1, 1, now(), '[]');
      create table public.ntcust_projects (
      document jsonb not null,
      id text generated always as (document ->> 'id') stored primary key
    );`);
    const projects = [
      { id: 'a', field: '智慧', assigned_group: 2, draw_code: 'A10', draw_order: 99, password_hash: 'preserve-me' },
      { id: 'b', field: '智慧', assigned_group: 2, draw_code: 'A02' },
      { id: 'c', field: '智慧', assigned_group: 1, draw_code: 'A01' },
      { id: 'd', field: '智慧', assigned_group: 10, draw_code: 'A11' },
      { id: 'e', field: '智慧', assigned_group: 2, draw_code: 'A03' },
      { id: 'f', field: '系統', assigned_group: 1, draw_code: 'B01' },
      { id: 'g', field: '智慧', assigned_group: 1, draw_code: null },
      { id: 'h', field: '智慧', assigned_group: 1, draw_code: '' },
      { id: 'i', field: '智慧', assigned_group: 1, draw_order: 1 },
    ];
    await db.query('insert into public.ntcust_projects(document) select value from jsonb_array_elements($1::jsonb)', [JSON.stringify(projects)]);
    const before = await db.query("select document - 'draw_order' as document from public.ntcust_projects order by id");
    const migration = await readFile(new URL('../supabase/migrations/202610080001_remove_draw_order.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual(await db.query("select document - 'draw_order' as document from public.ntcust_projects order by id"), before);
    assert.equal((await db.query("select id from public.ntcust_projects where document ? 'draw_order'")).rows.length, 0);
    await assert.rejects(db.exec(`update public.ntcust_projects set document = document || '{"draw_order":1}'::jsonb where id = 'c'`), /ntcust_project_no_draw_order/);
    const query = `select id from public.ntcust_projects
      where document ->> 'field' = '智慧'
        and jsonb_typeof(document -> 'assigned_group') = 'number'
        and document -> 'assigned_group' > '0'::jsonb
        and (document ->> 'assigned_group')::numeric = trunc((document ->> 'assigned_group')::numeric)
        and document ->> 'draw_code' is not null
        and btrim(document ->> 'draw_code') <> ''
      order by document -> 'assigned_group' asc nulls last, regexp_replace(document ->> 'draw_code', '[0-9]+$', '') asc,
        substring(document ->> 'draw_code' from '([0-9]+)$')::numeric asc nulls first, document ->> 'draw_code' asc, id asc limit 50`;
    assert.deepEqual((await db.query<{ id: string }>(query)).rows.map(row => row.id), ['c', 'b', 'e', 'a', 'd']);
    // Force eligibility inspection on this small fixture; this is not a speed benchmark.
    await db.exec('set enable_seqscan = off;');
    const plan = (await db.query<{ 'QUERY PLAN': any }>('explain (format json) ' + query)).rows[0]['QUERY PLAN'][0].Plan;
    const nodes: any[] = [];
    const walk = (node: any) => { nodes.push(node); (node.Plans || []).forEach(walk); };
    walk(plan);
    assert.ok(nodes.some(node => node['Index Name'] === 'ntcust_projects_public_results'));
    assert.ok(nodes.every(node => node['Node Type'] !== 'Sort'));
    await db.exec(`update public.ntcust_projects set document = document || '{"draw_code":null}'::jsonb where id = 'b';`);
    assert.deepEqual((await db.query<{ id: string }>(query)).rows.map(row => row.id), ['c', 'e', 'a', 'd']);
  } finally { await db.close(); }
});
