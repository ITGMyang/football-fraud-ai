// The console lives on its own hostname so the public site never carries it. Both
// hostnames are served by the same Worker; the split is enforced here rather than by
// deploying twice, which would mean keeping two copies of every secret in sync.

// Everything the console needs and nothing else. The public app must not be reachable
// on the console hostname, or the split buys nothing.
const ADMIN_HOST_PATHS = new Set(['/', '/admin', '/api/auth/config']);
const ADMIN_HOST_PREFIXES = ['/api/admin/', '/build/', '/assets/', '/media/'];

export function adminHostname(env = {}) {
  return String(env.ADMIN_HOSTNAME || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

export function isAdminHost(url, env = {}) {
  const configured = adminHostname(env);
  return Boolean(configured) && String(url?.hostname || '').toLowerCase() === configured;
}

export function allowedOnAdminHost(pathname = '') {
  return ADMIN_HOST_PATHS.has(pathname) || ADMIN_HOST_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// Local development has no second hostname, so the console stays at /admin there.
export function adminConsoleUrl(env = {}) {
  const configured = adminHostname(env);
  return configured ? `https://${configured}/` : '';
}
