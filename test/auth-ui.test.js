import test from 'node:test';
import assert from 'node:assert/strict';

import { authErrorMessage, authRedirectUrl, guestAccessLabel, safeNextPath } from '../public/auth-utils.js';

test('safe next path keeps local destinations and rejects external redirects', () => {
  assert.equal(safeNextPath('/data?date=2026-07-11'), '/data?date=2026-07-11');
  assert.equal(safeNextPath('//evil.example/path'), '/');
  assert.equal(safeNextPath('https://evil.example/path'), '/');
});

test('auth errors are translated without exposing implementation details', () => {
  assert.equal(authErrorMessage({ message: 'Invalid login credentials' }), 'Incorrect email or password');
  assert.equal(authErrorMessage({ message: 'Email not confirmed' }), 'Open the confirmation email before signing in');
  assert.equal(authErrorMessage({ message: 'User already registered' }), 'This email is already registered. Sign in instead.');
  assert.equal(authErrorMessage({ message: 'network request failed' }), 'The sign-in service is temporarily unavailable');
});

test('guest access label describes remaining prediction access', () => {
  assert.deepEqual(guestAccessLabel({ authenticated: false, guestPredictionUsed: false }), {
    tone: 'available',
    title: 'Guest Trial: 1 AI Prediction Remaining',
    detail: 'Browse public content without signing in. This trial uses Qwen.'
  });
  assert.equal(guestAccessLabel({ authenticated: false, guestPredictionUsed: true }).tone, 'used');
  assert.deepEqual(guestAccessLabel({
    authenticated: true,
    billing: { tier: 'free', active: false, freePredictionUsed: false }
  }), {
    tone: 'available',
    title: 'Free Account: 1 Qwen Prediction Remaining',
    detail: 'The result will be saved to this account. Purchase a pass to use every AI model.'
  });
  assert.equal(guestAccessLabel({
    authenticated: true,
    billing: { tier: 'locked', active: false, freePredictionUsed: true }
  }).tone, 'used');
  assert.equal(guestAccessLabel({
    authenticated: true,
    billing: { tier: 'paid', active: true, validUntil: '2026-08-20T00:00:00.000Z' }
  }).tone, 'signed-in');
});

test('OAuth redirects use the configured production origin', () => {
  assert.equal(authRedirectUrl('https://futbots.cc/', '/auth/callback'), 'https://futbots.cc/auth/callback');
  assert.equal(authRedirectUrl('https://futbots.cc', '/auth/reset'), 'https://futbots.cc/auth/reset');
  assert.equal(authRedirectUrl('https://futbots.cc', '//evil.example/path'), 'https://futbots.cc/');
});
