import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { isAdminUser } from '../src/auth.js';
import { buildAdminDashboard } from '../src/admin-dashboard.js';
import { modelUsageFromResponse } from '../src/openrouter.js';

test('the configured email list is the only way to be an administrator', () => {
  const env = { ADMIN_EMAILS: 'owner@example.com, second@example.com' };
  assert.equal(isAdminUser({ email: 'owner@example.com' }, env), true);
  assert.equal(isAdminUser({ email: 'SECOND@Example.com' }, env), true);
  assert.equal(isAdminUser({ email: 'member@example.com' }, env), false);
  assert.equal(isAdminUser({}, env), false);

  // Editing a user record in Supabase, or an id list nobody rereads, must not be able
  // to add an administrator behind the list's back.
  assert.equal(isAdminUser({ email: 'member@example.com', app_metadata: { role: 'admin' } }, env), false);
  assert.equal(isAdminUser({ email: 'member@example.com', id: 'abc' }, { ...env, ADMIN_USER_IDS: 'abc' }), false);
});

test('with no list configured the metadata role still works for local development', () => {
  assert.equal(isAdminUser({ app_metadata: { role: 'admin' } }), true);
  assert.equal(isAdminUser({ app_metadata: { user_role: 'admin' } }), true);
  // user_metadata is writable by the account holder, so it is never trusted.
  assert.equal(isAdminUser({ user_metadata: { role: 'admin' } }), false);
});

test('model usage normalizes provider token and cost fields', () => {
  assert.deepEqual(modelUsageFromResponse({
    usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500, cost: 0.42 }
  }), {
    inputTokens: 1200,
    outputTokens: 300,
    totalTokens: 1500,
    costUsd: 0.42,
    costReported: true
  });
  assert.deepEqual(modelUsageFromResponse({ usageMetadata: {
    promptTokenCount: 80, candidatesTokenCount: 20, totalTokenCount: 100
  } }), {
    inputTokens: 80,
    outputTokens: 20,
    totalTokens: 100,
    costUsd: 0,
    costReported: false
  });
});

test('APIMart usage converts Claude and Gemini tokens with the published discounted rates', () => {
  assert.deepEqual(modelUsageFromResponse({ usage: {
    prompt_tokens: 9146, completion_tokens: 1102, total_tokens: 10248
  } }, { provider: 'apimart', model: 'claude-opus-4-8' }), {
    inputTokens: 9146,
    outputTokens: 1102,
    totalTokens: 10248,
    costUsd: 0.058624,
    costReported: true
  });

  assert.deepEqual(modelUsageFromResponse({ usage: {
    prompt_tokens: 6328, completion_tokens: 3707, total_tokens: 10035
  } }, { provider: 'apimart', model: 'gemini-3.1-pro-preview' }), {
    inputTokens: 6328,
    outputTokens: 3707,
    totalTokens: 10035,
    costUsd: 0.045712,
    costReported: true
  });
});

test('OpenAI GPT 5.5 usage calculates cost when the response only reports tokens', () => {
  assert.deepEqual(modelUsageFromResponse({ usage: {
    prompt_tokens: 5569, completion_tokens: 3648, total_tokens: 9217
  } }, { provider: 'openai', model: 'gpt-5.5' }), {
    inputTokens: 5569,
    outputTokens: 3648,
    totalTokens: 9217,
    costUsd: 0.137285,
    costReported: true
  });
});

