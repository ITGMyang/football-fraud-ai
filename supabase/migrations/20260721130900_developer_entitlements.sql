alter table public.billing_entitlements
  drop constraint if exists billing_entitlements_plan_id_check;

alter table public.billing_entitlements
  add constraint billing_entitlements_plan_id_check
  check (plan_id in ('day', 'week', 'month', 'developer'));
