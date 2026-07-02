import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from './env.js';
import { buildMarket } from './domain.js';
import { parseDongqiudiSections } from './dongqiudi.js';
import { fetchDongqiudiContext, fetchDongqiudiMatches } from './dongqiudi-fetcher.js';
import { parseStakeText, sampleMarkets } from './parser.js';
import { createOpenRouterFetch } from './node-openrouter-fetch.js';
import { predictMarket, rankMarkets } from './openrouter.js';
import { contextKey, findExistingContext, hasLineupPlayers } from './context-utils.js';
import { buildAnalytics, shouldRefreshForAnalytics } from './evaluation.js';
import { clearMarkets, readDb, saveRanking, saveReport, upsertMarkets, upsertMatchContext } from './storage.js';

loadEnv();

const PORT = Number(process.env.PORT || 3888);
const PUBLIC_DIR = path.resolve('public');
const openRouterFetch = createOpenRouterFetch(process.env, fetch);

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

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/history' || url.pathname === '/data' || /^\/match\/[^/]+$/.test(url.pathname))) {
    return serveFile(res, 'index.html', 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && url.pathname === '/app.js') return serveFile(res, 'app.js', 'text/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/styles.css') return serveFile(res, 'styles.css', 'text/css; charset=utf-8');

  if (req.method === 'GET' && url.pathname === '/api/markets') return json(res, 200, { markets: readDb().markets });
  if (req.method === 'GET' && url.pathname === '/api/reports') return json(res, 200, { reports: readDb().reports });
  if (req.method === 'GET' && url.pathname === '/api/rankings') return json(res, 200, { rankings: readDb().rankings || [] });
  if (req.method === 'GET' && url.pathname === '/api/contexts') return json(res, 200, { contexts: readDb().matchContexts || [] });
  if (req.method === 'GET' && url.pathname === '/api/analytics') {
    const db = readDb();
    return json(res, 200, { analytics: buildAnalytics({ rankings: db.rankings || [], contexts: db.matchContexts || [] }) });
  }
  if (req.method === 'POST' && url.pathname === '/api/analytics/refresh') {
    const db = readDb();
    const targets = (db.matchContexts || []).filter(shouldRefreshForAnalytics).slice(0, 12);
    const errors = [];
    for (const context of targets) {
      try {
        upsertMatchContext(await fetchDongqiudiContext(context.sourceUrl, fetch));
      } catch (error) {
        errors.push({ sourceUrl: context.sourceUrl, error: error.message });
      }
    }
    const nextDb = readDb();
    return json(res, 200, {
      refreshed: targets.length - errors.length,
      attempted: targets.length,
      errors,
      analytics: buildAnalytics({ rankings: nextDb.rankings || [], contexts: nextDb.matchContexts || [] })
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/dongqiudi/matches') {
    const competitionId = url.searchParams.get('competitionId') || '10';
    const date = url.searchParams.get('date') || undefined;
    const sourceUrl = url.searchParams.get('sourceUrl') || '';
    const result = await fetchDongqiudiMatches({ competitionId, date, sourceUrl }, fetch);
    return json(res, 200, result);
  }

  if (req.method === 'POST' && url.pathname === '/api/markets/clear') {
    clearMarkets();
    return json(res, 200, { ok: true });
  }

  const marketMatch = url.pathname.match(/^\/api\/markets\/([^/]+)$/);
  if (req.method === 'GET' && marketMatch) {
    const id = decodeURIComponent(marketMatch[1]);
    const market = readDb().markets.find((item) => item.id === id);
    if (!market) return json(res, 404, { error: '找不到盘口' });
    return json(res, 200, { market });
  }

  if (req.method === 'POST' && url.pathname === '/api/sample') {
    const markets = upsertMarkets(sampleMarkets('screenshot://provided'));
    return json(res, 200, { markets });
  }

  if (req.method === 'POST' && url.pathname === '/api/import/text') {
    const body = await readJson(req);
    const markets = upsertMarkets(parseStakeText(body.text, body.sourceUrl));
    return json(res, 200, { markets });
  }

  if (req.method === 'POST' && url.pathname === '/api/import/chrome') {
    const body = await readJson(req);
    const markets = upsertMarkets(parseStakeText(body.text, body.sourceUrl));
    return corsJson(res, 200, { imported: markets.length, markets });
  }

  if (req.method === 'POST' && url.pathname === '/api/import/dongqiudi') {
    const body = await readJson(req);
    const context = upsertMatchContext(parseDongqiudiSections(body));
    return json(res, 200, { context });
  }

  if (req.method === 'POST' && url.pathname === '/api/import/dongqiudi-url') {
    const body = await readJson(req);
    const sourceUrl = body.sourceUrl || body.url;
    const existing = findExistingContext(readDb().matchContexts || [], sourceUrl);
    if (existing && hasLineupPlayers(existing)) return json(res, 200, { context: existing, alreadyImported: true, refreshed: false });
    if (existing) {
      const context = upsertMatchContext(await fetchDongqiudiContext(sourceUrl, fetch));
      return json(res, 200, { context, alreadyImported: true, refreshed: true });
    }
    const context = upsertMatchContext(await fetchDongqiudiContext(sourceUrl, fetch));
    return json(res, 200, { context, alreadyImported: false });
  }

  if (req.method === 'POST' && url.pathname === '/api/contexts/refresh') {
    const body = await readJson(req);
    const sourceUrl = body.sourceUrl || body.url;
    const context = upsertMatchContext(await fetchDongqiudiContext(sourceUrl, fetch));
    return json(res, 200, { context, refreshed: true });
  }

  if (req.method === 'OPTIONS' && url.pathname === '/api/import/chrome') {
    return corsJson(res, 204, {});
  }

  if (req.method === 'POST' && url.pathname === '/api/markets') {
    const body = await readJson(req);
    const market = buildMarket(body);
    upsertMarkets([market]);
    return json(res, 200, { market });
  }

  const predictMatch = url.pathname.match(/^\/api\/predict\/([^/]+)$/);
  if (req.method === 'POST' && predictMatch) {
    const id = decodeURIComponent(predictMatch[1]);
    const market = readDb().markets.find((item) => item.id === id);
    if (!market) return json(res, 404, { error: '找不到盘口' });
    const report = await predictMarket(market, process.env, openRouterFetch);
    saveReport(report);
    return json(res, 200, { report });
  }

  if (req.method === 'POST' && url.pathname === '/api/rankings') {
    const body = await readJson(req);
    const db = readDb();
    const contextSelector = body.contextId || body.sourceUrl || body.matchId;
    const context = contextSelector
      ? findExistingContext(db.matchContexts || [], contextSelector)
      : (db.matchContexts || [])[0] || null;
    if (!db.markets.length && !context) return json(res, 400, { error: '还没有导入懂球帝比赛数据' });
    const requestedModel = body.model || 'all';
    const ranking = await rankMarkets(db.markets, requestedModel, rankingEnv(process.env, body), openRouterFetch, context);
    ranking.contextId = context ? contextKey(context) : '';
    ranking.contextName = context?.matchName || '';
    const savedRanking = saveRanking(ranking, {
      mergeLatest: requestedModel !== 'all'
    });
    return json(res, 200, { ranking: savedRanking });
  }

  return json(res, 404, { error: 'Not found' });
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

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function corsJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(status === 204 ? '' : JSON.stringify(body));
}
