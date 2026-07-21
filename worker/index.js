import { buildMarket } from '../src/domain.js';
import {
  fetchApiFootballContext,
  fetchApiFootballMatches,
  fetchApiFootballOddsFixtureIds,
  filterApiFootballMatches,
  filterMatchesWithOdds,
  scheduleFromMatches
} from '../src/api-football.js';
import {
  aggregateApiFootballSchedules,
  enrichContextsWithScheduleTeams,
  filterApiFootballSchedules,
  isOddsCheckDue,
  mergeScheduleDate,
  refreshApiFootballScheduleCache
} from '../src/api-football-cache.js';
import { parseStakeText, sampleMarkets } from '../src/parser.js';
import { predictMarket, rankMarkets } from '../src/openrouter.js';
import { createSupabaseStorage } from '../src/supabase-storage.js';
import { contextKey, findExistingContext, hasLineupPlayers } from '../src/context-utils.js';
import { buildAnalytics, shouldRefreshForAnalytics } from '../src/evaluation.js';
import { authConfig } from '../src/auth.js';
import { authorizeApiRequest, guestPredictionCookie } from '../src/guest-access.js';
import { proxyTelegramDiscovery, proxyTelegramJwks } from '../src/telegram-oidc.js';
import { billingAccess, billingPlan, publicBillingPlans } from '../src/billing.js';
import {
  createAllScaleCheckout,
  getAllScaleCheckoutStatus,
  verifyAllScaleWebhook
} from '../src/allscale.js';

const APP_SHELL_ROUTES = new Set([
  '/',
  '/analytics',
  '/auth/callback',
  '/auth/reset',
  '/backend',
  '/data',
  '/history',
  '/login'
]);

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/api/auth/config') return json(authConfig(env));
      if (request.method === 'GET' && url.pathname === '/auth/telegram/.well-known/openid-configuration') {
        return proxyTelegramDiscovery(url.origin);
      }
      if (request.method === 'GET' && url.pathname === '/auth/telegram/jwks.json') {
        return proxyTelegramJwks(fetch);
      }
      if (request.method === 'POST' && url.pathname === '/api/billing/webhook') {
        return handleAllScaleWebhook(request, env);
      }
      if (request.method === 'POST' && url.pathname === '/api/internal/api-football-cache/refresh') {
        const expected = String(env.CRON_SECRET || '').trim();
        if (!expected || request.headers.get('X-Cron-Secret') !== expected) {
          return json({ error: 'Unauthorized' }, 401);
        }
        return json(await refreshApiFootballScheduleCache(env));
      }
      if (request.method === 'OPTIONS' && url.pathname === '/api/import/chrome') return corsJson({}, 204);
      let access = null;
      if (url.pathname.startsWith('/api/')) {
        access = await authorizeApiRequest(request, env, fetch);
        if (!access.ok) return json({ error: access.error, code: access.code }, access.status);
      }
      const apiResponse = await routeApi(request, env, access);
      if (apiResponse) return apiResponse;
      if (request.method === 'GET' && (APP_SHELL_ROUTES.has(url.pathname) || url.pathname.startsWith('/match/'))) {
        const shellResponse = await env.ASSETS.fetch(new Request(new URL('/index.html', url.origin), request));
        const headers = new Headers(shellResponse.headers);
        headers.set('Cache-Control', 'no-cache');
        return new Response(shellResponse.body, { status: shellResponse.status, headers });
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: error.message }, 500);
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(refreshApiFootballScheduleCache(env).then((result) => {
      console.log(JSON.stringify({ event: 'api_football_schedule_cache_refresh', ...result }));
    }).catch((error) => {
      console.error(JSON.stringify({ event: 'api_football_schedule_cache_refresh_failed', error: error.message }));
    }));
  }
};

