const DEFAULT_BASE_URL = 'https://v3.football.api-sports.io';
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);
const SCHEDULED_STATUSES = new Set(['TBD', 'NS']);

export async function fetchApiFootballMatches(options = {}, fetchImpl = fetch) {
  const date = options.date || todayInShanghai();
  const leagueId = String(options.leagueId || options.competitionId || '');
  const params = options.season && leagueId
    ? { league: leagueId, season: options.season, timezone: 'Asia/Shanghai' }
    : { date, timezone: 'Asia/Shanghai' };
  const rows = await apiRequest('/fixtures', params, options, fetchImpl);
  const matches = rows
    .filter((row) => !leagueId || String(row?.league?.id || '') === leagueId)
    .map(normalizeFixture)
    .filter(Boolean);

  return scheduleFromMatches(matches, {
    date,
    competitionId: leagueId || 'all',
    fetchedAt: new Date().toISOString()
  });
}

export async function fetchApiFootballOddsFixtureIds(options = {}, fetchImpl = fetch) {
  const fixtureId = String(options.fixtureId || '').trim();
  const params = fixtureId
    ? { fixture: fixtureId }
    : {
        date: options.date || todayInShanghai(),
        league: options.leagueId || options.competitionId || undefined,
        season: options.season || undefined,
        timezone: 'Asia/Shanghai'
      };
  const fixtureIds = new Set();
  let page = 1;
  let totalPages = 1;
  do {
    let payload;
    try {
      payload = await apiEnvelopeRequest('/odds', { ...params, page }, options, fetchImpl);
    } catch (error) {
      if (/free plans do not have access to this season/i.test(String(error?.message || ''))) return new Set();
      throw error;
    }
    for (const row of payload.response) {
      const fixtureId = row?.fixture?.id;
      const hasBookmaker = (row?.bookmakers || []).some((bookmaker) => (bookmaker?.bets || []).length > 0);
      if (fixtureId && hasBookmaker) fixtureIds.add(String(fixtureId));
    }
    totalPages = Math.max(1, Number(payload?.paging?.total) || 1);
    page += 1;
  } while (page <= totalPages);
  return fixtureIds;
}

export function filterMatchesWithOdds(matches, fixtureIds) {
  return (matches || [])
    .filter((match) => fixtureIds?.has(String(match?.matchId || match?.id || '')))
    .map((match) => ({ ...match, hasOdds: true }));
}

