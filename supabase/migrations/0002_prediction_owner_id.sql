alter table public.reports
  add column if not exists owner_id text not null default 'legacy';

alter table public.rankings
  add column if not exists owner_id text not null default 'legacy';

create index if not exists reports_owner_created_at_idx
  on public.reports (owner_id, created_at desc);

create index if not exists rankings_owner_created_at_idx
  on public.rankings (owner_id, created_at desc);
