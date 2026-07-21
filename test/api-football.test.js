import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  fetchApiFootballContext,
  fetchApiFootballMatches,
  fetchApiFootballOddsFixtureIds,
  filterApiFootballMatches,
  filterMatchesWithOdds
} from '../src/api-football.js';
import {
  aggregateApiFootballSchedules,
  buildApiFootballSchedules,
  configuredApiFootballLeagues,
  enrichContextsWithScheduleTeams,
  filterApiFootballSchedules,
  isOddsCheckDue,
  mergeScheduleDate,
  mergeScheduleMatches,
  mergeScheduleSnapshot,
  selectHistoryBackfillDate,
  upcomingRefreshDates
} from '../src/api-football-cache.js';

const fixture = {
  fixture: {
    id: 123456,
    date: '2026-07-18T19:00:00+08:00',
    referee: 'Referee Name',
    venue: { name: 'National Stadium', city: 'Shanghai' },
    status: { short: 'NS', long: 'Not Started' }
  },
  league: { id: 1, name: 'World Cup', season: 2026, country: 'World', round: 'Final' },
  teams: {
    home: { id: 10, name: 'England', logo: 'https://img/home.png' },
    away: { id: 20, name: 'Argentina', logo: 'https://img/away.png' }
  },
  goals: { home: null, away: null }
};

