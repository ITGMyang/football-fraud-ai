export function parseDongqiudiSections({ sourceUrl = '', sections = [] }) {
  const byName = new Map(sections.map((section) => [section.name, cleanLines(section.text)]));
  const headerLines = [...byName.values()].find((lines) => lines.length) || [];
  const teams = parseTeams(headerLines);
  const matchName = teams.length === 2 ? `${teams[0]} v ${teams[1]}` : '';

  return {
    id: sourceUrl || crypto.randomUUID(),
    source: 'dongqiudi',
    sourceUrl,
    matchName,
    teams,
    kickoff: findKickoff(headerLines),
    analysis: parseAnalysis(byName.get('分析') || []),
    lineup: parseLineup(byName.get('阵容') || [], teams),
    index: parseIndex(byName.get('指数') || []),
    experts: parseExperts(byName.get('专家') || []),
    live: parseLive(byName.get('文字直播') || []),
    capturedAt: new Date().toISOString()
  };
}

function cleanLines(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parseTeams(lines) {
  const vs = lines.indexOf('VS');
  if (vs > 0 && lines[vs + 1]) {
    const home = [...lines.slice(0, vs)].reverse().find((line) => !/^(未开始|已结束|进行中|VS|\d{4}-)/.test(line));
    const away = lines.slice(vs + 1).find((line) => !/^(未开始|已结束|进行中|VS|\d{4}-)/.test(line));
    if (home && away) return [home, away];
  }
  return [];
}

function findKickoff(lines) {
  return lines.find((line) => /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(line)) || '';
}

function parseAnalysis(lines) {
  return {
    h2h: tableRowsAfter(lines, '赛事\t日期\t主队\t比分\t客队', 1).slice(0, 5),
    recent: {
      ecuador: recentRowsForTeam(lines, '厄瓜多尔').slice(0, 8),
      germany: recentRowsForTeam(lines, '德国').slice(0, 8)
    },
    winRates: lines.filter((line) => /% 胜率$/.test(line)).slice(0, 4)
  };
}

function parseLineup(lines, teams) {
  const formation = lines.find((line) => /\d-\d-\d/.test(line) && /vs/.test(line)) || '';
  const players = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (/^\d+$/.test(lines[i]) && isLikelyPlayer(lines[i + 1])) {
      players.push(`${lines[i]} ${lines[i + 1]}`);
    }
  }
  return {
    formation,
    home: teams[0] || '',
    away: teams[1] || '',
    players: players.slice(0, 30),
    notes: lines.filter((line) => /受伤|停赛|替补|预计/.test(line)).slice(0, 12)
  };
}

function parseIndex(lines) {
  return {
    tabs: lines.filter((line) => /^(让球|欧指|进球数)$/.test(line)),
    handicapRows: lines.filter((line) => /\t/.test(line) && /受|让|半|一|球/.test(line)).slice(0, 20)
  };
}

function parseExperts(lines) {
  const items = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/小时前发布|天前发布/.test(lines[i + 2] || '') || /让球|大小球|竞彩/.test(lines[i + 2] || '')) {
      items.push({
        author: lines[i],
        title: lines[i + 1] || '',
        market: lines[i + 2] || '',
        tags: lines.slice(i + 3, i + 8).filter((line) => /连红|近|胜率|世界杯/.test(line))
      });
    }
  }
  return items.filter((item) => item.title.length > 6).slice(0, 12);
}

function parseLive(lines) {
  return lines.filter((line) => /天气|场地|热身|比赛即将开始/.test(line)).slice(0, 20);
}

function tableRowsAfter(lines, marker, occurrence = 0) {
  const indexes = lines.map((line, index) => line === marker ? index : -1).filter((index) => index >= 0);
  const start = indexes[occurrence] ?? indexes[0];
  if (start === undefined) return [];
  return lines.slice(start + 1).filter((line) => /\t/.test(line)).slice(0, 12);
}

function recentRowsForTeam(lines, team) {
  const recentIndex = lines.indexOf('近期战绩');
  const start = lines.findIndex((line, index) => index > recentIndex && line === team && /% 胜率$/.test(lines[index + 1] || ''));
  if (start === -1) return [];
  return lines.slice(start).filter((line) => /\t/.test(line)).slice(0, 12);
}

function isLikelyPlayer(line) {
  return !/^(首页|比赛|数据|专家|赛事|世界杯|未开始|VS|赛况|分析|阵容|指数|文字直播)$/.test(line)
    && !/^\d/.test(line)
    && line.length >= 2
    && line.length <= 24;
}
