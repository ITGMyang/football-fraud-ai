const TELEGRAM_ISSUER = 'https://oauth.telegram.org';
const TELEGRAM_DISCOVERY = `${TELEGRAM_ISSUER}/.well-known/openid-configuration`;
const TELEGRAM_JWKS = `${TELEGRAM_ISSUER}/.well-known/jwks.json`;

export function filterTelegramJwks(document) {
  return {
    ...document,
    keys: Array.isArray(document?.keys)
      ? document.keys.filter((key) => key?.kty === 'RSA' || (key?.kty === 'EC' && key?.crv === 'P-256'))
      : []
  };
}

export async function proxyTelegramDiscovery(origin) {
  return new Response(JSON.stringify({
    issuer: TELEGRAM_ISSUER,
    authorization_endpoint: `${TELEGRAM_ISSUER}/auth`,
    token_endpoint: `${TELEGRAM_ISSUER}/token`,
    jwks_uri: `${origin.replace(/\/$/, '')}/auth/telegram/jwks.json`,
    response_types_supported: ['code'],
    scopes_supported: ['openid', 'profile', 'phone', 'telegram:bot_access']
  }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' }
  });
}

export async function proxyTelegramJwks(fetchImpl = fetch) {
  const response = await fetchImpl(TELEGRAM_JWKS);
  if (!response.ok) return new Response('Telegram JWKS unavailable', { status: 502 });
  const document = filterTelegramJwks(await response.json());
  return new Response(JSON.stringify(document), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' }
  });
}

export { TELEGRAM_DISCOVERY };