test('admin dashboard aggregates real system, model, league, user, and order data', () => {
  const now = Date.parse('2026-07-21T12:00:00.000Z');
  const dashboard = buildAdminDashboard({
    apiFootballDailyLimit: 7500,
    users: [
      { id: 'u1', email: 'one@example.com', created_at: '2026-07-01T00:00:00Z', last_sign_in_at: '2026-07-21T11:00:00Z', app_metadata: { provider: 'google' } },
      { id: 'u2', email: null, created_at: '2026-07-10T00:00:00Z', last_sign_in_at: '2026-07-18T00:00:00Z', app_metadata: { provider: 'custom:telegram' } }
    ],
    rankings: [
      { owner_id: 'u1', created_at: '2026-07-21T10:00:00Z', payload: { contextId: 'match-1', results: [{ modelName: 'GPT 5.5' }, { modelName: 'Gemini' }] } },
      { owner_id: 'u2', created_at: '2026-07-20T10:00:00Z', payload: { contextId: 'match-2', results: [{ modelName: 'Qwen' }] } }
    ],
    contexts: [
      { owner_id: 'u1', payload: { id: 'match-1', competition: 'Premier League', actualScore: '2:1' } },
      { owner_id: 'u2', payload: { id: 'match-2', competition: 'La Liga' } }
    ],
    schedules: [{ payload: { competitionId: '39', matches: [{ matchId: '1' }, { matchId: '2' }] } }],
    predictionSnapshots: [
      { fixture_id: 'match-1', phase: 'early', model_key: 'gpt', model_id: 'gpt-5.5', payload: { modelName: 'GPT 5.5' }, generated_at: '2026-07-21T10:01:00Z' },
      { fixture_id: 'match-1', phase: 'live', model_key: 'claude', model_id: 'claude-opus-4-8', payload: { modelName: 'Claude 4.8' }, generated_at: '2026-07-21T10:02:00Z' }
    ],
    predictionConsensus: [
      { fixture_id: 'match-1', phase: 'live', is_current: true, payload: { contextName: 'match-1', results: [{ modelName: 'Claude 4.8' }] }, generated_at: '2026-07-21T10:02:00Z' }
    ],
    aiUsage: [
      { owner_id: 'u1', request_kind: 'ranking', context_id: 'match-1', model_name: 'GPT 5.5', model_id: 'gpt-5.5', provider: 'OpenAI', input_tokens: 1000, output_tokens: 250, total_tokens: 1250, cost_usd: 0, cost_reported: false, status: 'success', created_at: '2026-07-21T10:00:00Z' },
      { owner_id: 'u1', request_kind: 'ranking', context_id: 'match-1', model_name: 'Gemini', provider: 'APIMart', input_tokens: 800, output_tokens: 200, total_tokens: 1000, cost_usd: 0, cost_reported: false, status: 'error', created_at: '2026-07-21T10:05:00Z' },
      { owner_id: 'u2', request_kind: 'ranking', context_id: 'match-2', model_name: 'Qwen Max', provider: 'OpenRouter', input_tokens: 600, output_tokens: 150, total_tokens: 750, cost_usd: 0.1, cost_reported: true, status: 'success', created_at: '2026-07-20T10:05:00Z' }
    ],
    systemEvents: [{ event_type: 'api_football_refresh', payload: { apiCalls: 18, errors: [] }, created_at: '2026-07-21T09:40:00Z' }],
    orders: [
      { id: 'o1', owner_id: 'u1', plan_id: 'day', amount_cents: 299, status: 20, created_at: '2026-07-21T08:00:00Z' },
      { id: 'o2', owner_id: 'u2', plan_id: 'week', amount_cents: 1199, status: -1, request_id: 'provider-failed', created_at: '2026-07-21T09:00:00Z' }
    ],
    entitlements: [{ owner_id: 'u1', plan_id: 'day', valid_until: '2026-07-22T08:00:00Z', free_prediction_used: true }],
    predictionRequests: [
      { owner_id: 'u1', fixture_id: 'match-1', status: 'success', cached: false, created_at: '2026-07-21T10:00:00Z' },
      { owner_id: 'u1', fixture_id: 'match-1', status: 'error', cached: false, created_at: '2026-07-21T10:10:00Z' }
    ]
  }, now, { selectedDate: '2026-07-20' });

  assert.equal(dashboard.core.apiFootballCallsToday, 18);
  assert.equal(dashboard.core.apiFootballDailyLimit, 7500);
  assert.equal(dashboard.core.modelCallsToday, 2);
  assert.equal(dashboard.core.modelUsersToday, 1);
  assert.equal(dashboard.core.predictionRequestsToday, 2);
  assert.equal(dashboard.core.predictionRequestErrorsToday, 1);
  assert.equal(dashboard.core.modelCostTodayUsd, 0.0125);
  assert.equal(dashboard.core.modelCostEstimatedCalls, 1);
  assert.equal(dashboard.models[0].modelName, 'GPT 5.5');
  assert.equal(dashboard.models[0].totalTokens, 1250);
  assert.equal(dashboard.models[0].costUsd, 0.0125);
  assert.equal(dashboard.models[0].costEstimatedCalls, 1);
  assert.equal(dashboard.modelUsage.selectedDate, '2026-07-20');
  assert.deepEqual(dashboard.modelUsage.availableDates, ['2026-07-21', '2026-07-20']);
  assert.equal(dashboard.modelUsage.selected.calls, 1);
  assert.equal(dashboard.modelUsage.selected.models[0].modelName, 'Qwen Max');
  assert.equal(dashboard.modelUsage.total.calls, 3);
  assert.equal(dashboard.modelUsage.total.users, 2);
  assert.equal(dashboard.modelUsage.total.tokens, 3000);
  assert.equal(dashboard.users.total, 2);
  assert.equal(dashboard.users.activeToday, 1);
  assert.equal(dashboard.users.paid, 1);
  assert.equal(dashboard.orders.confirmedRevenueUsd, 2.99);
  assert.equal(dashboard.orders.pendingCount, 0);
  assert.equal(dashboard.orders.failedCount, 1);
  assert.equal(dashboard.recentOrders[0].email, '');
  assert.equal(dashboard.recentOrders[0].failureReason, 'provider-failed');
  assert.equal(dashboard.leagues.find((row) => row.name === 'Premier League').imports, 1);
  assert.equal(dashboard.sharedPool.totalMatches, 1);
  assert.equal(dashboard.sharedPool.totalResults, 2);
  assert.deepEqual(dashboard.sharedPool.matches[0].models, {
    gpt: 'early', claude: 'live', gemini: 'failed', qwen: 'not_requested'
  });
  assert.equal(dashboard.sharedPool.matches[0].phase, 'live');
  assert.equal(dashboard.sharedPool.matches[0].publishedModel, 'Claude 4.8');
  assert.equal(dashboard.sharedPool.matches[0].matchName, 'match-1');
});

