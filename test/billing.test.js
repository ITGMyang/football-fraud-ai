import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';

import {
  BILLING_PLANS,
  billingAccess,
  billingPlan,
  publicBillingPlans
} from '../src/billing.js';
import {
  createAllScaleCheckout,
  getAllScaleCheckoutStatus,
  signAllScaleRequest,
  verifyAllScaleWebhook
} from '../src/allscale.js';

const env = {
  ALLSCALE_API_KEY: 'st_test_key',
  ALLSCALE_API_SECRET: 'st_test_secret',
  ALLSCALE_BASE_URL: 'https://openapi.allscale.io'
};

test('billing plans keep prices and durations on the server', () => {
  assert.deepEqual(BILLING_PLANS.map(({ id, amountCents, durationHours }) => ({ id, amountCents, durationHours })), [
    { id: 'day', amountCents: 299, durationHours: 24 },
    { id: 'week', amountCents: 1199, durationHours: 168 },
    { id: 'month', amountCents: 2999, durationHours: 720 }
  ]);
  assert.equal(billingPlan('unknown'), null);
  assert.deepEqual(publicBillingPlans()[0], {
    id: 'day', name: '24 小时卡', price: '2.99', currency: 'USDT', durationHours: 24, recommended: false
  });
});

test('billing access distinguishes paid, free and exhausted accounts', () => {
  const now = Date.parse('2026-07-20T12:00:00.000Z');
  assert.equal(billingAccess({ validUntil: '2026-07-21T12:00:00.000Z' }, now).tier, 'paid');
  assert.equal(billingAccess({ freePredictionUsed: false }, now).tier, 'free');
  assert.equal(billingAccess({ freePredictionUsed: true }, now).tier, 'locked');
});

test('AllScale request signing follows the documented canonical string', async () => {
  const timestamp = '1784548800';
  const nonce = 'nonce-123';
  const body = JSON.stringify({ stable_coin: 1, amount_cents: 299 });
  const signed = await signAllScaleRequest({
    method: 'POST', path: '/v1/checkout_intents/', query: '', body,
    apiSecret: env.ALLSCALE_API_SECRET, timestamp, nonce
  });
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const canonical = ['POST', '/v1/checkout_intents/', '', timestamp, nonce, bodyHash].join('\n');
  const expected = createHmac('sha256', env.ALLSCALE_API_SECRET).update(canonical).digest('base64');

  assert.equal(signed['X-Timestamp'], timestamp);
  assert.equal(signed['X-Nonce'], nonce);
  assert.equal(signed['X-Signature'], `v1=${expected}`);
});

test('checkout creation ignores client amounts and uses the selected server plan', async () => {
  let request;
  const result = await createAllScaleCheckout({
    planId: 'day',
    orderId: 'order-1',
    userId: 'user-1',
    userName: 'Member',
    redirectUrl: 'https://futbots.cc/?checkout=return'
  }, env, async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({
      code: 0,
      payload: {
        checkout_url: 'https://checkout.allscale.io/test',
        allscale_checkout_intent_id: 'intent-1',
        amount_coins: '2.990000',
        stable_coin_type: 1
      },
      request_id: 'req-1'
    }), { headers: { 'content-type': 'application/json' } });
  });

  assert.equal(request.url, 'https://openapi.allscale.io/v1/checkout_intents/');
  assert.deepEqual(JSON.parse(request.options.body), {
    stable_coin: 1,
    amount_cents: 299,
    order_id: 'order-1',
    order_description: '24 小时卡',
    user_id: 'user-1',
    user_name: 'Member',
    redirect_url: 'https://futbots.cc/?checkout=return',
    extra: { plan_id: 'day', duration_hours: 24, source: 'futbots.cc' }
  });
  assert.equal(result.intentId, 'intent-1');
});

test('AllScale status reads the integer payload', async () => {
  const status = await getAllScaleCheckoutStatus('intent-1', env, async () => new Response(JSON.stringify({
    code: 0, payload: 20, error: null, request_id: 'req-status'
  }), { headers: { 'content-type': 'application/json' } }));
  assert.deepEqual(status, { status: 20, requestId: 'req-status' });
});

test('AllScale webhook verification rejects stale requests and accepts valid raw bodies', async () => {
  const now = Date.parse('2026-07-20T12:00:00.000Z');
  const timestamp = String(Math.floor(now / 1000));
  const nonce = randomUUID();
  const webhookId = 'whk-1';
  const body = JSON.stringify({
    webhook_id: webhookId,
    all_scale_checkout_intent_id: 'intent-1',
    all_scale_transaction_id: 'tx-1',
    amount_cents: 299,
    coin_symbol: 'USDT'
  });
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const canonical = ['allscale:webhook:v1', 'POST', '/api/billing/webhook', '', webhookId, timestamp, nonce, bodyHash].join('\n');
  const signature = createHmac('sha256', env.ALLSCALE_API_SECRET).update(canonical).digest('base64');
  const request = new Request('https://futbots.cc/api/billing/webhook', {
    method: 'POST',
    headers: {
      'X-API-Key': env.ALLSCALE_API_KEY,
      'X-Webhook-Id': webhookId,
      'X-Webhook-Timestamp': timestamp,
      'X-Webhook-Nonce': nonce,
      'X-Webhook-Signature': `v1=${signature}`
    },
    body
  });

  const verified = await verifyAllScaleWebhook(request, env, now);
  assert.equal(verified.payload.all_scale_checkout_intent_id, 'intent-1');
  assert.equal(verified.nonce, nonce);

  await assert.rejects(
    verifyAllScaleWebhook(request, env, now + (6 * 60 * 1000)),
    /timestamp/i
  );
});
