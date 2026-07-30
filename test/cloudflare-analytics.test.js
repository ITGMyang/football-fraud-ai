import assert from 'node:assert/strict';
import test from 'node:test';

import { analyticsConfig, analyticsWindow, fetchSiteTraffic, summarize } from '../src/cloudflare-analytics.js';

const ENV = { CLOUDFLARE_ZONE_ID: 'zone-1', CLOUDFLARE_ANALYTICS_TOKEN: 'token-1' };
const NOW = Date.parse('2026-07-29T12:00:00Z');

const GROUPS = [
  {
    dimensions: { date: '2026-07-28' },
    uniq: { uniques: 120 },
    sum: {
      requests: 4000, pageViews: 900, bytes: 5_000_000, threats: 2,
      countryMap: [
        { clientCountryName: 'CN', requests: 2500, threats: 1 },
        { clientCountryName: 'US', requests: 1000, threats: 0 },
        { clientCountryName: 'SG', requests: 500, threats: 1 }
      ]
    }
  },
  {
    dimensions: { date: '2026-07-29' },
    uniq: { uniques: 200 },
    sum: {
      requests: 6000, pageViews: 1500, bytes: 7_000_000, threats: 0,
      countryMap: [
        { clientCountryName: 'CN', requests: 4000, threats: 0 },
        { clientCountryName: 'US', requests: 2000, threats: 0 }
      ]
    }
  }
];

test('missing configuration is reported field by field rather than as a blank panel', () => {
  assert.match(analyticsConfig({}).reason, /CLOUDFLARE_ZONE_ID and CLOUDFLARE_ANALYTICS_TOKEN/);
  assert.match(analyticsConfig({ CLOUDFLARE_ANALYTICS_TOKEN: 't' }).reason, /CLOUDFLARE_ZONE_ID is not set/);
  assert.match(analyticsConfig({ CLOUDFLARE_ZONE_ID: 'z' }).reason, /CLOUDFLARE_ANALYTICS_TOKEN is not set/);
  assert.equal(analyticsConfig(ENV).ok, true);
});

test('the window is inclusive of both ends and capped at thirty days', () => {
  assert.deepEqual(analyticsWindow(7, NOW), { since: '2026-07-23', until: '2026-07-29', days: 7 });
  assert.deepEqual(analyticsWindow(1, NOW), { since: '2026-07-29', until: '2026-07-29', days: 1 });
  assert.equal(analyticsWindow(365, NOW).days, 30);
  assert.equal(analyticsWindow('14', NOW).days, 14);
  // Unusable input all lands on the same default instead of splitting between 1 and 7.
  for (const bad of [0, -5, NaN, undefined, 'abc']) assert.equal(analyticsWindow(bad, NOW).days, 7);
});

test('daily uniques are reported as a peak and a sum, never as a headcount', () => {
  const result = summarize(GROUPS);

  assert.equal(result.totals.peakDailyUniques, 200);
  assert.equal(result.totals.dailyUniqueSum, 320);
  assert.equal(result.totals.requests, 10000);
  assert.equal(result.totals.pageViews, 2400);
  assert.equal(result.totals.threats, 2);
  assert.equal(result.totals.countries, 3);
  assert.deepEqual(result.daily.map((day) => day.date), ['2026-07-28', '2026-07-29']);
});

test('countries are merged across days, sorted, and given a share of requests', () => {
  const { countries } = summarize(GROUPS);

  assert.deepEqual(countries.map((row) => row.country), ['CN', 'US', 'SG']);
  assert.equal(countries[0].requests, 6500);
  assert.equal(countries[1].requests, 3000);
  assert.equal(countries[2].threats, 1);
  assert.equal(Math.round(countries[0].share * 1000) / 1000, 0.65);
  assert.ok(Math.abs(countries.reduce((sum, row) => sum + row.share, 0) - 1) < 1e-9);
});

test('an unconfigured zone answers without calling Cloudflare at all', async () => {
  let called = false;
  const result = await fetchSiteTraffic({}, async () => { called = true; }, { days: 7, now: NOW });

  assert.equal(called, false);
  assert.equal(result.configured, false);
  assert.equal(result.days, 7);
  assert.match(result.reason, /CLOUDFLARE_ZONE_ID/);
});

test('the zone and window reach Cloudflare as GraphQL variables', async () => {
  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url: String(url), headers: options.headers, body: JSON.parse(options.body) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: { viewer: { zones: [{ httpRequests1dGroups: GROUPS }] } } }) };
  };

  const result = await fetchSiteTraffic(ENV, fetchImpl, { days: 7, now: NOW });

  assert.equal(request.url, 'https://api.cloudflare.com/client/v4/graphql');
  assert.equal(request.headers.Authorization, 'Bearer token-1');
  assert.deepEqual(request.body.variables, { zoneTag: 'zone-1', since: '2026-07-23', until: '2026-07-29' });
  assert.equal(result.ok, true);
  assert.equal(result.totals.peakDailyUniques, 200);
});

// GraphQL answers 200 with an errors array, so a plan or scope problem looks like
// success unless the body is inspected.
test('a GraphQL error is surfaced verbatim instead of reading as zero traffic', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      data: null,
      errors: [{ message: 'not entitled to httpRequests1dGroups' }]
    })
  });

  const result = await fetchSiteTraffic(ENV, fetchImpl, { days: 7, now: NOW });

  assert.equal(result.configured, true);
  assert.equal(result.ok, false);
  assert.match(result.error, /not entitled/);
  assert.equal(result.totals, undefined);
});

test('a wrong zone id is named rather than shown as an empty week', async () => {
  const fetchImpl = async () => ({
    ok: true, status: 200, text: async () => JSON.stringify({ data: { viewer: { zones: [] } } })
  });

  const result = await fetchSiteTraffic(ENV, fetchImpl, { days: 7, now: NOW });

  assert.equal(result.ok, false);
  assert.match(result.error, /No zone matched/);
});

test('an HTTP failure and a non-JSON body are both reported', async () => {
  const denied = await fetchSiteTraffic(ENV, async () => ({
    ok: false, status: 403, text: async () => JSON.stringify({ errors: [{ message: 'Authentication error' }] })
  }), { days: 7, now: NOW });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /Authentication error/);

  const garbled = await fetchSiteTraffic(ENV, async () => ({
    ok: false, status: 502, text: async () => '<html>bad gateway</html>'
  }), { days: 7, now: NOW });
  assert.equal(garbled.ok, false);
  assert.match(garbled.error, /non-JSON response \(502\)/);
});