test('shared prediction pool uses schedule match details when a private context is unavailable', () => {
  const dashboard = buildAdminDashboard({
    predictionSnapshots: [{
      fixture_id: '9001', phase: 'early', model_key: 'qwen', payload: { modelName: 'Qwen 3.7 Max' }, generated_at: '2026-07-21T10:00:00Z'
    }],
    predictionConsensus: [{
      fixture_id: '9001', phase: 'early', is_current: true, payload: { results: [{ modelName: 'Qwen 3.7 Max' }] }, generated_at: '2026-07-21T10:00:00Z'
    }],
    schedules: [{ payload: { matches: [{
      matchId: '9001', homeTeam: 'Spain', awayTeam: 'Argentina', kickoff: '2026-07-22T19:00:00Z', competition: 'World Cup'
    }] } }]
  }, Date.parse('2026-07-21T12:00:00Z'));

  assert.deepEqual(dashboard.sharedPool.matches[0], {
    fixtureId: '9001',
    matchName: 'Spain v Argentina',
    competition: 'World Cup',
    kickoff: '2026-07-22T19:00:00Z',
    phase: 'early',
    publishedModel: 'Qwen 3.7 Max',
    cachedCount: 1,
    latestUpdatedAt: '2026-07-21T10:00:00Z',
    models: { gpt: 'not_requested', claude: 'not_requested', gemini: 'not_requested', qwen: 'early' }
  });
});

