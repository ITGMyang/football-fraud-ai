alter table public.markets
  add column if not exists owner_id text not null default 'legacy';

alter table public.match_contexts
  add column if not exists owner_id text not null default 'legacy';

alter table public.markets drop constraint if exists markets_pkey;
alter table public.markets add constraint markets_owner_id_id_pkey primary key (owner_id, id);

alter table public.match_contexts drop constraint if exists match_contexts_pkey;
alter table public.match_contexts drop constraint if exists match_contexts_source_url_key;
alter table public.match_contexts add constraint match_contexts_owner_id_id_pkey primary key (owner_id, id);
alter table public.match_contexts add constraint match_contexts_owner_id_source_url_key unique (owner_id, source_url);

alter table public.markets enable row level security;
alter table public.match_contexts enable row level security;

create index if not exists markets_owner_updated_at_idx
  on public.markets (owner_id, updated_at desc);

create index if not exists match_contexts_owner_updated_at_idx
  on public.match_contexts (owner_id, updated_at desc);