async function routeApi(request, env, access) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;

  const workerFetch = (input, init) => fetch(input, init);
  const storage = createSupabaseStorage(env, workerFetch);
  const ownerId = access?.user?.id || 'guest';

  if (request.method === 'GET' && url.pathname === '/api/auth/status') {
    const entitlement = access.role === 'user'
      ? await storage.readBillingEntitlement(ownerId)
      : { freePredictionUsed: access.guestPredictionUsed };
    return json({
      authenticated: access.role === 'user',
      guestPredictionUsed: access.role === 'guest' && access.guestPredictionUsed,
      billing: billingAccess(entitlement),
      plans: publicBillingPlans()
    });
  }
  if (request.method === 'GET' && url.pathname === '/api/billing/status') {
    const entitlement = access.role === 'user'
      ? await storage.readBillingEntitlement(ownerId)
      : { freePredictionUsed: access.guestPredictionUsed };
    return json({ billing: billingAccess(entitlement), plans: publicBillingPlans() });
  }
  if (request.method === 'POST' && url.pathname === '/api/billing/checkout') {
    if (access.role !== 'user') return json({ error: 'Sign in before purchasing a pass', code: 'LOGIN_REQUIRED' }, 401);
    const recentOrders = await storage.countRecentBillingOrders(
      ownerId,
      new Date(Date.now() - 60 * 1000).toISOString()
    );
    if (recentOrders >= 5) return json({ error: 'Too many checkout requests. Try again in one minute.', code: 'BILLING_RATE_LIMIT' }, 429);
    const body = await request.json();
    const plan = billingPlan(body.planId);
    if (!plan) return json({ error: 'Invalid access pass' }, 400);
    const orderId = crypto.randomUUID();
    await storage.createBillingOrder({
      id: orderId,
      ownerId,
      planId: plan.id,
      amountCents: plan.amountCents,
      status: 0
    });
    try {
      const siteUrl = String(env.AUTH_SITE_URL || url.origin).replace(/\/$/, '');
      const checkout = await createAllScaleCheckout({
        planId: plan.id,
        orderId,
        userId: ownerId,
        userName: access.user?.email || access.user?.user_metadata?.full_name || '',
        redirectUrl: `${siteUrl}/?checkout=return&order=${encodeURIComponent(orderId)}#subscriptionPanel`
      }, env, workerFetch);
      if (!checkout.checkoutUrl || !checkout.intentId) throw new Error('AllScale did not return a checkout URL');
      await storage.updateBillingOrder(orderId, {
        intentId: checkout.intentId,
        checkoutUrl: checkout.checkoutUrl,
        status: 1,
        requestId: checkout.requestId
      });
      return json({
        orderId,
        checkoutUrl: checkout.checkoutUrl,
        intentId: checkout.intentId,
        amount: (plan.amountCents / 100).toFixed(2),
        currency: 'USDT'
      });
    } catch (error) {
      await storage.updateBillingOrder(orderId, { status: -1, requestId: error.requestId || '' }).catch(() => null);
      throw error;
    }
  }
  const billingOrderMatch = url.pathname.match(/^\/api\/billing\/orders\/([^/]+)\/status$/);
  if (request.method === 'GET' && billingOrderMatch) {
    if (access.role !== 'user') return json({ error: 'Sign in required' }, 401);
    const orderId = decodeURIComponent(billingOrderMatch[1]);
    const order = await storage.readBillingOrder(ownerId, orderId);
    if (!order) return json({ error: 'Order not found' }, 404);
    const currentBilling = billingAccess(await storage.readBillingEntitlement(ownerId));
    if (Number(order.status) === 20 || currentBilling.active) {
      return json({ orderId: order.id, status: 20, billing: currentBilling });
    }
    if (!order.intentId) return json({ order, status: order.status, billing: currentBilling });
    const lastCheck = Date.parse(order.updatedAt || '');
    if (Number.isFinite(lastCheck) && Date.now() - lastCheck < 4000) {
      return json({ orderId: order.id, status: order.status, billing: currentBilling, retryAfterMs: 4000 });
    }
    const remote = await getAllScaleCheckoutStatus(order.intentId, env, workerFetch);
    await storage.updateBillingOrder(order.id, { status: remote.status, requestId: remote.requestId });
    if (remote.status === 20) {
      await storage.confirmAllScalePayment({
        intentId: order.intentId,
        webhookId: `poll:${order.intentId}`,
        nonce: crypto.randomUUID(),
        payload: { source: 'status-poll', request_id: remote.requestId }
      });
    }
    return json({
      orderId: order.id,
      status: remote.status,
      billing: billingAccess(await storage.readBillingEntitlement(ownerId))
    });
  }
  if (request.method === 'GET' && url.pathname === '/api/markets') {
    return json({ markets: (await storage.readDb({ ownerId })).markets });
  }
  if (request.method === 'GET' && url.pathname === '/api/reports') {
    return json({ reports: (await storage.readDb({ ownerId })).reports });
  }
  if (request.method === 'GET' && url.pathname === '/api/rankings') {
    return json({ rankings: (await storage.readDb({ ownerId })).rankings || [] });
  }
  if (request.method === 'GET' && url.pathname === '/api/contexts') {
    const db = await storage.readDb({ ownerId });
    const schedules = await storage.listMatchSchedules();
    return json({
      contexts: enrichContextsWithScheduleTeams(db.matchContexts || [], schedules)
    });
  }
  if (request.method === 'GET' && url.pathname === '/api/analytics') {
    const db = await storage.readDb({ ownerId });
    return json({ analytics: buildAnalytics({ rankings: db.rankings || [], contexts: db.matchContexts || [] }) });
  }
  if (request.method === 'GET' && url.pathname === '/api/backend/schedules') {
    if (access.role !== 'user') return json({ error: 'Sign in to view the data console' }, 401);
    return json({
      schedules: filterApiFootballSchedules(await storage.listMatchSchedules()),
      generatedAt: new Date().toISOString()
    });
  }
  const backendFixtureMatch = url.pathname.match(/^\/api\/backend\/fixtures\/(\d+)$/);
  if (request.method === 'GET' && backendFixtureMatch) {
    if (access.role !== 'user') return json({ error: 'Sign in to view match details' }, 401);
    const context = await fetchApiFootballContext(backendFixtureMatch[1], apiFootballContextOptions(env, storage), workerFetch);
    return json({ context, generatedAt: new Date().toISOString() });
  }
  if (request.method === 'POST' && url.pathname === '/api/analytics/refresh') {
    const db = await storage.readDb({ ownerId });
    const targets = (db.matchContexts || []).filter((context) => context.source === 'api-football' && shouldRefreshForAnalytics(context)).slice(0, 12);
    const errors = [];
    for (const context of targets) {
      try {
        await storage.upsertMatchContext(await fetchApiFootballContext(context.matchId || context.sourceUrl, apiFootballContextOptions(env, storage), workerFetch), { ownerId });
      } catch (error) {
        errors.push({ sourceUrl: context.sourceUrl, error: error.message });
      }
    }
    const nextDb = await storage.readDb({ ownerId });
    return json({
      refreshed: targets.length - errors.length,
      attempted: targets.length,
      errors,
      analytics: buildAnalytics({ rankings: nextDb.rankings || [], contexts: nextDb.matchContexts || [] })
    });
  }

  if (request.method === 'GET' && url.pathname === '/api/football/matches') {
    const competitionId = url.searchParams.get('competitionId') || '1';
    const date = url.searchParams.get('date') || undefined;
    let cached;
    if (competitionId === 'all') {
      let schedules = filterApiFootballSchedules(await storage.listMatchSchedules());
      if (!schedules.length) {
        await refreshApiFootballScheduleCache(env, workerFetch);
        schedules = filterApiFootballSchedules(await storage.listMatchSchedules());
      }
      cached = aggregateApiFootballSchedules(schedules, date);
    } else {
      cached = await storage.readMatchSchedule(competitionId);
      if (!cached) await refreshApiFootballScheduleCache(env, workerFetch);
      if (!cached) cached = await storage.readMatchSchedule(competitionId);
    }
    const needsWorldCupDate = competitionId === '1'
      && String(date || '').startsWith('2026-')
      && !cached?.matches?.some((match) => match.date === date && match.hasOdds === true)
      && (!cached?.providerChecks?.[date]
        || cached.providerChecks?.[date]?.rateLimit === undefined
        || cached?.oddsCheckModes?.[date] !== 'fixture'
        || isOddsCheckDue(cached, date));
    if (needsWorldCupDate) {
      let checkStage = 'fixtures';
      let fixtureCount = 0;
      try {
        const fetched = await fetchApiFootballMatches({
          leagueId: '1',
          date,
          ...apiFootballOptions(env)
        }, workerFetch);
        fixtureCount = fetched.matches.length;
        checkStage = 'odds';
        const oddsFixtureIds = new Set();
        for (const match of fetched.matches) {
          const verifiedIds = await fetchApiFootballOddsFixtureIds({
            fixtureId: match.matchId,
            ...apiFootballOptions(env)
          }, workerFetch);
          for (const fixtureId of verifiedIds) oddsFixtureIds.add(fixtureId);
        }
        const verifiedMatches = filterMatchesWithOdds(fetched.matches, oddsFixtureIds);
        cached = scheduleFromMatches(
          mergeScheduleDate(cached?.matches || [], verifiedMatches, date),
          { date, competitionId: '1', fetchedAt: fetched.fetchedAt }
        );
        cached.oddsCheckedDates = {
          ...(cached.oddsCheckedDates || {}),
          [date]: fetched.fetchedAt
        };
        cached.oddsCheckModes = {
          ...(cached.oddsCheckModes || {}),
          [date]: 'fixture'
        };
        cached.providerChecks = {
          ...(cached.providerChecks || {}),
          [date]: {
            status: 'ready',
            stage: 'complete',
            fixtureCount,
            oddsCount: verifiedMatches.length,
            checkedAt: fetched.fetchedAt
          }
        };
        await storage.upsertMatchSchedules([cached]);
      } catch (error) {
        if (!cached || !/too many requests/i.test(String(error?.message || ''))) throw error;
        cached = {
          ...cached,
          oddsCheckedDates: {
            ...(cached.oddsCheckedDates || {}),
            [date]: new Date().toISOString()
          },
          oddsCheckModes: {
            ...(cached.oddsCheckModes || {}),
            [date]: 'fixture'
          },
          providerChecks: {
            ...(cached.providerChecks || {}),
            [date]: {
              status: 'rate-limited',
              stage: checkStage,
              fixtureCount,
              oddsCount: 0,
              rateLimit: error.rateLimit || null,
              checkedAt: new Date().toISOString()
            }
          }
        };
        await storage.upsertMatchSchedules([cached]);
        return json({ ...filterApiFootballMatches(cached, date), cacheStatus: 'odds-check-delayed' });
      }
    }
    if (!cached) return json({ error: 'Match data is being prepared for the first time. Try again shortly.', code: 'SCHEDULE_CACHE_MISS' }, 503);
    return json({ ...filterApiFootballMatches(cached, date), cacheStatus: 'ready' });
  }

  if (request.method === 'POST' && url.pathname === '/api/markets/clear') {
    await storage.clearMarkets({ ownerId });
    return json({ ok: true });
  }

  const marketMatch = url.pathname.match(/^\/api\/markets\/([^/]+)$/);
  if (request.method === 'GET' && marketMatch) {
    const id = decodeURIComponent(marketMatch[1]);
    const market = (await storage.readDb({ ownerId })).markets.find((item) => item.id === id);
    if (!market) return json({ error: 'Market not found' }, 404);
    return json({ market });
  }

  if (request.method === 'POST' && url.pathname === '/api/sample') {
    const markets = await storage.upsertMarkets(sampleMarkets('sample://cloudflare'), { ownerId });
    return json({ markets });
  }

  if (request.method === 'POST' && url.pathname === '/api/import/text') {
    const body = await request.json();
    const markets = await storage.upsertMarkets(parseStakeText(body.text, body.sourceUrl), { ownerId });
    return json({ markets });
  }

  if (request.method === 'POST' && url.pathname === '/api/import/chrome') {
    const body = await request.json();
    const markets = await storage.upsertMarkets(parseStakeText(body.text, body.sourceUrl), { ownerId });
    return corsJson({ imported: markets.length, markets });
  }

  if (request.method === 'OPTIONS' && url.pathname === '/api/import/chrome') {
    return corsJson({}, 204);
  }

  if (request.method === 'POST' && url.pathname === '/api/import/api-football') {
    const body = await request.json();
    const fixtureId = String(body.fixtureId || body.matchId || '').trim();
    if (!fixtureId) return json({ error: 'Missing fixtureId' }, 400);
    const existing = findExistingContext((await storage.readDb({ ownerId })).matchContexts || [], fixtureId);
    if (existing && hasLineupPlayers(existing) && hasCompleteCatalog(existing)) {
      return json({ context: existing, alreadyImported: true, refreshed: false });
    }
    if (existing) {
      const context = await storage.upsertMatchContext(await fetchApiFootballContext(fixtureId, apiFootballContextOptions(env, storage), workerFetch), { ownerId });
      return json({ context, alreadyImported: true, refreshed: true });
    }
    const context = await storage.upsertMatchContext(await fetchApiFootballContext(fixtureId, apiFootballContextOptions(env, storage), workerFetch), { ownerId });
    return json({ context, alreadyImported: false });
  }

  if (request.method === 'POST' && url.pathname === '/api/contexts/refresh') {
    const body = await request.json();
    const context = await storage.upsertMatchContext(await fetchApiFootballContext(body.fixtureId || body.matchId || body.sourceUrl, apiFootballContextOptions(env, storage), workerFetch), { ownerId });
    return json({ context, refreshed: true });
  }

  if (request.method === 'POST' && url.pathname === '/api/markets') {
    const market = buildMarket(await request.json());
    await storage.upsertMarkets([market], { ownerId });
    return json({ market });
  }

  const predictMatch = url.pathname.match(/^\/api\/predict\/([^/]+)$/);
  if (request.method === 'POST' && predictMatch) {
    const id = decodeURIComponent(predictMatch[1]);
    const market = (await storage.readDb({ ownerId })).markets.find((item) => item.id === id);
    if (!market) return json({ error: 'Market not found' }, 404);
    const predictionAccess = await reservePredictionAccess(access, storage, ownerId);
    if (!predictionAccess.ok) return json({ error: predictionAccess.error, code: predictionAccess.code }, 402);
    try {
      const report = await predictMarket(market, env, workerFetch);
      await storage.saveReport(report, { ownerId });
      return json({ report, billing: predictionAccess.billing });
    } catch (error) {
      if (predictionAccess.release) await storage.releaseFreePrediction(ownerId).catch(() => null);
      throw error;
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/rankings') {
    const body = await request.json();
    const db = await storage.readDb({ ownerId });
    const contextSelector = body.contextId || body.sourceUrl || body.matchId;
    const context = contextSelector
      ? findExistingContext(db.matchContexts || [], contextSelector)
      : (db.matchContexts || [])[0] || null;
    if (!db.markets.length && !context) return json({ error: 'No API-Football match data has been imported' }, 400);
    const predictionAccess = await reservePredictionAccess(access, storage, ownerId);
    if (!predictionAccess.ok) return json({ error: predictionAccess.error, code: predictionAccess.code }, 402);
    const requestedModel = predictionAccess.free ? 'Qwen' : (body.model || 'all');
    try {
      const ranking = await rankMarkets(db.markets, requestedModel, rankingEnv(env, body), workerFetch, context);
      ranking.contextId = context ? contextKey(context) : '';
      ranking.contextName = context?.matchName || '';
      const savedRanking = await storage.saveRanking(ranking, {
        mergeLatest: requestedModel !== 'all',
        ownerId
      });
      const headers = access.consumeGuestPrediction
        ? { 'Set-Cookie': await guestPredictionCookie(env, request) }
        : {};
      return json({ ranking: savedRanking, billing: predictionAccess.billing, model: requestedModel }, 200, headers);
    } catch (error) {
      if (predictionAccess.release) await storage.releaseFreePrediction(ownerId).catch(() => null);
      throw error;
    }
  }

  return json({ error: 'Not found' }, 404);
}

