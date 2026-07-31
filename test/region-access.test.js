import test from 'node:test';
import assert from 'node:assert/strict';
import { regionDenial } from '../src/region-access.js';

function requestFrom(country, path = '/') {
  const url = new URL(`https://futbots.cc${path}`);
  return [{ cf: country ? { country } : undefined }, url];
}

test('mainland China is refused with 451 on every page', () => {
  for (const path of ['/', '/admin', '/api/rankings', '/build/app.js', '/match/1591866']) {
    const denial = regionDenial(...requestFrom('CN', path));
    assert.equal(denial?.status, 451, `${path} should be refused`);
  }
});

test('Hong Kong, Macau and Taiwan are separate country codes and stay open', () => {
  for (const country of ['HK', 'MO', 'TW', 'SG', 'US']) {
    assert.equal(regionDenial(...requestFrom(country)), null, `${country} must not be blocked`);
  }
});

test('a request without country information is not blocked', () => {
  // Local development and unit tests have no request.cf, and refusing them by default
  // would make the whole site unreachable off Cloudflare.
  assert.equal(regionDenial(...requestFrom('')), null);
  assert.equal(regionDenial({}, new URL('https://futbots.cc/')), null);
});

test('signed machine callbacks are answered wherever they come from', () => {
  // The payment webhook confirms an order nobody is watching; a 451 loses it silently.
  assert.equal(regionDenial(...requestFrom('CN', '/api/billing/webhook')), null);
  assert.equal(regionDenial(...requestFrom('CN', '/api/internal/api-football-cache/refresh')), null);
});

test('the refusal is never cached, at the browser or the edge', () => {
  const denial = regionDenial(...requestFrom('CN'));
  assert.equal(denial.headers.get('Cache-Control'), 'no-store');
  assert.equal(denial.headers.get('CDN-Cache-Control'), 'no-store');
});
