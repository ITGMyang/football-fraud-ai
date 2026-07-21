import { authenticateRequest } from './auth.js';

const COOKIE_NAME = 'football_guest_prediction';
const COOKIE_MESSAGE = 'guest-prediction-used:v1';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 10;

export async function authorizeApiRequest(request, env = {}, fetchImpl = fetch) {
  const method = String(request?.method || 'GET').toUpperCase();
  const pathname = requestPath(request);
  const authorization = readHeader(request, 'authorization');

  if (authorization) {
    const auth = await authenticateRequest(request, env, fetchImpl);
    return auth.ok ? { ok: true, role: 'user', user: auth.user } : auth;
  }

  const used = await guestPredictionUsed(request, env);
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return { ok: true, role: 'guest', guestPredictionUsed: used };
  }

  if (method === 'POST' && pathname === '/api/rankings') {
    if (!clean(env.GUEST_USAGE_SECRET)) {
      return { ok: false, status: 503, error: 'Guest predictions are not configured' };
    }
    if (used) {
      return {
        ok: false,
        status: 403,
        code: 'GUEST_LIMIT_REACHED',
        error: 'The guest prediction has been used. Sign in to continue.'
      };
    }
    return { ok: true, role: 'guest', guestPredictionUsed: false, consumeGuestPrediction: true };
  }

  return { ok: false, status: 401, error: 'Sign in required' };
}

export async function guestPredictionCookie(env = {}, request) {
  const secret = clean(env.GUEST_USAGE_SECRET);
  if (!secret) throw new Error('Missing GUEST_USAGE_SECRET');
  const signature = await sign(COOKIE_MESSAGE, secret);
  const secure = requestProtocol(request) === 'https:' ? '; Secure' : '';
  return `${COOKIE_NAME}=v1.${signature}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
}

async function guestPredictionUsed(request, env) {
  const secret = clean(env.GUEST_USAGE_SECRET);
  if (!secret) return false;
  const token = parseCookies(readHeader(request, 'cookie'))[COOKIE_NAME] || '';
  const [version, signature] = token.split('.');
  if (version !== 'v1' || !signature) return false;
  return safeEqual(signature, await sign(COOKIE_MESSAGE, secret));
}

async function sign(message, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function requestPath(request) {
  try {
    return new URL(request?.url || '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

function requestProtocol(request) {
  try {
    return new URL(request?.url || '/', 'http://localhost').protocol;
  } catch {
    return 'http:';
  }
}

function readHeader(request, name) {
  const headers = request?.headers;
  if (typeof headers?.get === 'function') return headers.get(name) || '';
  return headers?.[name.toLowerCase()] || headers?.[name] || '';
}

function parseCookies(header) {
  return Object.fromEntries(String(header || '').split(';').map((part) => {
    const [name, ...rest] = part.trim().split('=');
    return [name, rest.join('=')];
  }).filter(([name]) => name));
}

function clean(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim();
}