export async function fetchApiFootballContext(value, options = {}, fetchImpl = fetch) {
  const fixtureId = extractApiFootballFixtureId(value);
  if (!fixtureId) throw new Error('无法识别 API-Football fixture ID');

  const fetchStatus = {};
  const required = apiRequest('/fixtures', { id: fixtureId, timezone: 'Asia/Shanghai' }, options, fetchImpl)
    .then((rows) => {
      fetchStatus.fixtures = endpointFetchStatus(rows);
      return rows;
    });
  const optional = async (path, params = { fixture: fixtureId }, statusKey = path) => {
    try {
      const rows = await apiRequest(path, params, options, fetchImpl);
      fetchStatus[statusKey] = endpointFetchStatus(rows);
      return rows;
    } catch (error) {
      fetchStatus[statusKey] = { state: 'error', count: 0, error: String(error?.message || error) };
      return [];
    }
  };
  const [fixtures, lineups, injuries, statistics, players, odds, predictions, h2hSeed, events] = await Promise.all([
    required,
    optional('/fixtures/lineups', undefined, 'lineups'),
    optional('/injuries', undefined, 'injuries'),
    optional('/fixtures/statistics', undefined, 'fixtureStatistics'),
    optional('/fixtures/players', undefined, 'playerStatistics'),
    optional('/odds', undefined, 'odds'),
    optional('/predictions', undefined, 'predictions'),
    Promise.resolve([]),
    optional('/fixtures/events', undefined, 'events')
  ]);
  const fixture = fixtures[0];
  if (!fixture) throw new Error(`API-Football 找不到比赛 ${fixtureId}`);

  const homeId = fixture?.teams?.home?.id;
  const awayId = fixture?.teams?.away?.id;
  const h2h = homeId && awayId
    ? await optional('/fixtures/headtohead', { h2h: `${homeId}-${awayId}`, last: 6, timezone: 'Asia/Shanghai' }, 'h2h')
    : h2hSeed;
  if (!homeId || !awayId) fetchStatus.h2h = { state: 'not-requested', count: 0 };

  let catalog = {};
  if (options.includeCatalog) {
    const leagueId = fixture?.league?.id;
    const season = fixture?.league?.season;
    const cacheKey = apiFootballCatalogCacheKey({ leagueId, season, homeId, awayId });
    catalog = cacheKey && options.catalogCache?.read
      ? await options.catalogCache.read(cacheKey).catch(() => null)
      : null;
    if (!catalog) {
      const leagueParams = { league: leagueId, season };
      const [standings, topScorers, homeTeamStatistics, awayTeamStatistics, homeSquad, awaySquad, homeCoaches, awayCoaches] = await Promise.all([
        leagueId && season ? optional('/standings', leagueParams, 'standings') : [],
        leagueId && season ? optional('/players/topscorers', leagueParams, 'topScorers') : [],
        leagueId && season && homeId ? optional('/teams/statistics', { ...leagueParams, team: homeId }, 'homeTeamStatistics') : [],
        leagueId && season && awayId ? optional('/teams/statistics', { ...leagueParams, team: awayId }, 'awayTeamStatistics') : [],
        homeId ? optional('/players/squads', { team: homeId }, 'homeSquad') : [],
        awayId ? optional('/players/squads', { team: awayId }, 'awaySquad') : [],
        homeId ? optional('/coachs', { team: homeId }, 'homeCoaches') : [],
        awayId ? optional('/coachs', { team: awayId }, 'awayCoaches') : []
      ]);
      catalog = normalizeCatalog({
        standings,
        topScorers,
        teamStatistics: [...homeTeamStatistics, ...awayTeamStatistics],
        squads: [...homeSquad, ...awaySquad],
        coaches: [...homeCoaches, ...awayCoaches]
      });
      if (cacheKey && options.catalogCache?.write) {
        await options.catalogCache.write(cacheKey, catalog).catch(() => null);
      }
    }
    fetchStatus.standings ||= endpointFetchStatus(catalog.standings || []);
    fetchStatus.topScorers ||= endpointFetchStatus(catalog.topScorers || []);
    fetchStatus.teamStatistics = combinedFetchStatus(
      catalog.teamStatistics || [],
      fetchStatus.homeTeamStatistics,
      fetchStatus.awayTeamStatistics
    );
    fetchStatus.squads = combinedFetchStatus(catalog.squads || [], fetchStatus.homeSquad, fetchStatus.awaySquad);
    fetchStatus.coaches = combinedFetchStatus(catalog.coaches || [], fetchStatus.homeCoaches, fetchStatus.awayCoaches);
  }

  return normalizeContext({ fixture, lineups, injuries, statistics, players, odds, predictions, h2h, events, catalog, fetchStatus });
}

function endpointFetchStatus(rows = []) {
  const count = Array.isArray(rows) ? rows.length : 0;
  return { state: count ? 'available' : 'empty', count };
}

function combinedFetchStatus(rows, ...statuses) {
  const result = endpointFetchStatus(rows);
  if (result.count) return result;
  const error = statuses.find((status) => status?.state === 'error');
  return error || result;
}

export function apiFootballCatalogCacheKey({ leagueId, season, homeId, awayId }) {
  if (!leagueId || !season || !homeId || !awayId) return '';
  return `league:${leagueId}:season:${season}:teams:${homeId}-${awayId}`;
}

export function scheduleFromMatches(matches, { date = todayInShanghai(), competitionId = 'all', fetchedAt = new Date().toISOString() } = {}) {
  const selected = matches.filter((match) => match.date === date);
  return {
    source: 'api-football',
    competitionId: String(competitionId),
    sourceUrl: 'https://dashboard.api-football.com/',
    date,
    fetchedAt,
    matches,
    todayMatches: selected,
    upcomingTodayMatches: selected.filter((match) => match.status === 'scheduled')
  };
}

export function filterApiFootballMatches(schedule, date = todayInShanghai()) {
  const matches = Array.isArray(schedule?.matches)
    ? schedule.matches.filter((match) => match.hasOdds === true)
    : [];
  return {
    ...scheduleFromMatches(matches, { date, competitionId: schedule?.competitionId, fetchedAt: schedule?.fetchedAt }),
    providerCheck: schedule?.providerChecks?.[date] || null,
    cached: true
  };
}

export function extractApiFootballFixtureId(value) {
  const text = String(value || '').trim();
  return text.match(/api-football:\/\/fixture\/(\d+)/i)?.[1]
    || text.match(/[?&](?:fixture|id)=(\d+)/i)?.[1]
    || text.match(/fixtures?\/(\d+)/i)?.[1]
    || text.match(/^\d+$/)?.[0]
    || '';
}

