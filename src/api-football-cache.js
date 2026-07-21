import {
  fetchApiFootballMatches,
  fetchApiFootballOddsFixtureIds,
  filterMatchesWithOdds,
  scheduleFromMatches,
  todayInShanghai
} from './api-football.js';
import { createSupabaseStorage } from './supabase-storage.js';

export const DEFAULT_API_FOOTBALL_LEAGUES = [
  '1', '15', '17', '39', '140', '78', '135', '61',
  '2', '3', '188', '307', '169', '170', '171'
];

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

export function selectHistoryBackfillDate(schedules = [], today = todayInShanghai(), historyDays = 6) {
  for (let offset = -historyDays; offset < 0; offset += 1) {
    const date = offsetDate(today, offset);
    if (!schedules.length || schedules.some((schedule) => !schedule?.oddsCheckedDates?.[date])) return date;
  }
  return '';
}

export function upcomingRefreshDates(today = todayInShanghai()) {
  return [0, 1, 2].map((offset) => offsetDate(today, offset));
}

export async function refreshApiFootballScheduleCache(env, fetchImpl = fetch) {
  const workerFetch = (input, init) => fetchImpl(input, init);
  const storage = createSupabaseStorage(env, workerFetch);
  const date = todayInShanghai();
  const fetchedAt = new Date().toISOString();
  const configuredLeagues = configuredApiFootballLeagues(env);
  const existing = await storage.listMatchSchedules();
  const current = await fetchVerifiedSchedulesForDate(env, date, configuredLeagues, workerFetch, fetchedAt);
  let schedules = mergeScheduleSets(existing, current.schedules, configuredLeagues);
  let apiCalls = current.apiCalls;
  let futureFixturesWithOdds = 0;
  const errors = [];

  for (const futureDate of upcomingRefreshDates(date).slice(1)) {
    try {
      const future = await fetchVerifiedSchedulesForDate(env, futureDate, configuredLeagues, workerFetch, fetchedAt);
      schedules = mergeScheduleSets(schedules, future.schedules, configuredLeagues);
      apiCalls += future.apiCalls;
      futureFixturesWithOdds += future.fixturesWithOdds;
    } catch (error) {
      errors.push({ date: futureDate, error: error.message });
    }
  }
  await storage.upsertMatchSchedules(schedules);

  const historyDate = selectHistoryBackfillDate(schedules, date);
  let history = null;
  if (historyDate) {
    try {
      history = await fetchVerifiedSchedulesForDate(env, historyDate, configuredLeagues, workerFetch, fetchedAt);
      schedules = mergeScheduleSets(schedules, history.schedules, configuredLeagues);
      apiCalls += history.apiCalls;
      await storage.upsertMatchSchedules(schedules);
    } catch (error) {
      errors.push({ date: historyDate, error: error.message });
    }
  }
  return {
    source: 'api-football',
    date,
    refreshDates: upcomingRefreshDates(date),
    fetchedAt,
    apiCalls,
    fixtures: current.fixtures,
    fixturesWithOdds: current.fixturesWithOdds,
    futureFixturesWithOdds,
    historyDate,
    historyFixturesWithOdds: history?.fixturesWithOdds || 0,
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
  const oddsFixtureIds = new Set();
  for (const [leagueId, season] of activeLeagues) {
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
    apiCalls: 1 + activeLeagues.size,
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
