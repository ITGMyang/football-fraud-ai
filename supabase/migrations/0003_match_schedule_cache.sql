create table if not exists public.match_schedules (
  id text primary key,
  competition_id text not null unique,
  payload jsonb not null,
  fetched_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.match_schedules enable row level security;

revoke all on table public.match_schedules from anon, authenticated;
grant select, insert, update, delete on table public.match_schedules to service_role;