export function todayInShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

async function apiRequest(path, params, options, fetchImpl) {
  return (await apiEnvelopeRequest(path, params, options, fetchImpl)).response;
}

async function apiEnvelopeRequest(path, params, options, fetchImpl) {
  const apiKey = String(options.apiKey || options.API_FOOTBALL_KEY || '').trim();
  if (!apiKey) throw new Error('缺少 API_FOOTBALL_KEY，请将它配置为 Cloudflare Secret');
  const baseUrl = String(options.baseUrl || options.API_FOOTBALL_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== '' && value !== null && value !== undefined) url.searchParams.set(key, String(value));
  }
  const headers = { Accept: 'application/json', 'x-apisports-key': apiKey };
  const proxySecret = String(options.proxySecret || options.API_FOOTBALL_PROXY_SECRET || '').trim();
  if (proxySecret) headers['X-Proxy-Secret'] = proxySecret;
  const response = await fetchImpl(url, { headers });
  const payload = await response.json().catch(() => ({}));
  const rateLimit = rateLimitHeaders(response.headers);
  if (!response.ok) {
    const error = new Error(`API-Football 接口 ${response.status}`);
    error.rateLimit = rateLimit;
    throw error;
  }
  const errors = payload?.errors;
  if (errors && (Array.isArray(errors) ? errors.length : Object.keys(errors).length)) {
    const error = new Error(`API-Football: ${formatErrors(errors)}`);
    error.rateLimit = rateLimit;
    throw error;
  }
  const providerResponse = payload?.response;
  return {
    response: Array.isArray(providerResponse)
      ? providerResponse
      : providerResponse && typeof providerResponse === 'object' ? [providerResponse] : [],
    paging: payload?.paging || { current: 1, total: 1 }
  };
}

function rateLimitHeaders(headers) {
  return {
    minuteLimit: headers.get('x-ratelimit-limit'),
    minuteRemaining: headers.get('x-ratelimit-remaining'),
    dailyLimit: headers.get('x-ratelimit-requests-limit'),
    dailyRemaining: headers.get('x-ratelimit-requests-remaining')
  };
}

function normalizeFixture(row) {
  const id = row?.fixture?.id;
  const home = row?.teams?.home;
  const away = row?.teams?.away;
  if (!id || !home?.name || !away?.name) return null;
  const kickoff = row.fixture.date || '';
  const date = formatDate(kickoff);
  const time = formatTime(kickoff);
  const statusCode = String(row?.fixture?.status?.short || '');
  const finished = FINISHED_STATUSES.has(statusCode);
  const score = finished && Number.isFinite(Number(row?.goals?.home)) && Number.isFinite(Number(row?.goals?.away))
    ? `${Number(row.goals.home)}:${Number(row.goals.away)}`
    : '';
  return {
    id: String(id),
    matchId: String(id),
    sourceUrl: `api-football://fixture/${id}`,
    date,
    time,
    kickoff,
    competition: row?.league?.name || '',
    competitionId: String(row?.league?.id || ''),
    season: row?.league?.season || '',
    home: home.name,
    away: away.name,
    teams: [home.name, away.name],
    homeLogo: home.logo || '',
    awayLogo: away.logo || '',
    matchName: `${home.name} v ${away.name}`,
    score,
    status: SCHEDULED_STATUSES.has(statusCode) ? 'scheduled' : finished ? 'finished' : 'live'
  };
}

