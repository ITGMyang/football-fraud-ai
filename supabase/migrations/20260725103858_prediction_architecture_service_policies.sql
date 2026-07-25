create policy "service role manages prediction snapshots"
  on public.prediction_snapshots
  for all
  to service_role
  using (true)
  with check (true);

create policy "service role manages prediction consensus"
  on public.prediction_consensus
  for all
  to service_role
  using (true)
  with check (true);

create policy "service role manages weekly model performance"
  on public.model_weekly_performance
  for all
  to service_role
  using (true)
  with check (true);

create policy "service role manages prediction settings"
  on public.prediction_settings
  for all
  to service_role
  using (true)
  with check (true);

create policy "service role manages prediction generation leases"
  on public.prediction_generation_leases
  for all
  to service_role
  using (true)
  with check (true);
