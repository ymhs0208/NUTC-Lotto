-- Staff credentials and account preferences are accessible only by the backend.
create table if not exists public.ntcust_staff_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists ntcust_staff_sessions_expiry on public.ntcust_staff_sessions (expires_at);
create table if not exists public.ntcust_staff_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sound_enabled boolean not null default true
);
alter table public.ntcust_staff_sessions enable row level security;
alter table public.ntcust_staff_preferences enable row level security;
revoke all on public.ntcust_staff_sessions, public.ntcust_staff_preferences from public, anon, authenticated;
grant select, insert, delete on public.ntcust_staff_sessions to service_role;
grant select, insert, update on public.ntcust_staff_preferences to service_role;