async function handleAllScaleWebhook(request, env) {
  let verified;
  try {
    verified = await verifyAllScaleWebhook(request, env);
  } catch (error) {
    return json({ error: error.message }, 400);
  }
  try {
    const payload = verified.payload;
    const storage = createSupabaseStorage(env, (input, init) => fetch(input, init));
    const result = await storage.confirmAllScalePayment({
      intentId: String(payload.all_scale_checkout_intent_id || ''),
      webhookId: verified.webhookId,
      nonce: verified.nonce,
      transactionId: String(payload.all_scale_transaction_id || ''),
      amountCents: Number.isFinite(Number(payload.amount_cents)) ? Number(payload.amount_cents) : null,
      payload
    });
    return json({ ok: true, duplicate: Boolean(result?.duplicate) });
  } catch {
    return json({ error: 'Payment processing temporarily unavailable' }, 500);
  }
}

async function reservePredictionAccess(access, storage, ownerId) {
  if (access.role === 'guest') {
    return {
      ok: true,
      free: true,
      release: false,
      billing: billingAccess({ freePredictionUsed: false })
    };
  }
  const current = billingAccess(await storage.readBillingEntitlement(ownerId));
  if (current.active) return { ok: true, free: false, release: false, billing: current };
  const consumed = await storage.consumeFreePrediction(ownerId);
  if (!consumed) {
    return {
      ok: false,
      code: 'SUBSCRIPTION_REQUIRED',
      error: 'Your free prediction has been used. Choose a 24-hour, weekly, or monthly pass.'
    };
  }
  return {
    ok: true,
    free: true,
    release: true,
    billing: billingAccess({ freePredictionUsed: true })
  };
}

