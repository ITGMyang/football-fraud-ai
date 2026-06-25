export async function fetchDongqiudiContext(sourceUrl, fetchImpl = fetch) {
  const matchId = extractDongqiudiMatchId(sourceUrl);
  if (!matchId) throw new Error('无法识别懂球帝比赛 URL，请使用 https://www.dongqiudi.com/match/数字');

  const base = 'https://www.dongqiudi.com';
  const detail = await fetchJson(fetchImpl, `${base}/magicball/v1/match/app/detail?id=${matchId}&app=dqd&lang=zh-cn`).catch(() => null);
  const pre = await fetchJson(fetchImpl, `${base}/api/data/match/pre_analysis_v1/${matchId}?platform=iphone&version=718`).catch(() => null);
  const lineupId = normalizeLineupMatchId(matchId);
  const lineup = await fetchJson(fetchImpl, `${base}/sport-data/soccer/biz/dqd/v1/match/lineup/${lineupId}?app=dqd&lang=zh-cn`).catch(() => null);
  const cmpType = detail?.matchSample?.cmp_type || 'soccer';
  const odds = await fetchJson(fetchImpl, `${base}/sport-data/soccer/biz/dqd/v1/match/odds/index/${matchId}?cmp_type=${cmpType}&app=dqd&lang=zh-cn&platform=android`).catch(() => null);
  const experts = await fetchJson(fetchImpl, `${base}/zc/plan/index?match_id=${matchId}&plan_type=tab_all`).catch(() => null);

  return normalizeDongqiudiContext({ sourceUrl, matchId, detail, pre, lineup, odds, experts });
}

export function extractDongqiudiMatchId(value) {
  const match = String(value || '').match(/dongqiudi\.com\/match\/(\d+)/i) || String(value || '').match(/^(\d{6,})$/);
  return match?.[1] || '';
}

function normalizeLineupMatchId(matchId) {
  const normalized = String(matchId || '').replace(/^0+/, '');
  return normalized.startsWith('5') ? normalized.slice(1) : normalized;
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: 'https://www.dongqiudi.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
    }
  });
  if (!response.ok) throw new Error(`懂球帝接口 ${response.status}`);
  const text = await response.text();
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}

function normalizeDongqiudiContext({ sourceUrl, matchId, detail, pre, lineup, odds, experts }) {
  const sample = detail?.matchSample || {};
  const home = firstText(pre?.team_A, sample.team_A_name, lineup?.persons?.team_A?.team_name);
  const away = firstText(pre?.team_B, sample.team_B_name, lineup?.persons?.team_B?.team_name);
  const teams = [home, away].filter(Boolean);
  const matchName = teams.length === 2 ? `${teams[0]} v ${teams[1]}` : `懂球帝比赛 ${matchId}`;
  const kickoff = firstText(pre?.start_time, sample.start_play);

  return {
    id: sourceUrl || `dongqiudi:${matchId}`,
    source: 'dongqiudi',
    sourceUrl,
    matchId,
    matchName,
    teams,
    kickoff,
    competition: firstText(sample.competition_name, pre?.competition_name),
    analysis: normalizeAnalysis(pre, teams),
    lineup: normalizeLineup(lineup, teams),
    index: normalizeOdds(odds),
    experts: normalizeExperts(experts),
    live: normalizeLive(lineup),
    capturedAt: new Date().toISOString()
  };
}

function normalizeAnalysis(pre, teams) {
  const recent = {};
  if (teams[0]) recent[teams[0]] = formatRecentRows(pre?.recent_record?.team_A);
  if (teams[1]) recent[teams[1]] = formatRecentRows(pre?.recent_record?.team_B);
  return {
    h2h: formatRecentRows(pre?.battle_history?.list).slice(0, 6),
    recent,
    standings: (pre?.cup_table?.list || pre?.league_table?.list || []).slice(0, 8).map((row) => [
      row.rank,
      row.name,
      `${row.matches_won || 0}-${row.matches_draw || 0}-${row.matches_lost || 0}`,
      `${row.goals_pro || 0}:${row.goals_against || 0}`,
      `${row.points || 0}分`
    ].filter(Boolean).join(' '))
  };
}