function response(body, headers = {}) {
  return new Response(JSON.stringify({ response: body }), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

function pagedResponse(body, current, total) {
  return new Response(JSON.stringify({
    response: body,
    paging: { current, total }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('API-Football schedule normalizes fixtures into the existing schedule shape', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return response([fixture], { 'x-ratelimit-requests-remaining': '99' });
  };

  const schedule = await fetchApiFootballMatches({
    date: '2026-07-18',
    leagueId: '1',
    apiKey: 'test-key'
  }, fakeFetch);

  assert.equal(schedule.source, 'api-football');
  assert.equal(schedule.matches[0].matchId, '123456');
  assert.equal(schedule.matches[0].matchName, 'England v Argentina');
  assert.equal(schedule.matches[0].status, 'scheduled');
  assert.equal(schedule.upcomingTodayMatches.length, 1);
  assert.match(calls[0].url, /fixtures\?date=2026-07-18/);
  assert.equal(calls[0].options.headers['x-apisports-key'], 'test-key');
});

test('API-Football sends the private proxy credential when configured', async () => {
  let requestOptions;
  await fetchApiFootballMatches({
    date: '2026-07-18',
    apiKey: 'test-key',
    proxySecret: 'proxy-secret'
  }, async (_url, options) => {
    requestOptions = options;
    return response([]);
  });

  assert.equal(requestOptions.headers['X-Proxy-Secret'], 'proxy-secret');
});

test('API-Football can fetch a complete league season for future World Cup dates', async () => {
  let requestedUrl = '';
  const fakeFetch = async (url) => {
    requestedUrl = String(url);
    return response([fixture]);
  };

  const schedule = await fetchApiFootballMatches({
    leagueId: '1',
    season: '2026',
    date: '2026-07-19',
    apiKey: 'test-key'
  }, fakeFetch);

  assert.match(requestedUrl, /fixtures\?league=1&season=2026/);
  assert.doesNotMatch(requestedUrl, /[?&]date=/);
  assert.equal(schedule.matches.length, 1);
});

test('API-Football detail combines lineups, players, injuries, odds and predictions', async () => {
  const fakeFetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/fixtures') return response([fixture]);
    if (path === '/fixtures/lineups') return response([
      {
        team: fixture.teams.home,
        formation: '4-3-3',
        startXI: [{ player: { name: 'Home Player', number: 9, pos: 'F', grid: '4:2' } }],
        substitutes: []
      },
      {
        team: fixture.teams.away,
        formation: '4-4-2',
        startXI: [{ player: { name: 'Away Player', number: 10, pos: 'M', grid: '3:2' } }],
        substitutes: []
      }
    ]);
    if (path === '/injuries') return response([
      { team: fixture.teams.home, player: { name: 'Injured Player' }, type: 'Missing Fixture', reason: 'Knee Injury' }
    ]);
    if (path === '/fixtures/statistics') return response([
      { team: fixture.teams.home, statistics: [{ type: 'Ball Possession', value: '55%' }] }
    ]);
    if (path === '/fixtures/players') return response([
      { team: fixture.teams.home, players: [{ player: { name: 'Home Player' }, statistics: [{ games: { minutes: 90, rating: '7.2' } }] }] }
    ]);
    if (path === '/odds') return response([{
      bookmakers: [{
        name: 'Bet365',
        bets: [
          { name: 'Match Winner', values: [{ value: 'Home', odd: '1.80' }, { value: 'Draw', odd: '3.20' }, { value: 'Away', odd: '4.50' }] },
          { name: 'Asian Handicap', values: [{ value: 'Home -0.5', odd: '1.95' }, { value: 'Away +0.5', odd: '1.85' }] },
          { name: 'Goals Over/Under', values: [{ value: 'Over 2.5', odd: '1.90' }, { value: 'Under 2.5', odd: '1.90' }] }
        ]
      }]
    }]);
    if (path === '/predictions') return response([{
      predictions: { winner: { name: 'England' }, advice: 'England or draw', percent: { home: '55%', draw: '25%', away: '20%' } },
      comparison: { form: { home: '60%', away: '40%' } }
    }]);
    if (path === '/fixtures/headtohead') return response([]);
    if (path === '/fixtures/events') return response([{ time: { elapsed: 12 }, type: 'Goal', detail: 'Normal Goal', player: { name: 'Home Player' } }]);
    throw new Error(`Unexpected API path ${path}`);
  };

  const context = await fetchApiFootballContext('123456', { apiKey: 'test-key' }, fakeFetch);

  assert.equal(context.source, 'api-football');
  assert.equal(context.matchName, 'England v Argentina');
  assert.equal(context.lineup.players.length, 2);
  assert.match(context.lineup.notes.join(' '), /Injured Player/);
  assert.equal(context.index.live.euro[0].home, '1.80');
  assert.equal(context.index.live.asia[0].lineValue, '-0.5');
  assert.equal(context.index.live.size[0].line, '2.5');
  assert.equal(context.analysis.apiPrediction.winner, 'England');
  assert.equal(context.experts[0].author, 'API-Football');
  assert.match(context.live[0], /Goal/);
  assert.equal(context.fixture.leagueId, '1');
  assert.equal(context.fixture.season, 2026);
  assert.equal(context.fixture.country, 'World');
  assert.equal(context.fixture.venue.name, 'National Stadium');
  assert.deepEqual(context.fetchStatus.lineups, { state: 'available', count: 2 });
  assert.deepEqual(context.fetchStatus.h2h, { state: 'empty', count: 0 });
});

test('API-Football detail distinguishes empty responses from failed endpoint requests', async () => {
  const fakeFetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/fixtures') return response([fixture]);
    if (path === '/injuries') return new Response('{}', {
      status: 503,
      headers: { 'content-type': 'application/json' }
    });
    return response([]);
  };

  const context = await fetchApiFootballContext('123456', { apiKey: 'test-key' }, fakeFetch);

  assert.deepEqual(context.fetchStatus.lineups, { state: 'empty', count: 0 });
  assert.equal(context.fetchStatus.injuries.state, 'error');
  assert.match(context.fetchStatus.injuries.error, /503/);
});

test('API-Football backend detail keeps object-shaped team season statistics', async () => {
  const fakeFetch = async (url) => {
    const requestUrl = new URL(url);
    if (requestUrl.pathname === '/fixtures') return response([fixture]);
    if (requestUrl.pathname === '/teams/statistics') {
      const teamId = requestUrl.searchParams.get('team');
      return response({
        team: teamId === '10' ? fixture.teams.home : fixture.teams.away,
        fixtures: { played: { total: 8 }, wins: { total: 5 }, draws: { total: 2 }, loses: { total: 1 } },
        goals: { for: { total: { total: 14 } }, against: { total: { total: 6 } } },
        clean_sheet: { total: 4 }
      });
    }
    return response([]);
  };

  const context = await fetchApiFootballContext('123456', { apiKey: 'test-key', includeCatalog: true }, fakeFetch);

  assert.equal(context.catalog.teamStatistics.length, 2);
  assert.equal(context.catalog.teamStatistics[0].team, 'England');
  assert.equal(context.catalog.teamStatistics[0].played, 8);
});

test('API-Football full context reuses a fresh shared catalog cache', async () => {
  const requestedPaths = [];
  const cachedCatalog = {
    standings: ['#1 England'],
    topScorers: ['#1 Player'],
    teamStatistics: [{ team: 'England', played: 8 }],
    squads: ['England 9 Player F'],
    coaches: ['England Coach']
  };
  let cacheKey = '';
  const fakeFetch = async (url) => {
    const path = new URL(url).pathname;
    requestedPaths.push(path);
    if (path === '/fixtures') return response([fixture]);
    return response([]);
  };

  const context = await fetchApiFootballContext('123456', {
    apiKey: 'test-key',
    includeCatalog: true,
    catalogCache: {
      read: async (key) => {
        cacheKey = key;
        return cachedCatalog;
      },
      write: async () => {
        throw new Error('fresh cache must not be rewritten');
      }
    }
  }, fakeFetch);

  assert.equal(cacheKey, 'league:1:season:2026:teams:10-20');
  assert.deepEqual(context.catalog, cachedCatalog);
  assert.doesNotMatch(requestedPaths.join(','), /standings|topscorers|teams\/statistics|players\/squads|coachs/);
});

test('API-Football rejects missing server-side credentials', async () => {
  await assert.rejects(
    () => fetchApiFootballMatches({ date: '2026-07-18' }, async () => response([])),
    /API_FOOTBALL_KEY/
  );
});

test('API-Football collects every paged fixture id that has pre-match odds', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(String(url));
    const page = Number(new URL(url).searchParams.get('page') || 1);
    return page === 1
      ? pagedResponse([{ fixture: { id: 123456 }, bookmakers: [{ id: 1, bets: [{ id: 1 }] }] }], 1, 2)
      : pagedResponse([{ fixture: { id: 999999 }, bookmakers: [{ id: 2, bets: [{ id: 1 }] }] }], 2, 2);
  };

  const fixtureIds = await fetchApiFootballOddsFixtureIds({
    date: '2026-07-18',
    apiKey: 'test-key'
  }, fakeFetch);

  assert.deepEqual([...fixtureIds], ['123456', '999999']);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /odds\?date=2026-07-18/);
  assert.match(calls[1], /page=2/);
});

