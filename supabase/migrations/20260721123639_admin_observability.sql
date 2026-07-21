create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  request_kind text not null check (request_kind in ('market', 'ranking')),
  model_name text not null,
  model_id text,
  provider text not null default 'unknown',
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  cost_usd numeric(14, 8) not null default 0 check (cost_usd >= 0),
  cost_reported boolean not null default false,
  status text not null check (status in ('success', 'error')),
  context_id text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_events_created_at_idx
  on public.ai_usage_events (created_at desc);
create index if not exists ai_usage_events_model_created_at_idx
  on public.ai_usage_events (model_name, created_at desc);
create index if not exists ai_usage_events_owner_created_at_idx
  on public.ai_usage_events (owner_id, created_at desc);

create table if not exists public.system_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists system_events_type_created_at_idx
  on public.system_events (event_type, created_at desc);

alter table public.ai_usage_events enable row level security;
alter table public.system_events enable row level security;

revoke all on public.ai_usage_events from anon, authenticated;
revoke all on public.system_events from anon, authenticated;
grant select, insert, update, delete on public.ai_usage_events to service_role;
grant select, insert, update, delete on public.system_events to service_role;
