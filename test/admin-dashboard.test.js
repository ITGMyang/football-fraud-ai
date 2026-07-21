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
    aiUsage: [
      { owner_id: 'u1', model_name: 'GPT 5.5', provider: 'OpenAI', input_tokens: 1000, output_tokens: 250, total_tokens: 1250, cost_usd: 0.5, cost_reported: true, status: 'success', created_at: '2026-07-21T10:00:00Z' },
      { owner_id: 'u1', model_name: 'Gemini', provider: 'APIMart', input_tokens: 800, output_tokens: 200, total_tokens: 1000, cost_usd: 0, cost_reported: false, status: 'error', created_at: '2026-07-21T10:05:00Z' }
    ],
    systemEvents: [{ event_type: 'api_football_refresh', payload: { apiCalls: 18, errors: [] }, created_at: '2026-07-21T09:40:00Z' }],
    orders: [
      { id: 'o1', owner_id: 'u1', plan_id: 'day', amount_cents: 299, status: 20, created_at: '2026-07-21T08:00:00Z' },
      { id: 'o2', owner_id: 'u2', plan_id: 'week', amount_cents: 1199, status: 1, created_at: '2026-07-21T09:00:00Z' }
    ],
    entitlements: [{ owner_id: 'u1', plan_id: 'day', valid_until: '2026-07-22T08:00:00Z', free_prediction_used: true }]
  }, now);

  assert.equal(dashboard.core.apiFootballCallsToday, 18);
  assert.equal(dashboard.core.apiFootballDailyLimit, 7500);
  assert.equal(dashboard.core.modelCallsToday, 2);
  assert.equal(dashboard.core.modelCostTodayUsd, 0.5);
  assert.equal(dashboard.models[0].modelName, 'GPT 5.5');
  assert.equal(dashboard.models[0].totalTokens, 1250);
  assert.equal(dashboard.users.total, 2);
  assert.equal(dashboard.users.activeToday, 1);
  assert.equal(dashboard.users.paid, 1);
  assert.equal(dashboard.orders.confirmedRevenueUsd, 2.99);
  assert.equal(dashboard.orders.pendingCount, 1);
  assert.equal(dashboard.leagues.find((row) => row.name === 'Premier League').imports, 1);
});

test('admin route and dashboard API are wired into the app shell', async () => {
  const [markup, app, worker] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../worker/index.js', import.meta.url), 'utf8')
  ]);

  assert.match(markup, /id="adminDashboard"/);
  assert.match(markup, /Operations Dashboard/);
  assert.match(app, /\/api\/admin\/dashboard/);
  assert.match(worker, /'\/admin'/);
  assert.match(worker, /url\.pathname === '\/api\/admin\/dashboard'/);
  assert.match(worker, /isAdminUser/);
});
