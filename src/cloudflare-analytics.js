// Site traffic from Cloudflare's GraphQL Analytics API.
//
// This reads the zone's own request logs, so it needs no beacon script and adds
// nothing to the request path. Two things it deliberately does not pretend to know:
// unique visitors are only available per day, not per country (countryMap counts
// requests), and this dataset has no sub-country granularity on standard plans.

const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const MAX_DAYS = 30;

const QUERY = `query SiteTraffic($zoneTag: String!, $since: Date!, $until: Date!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequests1dGroups(
        limit: 31
        filter: { date_geq: $since, date_leq: $until }
        orderBy: [date_ASC]
      ) {
        dimensions { date }
        uniq { uniques }
        sum {
          requests
          pageViews
          bytes
          threats
          countryMap { clientCountryName requests threats }
        }
      }
    }
  }
}`;

export function analyticsConfig(env = {}) {
  const zoneTag = clean(env.CLOUDFLARE_ZONE_ID);
  const token = clean(env.CLOUDFLARE_ANALYTICS_TOKEN);
  if (!zoneTag && !token) return { ok: false, reason: 'CLOUDFLARE_ZONE_ID and CLOUDFLARE_ANALYTICS_TOKEN are not set' };
  if (!zoneTag) return { ok: false, reason: 'CLOUDFLARE_ZONE_ID is not set' };
  if (!token) return { ok: false, reason: 'CLOUDFLARE_ANALYTICS_TOKEN is not set' };
  return { ok: true, zoneTag, token };
}

export function analyticsWindow(days, now = Date.now()) {
  // Any unusable value falls back to a week rather than to one day: zero and a
  // negative number are the same kind of mistake and should not diverge.
  const requested = Math.round(Number(days));
  const span = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_DAYS) : 7;
  const until = dateKey(now);
  const since = dateKey(now - (span - 1) * 24 * 60 * 60 * 1000);
  return { since, until, days: span };
}

export async function fetchSiteTraffic(env = {}, fetchImpl = fetch, { days = 7, now = Date.now() } = {}) {
  const config = analyticsConfig(env);
  const window = analyticsWindow(days, now);
  if (!config.ok) return { configured: false, reason: config.reason, ...window };

  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { zoneTag: config.zoneTag, since: window.since, until: window.until }
    })
  });

  const body = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(body);
  } catch {
    return { configured: true, ok: false, error: `Cloudflare returned a non-JSON response (${response.status})`, ...window };
  }

  // GraphQL answers 200 with an errors array, so the status alone proves nothing.
  const errors = payload?.errors || [];
  if (!response.ok || errors.length) {
    return {
      configured: true,
      ok: false,
      error: errors.map((item) => item?.message).filter(Boolean).join('; ')
        || `Cloudflare Analytics returned ${response.status}`,
      ...window
    };
  }

  const groups = payload?.data?.viewer?.zones?.[0]?.httpRequests1dGroups;
  if (!Array.isArray(groups)) {
    return { configured: true, ok: false, error: 'No zone matched CLOUDFLARE_ZONE_ID', ...window };
  }

  return { configured: true, ok: true, ...window, ...summarize(groups) };
}

export function summarize(groups = []) {
  const daily = groups.map((group) => ({
    date: group?.dimensions?.date || '',
    uniques: number(group?.uniq?.uniques),
    requests: number(group?.sum?.requests),
    pageViews: number(group?.sum?.pageViews),
    bytes: number(group?.sum?.bytes),
    threats: number(group?.sum?.threats)
  }));

  const countries = new Map();
  for (const group of groups) {
    for (const row of group?.sum?.countryMap || []) {
      const name = clean(row?.clientCountryName) || 'XX';
      const item = countries.get(name) || { country: name, requests: 0, threats: 0 };
      item.requests += number(row?.requests);
      item.threats += number(row?.threats);
      countries.set(name, item);
    }
  }
  const countryRows = [...countries.values()].sort((left, right) => right.requests - left.requests);
  const countryRequests = countryRows.reduce((sum, row) => sum + row.requests, 0);

  return {
    totals: {
      // Summing daily uniques double counts anyone who returns on another day, so the
      // headline is the peak day and the sum is labelled as visits, not people.
      peakDailyUniques: Math.max(0, ...daily.map((day) => day.uniques)),
      dailyUniqueSum: daily.reduce((sum, day) => sum + day.uniques, 0),
      requests: daily.reduce((sum, day) => sum + day.requests, 0),
      pageViews: daily.reduce((sum, day) => sum + day.pageViews, 0),
      bytes: daily.reduce((sum, day) => sum + day.bytes, 0),
      threats: daily.reduce((sum, day) => sum + day.threats, 0),
      countries: countryRows.length
    },
    daily,
    countries: countryRows.map((row) => ({
      ...row,
      share: countryRequests ? row.requests / countryRequests : 0
    }))
  };
}

function dateKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function clean(value) {
  return String(value || '').replace(/^﻿/, '').trim();
}
