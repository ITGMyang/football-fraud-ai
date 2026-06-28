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

export async function fetchDongqiudiMatches({ competitionId = '10', date = todayInShanghai(), sourceUrl = '' } = {}, fetchImpl = fetch) {
  const url = sourceUrl || `https://m.dongqiudi.com/match/${encodeURIComponent(competitionId)}`;
  const html = await fetchText(fetchImpl, url);
  const matches = parseDongqiudiMatchList(html, url);
  return {
    source: 'dongqiudi',
    sourceUrl: url,
    date,
    fetchedAt: new Date().toISOString(),
    matches,
    todayMatches: matches.filter((match) => match.date === date),
    upcomingTodayMatches: matches.filter((match) => match.date === date && match.status === 'scheduled')
  };
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
  const text = await fetchText(fetchImpl, url);
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: 'https://www.dongqiudi.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
    }
  });
  if (!response.ok) throw new Error(`懂球帝接口 ${response.status}`);
  return response.text();
}

function normalizeDongqiudiContext({ sourceUrl, matchId, detail, pre, lineup, odds, experts }) {
  const sample = detail?.matchSample || {};
  const home = firstText(pre?.team_A, sample.team_A_name, lineup?.persons?.team_A?.team_name);
  const away = firstText(pre?.team_B, sample.team_B_name, lineup?.persons?.team_B?.team_name);
  const teams = [home, away].filter(Boolean);
  const matchName = teams.length === 2 ? `${teams[0]} v ${teams[1]}` : `懂球帝比赛 ${matchId}`;
  const kickoff = firstText(pre?.start_time, sample.start_play);
  const actualScore = extractActualScore(sample, pre, lineup);

  return {
    id: sourceUrl || `dongqiudi:${matchId}`,
    source: 'dongqiudi',
    sourceUrl,
    matchId,
    matchName,
    teams,
    kickoff,
    actualScore,
    status: actualScore ? 'finished' : firstText(sample.status, sample.status_name, pre?.status) || '',
    competition: firstText(sample.competition_name, pre?.competition_name),
    analysis: normalizeAnalysis(pre, teams),
    lineup: normalizeLineup(lineup, teams),
    index: normalizeOdds(odds),
    experts: normalizeExperts(experts),
    live: normalizeLive(lineup),
    capturedAt: new Date().toISOString()
  };
}

function extractActualScore(sample = {}, pre = {}, lineup = {}) {
  const direct = [
    sample.score,
    sample.final_score,
    sample.full_score,
    sample.fs,
    pre.score,
    lineup?.base?.score
  ].map(normalizeScoreText).find(Boolean);
  if (direct) return direct;

  const pairs = [
    [sample.team_A_score, sample.team_B_score],
    [sample.team_a_score, sample.team_b_score],
    [sample.home_score, sample.away_score],
    [sample.fs_A, sample.fs_B],
    [sample.score_A, sample.score_B],
    [pre.team_A_score, pre.team_B_score],
    [pre.home_score, pre.away_score]
  ];
  for (const [home, away] of pairs) {
    if (isScoreNumber(home) && isScoreNumber(away)) return `${Number(home)}:${Number(away)}`;
  }
  return '';
}

function normalizeScoreText(value) {
  const match = String(value || '').replace(/[：\-–—]/g, ':').match(/(\d+)\s*:\s*(\d+)/);
  return match ? `${Number(match[1])}:${Number(match[2])}` : '';
}

function isScoreNumber(value) {
  return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
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

export function parseDongqiudiMatchList(html, sourceUrl = 'https://m.dongqiudi.com/match/10') {
  const source = String(html || '');
  const itemPattern = /<li id="id(\d+)" class="match-calendar-item"[\s\S]*?(?=<li id="id\d+" class="match-calendar-item"|<\/ul>)/g;
  const matches = [];
  let currentDate = '';

  for (const match of source.matchAll(itemPattern)) {
    const block = match[0];
    const dateTitle = stripTags(block.match(/<h3 class="match-title"[^>]*>([\s\S]*?)<\/h3>/)?.[1] || '').trim();
    if (dateTitle) currentDate = dateTitle.split(/\s+/)[0];

    const teams = [...block.matchAll(/<div class="match-item-[ab]"[\s\S]*?<img src="([^"]*)"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/g)]
      .map((item) => ({
        logo: decodeHtml(item[1] || ''),
        name: stripTags(item[2] || '').trim()
      }))
      .filter((team) => team.name);

    const middle = stripTags(block.match(/<div class="match-item-c"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/)?.[1] || '')
      .replace(/\s+/g, ' ')
      .trim();
    const time = middle.match(/\d{1,2}:\d{2}/)?.[0] || '';
    const competition = middle.replace(time, '').trim();
    const score = stripTags(block.match(/<p class="spec"[^>]*>([\s\S]*?)<\/p>/)?.[1] || '').trim();
    const status = score ? 'finished' : isUpcoming(currentDate, time) ? 'scheduled' : 'unknown';
    const id = match[1];

    if (teams.length >= 2) {
      matches.push({
        id,
        matchId: id,
        sourceUrl: `https://www.dongqiudi.com/match/${id}`,
        mobileSourceUrl: `https://m.dongqiudi.com/match/${id}`,
        listSourceUrl: sourceUrl,
        date: currentDate,
        time,
        kickoff: [currentDate, time].filter(Boolean).join(' '),
        competition,
        home: teams[0].name,
        away: teams[1].name,
        teams: [teams[0].name, teams[1].name],
        homeLogo: teams[0].logo,
        awayLogo: teams[1].logo,
        matchName: `${teams[0].name} v ${teams[1].name}`,
        score,
        status
      });
    }
  }

  return matches;
}

function todayInShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function isUpcoming(date, time) {
  if (!date || !time) return false;
  const kickoff = new Date(`${date}T${time}:00+08:00`).getTime();
  return Number.isFinite(kickoff) && kickoff >= Date.now() - 15 * 60 * 1000;
}

function stripTags(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