function formatRecentRows(rows) {
  return (rows || []).slice(0, 12).map((row) => {
    const date = [row.year, row.date].filter(Boolean).join('-');
    const teams = [row.team_A_name, row.score, row.team_B_name].filter(Boolean).join(' ');
    const extra = [row.competition, row.handicap ? `盘口:${row.handicap}` : '', row.handicap_result ? `盘路:${row.handicap_result}` : '']
      .filter(Boolean).join(' · ');
    return [date, teams, extra].filter(Boolean).join(' | ');
  });
}

function normalizeLineup(lineup, teams) {
  const home = lineup?.persons?.team_A || lineup?.forecasts?.team_A || {};
  const away = lineup?.persons?.team_B || lineup?.forecasts?.team_B || {};
  return {
    formation: [home.formation, away.formation].filter(Boolean).join(' vs '),
    home: teams[0] || home.team_name || '',
    away: teams[1] || away.team_name || '',
    players: [
      ...formatPlayers(home.lineups, teams[0]),
      ...formatPlayers(away.lineups, teams[1])
    ].slice(0, 30),
    notes: [
      lineup?.base?.weather ? `天气 ${lineup.base.weather}` : '',
      lineup?.base?.temperature ? `温度 ${lineup.base.temperature}` : '',
      lineup?.base?.field ? `场地 ${lineup.base.field}` : '',
      lineup?.base?.referee ? `裁判 ${lineup.base.referee}` : ''
    ].filter(Boolean)
  };
}

function formatPlayers(players, team) {
  return (players || []).slice(0, 15).map((player) => [
    team,
    player.shirtnumber ? `${player.shirtnumber}号` : '',
    player.person,
    player.position
  ].filter(Boolean).join(' '));
}

function normalizeOdds(odds) {
  return {
    tabs: ['欧指', '让球', '进球数'].filter((name, index) => [odds?.euro, odds?.asia, odds?.size][index]?.length),
    handicapRows: [
      ...formatOddsRows(odds?.asia, '让球'),
      ...formatOddsRows(odds?.euro, '欧指'),
      ...formatOddsRows(odds?.size, '进球数')
    ].slice(0, 24)
  };
}

function formatOddsRows(rows, label) {
  return (rows || []).slice(0, 8).map((row) => {
    if (Array.isArray(row)) return `${label}: ${row.join(' ')}`;
    return `${label}: ${Object.values(row || {}).filter((value) => ['string', 'number'].includes(typeof value)).slice(0, 8).join(' ')}`;
  });
}

function normalizeExperts(experts) {
  const list = experts?.data?.list || experts?.data?.match_experts || [];
  return list.slice(0, 12).map((item) => ({
    author: item.expertInfo?.name || item.expertInfo?.expertName || '',
    title: item.planInfo?.summary || '',
    market: item.planInfo?.play_name || item.planInfo?.plan_type || '',
    tags: [
      item.expertInfo?.high_labels_string,
      ...(item.expertInfo?.labels || []).map((label) => label.tag).filter(Boolean)
    ].filter(Boolean).slice(0, 6)
  })).filter((item) => item.author || item.title);
}

function normalizeLive(lineup) {
  return [
    lineup?.base?.weather_info?.weather ? `天气:${lineup.base.weather_info.weather}` : '',
    lineup?.base?.weather_info?.temperature ? `温度:${lineup.base.weather_info.temperature}` : '',
    lineup?.base?.field ? `场地:${lineup.base.field}` : '',
    lineup?.base?.referee ? `裁判:${lineup.base.referee}` : ''
  ].filter(Boolean);
}

function firstText(...values) {
  return values.map((value) => String(value || '').trim()).find((value) => value && !/^\?+$/.test(value)) || '';
}
