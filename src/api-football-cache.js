import {
  fetchApiFootballMatches,
  fetchApiFootballOddsFixtureIds,
  filterMatchesWithOdds,
  scheduleFromMatches,
  todayInShanghai
} from './api-football.js';
import { createSupabaseStorage } from './supabase-storage.js';

// Leagues chosen for how well the provider covers them, not for how big they are:
// a prediction is only as good as the statistics behind it, and a competition with
// thin data produces confident-looking noise. Ids are API-Football's.
export const DEFAULT_API_FOOTBALL_LEAGUES = [
  // Europe's big five, plus the two continental cups they feed.
  '39', '140', '78', '135', '61', '2', '3',
  // Europe beyond the big five, all with full pre-match statistics.
  '94', '88', '203', '144', '235', '179',
  // The Americas.
  '253', '262', '71', '128',
  // Asia-Pacific.
  '98', '292', '188'
];

// Leaves room inside the 50-subrequest limit for pagination and the Supabase reads and
// writes that bracket the refresh.
const ODDS_CALLS_PER_RUN = 20;

function rotateByClock(items, offset) {
  if (items.length <= 1) return items;
  const start = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

export function configuredApiFootballLeagues(env = {}) {
  const configured = String(env.API_FOOTBALL_LEAGUES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(configured.length ? configured : DEFAULT_API_FOOTBALL_LEAGUES)];
}

export function filterApiFootballSchedules(schedules = []) {
  return schedules.filter((schedule) => schedule?.source === 'api-football');
}

// Retiring a league stops it being refreshed, but its rows stay in the database and
// kept appearing on the site indefinitely - the config said one thing and users saw
// another. The configured list is what is visible, and rows for a league added back
// later are still there waiting.
export function visibleApiFootballSchedules(schedules = [], env = {}) {
  const configured = new Set(configuredApiFootballLeagues(env).map(String));
  return filterApiFootballSchedules(schedules)
    .filter((schedule) => configured.has(String(schedule.competitionId)));
}

export function enrichContextsWithScheduleTeams(contexts = [], schedules = []) {
  const matchesById = new Map(
    filterApiFootballSchedules(schedules)
      .flatMap((schedule) => schedule.matches || [])
      .map((match) => [String(match.matchId || match.id || ''), match])
      .filter(([matchId]) => matchId)
  );

  return contexts.map((context) => {
    if (context?.source !== 'api-football') return context;
    const match = matchesById.get(String(context.matchId || ''));
    if (!match) return context;
    const existingHome = context.fixture?.home || {};
    const existingAway = context.fixture?.away || {};
    return {
      ...context,
      fixture: {
        ...(context.fixture || {}),
        home: {
          ...existingHome,
          name: existingHome.name || match.home || '',
          logo: existingHome.logo || match.homeLogo || ''
        },
        away: {
          ...existingAway,
          name: existingAway.name || match.away || '',
          logo: existingAway.logo || match.awayLogo || ''
        }
      }
    };
  });
}

export function aggregateApiFootballSchedules(schedules = [], date = todayInShanghai()) {
  const apiSchedules = filterApiFootballSchedules(schedules);
  const fetchedAt = apiSchedules.reduce((latest, schedule) => {
    const value = String(schedule?.fetchedAt || '');
    return !latest || Date.parse(value) > Date.parse(latest) ? value : latest;
  }, '');
  const aggregate = scheduleFromMatches(
    mergeScheduleMatches([], apiSchedules.flatMap((schedule) => schedule.matches || [])),
    { date, competitionId: 'all', fetchedAt: fetchedAt || new Date().toISOString() }
  );
  aggregate.providerChecks = Object.assign({}, ...apiSchedules.map((schedule) => schedule.providerChecks || {}));
  return aggregate;
}

export function buildApiFootballSchedules(matches, leagueIds, date, fetchedAt = new Date().toISOString()) {
  return leagueIds.map((leagueId) => ({
    ...scheduleFromMatches(
      matches.filter((match) => String(match.competitionId || '') === String(leagueId)),
      { date, competitionId: leagueId, fetchedAt }
    ),
    oddsCheckedDates: { [date]: fetchedAt },
    oddsCheckModes: { [date]: 'league-date' }
  }));
}

export function isOddsCheckDue(schedule, date, now = Date.now(), cooldownMs = 20 * 60 * 1000) {
  const checkedAt = Date.parse(schedule?.oddsCheckedDates?.[date] || '');
  return !Number.isFinite(checkedAt) || now - checkedAt >= cooldownMs;
}

export function mergeScheduleMatches(existing = [], updates = []) {
  const merged = new Map(existing.map((match) => [String(match.matchId || match.id), match]));
  for (const match of updates) merged.set(String(match.matchId || match.id), match);
  return [...merged.values()].sort((a, b) => String(a.kickoff || a.date || '').localeCompare(String(b.kickoff || b.date || '')));
}

export function mergeScheduleDate(existing = [], updates = [], date) {
  return mergeScheduleMatches(
    existing.filter((match) => match.date !== date),
    updates
  );
}

export function mergeScheduleSnapshot(existing = {}, incoming = {}) {
  return {
    ...existing,
    ...incoming,
    matches: mergeScheduleMatches(existing.matches || [], incoming.matches || []),
    oddsCheckedDates: { ...(existing.oddsCheckedDates || {}), ...(incoming.oddsCheckedDates || {}) },
    oddsCheckModes: { ...(existing.oddsCheckModes || {}), ...(incoming.oddsCheckModes || {}) },
    providerChecks: { ...(existing.providerChecks || {}), ...(incoming.providerChecks || {}) }
  };
}

// Most recent first. Walking forward from six days ago meant a match that finished
// last night waited behind five older days - one refresh each, one run in four - so
// its score, and the accuracy that depends on it, arrived hours late while nobody was
// asking about the older ones.
export function selectHistoryBackfillDate(schedules = [], today = todayInShanghai(), historyDays = 6) {
  for (let offset = -1; offset >= -historyDays; offset -= 1) {
    const date = offsetDate(today, offset);
    if (!schedules.length || schedules.some((schedule) => !schedule?.oddsCheckedDates?.[date])) return date;
  }
  return '';
}

export function upcomingRefreshDates(today = todayInShanghai()) {
  return [0, 1, 2].map((offset) => offsetDate(today, offset));
}

// A Worker gets 50 subrequests per invocation on this plan. One date costs a fixtures
// call plus a paginated odds call for every league playing that day, so refreshing
// today, the next two days and a history date in one go stopped fitting the moment the
// league list grew - "Too many subrequests by single Worker invocation", and the
// refresh died part-way. Each run now takes one date; the cron fires every twenty
// minutes, so all four are still covered within the hour, and merging means the dates
// a run does not touch keep the fixtures they already had.
export function refreshSliceFor(schedules = [], today = todayInShanghai(), now = Date.now()) {
  const historyDate = selectHistoryBackfillDate(schedules, today);
  const rotation = [...upcomingRefreshDates(today), historyDate].filter(Boolean);
  const slot = Math.floor(now / (20 * 60 * 1000)) % rotation.length;
  const date = rotation[slot];
  return { date, isHistory: date === historyDate, rotation };
}

export async function refreshApiFootballScheduleCache(env, fetchImpl = fetch, now = Date.now()) {
  const workerFetch = (input, init) => fetchImpl(input, init);
  const storage = createSupabaseStorage(env, workerFetch);
  const today = todayInShanghai();
  const fetchedAt = new Date().toISOString();
  const configuredLeagues = configuredApiFootballLeagues(env);
  const existing = await storage.listMatchSchedules();
  const slice = refreshSliceFor(existing, today, now);
  const errors = [];
  let schedules = mergeScheduleSets(existing, [], configuredLeagues);
  let refreshedDate = null;

  try {
    refreshedDate = await fetchVerifiedSchedulesForDate(env, slice.date, configuredLeagues, workerFetch, fetchedAt);
    schedules = mergeScheduleSets(schedules, refreshedDate.schedules, configuredLeagues);
    await storage.upsertMatchSchedules(schedules);
  } catch (error) {
    errors.push({ date: slice.date, error: error.message });
  }

  return {
    source: 'api-football',
    date: today,
    refreshedDate: slice.date,
    isHistoryBackfill: slice.isHistory,
    refreshDates: slice.rotation,
    fetchedAt,
    apiCalls: refreshedDate?.apiCalls || 0,
    fixtures: refreshedDate?.fixtures || 0,
    fixturesWithOdds: refreshedDate?.fixturesWithOdds || 0,
    skippedLeagues: refreshedDate?.skippedLeagues || [],
    historyDate: slice.isHistory ? slice.date : '',
    historyFixturesWithOdds: slice.isHistory ? (refreshedDate?.fixturesWithOdds || 0) : 0,
    refreshed: schedules.map((schedule) => ({
      competitionId: schedule.competitionId,
      matches: schedule.matches.length,
      fetchedAt
    })),
    errors,
    attempted: schedules.length
  };
}

async function fetchVerifiedSchedulesForDate(env, date, configuredLeagues, fetchImpl, fetchedAt) {
  const all = await fetchApiFootballMatches({
    date,
    apiKey: env.API_FOOTBALL_KEY,
    baseUrl: env.API_FOOTBALL_BASE_URL,
    proxySecret: env.API_FOOTBALL_PROXY_SECRET
  }, fetchImpl);
  const activeLeagues = new Map();
  for (const match of all.matches) {
    if (configuredLeagues.includes(String(match.competitionId))) {
      activeLeagues.set(String(match.competitionId), match.season || undefined);
    }
  }
  // Odds calls are paginated, so even one date can run past the subrequest limit on a
  // busy day. Cap them and rotate which leagues go first, so no league is permanently
  // the one that gets dropped.
  const ordered = rotateByClock([...activeLeagues], Math.floor(Date.now() / (20 * 60 * 1000)));
  const attempted = ordered.slice(0, ODDS_CALLS_PER_RUN);
  const skippedLeagues = ordered.slice(ODDS_CALLS_PER_RUN).map(([leagueId]) => leagueId);
  if (skippedLeagues.length) {
    console.warn(JSON.stringify({ event: 'api_football_odds_calls_capped', date, skippedLeagues }));
  }

  const oddsFixtureIds = new Set();
  for (const [leagueId, season] of attempted) {
    const leagueFixtureIds = await fetchApiFootballOddsFixtureIds({
      date,
      leagueId,
      season,
      apiKey: env.API_FOOTBALL_KEY,
      baseUrl: env.API_FOOTBALL_BASE_URL,
      proxySecret: env.API_FOOTBALL_PROXY_SECRET
    }, fetchImpl);
    for (const fixtureId of leagueFixtureIds) oddsFixtureIds.add(fixtureId);
  }
  const matchesWithOdds = filterMatchesWithOdds(all.matches, oddsFixtureIds);
  return {
    schedules: buildApiFootballSchedules(matchesWithOdds, configuredLeagues, date, fetchedAt),
    apiCalls: 1 + attempted.length,
    skippedLeagues,
    fixtures: all.matches.length,
    fixturesWithOdds: matchesWithOdds.length
  };
}

function mergeScheduleSets(existing, incoming, configuredLeagues) {
  const existingByLeague = new Map((existing || []).map((schedule) => [String(schedule.competitionId), schedule]));
  const incomingByLeague = new Map((incoming || []).map((schedule) => [String(schedule.competitionId), schedule]));
  return configuredLeagues.map((leagueId) => mergeScheduleSnapshot(
    existingByLeague.get(String(leagueId)) || { competitionId: String(leagueId), matches: [] },
    incomingByLeague.get(String(leagueId)) || { competitionId: String(leagueId), matches: [] }
  ));
}

function offsetDate(date, offset) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}