test('admin dashboard calculates deduplicated site-wide prediction accuracy', () => {
  const sharedResult = {
    modelName: 'Qwen 3.7 Max',
    generatedAt: '2026-07-22T10:00:00Z',
    picks: [{
      market: {
        matchName: 'Alpha v Beta',
        marketType: 'Goals Total',
        selection: 'Over',
        line: '2.5'
      }
    }],
    scorePicks: [
      { score: '1:0' },
      { score: '2:1' },
      { score: '1:1' },
      { score: '0:1' }
    ]
  };
  const dashboard = buildAdminDashboard({
    contexts: [
      { owner_id: 'u1', created_at: '2026-07-22T12:00:00Z', payload: { matchId: 'fixture-1', matchName: 'Alpha v Beta', competition: 'World Cup', kickoff: '2026-07-22T20:00:00Z', actualScore: '2:1' } },
      { owner_id: 'u2', created_at: '2026-07-22T12:01:00Z', payload: { matchId: 'fixture-1', matchName: 'Alpha v Beta', competition: 'World Cup', kickoff: '2026-07-22T20:00:00Z', actualScore: '2:1' } }
    ],
    rankings: [
      { owner_id: 'u1', created_at: '2026-07-22T10:00:00Z', payload: { id: 'r1', contextId: 'fixture-1', createdAt: '2026-07-22T10:00:00Z', results: [sharedResult] } },
      { owner_id: 'u2', created_at: '2026-07-22T10:05:00Z', payload: { id: 'r2', contextId: 'fixture-1', createdAt: '2026-07-22T10:00:00Z', results: [sharedResult] } }
    ]
  }, Date.parse('2026-07-23T00:00:00Z'));

  assert.equal(dashboard.accuracy.uniqueModelPredictions, 1);
  assert.equal(dashboard.accuracy.matchCount, 1);
  assert.equal(dashboard.accuracy.evaluatedCount, 2);
  assert.equal(dashboard.accuracy.hits, 2);
  assert.equal(dashboard.accuracy.total, 2);
  assert.equal(dashboard.accuracy.accuracy, 1);
  assert.equal(dashboard.accuracy.evaluations[0].competition, 'World Cup');
  assert.equal(dashboard.accuracy.categories.find((row) => row.key === 'score').total, 1);
  assert.equal(dashboard.accuracy.categories.find((row) => row.key === 'score').accuracy, 1);
});

test('admin dashboard audits revenue periods, plans, users, and duplicate competition data', () => {
  const now = Date.parse('2026-07-22T12:00:00Z');
  const dashboard = buildAdminDashboard({
    users: [
      { id: 'u1', email: 'day@example.com', created_at: '2026-07-22T02:00:00Z' },
      { id: 'u2', email: 'week@example.com', created_at: '2026-07-01T02:00:00Z' },
      { id: 'u3', email: 'month@example.com', created_at: '2026-06-01T02:00:00Z' }
    ],
    entitlements: [
      { owner_id: 'u1', plan_id: 'day', valid_until: '2026-07-23T12:00:00Z' },
      { owner_id: 'u2', plan_id: 'week', valid_until: '2026-07-25T12:00:00Z' },
      { owner_id: 'u3', plan_id: 'month', valid_until: '2026-08-20T12:00:00Z' }
    ],
    orders: [
      { id: 'today-day', owner_id: 'u1', plan_id: 'day', amount_cents: 299, status: 20, confirmed_at: '2026-07-22T03:00:00Z', created_at: '2026-07-22T02:55:00Z' },
      { id: 'week-week', owner_id: 'u2', plan_id: 'week', amount_cents: 1199, status: 20, confirmed_at: '2026-07-18T03:00:00Z', created_at: '2026-07-18T02:55:00Z' },
      { id: 'month-month', owner_id: 'u3', plan_id: 'month', amount_cents: 2999, status: 20, confirmed_at: '2026-07-02T03:00:00Z', created_at: '2026-07-02T02:55:00Z' },
      { id: 'pending-day', owner_id: 'u1', plan_id: 'day', amount_cents: 299, status: 1, created_at: '2026-07-22T04:00:00Z' },
      { id: 'failed-week', owner_id: 'u2', plan_id: 'week', amount_cents: 1199, status: -1, created_at: '2026-07-22T05:00:00Z' }
    ],
    contexts: [{ owner_id: 'u1', payload: { id: 'tiny-1', matchId: 'tiny-1', competition: 'Tiny Cup' } }],
    aiUsage: [{ owner_id: 'u1', context_id: 'tiny-1', request_kind: 'ranking', total_tokens: 25000, status: 'success', created_at: '2026-07-22T06:00:00Z' }],
    predictionRequests: [
      { owner_id: 'u1', fixture_id: 'tiny-1', status: 'success', cached: true, created_at: '2026-07-22T06:00:00Z' },
      { owner_id: 'u1', fixture_id: 'tiny-1', status: 'error', cached: false, created_at: '2026-07-22T07:00:00Z' }
    ],
    schedules: [
      { payload: { competitionId: '900', matches: [{ matchId: 'tiny-1', competition: 'Tiny Cup' }] } },
      { payload: { competitionId: '900', matches: [{ matchId: 'tiny-1', competition: 'Tiny Cup' }] } }
    ]
  }, now);

  assert.deepEqual(dashboard.orders.revenue.today, { count: 1, amountUsd: 2.99 });
  assert.deepEqual(dashboard.orders.revenue.week, { count: 2, amountUsd: 14.98 });
  assert.deepEqual(dashboard.orders.revenue.month, { count: 3, amountUsd: 44.97 });
  assert.deepEqual(dashboard.orders.statusCounts, { pending: 1, completed: 3, failed: 1 });
  assert.equal(dashboard.orders.byPlan.day.pending, 1);
  assert.equal(dashboard.orders.byPlan.week.failed, 1);
  assert.deepEqual(dashboard.users.activePlans, { day: 1, week: 1, month: 1, developer: 0 });
  assert.equal(dashboard.users.newToday, 1);
  assert.equal(dashboard.users.purchasesToday.day, 1);
  assert.equal(dashboard.userRows[0].predictionRequests, 2);
  assert.equal(dashboard.userRows[0].cachedResponses, 1);
  assert.equal(dashboard.userRows[0].failedRequests, 1);
  assert.equal(dashboard.leagueAudit.duplicateFixtures, 1);
  assert.equal(dashboard.leagueAudit.duplicateLeagues, 1);
  assert.equal(dashboard.leagues[0].totalTokens, 25000);
  assert.equal(dashboard.leagues[0].reviewRequired, true);
});