function normalizeContext({ fixture, lineups, injuries, statistics, players, odds, predictions, h2h, events, catalog = {}, fetchStatus = {} }) {
  const match = normalizeFixture(fixture);
  const home = fixture.teams.home;
  const away = fixture.teams.away;
  const prediction = predictions?.[0]?.predictions || {};
  const predictionSummary = prediction?.advice || prediction?.winner?.name || '';
  return {
    id: `api-football:${match.matchId}`,
    source: 'api-football',
    sourceUrl: match.sourceUrl,
    matchId: match.matchId,
    matchName: match.matchName,
    teams: match.teams,
    kickoff: match.kickoff,
    actualScore: match.score,
    status: fixture?.fixture?.status?.long || match.status,
    competition: fixture?.league?.name || '',
    fixture: {
      leagueId: String(fixture?.league?.id || ''),
      season: fixture?.league?.season || '',
      country: fixture?.league?.country || '',
      round: fixture?.league?.round || '',
      referee: fixture?.fixture?.referee || '',
      venue: fixture?.fixture?.venue || {},
      home: fixture?.teams?.home || {},
      away: fixture?.teams?.away || {}
    },
    catalog,
    analysis: {
      h2h: (h2h || []).map(formatFixtureResult).filter(Boolean),
      recent: {},
      standings: catalog.standings || [],
      teamStatistics: normalizeTeamStatistics(statistics),
      playerStatistics: normalizePlayerStatistics(players),
      apiPrediction: {
        winner: prediction?.winner?.name || '',
        advice: prediction?.advice || '',
        percent: prediction?.percent || {},
        comparison: predictions?.[0]?.comparison || {}
      }
    },
    lineup: normalizeLineups(lineups, injuries, home.name, away.name, fixture),
    index: normalizeOdds(odds),
    experts: predictionSummary ? [{
      author: 'API-Football',
      title: predictionSummary,
      market: prediction?.winner?.name ? `倾向 ${prediction.winner.name}` : '',
      tags: Object.entries(prediction?.percent || {}).map(([key, value]) => `${key} ${value}`)
    }] : [],
    live: (events || []).slice(0, 40).map(formatEvent).filter(Boolean),
    fetchStatus,
    capturedAt: new Date().toISOString()
  };
}

function normalizeCatalog({ standings, topScorers, teamStatistics, squads, coaches }) {
  const table = (standings || []).flatMap((entry) => entry?.league?.standings || []).flat();
  return {
    standings: table.slice(0, 40).map((row) => [
      row?.rank ? `#${row.rank}` : '',
      row?.team?.name,
      Number.isFinite(Number(row?.points)) ? `${row.points}分` : '',
      row?.form ? `近况 ${row.form}` : ''
    ].filter(Boolean).join(' · ')),
    topScorers: (topScorers || []).slice(0, 20).map((row, index) => {
      const stats = row?.statistics?.[0] || {};
      return [
        `#${index + 1}`,
        row?.player?.name,
        stats?.team?.name,
        Number.isFinite(Number(stats?.goals?.total)) ? `${stats.goals.total}球` : ''
      ].filter(Boolean).join(' · ');
    }),
    teamStatistics: (teamStatistics || []).map((row) => ({
      team: row?.team?.name || '',
      played: row?.fixtures?.played?.total ?? '',
      wins: row?.fixtures?.wins?.total ?? '',
      draws: row?.fixtures?.draws?.total ?? '',
      losses: row?.fixtures?.loses?.total ?? '',
      goalsFor: row?.goals?.for?.total?.total ?? '',
      goalsAgainst: row?.goals?.against?.total?.total ?? '',
      cleanSheets: row?.clean_sheet?.total ?? ''
    })),
    squads: (squads || []).flatMap((row) => (row?.players || []).map((player) => [
      row?.team?.name,
      player?.number ? `${player.number}号` : '',
      player?.name,
      player?.position
    ].filter(Boolean).join(' '))).slice(0, 80),
    coaches: (coaches || []).slice(0, 20).map((coach) => [
      coach?.team?.name,
      coach?.name,
      coach?.nationality
    ].filter(Boolean).join(' · '))
  };
}

function normalizeLineups(lineups, injuries, homeName, awayName, fixture) {
  const players = [];
  const formations = [];
  for (const lineup of lineups || []) {
    if (lineup?.formation) formations.push(`${lineup.team?.name || ''} ${lineup.formation}`.trim());
    for (const entry of [...(lineup?.startXI || []), ...(lineup?.substitutes || [])]) {
      const player = entry?.player || {};
      players.push([
        lineup?.team?.name,
        player.number ? `${player.number}号` : '',
        player.name,
        player.pos,
        player.grid ? `站位 ${player.grid}` : ''
      ].filter(Boolean).join(' '));
    }
  }
  const injuryNotes = (injuries || []).map((item) => [
    item?.team?.name,
    item?.player?.name,
    item?.type,
    item?.reason
  ].filter(Boolean).join(' · '));
  const venue = fixture?.fixture?.venue || {};
  return {
    formation: formations.join(' vs '),
    home: homeName,
    away: awayName,
    players: players.slice(0, 60),
    notes: [
      fixture?.fixture?.referee ? `裁判 ${fixture.fixture.referee}` : '',
      venue.name ? `场地 ${venue.name}${venue.city ? `（${venue.city}）` : ''}` : '',
      ...injuryNotes.map((note) => `伤停 ${note}`)
    ].filter(Boolean)
  };
}

