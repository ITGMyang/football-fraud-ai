create table if not exists public.shared_prediction_results (
  fixture_id text not null,
  model_key text not null,
  model_id text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (fixture_id, model_key)
);

create index if not exists shared_prediction_results_updated_at_idx
  on public.shared_prediction_results (updated_at desc);

alter table public.shared_prediction_results enable row level security;

revoke all on public.shared_prediction_results from anon, authenticated;
grant select, insert, update, delete on public.shared_prediction_results to service_role;
