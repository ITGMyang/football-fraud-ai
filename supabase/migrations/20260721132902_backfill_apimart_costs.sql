update public.ai_usage_events
set
  cost_usd = case lower(model_id)
    when 'claude-opus-4-8' then ((input_tokens * 4.0) + (output_tokens * 20.0)) / 1000000.0
    when 'gemini-3.1-pro-preview' then ((input_tokens * 1.6) + (output_tokens * 9.6)) / 1000000.0
    else cost_usd
  end,
  cost_reported = true
where lower(provider) = 'apimart'
  and lower(model_id) in ('claude-opus-4-8', 'gemini-3.1-pro-preview')
  and status = 'success'
  and not cost_reported;
