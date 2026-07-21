import test from 'node:test';
import assert from 'node:assert/strict';

import { filterTelegramJwks, proxyTelegramDiscovery } from '../src/telegram-oidc.js';

test('Telegram JWKS proxy removes unsupported secp256k1 keys', () => {
  const result = filterTelegramJwks({
    keys: [
      { kty: 'RSA', kid: 'rsa-1', alg: 'RS256' },
      { kty: 'EC', crv: 'P-256', kid: 'p256-1', alg: 'ES256' },
      { kty: 'EC', crv: 'secp256k1', kid: 'k1-1', alg: 'ES256K' }
    ]
  });

  assert.deepEqual(result.keys.map((key) => key.kid), ['rsa-1', 'p256-1']);
});

test('discovery proxy points JWKS at the production proxy URL', async () => {
  const response = await proxyTelegramDiscovery('https://futbots.cc');
  const discovery = await response.json();

  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(discovery.issuer, 'https://oauth.telegram.org');
  assert.equal(discovery.jwks_uri, 'https://futbots.cc/auth/telegram/jwks.json');
});
