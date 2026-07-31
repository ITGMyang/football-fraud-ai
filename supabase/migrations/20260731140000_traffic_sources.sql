-- Where visitors arrive from. Cloudflare's zone analytics has no referrer dimension
-- on this plan, so the Worker classifies the Referer header itself and counts here.
--
-- Counters rather than one row per page view: the question is "how many came from
-- search this week", and keeping a row per visit would grow without bound and hold
-- more about individuals than the answer needs. Only the referring host is stored -
-- never the full referring URL, which can carry search terms.

create table if not exists public.traffic_sources (
  day date not null,
  source text not null,
  referrer_host text not null default '',
  campaign text not null default '',
  views bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, source, referrer_host, campaign)
);

create index if not exists traffic_sources_day_idx on public.traffic_sources (day desc);

alter table public.traffic_sources enable row level security;

create policy "service role manages traffic sources"
  on public.traffic_sources
  for all
  to service_role
  using (true)
  with check (true);

-- PostgREST can upsert but cannot increment, and a read-then-write from the Worker
-- would lose counts whenever two visits land at once.
create or replace function public.record_traffic_source(
  p_day date,
  p_source text,
  p_referrer_host text,
  p_campaign text
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.traffic_sources (day, source, referrer_host, campaign, views, updated_at)
  values (p_day, p_source, coalesce(p_referrer_host, ''), coalesce(p_campaign, ''), 1, now())
  on conflict (day, source, referrer_host, campaign)
  do update set views = public.traffic_sources.views + 1, updated_at = now();
$$;

revoke execute on function public.record_traffic_source(date, text, text, text) from public, anon, authenticated;
grant execute on function public.record_traffic_source(date, text, text, text) to service_role;
