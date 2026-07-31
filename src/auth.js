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
      error: 'Supabase Auth is not configured. Add SUPABASE_PUBLISHABLE_KEY.'
    };
  }

  const authorization = String(readHeader(request, 'authorization') || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, status: 401, error: 'Sign in required' };

  let response;
  try {
    response = await fetchImpl(`${config.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${match[1]}`
      }
    });
  } catch {
    return { ok: false, status: 503, error: 'Unable to verify the session right now' };
  }

  if (!response.ok) return { ok: false, status: 401, error: 'Your session has expired. Sign in again.' };
  return { ok: true, user: await response.json() };
}

// The email allow-list is the whole answer once it is set. It used to be one of three
// ways in, alongside a Supabase app_metadata role and an id list, so an administrator
// could be created by editing a user record - somewhere the list nobody reads does not
// mention. Signing in still requires a confirmed email, which is what makes an address
// safe to trust as the identity.
export function isAdminUser(user = {}, env = {}) {
  const adminEmails = listEnvValues(env.ADMIN_EMAILS);
  if (adminEmails.size) return adminEmails.has(String(user.email || '').toLowerCase());

  // Unconfigured - local development only. Production sets ADMIN_EMAILS.
  const appRole = String(user.app_metadata?.role || user.app_metadata?.user_role || '').toLowerCase();
  if (appRole === 'admin') return true;
  return listEnvValues(env.ADMIN_USER_IDS).has(String(user.id || '').toLowerCase());
}

function listEnvValues(value) {
  return new Set(String(value || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean));
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
