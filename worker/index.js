import { buildMarket } from '../src/domain.js';
import { parseDongqiudiSections } from '../src/dongqiudi.js';
import { fetchDongqiudiContext, fetchDongqiudiMatches } from '../src/dongqiudi-fetcher.js';
import { parseStakeText, sampleMarkets } from '../src/parser.js';
import { predictMarket, rankMarkets } from '../src/openrouter.js';
import { createSupabaseStorage } from '../src/supabase-storage.js';
import { contextKey, findExistingContext } from '../src/context-utils.js';

export default {
  async fetch(request, env) {
    try {
      const authResponse = await protect(request, env);
      if (authResponse) return authResponse;
      const apiResponse = await routeApi(request, env);
      if (apiResponse) return apiResponse;
      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: error.message }, 500);
    }
  }
};

const AUTH_COOKIE = 'football_fraud_access';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

async function protect(request, env) {
  if (!env.ACCESS_PASSWORD) return null;

  const url = new URL(request.url);
  if (url.pathname === '/login' && request.method === 'GET') {
    return loginPage(url.searchParams.get('next') || '/');
  }
  if (url.pathname === '/login' && request.method === 'POST') {
    return handleLogin(request, env);
  }
  if (url.pathname === '/logout') {
    return new Response('', {
      status: 302,
      headers: {
        Location: '/login',
        'Set-Cookie': `${AUTH_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
      }
    });
  }

  const token = parseCookies(request.headers.get('Cookie') || '')[AUTH_COOKIE];
  if (token && await verifySessionToken(token, env.ACCESS_PASSWORD)) return null;

  if (url.pathname.startsWith('/api/')) {
    return json({ error: '需要先输入访问密码' }, 401);
  }

  return new Response('', {
    status: 302,
    headers: { Location: `/login?next=${encodeURIComponent(url.pathname + url.search)}` }
  });
}

async function handleLogin(request, env) {
  const form = await request.formData();
  const password = String(form.get('password') || '');
  const next = sanitizeNext(form.get('next'));

  if (password !== env.ACCESS_PASSWORD) {
    return loginPage(next, '密码不对');
  }

  const token = await createSessionToken(env.ACCESS_PASSWORD);
  return new Response('', {
    status: 302,
    headers: {
      Location: next,
      'Set-Cookie': `${AUTH_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`
    }
  });
}

function loginPage(next = '/', error = '') {
  return new Response(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>足球诈骗 | 访问验证</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #071017;
      color: #f4f7fb;
      font-family: Arial, "Microsoft YaHei", sans-serif;
    }
    main {
      width: min(420px, calc(100vw - 32px));
      border: 1px solid rgba(255,255,255,.14);
      background: #101a24;
      padding: 28px;
      border-radius: 10px;
      box-shadow: 0 24px 80px rgba(0,0,0,.36);
    }
    h1 { margin: 0 0 8px; font-size: 32px; letter-spacing: 0; }
    p { margin: 0 0 22px; color: #aebdca; line-height: 1.5; }
    label { display: block; margin-bottom: 8px; color: #d8e0e8; font-weight: 700; }
    input {
      width: 100%;
      height: 46px;
      border: 1px solid rgba(255,255,255,.18);
      border-radius: 8px;
      background: #071017;
      color: #fff;
      padding: 0 14px;
      font-size: 16px;
      outline: none;
    }
    input:focus { border-color: #f2c94c; }
    button {
      width: 100%;
      height: 46px;
      margin-top: 16px;
      border: 0;
      border-radius: 8px;
      background: #f2c94c;
      color: #071017;
      font-weight: 800;
      cursor: pointer;
    }
    .error { margin: 14px 0 0; color: #ff8f8f; }
  </style>
</head>
<body>
  <main>
    <h1>足球诈骗</h1>
    <p>输入访问密码后继续。</p>
    <form method="post" action="/login">
      <input type="hidden" name="next" value="${escapeHtml(sanitizeNext(next))}">
      <label for="password">访问密码</label>
      <input id="password" name="password" type="password" autocomplete="current-password" autofocus>
      <button type="submit">进入网站</button>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
    </form>
  </main>
</body>
</html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

async function createSessionToken(secret) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const signature = await hmac(`${expires}`, secret);
  return `${expires}.${signature}`;
}

async function verifySessionToken(token, secret) {
  const [expires, signature] = String(token || '').split('.');
  const expiry = Number(expires);
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000) || !signature) return false;
  return signature === await hmac(expires, secret);
}

async function hmac(message, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(cookieHeader.split(';').map((part) => {
    const [name, ...rest] = part.trim().split('=');
    return [name, rest.join('=')];
  }).filter(([name]) => name));
}

function sanitizeNext(value) {
  const next = String(value || '/');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

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

  if (request.method === 'GET' && url.pathname === '/api/dongqiudi/matches') {
    const competitionId = url.searchParams.get('competitionId') || '10';
    const date = url.searchParams.get('date') || undefined;
    const sourceUrl = url.searchParams.get('sourceUrl') || '';
    return json(await fetchDongqiudiMatches({ competitionId, date, sourceUrl }, workerFetch));
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
    const sourceUrl = body.sourceUrl || body.url;
    const existing = findExistingContext((await storage.readDb()).matchContexts || [], sourceUrl);
    if (existing) return json({ context: existing, alreadyImported: true });
    const context = await storage.upsertMatchContext(await fetchDongqiudiContext(sourceUrl, workerFetch));
    return json({ context, alreadyImported: false });
  }

  if (request.method === 'POST' && url.pathname === '/api/contexts/refresh') {
    const body = await request.json();
    const context = await storage.upsertMatchContext(await fetchDongqiudiContext(body.sourceUrl || body.url, workerFetch));
    return json({ context, refreshed: true });
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
    const contextSelector = body.contextId || body.sourceUrl || body.matchId;
    const context = contextSelector
      ? findExistingContext(db.matchContexts || [], contextSelector)
      : (db.matchContexts || [])[0] || null;
    if (!db.markets.length && !context) return json({ error: '还没有导入懂球帝比赛数据' }, 400);
    const requestedModel = body.model || 'all';
    const ranking = await rankMarkets(db.markets, requestedModel, env, workerFetch, context);
    ranking.contextId = context ? contextKey(context) : '';
    ranking.contextName = context?.matchName || '';
    const savedRanking = await storage.saveRanking(ranking, {
      mergeLatest: requestedModel !== 'all'
    });
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