test('the admin console is wired to the dashboard API through its own shell', async () => {
  const [shell, app, worker, server] = await Promise.all([
    readFile(new URL('../frontend/admin.html', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/src/AdminApp.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../worker/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/server.js', import.meta.url), 'utf8')
  ]);

  assert.match(shell, /src="\/src\/admin\.tsx"/);
  assert.match(shell, /noindex/);

  // Every tab the merged console must expose, including the folded-in data console.
  for (const tab of ['overview', 'data', 'models', 'predictions', 'accuracy', 'accounts']) {
    assert.match(app, new RegExp(`id: '${tab}'`));
  }
  assert.match(app, /\/api\/admin\/dashboard/);
  assert.match(app, /\/api\/backend\/schedules/);
  assert.match(app, /\/api\/backend\/fixtures\//);
  assert.match(app, /\/api\/admin\/models\/check/);
  assert.match(app, /\/api\/admin\/traffic/);
  assert.match(worker, /url\.pathname === '\/api\/admin\/traffic'/);
  // Traffic is admin-gated like the rest of the console.
  assert.match(worker, /fetchSiteTraffic\(env, workerFetch/);

  // The pool lists only the models that actually ran; settled picks group by fixture.
  assert.match(app, /state !== 'not_requested'/);
  assert.doesNotMatch(app, /modelKeys/);
  assert.match(app, /const byMatch = new Map/);
  // The pool must read the tables the current pipeline writes, not the retired one.
  const dashboardSource = await readFile(new URL('../src/admin-dashboard.js', import.meta.url), 'utf8');
  assert.match(dashboardSource, /summarizeSharedPool\(predictionSnapshots, predictionConsensus,/);
  assert.doesNotMatch(dashboardSource, /sharedPredictions/);
  assert.match(app, /className="a-group"/);

  // The fixture payload nests an object per endpoint and names the lineup fields
  // `formation` / `notes`; reading them as strings blanked the console.
  assert.match(app, /String\(status\?\.state \|\| 'unknown'\)/);
  assert.match(app, /state === 'available' \? 'ok'/);
  assert.match(app, /context\.lineup\?\.formation \?/);
  assert.match(app, /context\?\.lineup\?\.notes \|\| \[\]/);
  assert.doesNotMatch(app, /lineup\?\.formations/);
  assert.doesNotMatch(app, /lineup\?\.injuries/);

  // A render error must not take the whole console down with it.
  assert.match(app, /class Boundary extends Component/);
  assert.match(app, /getDerivedStateFromError/);
  assert.match(app, /<Boundary label=\{tab\}>/);

  const types = await readFile(new URL('../frontend/src/adminTypes.ts', import.meta.url), 'utf8');
  assert.match(types, /fetchStatus\?: Record<string, \{ state\?: string; count\?: number; error\?: string \}>/);
  assert.match(worker, /url\.pathname === '\/api\/admin\/models\/check'/);
  assert.match(app, /setAuthorized\(false\)/);

  // Console copy ships in both languages behind a persisted toggle.
  const copy = await readFile(new URL('../frontend/src/adminCopy.ts', import.meta.url), 'utf8');
  assert.match(app, /createTranslator\(language\)/);
  assert.match(app, /localStorage\.setItem\(LANGUAGE_STORAGE_KEY, language\)/);
  assert.match(app, /className="a-lang"/);
  // Han text in the component is allowed only for the toggle's own label and for
  // regexes matching backend data prefixes — never for UI copy, which lives in adminCopy.
  const HAN_ALLOWED = new Set(['中文', '伤停']);
  for (const [text] of app.matchAll(/[\u4e00-\u9fff]+/g)) {
    assert.ok(HAN_ALLOWED.has(text), `unexpected Han text in the component: ${text}`);
  }
  assert.match(app, /\/\^\(伤停\|injury\)\/i/);
  assert.match(copy, /consoleTitle: \['Operations console', '运营后台'\]/);
  for (const [, en, zh] of copy.matchAll(/^ {2}\w+: \['((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'\]/gm)) {
    assert.ok(en.length > 0 && zh.length > 0, 'every console string needs both languages');
  }

  // Both servers serve the console shell and redirect the retired pages to it.
  for (const source of [worker, server]) {
    assert.match(source, /admin\.html/);
    assert.match(source, /RETIRED_CONSOLE_ROUTES/);
    assert.doesNotMatch(source, /legacy\.html/);
  }
  assert.match(worker, /url\.pathname === '\/api\/admin\/dashboard'/);
  assert.match(worker, /isAdminUser/);
  assert.match(worker, /planId: predictionAccess\.billing\.planId \|\| 'free'/);
});

test('admin dashboard summarizes optimized prediction architecture records', () => {
  const dashboard = buildAdminDashboard({
    predictionSettings: [{
      key: 'default',
      live_model_keys: ['gpt', 'claude', 'gemini'],
      model_weights: { claude: 1.2 }
    }],
    predictionSnapshots: [
      {
        id: 'snapshot-1',
        fixture_id: '123',
        phase: 'early',
        model_key: 'claude',
        payload: { modelName: 'Claude 4.8' },
        generated_at: '2026-07-25T02:00:00Z'
      },
      {
        id: 'snapshot-2',
        fixture_id: '123',
        phase: 'live',
        model_key: 'gpt',
        payload: { modelName: 'GPT 5.5' },
        generated_at: '2026-07-25T10:00:00Z'
      }
    ],
    predictionConsensus: [{
      id: 'consensus-1',
      fixture_id: '123',
      phase: 'live',
      payload: { contextName: 'Alpha v Beta', results: [{ modelName: 'FutBots Consensus' }] },
      source_snapshot_ids: ['snapshot-2'],
      is_current: true,
      generated_at: '2026-07-25T10:01:00Z'
    }],
    weeklyPerformance: [{
      week_start: '2026-07-20',
      model_key: 'claude',
      model_name: 'Claude 4.8',
      samples: 24,
      hits: 16,
      accuracy: 2 / 3,
      eligible: true,
      eligible: true
    }]
  }, Date.parse('2026-07-25T12:00:00Z'));

  assert.equal(dashboard.predictionArchitecture.snapshotCount, 2);
  assert.equal(dashboard.predictionArchitecture.currentConsensusCount, 1);
  assert.equal(dashboard.predictionArchitecture.latestWeek.rows[0].eligible, true);
  // The per-fixture view lives in the pool now; the architecture block is settings only.
  assert.equal(dashboard.predictionArchitecture.matches, undefined);
  assert.equal(dashboard.sharedPool.matches[0].fixtureId, '123');
  // Each model carries the phase of its own snapshot, not the consensus phase.
  assert.equal(dashboard.sharedPool.matches[0].models.gpt, 'live');
  assert.equal(dashboard.sharedPool.matches[0].models.claude, 'early');
  assert.equal(dashboard.sharedPool.matches[0].phase, 'live');
  assert.equal(dashboard.sharedPool.matches[0].matchName, 'Alpha v Beta');
});

test('the console can read what each prediction run cost, per expert node', () => {
  const dashboard = buildAdminDashboard({
    systemEvents: [
      {
        event_type: 'prediction_run',
        created_at: '2026-08-07T06:00:00Z',
        payload: {
          fixtureId: '1558583',
          matchName: 'Standard Liege v Cercle Brugge',
          phase: 'early',
          decision: 'PASS',
          passReason: 'entropy',
          costUsd: 0.02472,
          nodes: [
            { model: 'Claude 4.8 (tactical)', provider: 'apimart', costUsd: 0.00266, tokens: 400, error: '' },
            { model: 'GPT 5.5 (risk)', provider: 'openai', costUsd: 0.0092, tokens: 856, error: 'timeout' }
          ]
        }
      },
      { event_type: 'api_football_refresh', created_at: '2026-08-07T05:00:00Z', payload: { apiCalls: 9, errors: [] } }
    ]
  }, Date.parse('2026-08-07T07:00:00Z'));

  // console.log is a live stream; closing the tail loses the run. This is the copy the
  // console reads, and it must not sweep up unrelated system events.
  assert.equal(dashboard.predictionRuns.length, 1);
  const [run] = dashboard.predictionRuns;
  assert.equal(run.matchName, 'Standard Liege v Cercle Brugge');
  assert.equal(run.costUsd, 0.02472);
  assert.equal(run.nodes.length, 2);
  assert.equal(run.failed, 1, 'a node that failed is counted, not hidden');
  assert.equal(run.nodes[1].error, 'timeout');
});

test('personal accuracy reads the whole history, not a recent window', async () => {
  const worker = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');
  const storage = await readFile(new URL('../src/supabase-storage.js', import.meta.url), 'utf8');

  // readDb stops at fifty rankings and twenty contexts because it feeds a screen. Using
  // it for accuracy scored an active account on its last twenty matches and presented
  // that as a career record, with nothing on the page saying so.
  const route = worker.slice(worker.indexOf("url.pathname === '/api/analytics'"), worker.indexOf("'/api/analytics/day'"));
  assert.match(route, /readOwnerAccuracySource\(ownerId\)/);
  assert.doesNotMatch(route, /storage\.readDb/);
  assert.match(storage, /selectAllRows\(TABLES\.rankings, 'payload,created_at', \{ owner_id: `eq\.\$\{ownerId\}`/);
  assert.match(storage, /selectAllRows\(TABLES\.matchContexts, 'payload,created_at,updated_at', \{ owner_id: `eq\.\$\{ownerId\}`/);
});

test('the cron settles finished matches, so accuracy stops depending on who visits', async () => {
  const worker = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');
  const scheduled = worker.slice(worker.indexOf('async scheduled('));

  // The only writer used to be an endpoint the profile page called, so a match was
  // settled only if whoever imported it came back and opened that page.
  assert.match(scheduled, /backfillMatchResults\(storage, Date\.now\(\), apiFootballOptions\(env\), workerFetch\)/);
  assert.match(scheduled, /Promise\.all\(\[refreshTask, billingTask, resultsTask, weeklySettlementTask\]\)/);
});
