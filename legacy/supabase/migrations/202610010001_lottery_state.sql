-- Run once in Supabase SQL Editor. All writes go through the authenticated server API.
-- A single state row preserves every project field and commits roster/config changes atomically.
create table if not exists public.ntcust_lottery_state (
  id smallint primary key check (id = 1),
  projects jsonb not null default '[]'::jsonb check (jsonb_typeof(projects) = 'array'),
  domain_configs jsonb not null default '[]'::jsonb check (jsonb_typeof(domain_configs) = 'array'),
  version integer not null default 0 check (version >= 0),
  updated_at timestamptz not null default now()
);

alter table public.ntcust_lottery_state enable row level security;
revoke all on public.ntcust_lottery_state from anon, authenticated;
grant select, insert, update on public.ntcust_lottery_state to service_role;

insert into public.ntcust_lottery_state (id, domain_configs)
values (1, '[
  {"id":"domain-1","field":"企業智慧化","groupCount":2,"evaluatorsPerGroup":{}},
  {"id":"domain-2","field":"嵌入式系統與行動計算","groupCount":2,"evaluatorsPerGroup":{}},
  {"id":"domain-3","field":"智慧流通應用與研究","groupCount":2,"evaluatorsPerGroup":{}},
  {"id":"domain-4","field":"智慧運算創新應用","groupCount":5,"evaluatorsPerGroup":{}},
  {"id":"domain-5","field":"進修部","groupCount":1,"evaluatorsPerGroup":{}},
  {"id":"domain-6","field":"網路應用與資通安全","groupCount":5,"evaluatorsPerGroup":{}},
  {"id":"domain-7","field":"數位內容與多媒體應用","groupCount":2,"evaluatorsPerGroup":{}}
]'::jsonb)
on conflict (id) do nothing;
