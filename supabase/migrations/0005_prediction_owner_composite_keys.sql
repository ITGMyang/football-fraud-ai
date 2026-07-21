alter table public.reports drop constraint if exists reports_pkey;
alter table public.reports add constraint reports_owner_id_id_pkey primary key (owner_id, id);

alter table public.rankings drop constraint if exists rankings_pkey;
alter table public.rankings add constraint rankings_owner_id_id_pkey primary key (owner_id, id);
