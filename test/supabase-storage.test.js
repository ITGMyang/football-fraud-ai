import test from 'node:test';
import assert from 'node:assert/strict';

import { createSupabaseStorage } from '../src/supabase-storage.js';

test('Supabase storage prefers the modern secret key over a legacy service role key', async () => {
  const authorizations = [];
  const storage = createSupabaseStorage({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_modern',
    SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-role'
  }, async (_url, options) => {
    authorizations.push(options.headers.Authorization);
    return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
  });

  await storage.readDb();
  assert.deepEqual([...new Set(authorizations)], ['Bearer sb_secret_modern']);
});

test('Supabase storage scopes predictions to the authenticated owner', async () => {
  const requests = [];
  const storage = createSupabaseStorage({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_modern'
  }, async (url, options = {}) => {
    requests.push({ url, options });
    return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
  });

  await storage.readDb({ ownerId: 'user-123' });
  await storage.saveRanking({ id: 'ranking-1', results: [] }, { ownerId: 'user-123' });

  const rankingRead = requests.find(({ url }) => url.includes('/rankings?'));
  const rankingWrite = requests.find(({ url, options }) => url.includes('/rankings?') && options.method === 'POST');
  assert.match(rankingRead.url, /owner_id=eq\.user-123/);
  assert.match(rankingWrite.options.body, /"owner_id":"user-123"/);
});

test('Supabase schedule cache upserts by competition id', async () => {
  const requests = [];
  const storage = createSupabaseStorage({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_modern'
  }, async (url, options = {}) => {
    requests.push({ url, options });
    return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
  });

  await storage.upsertMatchSchedules([{
    competitionId: '125',
    fetchedAt: '2026-06-27T00:00:00.000Z',
    matches: [{ matchId: '1' }]
  }]);

  const write = requests.find(({ url, options }) => url.includes('/match_schedules?') && options.method === 'POST');
  assert.match(write.url, /on_conflict=competition_id/);
  assert.match(write.options.body, /"competition_id":"125"/);
  assert.match(write.options.body, /"matchId":"1"/);
});

test('Supabase storage lists every shared schedule without an owner filter', async () => {
  const requests = [];
  const storage = createSupabaseStorage({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_modern'
  }, async (url, options = {}) => {
    requests.push({ url, options });
    return new Response(JSON.stringify([
      { payload: { competitionId: '1', matches: [{ matchId: 'final' }] } },
      { payload: { competitionId: '39', matches: [] } }
    ]), { headers: { 'Content-Type': 'application/json' } });
  });

  const schedules = await storage.listMatchSchedules();

  assert.equal(schedules.length, 2);
  assert.equal(schedules[0].competitionId, '1');
  const read = requests.find(({ url }) => url.includes('/match_schedules?'));
  assert.ok(read);
  assert.doesNotMatch(read.url, /owner_id=/);
});

test('Supabase stores and reads the shared API-Football catalog cache', async () => {
  const requests = [];
  const cachedPayload = {
    catalog: { standings: ['#1 England'] },
    fetchedAt: '2026-07-20T00:00:00.000Z'
  };
  const storage = createSupabaseStorage({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_modern'
  }, async (url, options = {}) => {
    requests.push({ url, options });
    const body = options.method === 'POST' ? '[]' : JSON.stringify([{ payload: cachedPayload }]);
    return new Response(body, { headers: { 'Content-Type': 'application/json' } });
  });

  const cached = await storage.readApiFootballCatalog('league:1:season:2026:teams:10-20', {
    now: Date.parse('2026-07-20T00:30:00.000Z')
  });
  await storage.upsertApiFootballCatalog('league:1:season:2026:teams:10-20', cached);

  assert.deepEqual(cached, { standings: ['#1 England'] });
  const read = requests.find(({ url, options }) => url.includes('/api_football_catalog_cache?') && !options.method);
  const write = requests.find(({ url, options }) => url.includes('/api_football_catalog_cache?') && options.method === 'POST');
  assert.match(read.url, /cache_key=eq\.league%3A1%3Aseason%3A2026%3Ateams%3A10-20/);
  assert.match(write.url, /on_conflict=cache_key/);
  assert.match(write.options.body, /"standings":\["#1 England"\]/);
});

