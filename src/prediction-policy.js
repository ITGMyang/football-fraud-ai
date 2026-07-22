const DATA_WINDOW_MS = 72 * 60 * 60 * 1000;

export function predictionDailyLimit(planId = '') {
  if (planId === 'month') return 30;
  if (['day', 'week'].includes(planId)) return 20;
  return null;
}

export function visibleScheduleWindow(now = Date.now()) {
  return {
    startsAt: new Date(now).toISOString(),
    endsAt: new Date(now + DATA_WINDOW_MS).toISOString()
  };
}

export function validatePredictionFixture(context = {}, entitlement = {}, now = Date.now()) {
  const kickoff = Date.parse(context.kickoff || context.fixture?.date || '');
  if (!Number.isFinite(kickoff)) return { ok: false, code: 'MATCH_TIME_REQUIRED', error: 'This match has no valid kickoff time.' };
  if (kickoff < now) return { ok: false, code: 'MATCH_ALREADY_STARTED', error: 'Predictions are only available before kickoff.' };
  if (kickoff > now + DATA_WINDOW_MS) {
    return { ok: false, code: 'MATCH_OUTSIDE_DATA_WINDOW', error: 'Predictions are available for matches starting within the next 72 hours.' };
  }
  const planId = entitlement.planId || entitlement.plan_id || '';
  const validUntil = Date.parse(entitlement.validUntil || entitlement.valid_until || '');
  if (planId === 'day' && Number.isFinite(validUntil) && kickoff > validUntil) {
    return { ok: false, code: 'MATCH_AFTER_PASS_EXPIRY', error: 'This match starts after your 24-hour pass expires.' };
  }
  return { ok: true };
}

export function filterVisibleMatches(matches = [], now = Date.now(), entitlement = {}) {
  const windowEnd = now + DATA_WINDOW_MS;
  const planId = entitlement.planId || entitlement.plan_id || '';
  const validUntil = Date.parse(entitlement.validUntil || entitlement.valid_until || '');
  const end = planId === 'day' && Number.isFinite(validUntil) ? Math.min(windowEnd, validUntil) : windowEnd;
  return matches.filter((match) => {
    const kickoff = Date.parse(match.kickoff || match.fixture?.date || '');
    return Number.isFinite(kickoff) && kickoff >= now && kickoff <= end;
  });
}
