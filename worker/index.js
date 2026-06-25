import { buildMarket } from '../src/domain.js';
import { parseDongqiudiSections } from '../src/dongqiudi.js';
import { fetchDongqiudiContext } from '../src/dongqiudi-fetcher.js';
import { parseStakeText, sampleMarkets } from '../src/parser.js';
import { predictMarket, rankMarkets } from '../src/openrouter.js';
import { createSupabaseStorage } from '../src/supabase-storage.js';

export default {
  async fetch(request, env) {
    try {
      const apiResponse = await routeApi(request, env);
      if (apiResponse) return apiResponse;
      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: error.message }, 500);
    }
  }
};

async function routeApi(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;

  const workerFetch = (input, init) => fetch(input, init);
  const storage = createSupabaseStorage(env, workerFetch);

  if (request.method === 'GET' && url.pathname === '/api/markets') {
    return json({ markets: (await storage.readDb()).markets });
  }
  if (request.method === 'GET' && url.pathname === '/api/reports') {
    return json({ reports: (await storage.readDb()).reports });
  }
  if (request.method === 'GET' && url.pathname === '/api/rankings') {
    return json({ rankings: (await storage.readDb()).rankings || [] });
  }
  if (request.method === 'GET' && url.pathname === '/api/contexts') {
    return json({ contexts: (await storage.readDb()).matchContexts || [] });
  }

  if (request.method === 'POST' && url.pathname === '/api/markets/clear') {
    await storage.clearMarkets();
    return json({ ok: true });
  }

  const marketMatch = url.pathname.match(/^\/api\/markets\/([^/]+)$/);
  if (request.method === 'GET' && marketMatch) {
    const id = decodeURIComponent(marketMatch[1]);
    const market = (await storage.readDb()).markets.find((item) => item.id === id);
    if (!market) return json({ error: '找不到盘口' }, 404);
    return json({ market });
  }

  if (request.method === 'POST' && url.pathname === '/api/sample') {
    const markets = await storage.upsertMarkets(sampleMarkets('sample://cloudflare'));
    return json({ markets });
  }

  if (request.method === 'POST' && url.pathname === '/api/import/text') {
    const body = await request.json();
    const markets = await storage.upsertMarkets(parseStakeText(body.text, body.sourceUrl));
    return json({ markets });
  }

  if (request.method === 'POST' && url.pathname === '/api/import/chrome') {
    const body = await request.json();
    const markets = await storage.upsertMarkets(parseStakeText(body.text, body.sourceUrl));
    return corsJson({ imported: markets.length, markets });
  }

  if (request.method === 'OPTIONS' && url.pathname === '/api/import/chrome') {
    return corsJson({}, 204);
  }

  if (request.method === 'POST' && url.pathname === '/api/import/dongqiudi') {
    const body = await request.json();
    const context = await storage.upsertMatchContext(parseDongqiudiSections(body));
    return json({ context });
  }

  if (request.method === 'POST' && url.pathname === '/api/import/dongqiudi-url') {
    const body = await request.json();
    const context = await storage.upsertMatchContext(await fetchDongqiudiContext(body.sourceUrl || body.url, workerFetch));
    return json({ context });
  }

  if (request.method === 'POST' && url.pathname === '/api/markets') {
    const market = buildMarket(await request.json());
    await storage.upsertMarkets([market]);
    return json({ market });
  }

  const predictMatch = url.pathname.match(/^\/api\/predict\/([^/]+)$/);
  if (request.method === 'POST' && predictMatch) {
    const id = decodeURIComponent(predictMatch[1]);
    const market = (await storage.readDb()).markets.find((item) => item.id === id);
    if (!market) return json({ error: '找不到盘口' }, 404);
    const report = await predictMarket(market, env, workerFetch);
    await storage.saveReport(report);
    return json({ report });
  }

  if (request.method === 'POST' && url.pathname === '/api/rankings') {
    const body = await request.json();
    const db = await storage.readDb();
    const context = (db.matchContexts || [])[0] || null;
    if (!db.markets.length && !context) return json({ error: '还没有导入懂球帝比赛数据' }, 400);
    const requestedModel = body.model || 'all';
    const ranking = await rankMarkets(db.markets, requestedModel, env, workerFetch, context);
    const savedRanking = await storage.saveRanking(ranking, { mergeLatest: requestedModel !== 'all' });
    return json({ ranking: savedRanking });
  }

  return json({ error: 'Not found' }, 404);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function corsJson(body, status = 200) {
  return new Response(status === 204 ? '' : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
