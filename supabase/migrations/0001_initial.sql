create table if not exists public.markets (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reports (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.rankings (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.match_contexts (
  id text primary key,
  source_url text unique,
  payload jsonb not null,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.markets enable row level security;
alter table public.reports enable row level security;
alter table public.rankings enable row level security;
alter table public.match_contexts enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.markets to service_role;
grant select, insert, update, delete on public.reports to service_role;
grant select, insert, update, delete on public.rankings to service_role;
grant select, insert, update, delete on public.match_contexts to service_role;
