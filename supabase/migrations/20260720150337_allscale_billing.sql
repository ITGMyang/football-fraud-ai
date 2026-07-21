create table if not exists public.billing_orders (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null check (plan_id in ('day', 'week', 'month')),
  amount_cents integer not null check (amount_cents > 0),
  allscale_intent_id text unique,
  checkout_url text,
  status integer not null default 1,
  request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  expires_at timestamptz
);

create index if not exists billing_orders_owner_created_idx
  on public.billing_orders (owner_id, created_at desc);

create table if not exists public.billing_entitlements (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text check (plan_id in ('day', 'week', 'month')),
  valid_until timestamptz,
  free_prediction_used boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_webhooks (
  webhook_id text primary key,
  nonce text not null unique,
  intent_id text not null,
  transaction_id text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

alter table public.billing_orders enable row level security;
alter table public.billing_entitlements enable row level security;
alter table public.billing_webhooks enable row level security;

revoke all on public.billing_orders from anon, authenticated;
revoke all on public.billing_entitlements from anon, authenticated;
revoke all on public.billing_webhooks from anon, authenticated;
grant select, insert, update, delete on public.billing_orders to service_role;
grant select, insert, update, delete on public.billing_entitlements to service_role;
grant select, insert, update, delete on public.billing_webhooks to service_role;

create or replace function public.consume_free_prediction(p_owner_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  consumed boolean := false;
begin
  insert into public.billing_entitlements (owner_id, free_prediction_used, updated_at)
  values (p_owner_id, true, now())
  on conflict (owner_id) do update
    set free_prediction_used = true,
        updated_at = now()
    where public.billing_entitlements.free_prediction_used = false
  returning true into consumed;

  return coalesce(consumed, false);
end;
$$;

create or replace function public.release_free_prediction(p_owner_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.billing_entitlements
  set free_prediction_used = false,
      updated_at = now()
  where owner_id = p_owner_id
    and (valid_until is null or valid_until <= now());
$$;

create or replace function public.confirm_allscale_payment(
  p_intent_id text,
  p_webhook_id text,
  p_nonce text,
  p_transaction_id text default null,
  p_amount_cents integer default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payment_order public.billing_orders%rowtype;
  current_expiry timestamptz;
  next_expiry timestamptz;
  inserted_webhook text;
  duration interval;
begin
  select * into payment_order
  from public.billing_orders
  where allscale_intent_id = p_intent_id
  for update;

  if not found then
    raise exception 'billing order not found for intent %', p_intent_id;
  end if;

  if p_amount_cents is not null and p_amount_cents <> payment_order.amount_cents then
    raise exception 'payment amount mismatch';
  end if;

  insert into public.billing_webhooks (webhook_id, nonce, intent_id, transaction_id, payload)
  values (p_webhook_id, p_nonce, p_intent_id, p_transaction_id, coalesce(p_payload, '{}'::jsonb))
  on conflict (webhook_id) do nothing
  returning webhook_id into inserted_webhook;

  if inserted_webhook is null then
    select valid_until into current_expiry
    from public.billing_entitlements
    where owner_id = payment_order.owner_id;
    return jsonb_build_object(
      'duplicate', true,
      'ownerId', payment_order.owner_id,
      'validUntil', current_expiry
    );
  end if;

  duration := case payment_order.plan_id
    when 'day' then interval '24 hours'
    when 'week' then interval '7 days'
    when 'month' then interval '30 days'
    else null
  end;
  if duration is null then raise exception 'unsupported billing plan'; end if;

  select valid_until into current_expiry
  from public.billing_entitlements
  where owner_id = payment_order.owner_id
  for update;
  next_expiry := greatest(now(), coalesce(current_expiry, now())) + duration;

  insert into public.billing_entitlements (owner_id, plan_id, valid_until, updated_at)
  values (payment_order.owner_id, payment_order.plan_id, next_expiry, now())
  on conflict (owner_id) do update
    set plan_id = excluded.plan_id,
        valid_until = excluded.valid_until,
        updated_at = now();

  update public.billing_orders
  set status = 20,
      confirmed_at = now(),
      expires_at = next_expiry,
      updated_at = now()
  where id = payment_order.id;

  return jsonb_build_object(
    'duplicate', false,
    'ownerId', payment_order.owner_id,
    'planId', payment_order.plan_id,
    'validUntil', next_expiry
  );
end;
$$;

revoke execute on function public.consume_free_prediction(uuid) from public, anon, authenticated;
revoke execute on function public.release_free_prediction(uuid) from public, anon, authenticated;
revoke execute on function public.confirm_allscale_payment(text, text, text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.consume_free_prediction(uuid) to service_role;
grant execute on function public.release_free_prediction(uuid) to service_role;
grant execute on function public.confirm_allscale_payment(text, text, text, text, integer, jsonb) to service_role;
