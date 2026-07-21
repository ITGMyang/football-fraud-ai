import test from 'node:test';
import assert from 'node:assert/strict';

import { authConfig, authenticateRequest } from '../src/auth.js';

const env = {
  SUPABASE_URL: 'https://project.supabase.co/',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  AUTH_SITE_URL: 'https://futbots.cc/',
  SUPABASE_SECRET_KEY: 'sb_secret_never-expose'
};

test('auth config exposes only browser-safe Supabase settings', () => {
  assert.deepEqual(authConfig(env), {
    enabled: true,
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_test',
    siteUrl: 'https://futbots.cc',
    telegramEnabled: false
  });
  assert.equal(JSON.stringify(authConfig(env)).includes('never-expose'), false);
});

test('auth config accepts the legacy anon key during migration', () => {
  assert.equal(authConfig({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'legacy-anon'
  }).publishableKey, 'legacy-anon');
});

test('auth config ignores an invalid public site url', () => {
  assert.equal(authConfig({ AUTH_SITE_URL: 'javascript:alert(1)' }).siteUrl, '');
});

test('authentication reports a configuration error when public auth settings are missing', async () => {
  const result = await authenticateRequest(new Request('https://app.test/api/markets'), {}, async () => {
    throw new Error('fetch should not run');
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.match(result.error, /Supabase Auth/);
});

test('authentication rejects a request without a bearer token', async () => {
  const result = await authenticateRequest(new Request('https://app.test/api/markets'), env, async () => {
    throw new Error('fetch should not run');
  });

  assert.deepEqual(result, {
    ok: false,
    status: 401,
    error: 'Sign in required'
  });
});

test('authentication accepts Node IncomingMessage-style headers', async () => {
  const request = { headers: { authorization: 'Bearer node-access-token' } };
  const result = await authenticateRequest(request, env, async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer node-access-token');
    return new Response(JSON.stringify({ id: 'node-user' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  });

  assert.equal(result.ok, true);
  assert.equal(result.user.id, 'node-user');
});

test('authentication validates the bearer token with Supabase Auth', async () => {
  let received;
  const result = await authenticateRequest(new Request('https://app.test/api/markets', {
    headers: { Authorization: 'Bearer access-token' }
  }), env, async (url, options) => {
    received = { url, options };
    return new Response(JSON.stringify({ id: 'user-1', email: 'member@example.com' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  });

  assert.equal(result.ok, true);
  assert.equal(result.user.id, 'user-1');
  assert.equal(received.url, 'https://project.supabase.co/auth/v1/user');
  assert.equal(received.options.headers.apikey, 'sb_publishable_test');
  assert.equal(received.options.headers.Authorization, 'Bearer access-token');
});

test('authentication rejects an expired or invalid Supabase token', async () => {
  const result = await authenticateRequest(new Request('https://app.test/api/markets', {
    headers: { Authorization: 'Bearer expired-token' }
  }), env, async () => new Response(JSON.stringify({ message: 'invalid JWT' }), { status: 401 }));

  assert.deepEqual(result, {
    ok: false,
    status: 401,
    error: 'Your session has expired. Sign in again.'
  });
});