test('API-Football can verify odds by fixture id without date timezone ambiguity', async () => {
  let requestedUrl = '';
  const fakeFetch = async (url) => {
    requestedUrl = String(url);
    return pagedResponse([{
      fixture: { id: 123456 },
      bookmakers: [{ id: 1, bets: [{ id: 1 }] }]
    }], 1, 1);
  };

  const fixtureIds = await fetchApiFootballOddsFixtureIds({
    fixtureId: '123456',
    apiKey: 'test-key'
  }, fakeFetch);

  assert.deepEqual([...fixtureIds], ['123456']);
  assert.match(requestedUrl, /odds\?fixture=123456/);
  assert.doesNotMatch(requestedUrl, /[?&]date=/);
});

test('unsupported odds seasons produce no public fixtures instead of a server error', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({
    errors: { plan: 'Free plans do not have access to this season, try from 2022 to 2024.' },
    response: []
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  const fixtureIds = await fetchApiFootballOddsFixtureIds({
    date: '2026-07-19',
    leagueId: '1',
    season: '2026',
    apiKey: 'test-key'
  }, fakeFetch);

  assert.deepEqual([...fixtureIds], []);
});

test('API-Football errors retain safe rate-limit headers for diagnostics', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({
    errors: { requests: 'Too many requests. You have exceeded the limit of requests per minute of your subscription.' },
    response: []
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-ratelimit-limit': '300',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-requests-limit': '7500',
      'x-ratelimit-requests-remaining': '7420'
    }
  });

  await assert.rejects(
    () => fetchApiFootballOddsFixtureIds({ fixtureId: '123456', apiKey: 'test-key' }, fakeFetch),
    (error) => {
      assert.deepEqual(error.rateLimit, {
        minuteLimit: '300',
        minuteRemaining: '0',
        dailyLimit: '7500',
        dailyRemaining: '7420'
      });
      return true;
    }
  );
});

test('public schedule keeps only fixtures with betting odds and marks them verified', () => {
  const matches = [
    { matchId: '123456', matchName: 'England v Argentina' },
    { matchId: '777777', matchName: 'No market match' }
  ];

  assert.deepEqual(filterMatchesWithOdds(matches, new Set(['123456'])), [
    { matchId: '123456', matchName: 'England v Argentina', hasOdds: true }
  ]);
});

test('cached public schedule never exposes fixtures that were not odds-verified', () => {
  const schedule = {
    competitionId: '1',
    fetchedAt: '2026-07-18T00:00:00.000Z',
    providerChecks: {
      '2026-07-19': { status: 'rate-limited', stage: 'odds', fixtureCount: 1, oddsCount: 0 }
    },
    matches: [
      { matchId: '123456', date: '2026-07-19', hasOdds: true },
      { matchId: '777777', date: '2026-07-19' }
    ]
  };

  const filtered = filterApiFootballMatches(schedule, '2026-07-19');
  assert.deepEqual(filtered.matches, [
    { matchId: '123456', date: '2026-07-19', hasOdds: true }
  ]);
  assert.deepEqual(filtered.providerCheck, {
    status: 'rate-limited', stage: 'odds', fixtureCount: 1, oddsCount: 0
  });
});

