create table if not exists public.api_football_catalog_cache (
  cache_key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.api_football_catalog_cache enable row level security;

revoke all on table public.api_football_catalog_cache from anon, authenticated;
grant select, insert, update, delete on table public.api_football_catalog_cache to service_role;

