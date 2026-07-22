import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { isAdminUser } from '../src/auth.js';
import { buildAdminDashboard } from '../src/admin-dashboard.js';
import { modelUsageFromResponse } from '../src/openrouter.js';

test('admin access trusts app metadata and never user metadata', () => {
  assert.equal(isAdminUser({ app_metadata: { role: 'admin' } }), true);
  assert.equal(isAdminUser({ app_metadata: { user_role: 'admin' } }), true);
  assert.equal(isAdminUser({ user_metadata: { role: 'admin' } }), false);
  assert.equal(isAdminUser({ email: 'owner@example.com' }, { ADMIN_EMAILS: 'owner@example.com' }), true);
  assert.equal(isAdminUser({ email: 'member@example.com' }, { ADMIN_EMAILS: 'owner@example.com' }), false);
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
    sharedPredictions: [
      { fixture_id: 'match-1', model_key: 'gpt', model_id: 'gpt-5.5', payload: { modelName: 'GPT 5.5', predictionPhase: 'early' }, updated_at: '2026-07-21T10:01:00Z' },
      { fixture_id: 'match-1', model_key: 'claude', model_id: 'claude-opus-4-8', payload: { modelName: 'Claude 4.8', predictionPhase: 'live' }, updated_at: '2026-07-21T10:02:00Z' }
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
    gpt: 'early', claude: 'live', gemini: 'failed', deepseek: 'not_requested', qwen: 'not_requested'
  });
  assert.equal(dashboard.sharedPool.matches[0].matchName, 'match-1');
});

test('shared prediction pool uses schedule match details when a private context is unavailable', () => {
  const dashboard = buildAdminDashboard({
    sharedPredictions: [{
      fixture_id: '9001', model_key: 'qwen', payload: { modelName: 'Qwen 3.7 Max' }, updated_at: '2026-07-21T10:00:00Z'
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
    cachedCount: 1,
    latestUpdatedAt: '2026-07-21T10:00:00Z',
    models: { gpt: 'not_requested', claude: 'not_requested', gemini: 'not_requested', deepseek: 'not_requested', qwen: 'cached' }
  });
});

test('admin route and dashboard API are wired into the app shell', async () => {
  const [markup, app, worker] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../worker/index.js', import.meta.url), 'utf8')
  ]);

  assert.match(markup, /id="adminDashboard"/);
  assert.match(markup, /运营管理后台/);
  assert.match(markup, /role="tablist"/);
  assert.match(markup, /data-admin-tab="overview"/);
  assert.match(markup, /data-admin-tab="models"/);
  assert.match(markup, /data-admin-tab="shared-pool"/);
  assert.match(markup, /id="adminSharedPool"/);
  assert.match(markup, /data-admin-panel="orders"/);
  assert.match(app, /\/api\/admin\/dashboard/);
  assert.match(app, /activateAdminTab/);
  assert.match(app, /历史估算/);
  assert.match(app, /renderAdminSharedPool/);
  assert.match(app, /startAdminAutoRefresh/);
  assert.match(app, /未配置单价/);
  assert.match(worker, /'\/admin'/);
  assert.match(worker, /url\.pathname === '\/api\/admin\/dashboard'/);
  assert.match(worker, /isAdminUser/);
});
