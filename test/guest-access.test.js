import test from 'node:test';
import assert from 'node:assert/strict';

import { authorizeApiRequest, guestPredictionCookie } from '../src/guest-access.js';

const env = {
  GUEST_USAGE_SECRET: 'test-guest-secret',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test'
};

test('guest can read public API data without logging in', async () => {
  const access = await authorizeApiRequest(new Request('https://app.test/api/contexts'), env);
  assert.deepEqual(access, { ok: true, role: 'guest', guestPredictionUsed: false });
});

test('guest can request the first AI ranking', async () => {
  const access = await authorizeApiRequest(new Request('https://app.test/api/rankings', { method: 'POST' }), env);
  assert.equal(access.ok, true);
  assert.equal(access.role, 'guest');
  assert.equal(access.consumeGuestPrediction, true);
});

test('guest cannot request another ranking after the signed usage cookie is set', async () => {
  const setCookie = await guestPredictionCookie(env, new Request('https://app.test/api/rankings'));
  const cookie = setCookie.split(';')[0];
  const access = await authorizeApiRequest(new Request('https://app.test/api/rankings', {
    method: 'POST',
    headers: { Cookie: cookie }
  }), env);

  assert.deepEqual(access, {
    ok: false,
    status: 403,
    code: 'GUEST_LIMIT_REACHED',
    error: '访客预测次数已用完，请登录后继续'
  });
});

test('guest cannot use other write APIs', async () => {
  const access = await authorizeApiRequest(new Request('https://app.test/api/markets/clear', { method: 'POST' }), env);
  assert.deepEqual(access, { ok: false, status: 401, error: '请先登录' });
});

test('signed-in user can use write APIs without guest limits', async () => {
  const request = new Request('https://app.test/api/markets/clear', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token' }
  });
  const access = await authorizeApiRequest(request, env, async () => new Response(JSON.stringify({
    id: 'user-1',
    email: 'member@example.com'
  }), { headers: { 'Content-Type': 'application/json' } }));

  assert.equal(access.ok, true);
  assert.equal(access.role, 'user');
  assert.equal(access.user.id, 'user-1');
});
