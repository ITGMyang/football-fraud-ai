create table if not exists public.prediction_snapshots (
  id uuid primary key default gen_random_uuid(),
  fixture_id text not null,
  phase text not null check (phase in ('early', 'live')),
  model_key text not null,
  model_id text,
  payload jsonb not null,
  generated_at timestamptz not null default now()
);

create index if not exists prediction_snapshots_fixture_phase_idx
  on public.prediction_snapshots (fixture_id, phase, generated_at desc);
create index if not exists prediction_snapshots_model_generated_idx
  on public.prediction_snapshots (model_key, generated_at desc);

create table if not exists public.prediction_consensus (
  id uuid primary key default gen_random_uuid(),
  fixture_id text not null,
  phase text not null check (phase in ('early', 'live')),
  payload jsonb not null,
  source_snapshot_ids uuid[] not null default '{}',
  is_current boolean not null default true,
  generated_at timestamptz not null default now()
);

create unique index if not exists prediction_consensus_one_current_idx
  on public.prediction_consensus (fixture_id)
  where is_current;
create index if not exists prediction_consensus_fixture_generated_idx
  on public.prediction_consensus (fixture_id, generated_at desc);

create table if not exists public.model_weekly_performance (
  week_start date not null,
  model_key text not null,
  model_name text not null,
  samples integer not null default 0 check (samples >= 0),
  hits integer not null default 0 check (hits >= 0 and hits <= samples),
  accuracy double precision not null default 0 check (accuracy >= 0 and accuracy <= 1),
  eligible boolean not null default false,
  is_champion boolean not null default false,
  metrics jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (week_start, model_key)
);

create unique index if not exists model_weekly_performance_one_champion_idx
  on public.model_weekly_performance (week_start)
  where is_champion;

create table if not exists public.prediction_settings (
  key text primary key,
  champion_model_key text not null default 'qwen',
  live_model_keys jsonb not null default '["gpt","claude","gemini"]',
  model_weights jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.prediction_generation_leases (
  fixture_id text not null,
  phase text not null check (phase in ('early', 'live')),
  lease_id uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (fixture_id, phase)
);

create index if not exists prediction_generation_leases_expires_idx
  on public.prediction_generation_leases (expires_at);

insert into public.prediction_settings (
  key,
  champion_model_key,
  live_model_keys,
  model_weights
)
values (
  'default',
  'qwen',
  '["gpt","claude","gemini"]',
  '{"gpt":1,"claude":1,"gemini":1,"deepseek":1,"qwen":1}'
)
on conflict (key) do nothing;

alter table public.prediction_snapshots enable row level security;
alter table public.prediction_consensus enable row level security;
alter table public.model_weekly_performance enable row level security;
alter table public.prediction_settings enable row level security;
alter table public.prediction_generation_leases enable row level security;

revoke all on public.prediction_snapshots from public, anon, authenticated;
revoke all on public.prediction_consensus from public, anon, authenticated;
revoke all on public.model_weekly_performance from public, anon, authenticated;
revoke all on public.prediction_settings from public, anon, authenticated;
revoke all on public.prediction_generation_leases from public, anon, authenticated;

grant select, insert on public.prediction_snapshots to service_role;
grant select on public.prediction_consensus to service_role;
grant select, insert, update on public.model_weekly_performance to service_role;
grant select, update on public.prediction_settings to service_role;
grant select, insert, update, delete on public.prediction_generation_leases to service_role;

create or replace function public.publish_prediction_consensus(
  p_id uuid,
  p_fixture_id text,
  p_phase text,
  p_payload jsonb,
  p_source_snapshot_ids uuid[],
  p_generated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved public.prediction_consensus;
begin
  if p_phase not in ('early', 'live') then
    raise exception 'Invalid prediction phase';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_fixture_id, 0));

  update public.prediction_consensus
  set is_current = false
  where fixture_id = p_fixture_id
    and is_current;

  insert into public.prediction_consensus (
    id,
    fixture_id,
    phase,
    payload,
    source_snapshot_ids,
    is_current,
    generated_at
  )
  values (
    p_id,
    p_fixture_id,
    p_phase,
    p_payload,
    coalesce(p_source_snapshot_ids, '{}'),
    true,
    coalesce(p_generated_at, now())
  )
  returning * into saved;

  return to_jsonb(saved);
end;
$$;

revoke execute on function public.publish_prediction_consensus(uuid, text, text, jsonb, uuid[], timestamptz)
  from public, anon, authenticated;
grant execute on function public.publish_prediction_consensus(uuid, text, text, jsonb, uuid[], timestamptz)
  to service_role;

create or replace function public.reserve_prediction_generation(
  p_fixture_id text,
  p_phase text,
  p_lease_id uuid,
  p_ttl_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  active_lease uuid;
begin
  if p_phase not in ('early', 'live') then
    raise exception 'Invalid prediction phase';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_fixture_id || ':' || p_phase, 0));

  delete from public.prediction_generation_leases
  where fixture_id = p_fixture_id
    and phase = p_phase
    and expires_at <= now();

  insert into public.prediction_generation_leases (
    fixture_id,
    phase,
    lease_id,
    expires_at
  )
  values (
    p_fixture_id,
    p_phase,
    p_lease_id,
    now() + make_interval(secs => greatest(10, least(coalesce(p_ttl_seconds, 120), 600)))
  )
  on conflict (fixture_id, phase) do nothing;

  select lease_id into active_lease
  from public.prediction_generation_leases
  where fixture_id = p_fixture_id
    and phase = p_phase;

  return jsonb_build_object(
    'acquired', active_lease = p_lease_id,
    'leaseId', active_lease
  );
end;
$$;

create or replace function public.release_prediction_generation(
  p_lease_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer;
begin
  delete from public.prediction_generation_leases
  where lease_id = p_lease_id;
  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$$;

revoke execute on function public.reserve_prediction_generation(text, text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_prediction_generation(text, text, uuid, integer)
  to service_role;

revoke execute on function public.release_prediction_generation(uuid)
  from public, anon, authenticated;
grant execute on function public.release_prediction_generation(uuid)
  to service_role;
