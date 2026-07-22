create table if not exists public.prediction_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  fixture_id text not null,
  plan_id text not null,
  status text not null default 'running' check (status in ('queued', 'running', 'success', 'error')),
  cached boolean not null default false,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists prediction_requests_owner_created_idx
  on public.prediction_requests (owner_id, created_at desc);
create index if not exists prediction_requests_status_created_idx
  on public.prediction_requests (status, created_at desc);

alter table public.prediction_requests enable row level security;
revoke all on public.prediction_requests from anon, authenticated;
grant select, insert, update, delete on public.prediction_requests to service_role;

create or replace function public.reserve_prediction_request(
  p_owner_id uuid,
  p_fixture_id text,
  p_plan_id text,
  p_daily_limit integer,
  p_cooldown_seconds integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_id uuid;
  used_today integer := 0;
  latest_created_at timestamptz;
  retry_after_seconds integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 0));

  if p_plan_id <> 'developer' then
    if exists (
      select 1 from public.prediction_requests
      where owner_id = p_owner_id
        and status in ('queued', 'running')
        and created_at > now() - interval '10 minutes'
    ) then
      return jsonb_build_object('ok', false, 'code', 'PREDICTION_QUEUE_BUSY', 'retryAfterSeconds', 30);
    end if;

    select max(created_at) into latest_created_at
    from public.prediction_requests
    where owner_id = p_owner_id
      and status in ('running', 'success');

    if latest_created_at is not null and latest_created_at > now() - make_interval(secs => greatest(p_cooldown_seconds, 0)) then
      retry_after_seconds := greatest(1, ceil(extract(epoch from (latest_created_at + make_interval(secs => p_cooldown_seconds) - now())))::integer);
      return jsonb_build_object('ok', false, 'code', 'PREDICTION_COOLDOWN', 'retryAfterSeconds', retry_after_seconds);
    end if;

    select count(*) into used_today
    from public.prediction_requests
    where owner_id = p_owner_id
      and status in ('running', 'success')
      and (created_at at time zone 'Asia/Shanghai')::date = (now() at time zone 'Asia/Shanghai')::date;

    if p_daily_limit is not null and used_today >= p_daily_limit then
      return jsonb_build_object('ok', false, 'code', 'DAILY_PREDICTION_LIMIT', 'usedToday', used_today, 'dailyLimit', p_daily_limit);
    end if;
  end if;

  insert into public.prediction_requests (owner_id, fixture_id, plan_id, status)
  values (p_owner_id, p_fixture_id, p_plan_id, 'running')
  returning id into request_id;

  return jsonb_build_object(
    'ok', true,
    'requestId', request_id,
    'usedToday', used_today + 1,
    'dailyLimit', p_daily_limit
  );
end;
$$;

revoke execute on function public.reserve_prediction_request(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_prediction_request(uuid, text, text, integer, integer) to service_role;
