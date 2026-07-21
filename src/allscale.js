import { billingPlan } from './billing.js';

const DEFAULT_BASE_URL = 'https://openapi.allscale.io';

export async function signAllScaleRequest({ method, path, query = '', body = '', apiSecret, timestamp, nonce }) {
  const requestTimestamp = String(timestamp || Math.floor(Date.now() / 1000));
  const requestNonce = String(nonce || crypto.randomUUID());
  const bodyHash = await sha256Hex(body);
  const canonical = [String(method).toUpperCase(), path, query, requestTimestamp, requestNonce, bodyHash].join('\n');
  const signature = await hmacBase64(clean(apiSecret), canonical);
  return {
    'X-Timestamp': requestTimestamp,
    'X-Nonce': requestNonce,
    'X-Signature': `v1=${signature}`
  };
}

export async function pingAllScale(env = {}, fetchImpl = fetch) {
  const response = await allScaleRequest('/v1/test/ping', { method: 'GET' }, env, fetchImpl);
  return response.payload;
}

export async function createAllScaleCheckout(input, env = {}, fetchImpl = fetch) {
  const plan = billingPlan(input?.planId);
  if (!plan) throw new Error('无效的订阅套餐');
  const body = {
    stable_coin: 1,
    amount_cents: plan.amountCents,
    order_id: input.orderId,
    order_description: plan.name,
    user_id: input.userId,
    user_name: input.userName || '',
    redirect_url: input.redirectUrl,
    extra: {
      plan_id: plan.id,
      duration_hours: plan.durationHours,
      source: 'futbots.cc'
    }
  };
  const response = await allScaleRequest('/v1/checkout_intents/', { method: 'POST', body }, env, fetchImpl);
  return {
    checkoutUrl: response.payload?.checkout_url || '',
    intentId: response.payload?.allscale_checkout_intent_id || '',
    amountCoins: response.payload?.amount_coins || '',
    stableCoinType: response.payload?.stable_coin_type || 1,
    requestId: response.request_id || ''
  };
}

export async function getAllScaleCheckoutStatus(intentId, env = {}, fetchImpl = fetch) {
  const safeIntentId = encodeURIComponent(String(intentId || '').trim());
  if (!safeIntentId) throw new Error('缺少 AllScale Checkout Intent ID');
  const response = await allScaleRequest(`/v1/checkout_intents/${safeIntentId}/status`, { method: 'GET' }, env, fetchImpl);
  return { status: Number(response.payload), requestId: response.request_id || '' };
}

export async function verifyAllScaleWebhook(request, env = {}, now = Date.now()) {
  const apiKey = clean(env.ALLSCALE_API_KEY);
  const apiSecret = clean(env.ALLSCALE_API_SECRET);
  if (!apiKey || !apiSecret) throw new Error('AllScale credentials are not configured');
  if (clean(request.headers.get('X-API-Key')) !== apiKey) throw new Error('AllScale webhook API key mismatch');

  const webhookId = clean(request.headers.get('X-Webhook-Id'));
  const timestamp = clean(request.headers.get('X-Webhook-Timestamp'));
  const nonce = clean(request.headers.get('X-Webhook-Nonce'));
  const provided = clean(request.headers.get('X-Webhook-Signature')).replace(/^v1=/, '');
  if (!webhookId || !timestamp || !nonce || !provided) throw new Error('AllScale webhook headers are incomplete');
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > 5 * 60 * 1000) {
    throw new Error('AllScale webhook timestamp is outside the allowed window');
  }

  const rawBody = await request.text();
  const url = new URL(request.url);
  const bodyHash = await sha256Hex(rawBody);
  const canonical = [
    'allscale:webhook:v1',
    request.method.toUpperCase(),
    url.pathname,
    url.search.slice(1),
    webhookId,
    timestamp,
    nonce,
    bodyHash
  ].join('\n');
  const expected = await hmacBase64(apiSecret, canonical);
  if (!safeEqual(provided, expected)) throw new Error('AllScale webhook signature mismatch');

  const payload = JSON.parse(rawBody || '{}');
  if (String(payload.webhook_id || '') !== webhookId) throw new Error('AllScale webhook ID mismatch');
  return { webhookId, timestamp, nonce, payload };
}

async function allScaleRequest(path, options, env, fetchImpl) {
  const apiKey = clean(env.ALLSCALE_API_KEY);
  const apiSecret = clean(env.ALLSCALE_API_SECRET);
  if (!apiKey || !apiSecret) throw new Error('缺少 ALLSCALE_API_KEY 或 ALLSCALE_API_SECRET');
  const method = String(options?.method || 'GET').toUpperCase();
  const rawBody = options?.body ? JSON.stringify(options.body) : '';
  const signed = await signAllScaleRequest({ method, path, body: rawBody, apiSecret });
  const baseUrl = clean(env.ALLSCALE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      ...signed
    },
    ...(rawBody ? { body: rawBody } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || Number(payload?.code) !== 0) {
    const message = payload?.error?.message || `AllScale API ${response.status}`;
    const error = new Error(message);
    error.code = payload?.code || response.status;
    error.requestId = payload?.request_id || '';
    throw error;
  }
  return payload;
}

async function sha256Hex(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacBase64(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return btoa(String.fromCharCode(...bytes));
}

function safeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function clean(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim();
}
