import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from './env.js';
import { fetchApiFootballContext, fetchApiFootballMatches } from './api-football.js';
import { createOpenRouterFetch } from './node-openrouter-fetch.js';
import { rankMarkets } from './openrouter.js';
import { resolveOptimizedPrediction } from './prediction-strategy.js';
import { contextKey, findExistingContext, hasLineupPlayers } from './context-utils.js';
import { buildAnalytics, shouldRefreshForAnalytics } from './evaluation.js';
import { authConfig } from './auth.js';
import { authorizeApiRequest, guestPredictionCookie } from './guest-access.js';
import { shouldHydratePredictionContext } from './prediction-policy.js';
import { resolvePublicAsset } from './static-assets.js';
import {
  appendPredictionSnapshots,
  publishPredictionConsensus,
  readDb,
  readCurrentPredictionConsensus,
  readPredictionSettings,
  releasePredictionGeneration,
  reservePredictionGeneration,
  saveRanking,
  upsertMatchContext
} from './storage.js';

loadEnv();

const PORT = Number(process.env.PORT || 3888);
const PUBLIC_DIR = path.resolve('public');
const openRouterFetch = createOpenRouterFetch(process.env, fetch);
const APP_SHELL_ROUTES = new Set(['/', '/login', '/auth/callback', '/auth/reset']);
// The data console, analytics and history pages were folded into /admin.
const RETIRED_CONSOLE_ROUTES = new Set(['/analytics', '/backend', '/data', '/history']);

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Football odds predictor running at http://localhost:${PORT}`);
});

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const teamCrestMatch = url.pathname.match(/^\/media\/team-crests\/(\d+)\.png$/);
  if (req.method === 'GET' && teamCrestMatch) {
    const upstream = await fetch(`https://media.api-sports.io/football/teams/${teamCrestMatch[1]}.png`);
    if (!upstream.ok) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Team crest not found');
    }
    res.writeHead(200, {
      'Cache-Control': 'public, max-age=604800, immutable',
      'Content-Type': 'image/png'
    });
    return res.end(Buffer.from(await upstream.arrayBuffer()));
  }

  if (req.method === 'GET' && RETIRED_CONSOLE_ROUTES.has(url.pathname)) {
    res.writeHead(301, { Location: '/admin' });
    return res.end();
  }
  if (req.method === 'GET' && url.pathname === '/admin') {
    return serveFile(res, 'admin.html', 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && (APP_SHELL_ROUTES.has(url.pathname) || /^\/match\/[^/]+$/.test(url.pathname))) {
    return serveFile(res, 'index.html', 'text/html; charset=utf-8');
  }

  if (req.method === 'GET') {
    const asset = resolvePublicAsset(PUBLIC_DIR, url.pathname);
    if (asset && fs.existsSync(asset.file) && fs.statSync(asset.file).isFile()) {
      res.writeHead(200, { 'Content-Type': asset.contentType });
      return res.end(fs.readFileSync(asset.file));
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/config') return json(res, 200, authConfig(process.env));
  let access = null;
  if (url.pathname.startsWith('/api/')) {
    access = await authorizeApiRequest(req, process.env, fetch);
    if (!access.ok) return json(res, access.status, { error: access.error, code: access.code });
  }
  const ownerId = access?.user?.id || 'guest';

  if (req.method === 'GET' && url.pathname === '/api/auth/status') {
    return json(res, 200, {
      authenticated: access.role === 'user',
      guestPredictionUsed: access.role === 'guest' && access.guestPredictionUsed
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/rankings') return json(res, 200, { rankings: readDb({ ownerId }).rankings || [] });
  if (req.method === 'GET' && url.pathname === '/api/contexts') return json(res, 200, { contexts: readDb({ ownerId }).matchContexts || [] });
  if (req.method === 'GET' && url.pathname === '/api/analytics') {
    const db = readDb({ ownerId });
    return json(res, 200, { analytics: buildAnalytics({ rankings: db.rankings || [], contexts: db.matchContexts || [] }) });
  }
  if (req.method === 'GET' && url.pathname === '/api/backend/schedules') {
    if (access.role !== 'user') return json(res, 401, { error: 'Sign in to view the data console' });
    return json(res, 200, { schedules: [], generatedAt: new Date().toISOString() });
  }
  const backendFixtureMatch = url.pathname.match(/^\/api\/backend\/fixtures\/(\d+)$/);
  if (req.method === 'GET' && backendFixtureMatch) {
    if (access.role !== 'user') return json(res, 401, { error: 'Sign in to view match details' });
    const context = await fetchApiFootballContext(backendFixtureMatch[1], {
      ...apiFootballOptions(process.env),
      includeCatalog: true
    }, fetch);
    return json(res, 200, { context, generatedAt: new Date().toISOString() });
  }
  if (req.method === 'POST' && url.pathname === '/api/analytics/refresh') {
    const db = readDb({ ownerId });
    const targets = (db.matchContexts || []).filter((context) => context.source === 'api-football' && shouldRefreshForAnalytics(context)).slice(0, 12);
    const errors = [];
    for (const context of targets) {
      try {
        upsertMatchContext(await fetchApiFootballContext(context.matchId || context.sourceUrl, fullApiFootballOptions(process.env), fetch), { ownerId });
      } catch (error) {
        errors.push({ sourceUrl: context.sourceUrl, error: error.message });
      }
    }
    const nextDb = readDb({ ownerId });
    return json(res, 200, {
      refreshed: targets.length - errors.length,
      attempted: targets.length,
      errors,
      analytics: buildAnalytics({ rankings: nextDb.rankings || [], contexts: nextDb.matchContexts || [] })
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/football/matches') {
    const competitionId = url.searchParams.get('competitionId') || '1';
    const date = url.searchParams.get('date') || undefined;
    const result = await fetchApiFootballMatches({
      leagueId: competitionId === 'all' ? undefined : competitionId,
      date,
      ...apiFootballOptions(process.env)
    }, fetch);
    return json(res, 200, result);
  }

  if (req.method === 'POST' && url.pathname === '/api/import/api-football') {
    const body = await readJson(req);
    const fixtureId = String(body.fixtureId || body.matchId || '').trim();
    if (!fixtureId) return json(res, 400, { error: 'Missing fixtureId' });
    const existing = findExistingContext(readDb({ ownerId }).matchContexts || [], fixtureId);
    if (existing && hasLineupPlayers(existing) && hasCompleteCatalog(existing)) {
      return json(res, 200, { context: existing, alreadyImported: true, refreshed: false });
    }
    if (existing) {
      const context = upsertMatchContext(await fetchApiFootballContext(fixtureId, fullApiFootballOptions(process.env), fetch), { ownerId });
      return json(res, 200, { context, alreadyImported: true, refreshed: true });
    }
    const context = upsertMatchContext(await fetchApiFootballContext(fixtureId, fullApiFootballOptions(process.env), fetch), { ownerId });
    return json(res, 200, { context, alreadyImported: false });
  }

  if (req.method === 'POST' && url.pathname === '/api/contexts/refresh') {
    const body = await readJson(req);
    const fixtureId = body.fixtureId || body.matchId || body.sourceUrl;
    const context = upsertMatchContext(await fetchApiFootballContext(fixtureId, fullApiFootballOptions(process.env), fetch), { ownerId });
    return json(res, 200, { context, refreshed: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/rankings') {
    const body = await readJson(req);
    const db = readDb({ ownerId });
    const contextSelector = body.contextId || body.sourceUrl || body.matchId;
    let context = contextSelector
      ? findExistingContext(db.matchContexts || [], contextSelector)
      : (db.matchContexts || [])[0] || null;
    if (shouldHydratePredictionContext(access, context, contextSelector)) {
      context = upsertMatchContext(
        await fetchApiFootballContext(contextSelector, fullApiFootballOptions(process.env), fetch),
        { ownerId }
      );
    }
    if (!db.markets.length && !context) return json(res, 400, { error: 'No API-Football match data has been imported' });
    const requestedModel = body.model || 'all';
    const fixtureId = String(context?.matchId || '');
    const shared = fixtureId
      ? await resolveOptimizedPrediction({
        fixtureId,
        contextName: context?.matchName || '',
        markets: db.markets,
        env: rankingEnv(process.env, body),
        fetchImpl: openRouterFetch,
        storage: {
          appendPredictionSnapshots,
          publishPredictionConsensus,
          readCurrentPredictionConsensus,
          readPredictionSettings,
          releasePredictionGeneration,
          reservePredictionGeneration
        },
        rankFn: rankMarkets,
        matchContext: context
      })
      : {
        cacheHit: false,
        ranking: await rankMarkets(db.markets, requestedModel, rankingEnv(process.env, body), openRouterFetch, context)
      };
    const ranking = shared.ranking;
    ranking.contextId = context ? contextKey(context) : '';
    ranking.contextName = context?.matchName || '';
    const savedRanking = saveRanking(ranking, {
      mergeLatest: false,
      ownerId
    });
    const headers = access.consumeGuestPrediction
      ? { 'Set-Cookie': await guestPredictionCookie(process.env, req) }
      : {};
    return json(res, 200, {
      ranking: savedRanking,
      cached: shared.cacheHit,
      predictionPhase: shared.phase || '',
      predictionSource: shared.source || ''
    }, headers);
  }

  return json(res, 404, { error: 'Not found' });
}

function apiFootballOptions(env) {
  return {
    apiKey: env.API_FOOTBALL_KEY,
    baseUrl: env.API_FOOTBALL_BASE_URL,
    proxySecret: env.API_FOOTBALL_PROXY_SECRET
  };
}

function fullApiFootballOptions(env) {
  return { ...apiFootballOptions(env), includeCatalog: true };
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
  return { ...env, MODEL_QWEN: 'qwen/qwen3.7-max', MODEL_QWEN_LABEL: 'Qwen 3.7 Max' };
}

function serveFile(res, filename, contentType) {
  const file = path.join(PUBLIC_DIR, filename);
  if (!fs.existsSync(file)) return json(res, 404, { error: 'Not found' });
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(fs.readFileSync(file));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  return JSON.parse(raw);
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