function apiFootballOptions(env) {
  return {
    apiKey: env.API_FOOTBALL_KEY,
    baseUrl: env.API_FOOTBALL_BASE_URL,
    proxySecret: env.API_FOOTBALL_PROXY_SECRET
  };
}

function apiFootballContextOptions(env, storage) {
  return {
    ...apiFootballOptions(env),
    includeCatalog: true,
    catalogCache: {
      read: (cacheKey) => storage.readApiFootballCatalog(cacheKey),
      write: (cacheKey, catalog) => storage.upsertApiFootballCatalog(cacheKey, catalog)
    }
  };
}

function hasCompleteCatalog(context) {
  const catalog = context?.catalog;
  return Boolean(catalog
    && Array.isArray(catalog.standings)
    && Array.isArray(catalog.topScorers)
    && Array.isArray(catalog.teamStatistics)
    && Array.isArray(catalog.squads)
    && Array.isArray(catalog.coaches));
}

function rankingEnv(env, body = {}) {
  const variant = String(body.qwenVariant || '').toLowerCase();
  if (variant === 'max') {
    return { ...env, MODEL_QWEN: 'qwen/qwen3.7-max', MODEL_QWEN_LABEL: 'Qwen 3.7 Max' };
  }
  if (variant === 'plus') {
    return { ...env, MODEL_QWEN: 'qwen/qwen3.7-plus', MODEL_QWEN_LABEL: 'Qwen 3.7 Plus' };
  }
  return env;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
  });
}

function corsJson(body, status = 200) {
  return new Response(status === 204 ? '' : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}