test('schedule cache groups one daily fixture response by configured league', () => {
  const matches = [
    { ...fixture, league: { id: 1, name: 'World Cup' } },
    { ...fixture, fixture: { ...fixture.fixture, id: 999999 }, league: { id: 39, name: 'Premier League' } }
  ].map((row) => ({
    matchId: String(row.fixture.id),
    competitionId: String(row.league.id),
    date: '2026-07-18',
    status: 'scheduled'
  }));

  const schedules = buildApiFootballSchedules(matches, ['1', '39'], '2026-07-18', '2026-07-18T00:00:00.000Z');
  assert.equal(schedules.length, 2);
  assert.equal(schedules[0].matches.length, 1);
  assert.equal(schedules[1].competitionId, '39');
  assert.deepEqual(schedules[0].oddsCheckedDates, {
    '2026-07-18': '2026-07-18T00:00:00.000Z'
  });
  assert.deepEqual(configuredApiFootballLeagues({ API_FOOTBALL_LEAGUES: '1,39,1' }), ['1', '39']);
});

test('odds refresh cooldown prevents repeated provider calls from page refreshes', () => {
  const now = Date.parse('2026-07-19T01:00:00.000Z');

  assert.equal(isOddsCheckDue({}, '2026-07-19', now), true);
  assert.equal(isOddsCheckDue({
    oddsCheckedDates: { '2026-07-19': '2026-07-19T00:50:00.000Z' }
  }, '2026-07-19', now), false);
  assert.equal(isOddsCheckDue({
    oddsCheckedDates: { '2026-07-19': '2026-07-19T00:30:00.000Z' }
  }, '2026-07-19', now), true);
});

test('odds refresh cooldown for one date does not block a different date', () => {
  const schedule = {
    oddsCheckedDates: { '2026-07-19': '2026-07-19T00:50:00.000Z' }
  };

  assert.equal(isOddsCheckDue(schedule, '2026-07-20', Date.parse('2026-07-19T01:00:00.000Z')), true);
});

test('daily refresh updates World Cup matches without dropping the full tournament schedule', () => {
  const existing = [
    { matchId: '1', date: '2026-07-18', status: 'scheduled' },
    { matchId: '2', date: '2026-07-19', status: 'scheduled' }
  ];
  const daily = [{ matchId: '1', date: '2026-07-18', status: 'finished', score: '2:1' }];

  assert.deepEqual(mergeScheduleMatches(existing, daily), [
    { matchId: '1', date: '2026-07-18', status: 'finished', score: '2:1' },
    { matchId: '2', date: '2026-07-19', status: 'scheduled' }
  ]);
});

test('date refresh removes old unverified fixtures while preserving other dates', () => {
  const existing = [
    { matchId: '1', date: '2026-07-18', hasOdds: false },
    { matchId: '2', date: '2026-07-19', hasOdds: true }
  ];
  const updates = [{ matchId: '3', date: '2026-07-18', hasOdds: true }];

  assert.deepEqual(mergeScheduleDate(existing, updates, '2026-07-18'), [
    { matchId: '3', date: '2026-07-18', hasOdds: true },
    { matchId: '2', date: '2026-07-19', hasOdds: true }
  ]);
});

test('all league schedule refreshes preserve previously captured odds history', () => {
  const existing = {
    competitionId: '39',
    matches: [{ matchId: 'old', date: '2026-07-18', hasOdds: true }],
    oddsCheckedDates: { '2026-07-18': '2026-07-18T01:00:00.000Z' }
  };
  const daily = {
    competitionId: '39',
    fetchedAt: '2026-07-20T01:00:00.000Z',
    matches: [{ matchId: 'today', date: '2026-07-20', hasOdds: true }],
    oddsCheckedDates: { '2026-07-20': '2026-07-20T01:00:00.000Z' }
  };

  const merged = mergeScheduleSnapshot(existing, daily);

  assert.deepEqual(merged.matches.map((match) => match.matchId), ['old', 'today']);
  assert.deepEqual(Object.keys(merged.oddsCheckedDates), ['2026-07-18', '2026-07-20']);
});