test('Supabase imported markets and contexts are scoped to the authenticated owner', async () => {
  const requests = [];
  const storage = createSupabaseStorage({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_modern'
  }, async (url, options = {}) => {
    requests.push({ url, options });
    return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
  });

  await storage.readDb({ ownerId: 'user-123' });
  await storage.upsertMarkets([{ id: 'market-1', matchName: 'A v B' }], { ownerId: 'user-123' });
  await storage.upsertMatchContext({ id: 'context-1', sourceUrl: 'https://dongqiudi.com/match/1' }, { ownerId: 'user-123' });

  const marketRead = requests.find(({ url }) => url.includes('/markets?'));
  const contextRead = requests.find(({ url }) => url.includes('/match_contexts?'));
  const marketWrite = requests.find(({ url, options }) => url.includes('/markets?') && options.method === 'POST');
  const contextWrite = requests.find(({ url, options }) => url.includes('/match_contexts?') && options.method === 'POST');
  assert.match(marketRead.url, /owner_id=eq\.user-123/);
  assert.match(contextRead.url, /owner_id=eq\.user-123/);
  assert.match(marketWrite.options.body, /"owner_id":"user-123"/);
  assert.match(contextWrite.options.body, /"owner_id":"user-123"/);
  assert.match(marketWrite.url, /on_conflict=owner_id,id/);
  assert.match(contextWrite.url, /on_conflict=owner_id,id/);
});

test('Supabase billing storage scopes orders and entitlements to their owner', async () => {
  const requests = [];
  const storage = createSupabaseStorage({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_modern'
  }, async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/billing_entitlements?')) {
      return new Response(JSON.stringify([{
        owner_id: 'user-1', plan_id: 'day', valid_until: '2026-07-21T00:00:00Z', free_prediction_used: false
      }]), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  });

  await storage.createBillingOrder({
    id: 'order-1', ownerId: 'user-1', planId: 'day', amountCents: 299,
    intentId: 'intent-1', checkoutUrl: 'https://checkout.allscale.io/test'
  });
  const entitlement = await storage.readBillingEntitlement('user-1');
  await storage.consumeFreePrediction('user-1');

  const orderWrite = requests.find(({ url, options }) => url.includes('/billing_orders?') && options.method === 'POST');
  const entitlementRead = requests.find(({ url }) => url.includes('/billing_entitlements?'));
  const usageRpc = requests.find(({ url }) => url.includes('/rpc/consume_free_prediction'));
  assert.match(orderWrite.options.body, /"owner_id":"user-1"/);
  assert.match(entitlementRead.url, /owner_id=eq\.user-1/);
  assert.match(usageRpc.options.body, /"p_owner_id":"user-1"/);
  assert.equal(entitlement.planId, 'day');
});

test('Supabase records AI usage and scheduled refresh events separately', async () => {
  const requests = [];
  const storage = createSupabaseStorage({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_modern'
  }, async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  });

  await storage.recordAiUsageEvents([{
    ownerId: 'user-1', requestKind: 'ranking', modelName: 'GPT 5.5', modelId: 'gpt-5.5',
    provider: 'openai', inputTokens: 120, outputTokens: 30, totalTokens: 150,
    costUsd: 0.04, costReported: true, status: 'success', contextId: 'fixture-1'
  }]);
  await storage.recordSystemEvent('api_football_refresh', { apiCalls: 42, errors: [] });

  const usageWrite = requests.find(({ url }) => url.includes('/ai_usage_events?'));
  const eventWrite = requests.find(({ url }) => url.includes('/system_events?'));
  assert.match(usageWrite.options.body, /"owner_id":"user-1"/);
  assert.match(usageWrite.options.body, /"input_tokens":120/);
  assert.match(eventWrite.options.body, /"event_type":"api_football_refresh"/);
  assert.match(eventWrite.options.body, /"apiCalls":42/);
});

test('Supabase admin dashboard read includes auth users and operational tables', async () => {
  const requests = [];
  const storage = createSupabaseStorage({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_modern'
  }, async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/auth/v1/admin/users')) {
      return new Response(JSON.stringify({ users: [{ id: 'user-1', email: 'admin@example.com' }] }), {
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  });

  const data = await storage.readAdminDashboardData();

  assert.equal(data.users[0].email, 'admin@example.com');
  for (const table of ['ai_usage_events', 'system_events', 'rankings', 'match_contexts', 'match_schedules', 'billing_orders', 'billing_entitlements']) {
    assert.ok(requests.some(({ url }) => url.includes(`/${table}?`)), `expected ${table} read`);
  }
});