function normalizeTeamStatistics(rows) {
  return (rows || []).map((row) => ({
    team: row?.team?.name || '',
    values: Object.fromEntries((row?.statistics || []).map((item) => [item.type, item.value]))
  }));
}

function normalizePlayerStatistics(rows) {
  return (rows || []).flatMap((row) => (row?.players || []).map((entry) => ({
    team: row?.team?.name || '',
    player: entry?.player?.name || '',
    statistics: entry?.statistics?.[0] || {}
  }))).slice(0, 60);
}

function normalizeOdds(rows) {
  const live = { asia: [], euro: [], size: [] };
  for (const row of rows || []) {
    for (const bookmaker of row?.bookmakers || []) {
      for (const bet of bookmaker?.bets || []) {
        const name = String(bet?.name || '').toLowerCase();
        if (name.includes('match winner')) live.euro.push(moneylineRow(bookmaker.name, bet.values));
        if (name.includes('asian handicap')) live.asia.push(...handicapRows(bookmaker.name, bet.values));
        if (name.includes('goals over/under')) live.size.push(...totalRows(bookmaker.name, bet.values));
      }
    }
  }
  live.euro = live.euro.filter(Boolean).slice(0, 12);
  live.asia = live.asia.slice(0, 12);
  live.size = live.size.slice(0, 12);
  const handicapRowsText = [
    ...live.euro.map((row) => `欧指: ${row.company} ${row.home} ${row.line} ${row.away}`),
    ...live.asia.map((row) => `让球: ${row.company} ${row.home} ${row.line} ${row.away}`),
    ...live.size.map((row) => `进球数: ${row.company} ${row.home} ${row.line} ${row.away}`)
  ];
  return {
    tabs: [live.euro.length ? '欧指' : '', live.asia.length ? '让球' : '', live.size.length ? '进球数' : ''].filter(Boolean),
    live,
    handicapRows: handicapRowsText.slice(0, 24)
  };
}

function moneylineRow(company, values = []) {
  const value = (name) => values.find((item) => String(item.value).toLowerCase() === name)?.odd || '';
  const row = { market: '欧指', company: company || '', home: value('home'), line: value('draw'), away: value('away'), updatedAt: '' };
  return row.home || row.line || row.away ? row : null;
}

function handicapRows(company, values = []) {
  const grouped = new Map();
  for (const item of values) {
    const match = String(item?.value || '').match(/^(Home|Away)\s+([+-]?\d+(?:\.\d+)?)$/i);
    if (!match) continue;
    const side = match[1].toLowerCase();
    const line = Number(match[2]);
    const key = String(Math.abs(line));
    const row = grouped.get(key) || { market: '让球', company: company || '', home: '', line: line < 0 ? '让' : '受让', lineValue: String(line), away: '', updatedAt: '' };
    row[side] = item.odd || '';
    if (side === 'home') {
      row.line = line < 0 ? '让' : '受让';
      row.lineValue = String(line);
    }
    grouped.set(key, row);
  }
  return [...grouped.values()];
}

function totalRows(company, values = []) {
  const grouped = new Map();
  for (const item of values) {
    const match = String(item?.value || '').match(/^(Over|Under)\s+(\d+(?:\.\d+)?)$/i);
    if (!match) continue;
    const side = match[1].toLowerCase() === 'over' ? 'home' : 'away';
    const line = match[2];
    const row = grouped.get(line) || { market: '进球数', company: company || '', home: '', line, away: '', updatedAt: '' };
    row[side] = item.odd || '';
    grouped.set(line, row);
  }
  return [...grouped.values()];
}

function formatFixtureResult(row) {
  const home = row?.teams?.home?.name;
  const away = row?.teams?.away?.name;
  if (!home || !away) return '';
  const score = Number.isFinite(Number(row?.goals?.home)) && Number.isFinite(Number(row?.goals?.away))
    ? `${Number(row.goals.home)}:${Number(row.goals.away)}`
    : 'vs';
  return `${formatDate(row?.fixture?.date)} | ${home} ${score} ${away} | ${row?.league?.name || ''}`;
}

function formatEvent(event) {
  return [
    event?.time?.elapsed !== null && event?.time?.elapsed !== undefined ? `${event.time.elapsed}'` : '',
    event?.type,
    event?.detail,
    event?.player?.name,
    event?.assist?.name
  ].filter(Boolean).join(' · ');
}

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

function formatTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

function formatErrors(errors) {
  if (Array.isArray(errors)) return errors.join(', ');
  return Object.values(errors || {}).join(', ') || '未知错误';
}