test('backend schedules exclude legacy Dongqiudi cache records', () => {
  const schedules = [
    { competitionId: '1', source: 'api-football', matches: [{ matchId: 'new' }] },
    { competitionId: '125', source: 'dongqiudi', matches: [{ matchId: 'legacy' }] },
    { competitionId: 'unknown', matches: [{ matchId: 'unverified' }] }
  ];

  assert.deepEqual(filterApiFootballSchedules(schedules), [schedules[0]]);
});

test('all competitions combines API-Football schedules for the selected date', () => {
  const schedules = [
    {
      competitionId: '1',
      source: 'api-football',
      fetchedAt: '2026-07-20T01:00:00.000Z',
      matches: [{ matchId: 'world-cup', date: '2026-07-21', status: 'scheduled', hasOdds: true }]
    },
    {
      competitionId: '171',
      source: 'api-football',
      fetchedAt: '2026-07-20T02:00:00.000Z',
      matches: [{ matchId: 'league', date: '2026-07-21', status: 'scheduled', hasOdds: true }]
    },
    {
      competitionId: '125',
      source: 'dongqiudi',
      matches: [{ matchId: 'legacy', date: '2026-07-21', status: 'scheduled', hasOdds: true }]
    }
  ];

  const combined = aggregateApiFootballSchedules(schedules, '2026-07-21');

  assert.equal(combined.competitionId, 'all');
  assert.equal(combined.fetchedAt, '2026-07-20T02:00:00.000Z');
  assert.deepEqual(combined.upcomingTodayMatches.map((match) => match.matchId), ['world-cup', 'league']);
});

test('legacy imported contexts inherit team images from the shared schedule cache', () => {
  const contexts = [{
    source: 'api-football',
    matchId: '1591866',
    matchName: 'Spain v Argentina'
  }];
  const schedules = [{
    source: 'api-football',
    matches: [{
      matchId: '1591866',
      home: 'Spain',
      away: 'Argentina',
      homeLogo: 'https://media.api-sports.io/football/teams/9.png',
      awayLogo: 'https://media.api-sports.io/football/teams/26.png'
    }]
  }];

  const [enriched] = enrichContextsWithScheduleTeams(contexts, schedules);

  assert.equal(enriched.fixture.home.logo, 'https://media.api-sports.io/football/teams/9.png');
  assert.equal(enriched.fixture.away.logo, 'https://media.api-sports.io/football/teams/26.png');
});

test('history backfill selects the oldest unchecked date inside the seven-day odds window', () => {
  const schedules = [{
    competitionId: '39',
    oddsCheckedDates: {
      '2026-07-14': '2026-07-20T00:00:00.000Z',
      '2026-07-15': '2026-07-20T00:20:00.000Z'
    }
  }];

  assert.equal(selectHistoryBackfillDate(schedules, '2026-07-20'), '2026-07-16');
});

test('scheduled refresh covers today, tomorrow and the day after tomorrow', () => {
  assert.deepEqual(upcomingRefreshDates('2026-07-20'), [
    '2026-07-20',
    '2026-07-21',
    '2026-07-22'
  ]);
});

test('Cloudflare routes and cron use API-Football exclusively', async () => {
  const worker = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');
  const config = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

  assert.match(worker, /refreshApiFootballScheduleCache/);
  assert.match(worker, /fetchApiFootballContext/);
  assert.match(worker, /\/api\/football\/matches/);
  assert.match(worker, /\/api\/import\/api-football/);
  assert.match(worker, /if \(!cached\) await refreshApiFootballScheduleCache\(env, workerFetch\)/);
  assert.match(worker, /fetchApiFootballMatches\(\{[^}]*leagueId: '1'[^}]*date,/s);
  assert.match(worker, /fetchApiFootballOddsFixtureIds/);
  assert.match(worker, /fixtureId: match\.matchId/);
  assert.match(worker, /providerChecks/);
  assert.match(worker, /checkStage = 'odds'/);
  assert.match(worker, /rateLimit: error\.rateLimit/);
  assert.match(worker, /rateLimit === undefined/);
  assert.match(worker, /cacheStatus: 'odds-check-delayed'/);
  assert.match(worker, /isOddsCheckDue\(cached, date\)/);
  assert.doesNotMatch(worker, /season: '2026'/);
  assert.doesNotMatch(worker, /fetchDongqiudi|refreshDongqiudi|\/api\/dongqiudi/);
  assert.match(config, /"API_FOOTBALL_LEAGUES"/);
  assert.doesNotMatch(config, /DONGQIUDI_COMPETITIONS/);
});
