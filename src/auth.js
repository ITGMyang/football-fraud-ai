function clean(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim();
}

export function authConfig(env = {}) {
  const supabaseUrl = clean(env.SUPABASE_URL).replace(/\/$/, '');
  const publishableKey = clean(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY);
  const siteUrl = publicOrigin(env.AUTH_SITE_URL);
  return {
    enabled: Boolean(supabaseUrl && publishableKey),
    supabaseUrl,
    publishableKey,
    siteUrl,
    telegramEnabled: clean(env.TELEGRAM_AUTH_ENABLED).toLowerCase() === 'true'
  };
}

export async function authenticateRequest(request, env = {}, fetchImpl = fetch) {
  const config = authConfig(env);
  if (!config.enabled) {
    return {
      ok: false,
      status: 503,
      error: 'Supabase Auth 尚未配置，请添加 SUPABASE_PUBLISHABLE_KEY'
    };
  }

  const authorization = String(readHeader(request, 'authorization') || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, status: 401, error: '请先登录' };

  let response;
  try {
    response = await fetchImpl(`${config.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${match[1]}`
      }
    });
  } catch {
    return { ok: false, status: 503, error: '暂时无法验证登录状态' };
  }

  if (!response.ok) return { ok: false, status: 401, error: '登录已失效，请重新登录' };
  return { ok: true, user: await response.json() };
}

function readHeader(request, name) {
  const headers = request?.headers;
  if (typeof headers?.get === 'function') return headers.get(name);
  return headers?.[name.toLowerCase()] || headers?.[name] || '';
}

function publicOrigin(value) {
  try {
    const url = new URL(clean(value));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.origin;
  } catch {
    return '';
  }
}
