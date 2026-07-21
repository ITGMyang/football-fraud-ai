const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const PREDICTION_MODELS = ['gpt', 'claude', 'gemini', 'deepseek', 'qwen'];

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
  const sharedPredictions = input.sharedPredictions || [];
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
    sharedPool: summarizeSharedPool(sharedPredictions, aiUsage, contexts, schedules),
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

function summarizeSharedPool(sharedRows, usageRows, contextRows, scheduleRows) {
  const matchDetails = new Map();
  for (const row of scheduleRows) {
    for (const match of (row.payload || row).matches || []) addMatchDetails(matchDetails, match);
  }
  for (const row of contextRows) addMatchDetails(matchDetails, row.payload || row);

  const fixtureIds = new Set(sharedRows.map((row) => String(row.fixture_id || '')).filter(Boolean));
  for (const row of usageRows) {
    if (row.request_kind === 'ranking' && row.context_id) fixtureIds.add(String(row.context_id));
  }

  const cachedByFixture = groupByFixtureAndModel(sharedRows, (row) => row.fixture_id, (row) => row.model_key);
  const latestUsage = latestUsageByFixtureAndModel(usageRows);
  const matches = [...fixtureIds].map((fixtureId) => {
    const details = matchDetails.get(fixtureId) || {};
    const cached = cachedByFixture.get(fixtureId) || new Map();
    const models = Object.fromEntries(PREDICTION_MODELS.map((model) => {
      const attempt = latestUsage.get(`${fixtureId}|${model}`);
      return [model, cached.has(model) ? 'cached' : attempt?.status === 'error' ? 'failed' : 'not_requested'];
    }));
    const cachedRowsForMatch = [...cached.values()];
    return {
      fixtureId,
      matchName: details.matchName || fixtureId,
      competition: details.competition || '',
      kickoff: details.kickoff || '',
      cachedCount: cachedRowsForMatch.length,
      latestUpdatedAt: cachedRowsForMatch.sort((a, b) => timestamp(b.updated_at) - timestamp(a.updated_at))[0]?.updated_at || '',
      models
    };
  }).sort((a, b) => timestamp(b.latestUpdatedAt) - timestamp(a.latestUpdatedAt) || timestamp(b.kickoff) - timestamp(a.kickoff));

  return { totalMatches: matches.filter((match) => match.cachedCount > 0).length, totalResults: sharedRows.length, matches };
}

function addMatchDetails(map, match = {}) {
  const fixtureId = String(match.matchId || match.fixtureId || match.id || '').replace(/^api-football:/, '');
  if (!fixtureId) return;
  const teams = match.teams || [];
  const home = match.home || match.homeTeam || teams[0];
  const away = match.away || match.awayTeam || teams[1];
  map.set(fixtureId, {
    matchName: match.matchName || (home && away ? `${teamName(home)} v ${teamName(away)}` : ''),
    competition: match.competition || match.fixture?.competition || '',
    kickoff: match.kickoff || match.fixture?.date || ''
  });
}

function teamName(team) {
  return typeof team === 'string' ? team : team?.name || '';
}

function groupByFixtureAndModel(rows, fixtureFn, modelFn) {
  const groups = new Map();
  for (const row of rows) {
    const fixtureId = String(fixtureFn(row) || '');
    const model = modelKey(modelFn(row) || row.model_id || row.payload?.modelName);
    if (!fixtureId || !model) continue;
    if (!groups.has(fixtureId)) groups.set(fixtureId, new Map());
    groups.get(fixtureId).set(model, row);
  }
  return groups;
}

function latestUsageByFixtureAndModel(rows) {
  const latest = new Map();
  for (const row of rows) {
    if (row.request_kind !== 'ranking' || !row.context_id) continue;
    const key = `${row.context_id}|${modelKey(row.model_name || row.model_id)}`;
    if (!latest.has(key) || timestamp(row.created_at) > timestamp(latest.get(key).created_at)) latest.set(key, row);
  }
  return latest;
}

function modelKey(value = '') {
  const text = String(value).toLowerCase();
  if (text.includes('gpt') || text.includes('openai')) return 'gpt';
  if (text.includes('claude')) return 'claude';
  if (text.includes('gemini')) return 'gemini';
  if (text.includes('deepseek')) return 'deepseek';
  if (text.includes('qwen') || text.includes('通义')) return 'qwen';
  return text;
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
