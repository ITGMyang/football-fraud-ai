const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';

export function buildAdminDashboard(input = {}, now = Date.now()) {
  const today = dateKey(now);
  const users = input.users || [];
  const rankings = input.rankings || [];
  const contexts = input.contexts || [];
  const aiUsage = input.aiUsage || [];
  const systemEvents = input.systemEvents || [];
  const orders = input.orders || [];
  const entitlements = input.entitlements || [];
  const schedules = input.schedules || [];
  const todayUsage = aiUsage.filter((row) => dateKey(row.created_at) === today);
  const todayRefreshes = systemEvents.filter((row) => row.event_type === 'api_football_refresh' && dateKey(row.created_at) === today);
  const latestRefresh = [...systemEvents]
    .filter((row) => row.event_type === 'api_football_refresh')
    .sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at))[0] || null;
  const confirmedOrders = orders.filter((row) => Number(row.status) === 20);
  const activeEntitlements = entitlements.filter((row) => timestamp(row.valid_until) > now);

  return {
    generatedAt: new Date(now).toISOString(),
    core: {
      apiFootballCallsToday: sum(todayRefreshes, (row) => row.payload?.apiCalls),
      apiFootballDailyLimit: positiveNumber(input.apiFootballDailyLimit),
      modelCallsToday: todayUsage.length,
      modelCostTodayUsd: roundMoney(sum(todayUsage, (row) => row.cost_usd)),
      modelCostReportedCalls: todayUsage.filter((row) => row.cost_reported).length,
      lastRefreshAt: latestRefresh?.created_at || '',
      lastRefreshStatus: latestRefresh?.payload?.errors?.length ? 'warning' : latestRefresh ? 'healthy' : 'unknown',
      cachedMatches: uniqueScheduleMatches(schedules)
    },
    models: summarizeModels(todayUsage),
    leagues: summarizeLeagues(contexts, rankings, schedules),
    users: {
      total: users.length,
      activeToday: users.filter((user) => dateKey(user.last_sign_in_at) === today).length,
      active7d: users.filter((user) => withinDays(user.last_sign_in_at, now, 7)).length,
      active30d: users.filter((user) => withinDays(user.last_sign_in_at, now, 30)).length,
      paid: new Set(activeEntitlements.map((row) => String(row.owner_id))).size
    },
    userRows: summarizeUsers(users, rankings, aiUsage, entitlements, now),
    orders: {
      confirmedRevenueUsd: roundMoney(sum(confirmedOrders, (row) => Number(row.amount_cents) / 100)),
      confirmedCount: confirmedOrders.length,
      pendingCount: orders.filter((row) => [0, 1].includes(Number(row.status))).length,
      failedCount: orders.filter((row) => Number(row.status) < 0).length
    },
    recentOrders: [...orders]
      .sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at))
      .slice(0, 20)
      .map((row) => ({
        id: row.id,
        ownerId: row.owner_id,
        planId: row.plan_id,
        amountUsd: roundMoney(Number(row.amount_cents || 0) / 100),
        status: Number(row.status),
        createdAt: row.created_at,
        confirmedAt: row.confirmed_at || ''
      }))
  };
}

function summarizeModels(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.model_name || 'Unknown'}|${row.provider || 'Unknown'}`;
    const item = groups.get(key) || {
      modelName: row.model_name || 'Unknown',
      provider: row.provider || 'Unknown',
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      costReportedCalls: 0,
      errors: 0
    };
    item.requests += 1;
    item.inputTokens += positiveNumber(row.input_tokens);
    item.outputTokens += positiveNumber(row.output_tokens);
    item.totalTokens += positiveNumber(row.total_tokens);
    item.costUsd = roundMoney(item.costUsd + positiveNumber(row.cost_usd));
    if (row.cost_reported) item.costReportedCalls += 1;
    if (row.status !== 'success') item.errors += 1;
    groups.set(key, item);
  }
  return [...groups.values()].sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens || a.modelName.localeCompare(b.modelName));
}

function summarizeLeagues(contextRows, rankingRows, scheduleRows) {
  const leagues = new Map();
  const contextsByOwnerAndId = new Map();
  for (const row of contextRows) {
    const context = row.payload || {};
    const name = context.competition || context.fixture?.competition || 'Unknown Competition';
    const item = leagues.get(name) || { name, cachedMatches: 0, imports: 0, predictions: 0 };
    item.imports += 1;
    leagues.set(name, item);
    for (const id of [context.id, context.matchId, context.sourceUrl].filter(Boolean)) {
      contextsByOwnerAndId.set(`${row.owner_id || ''}|${id}`, name);
    }
  }
  for (const row of rankingRows) {
    const ranking = row.payload || {};
    const name = contextsByOwnerAndId.get(`${row.owner_id || ''}|${ranking.contextId || ''}`) || 'Unknown Competition';
    const item = leagues.get(name) || { name, cachedMatches: 0, imports: 0, predictions: 0 };
    item.predictions += (ranking.results || []).length;
    leagues.set(name, item);
  }
  for (const row of scheduleRows) {
    const schedule = row.payload || row;
    for (const match of schedule.matches || []) {
      const name = match.competition || `Competition ${schedule.competitionId || ''}`.trim();
      const item = leagues.get(name) || { name, cachedMatches: 0, imports: 0, predictions: 0 };
      item.cachedMatches += 1;
      leagues.set(name, item);
    }
  }
  return [...leagues.values()].sort((a, b) => b.predictions - a.predictions || b.imports - a.imports || b.cachedMatches - a.cachedMatches).slice(0, 20);
}

function summarizeUsers(users, rankings, aiUsage, entitlements, now) {
  const rankingCount = countBy(rankings, (row) => row.owner_id);
  const today = dateKey(now);
  const todayCalls = countBy(aiUsage.filter((row) => dateKey(row.created_at) === today), (row) => row.owner_id);
  const entitlementMap = new Map(entitlements.map((row) => [String(row.owner_id), row]));
  return users.map((user) => {
    const entitlement = entitlementMap.get(String(user.id)) || {};
    return {
      id: user.id,
      email: user.email || '',
      provider: user.app_metadata?.provider || user.app_metadata?.providers?.[0] || 'unknown',
      planId: timestamp(entitlement.valid_until) > now ? (entitlement.plan_id || 'paid') : 'free',
      validUntil: entitlement.valid_until || '',
      predictionRuns: rankingCount.get(String(user.id)) || 0,
      callsToday: todayCalls.get(String(user.id)) || 0,
      createdAt: user.created_at || '',
      lastSeenAt: user.last_sign_in_at || ''
    };
  }).sort((a, b) => timestamp(b.lastSeenAt) - timestamp(a.lastSeenAt));
}

function uniqueScheduleMatches(rows) {
  return new Set(rows.flatMap((row) => (row.payload || row).matches || []).map((match) => String(match.matchId || match.id || '')).filter(Boolean)).size;
}

function countBy(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) {
    const key = String(keyFn(row) || '');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function withinDays(value, now, days) {
  const time = timestamp(value);
  return Boolean(time) && now - time >= 0 && now - time <= days * 24 * 60 * 60 * 1000;
}

function dateKey(value) {
  const date = new Date(typeof value === 'number' ? value : value || 0);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function sum(rows, valueFn) {
  return rows.reduce((total, row) => total + positiveNumber(valueFn(row)), 0);
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 1000000) / 1000000;
}
