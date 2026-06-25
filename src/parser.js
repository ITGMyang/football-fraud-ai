import { buildMarket } from './domain.js';

const SAMPLE_LINES = [
  { matchName: '南非 v 韩国', marketType: '足球 让球', selection: '韩国', line: '-0.5 / 1', odds: 0.75 },
  { matchName: '捷克 v 墨西哥', marketType: '足球 让球', selection: '捷克', line: '+0.5', odds: 0.91 },
  { matchName: '摩洛哥 v 海地', marketType: '足球 让球', selection: '摩洛哥', line: '-2', odds: 0.88 },
  { matchName: '苏格兰 v 巴西', marketType: '足球 让球', selection: '苏格兰', line: '+1.5', odds: 0.97 },
  { matchName: '波斯尼亚和黑塞哥维那 v 卡塔尔', marketType: '足球 大/小', selection: '大', line: '3', odds: 0.96 },
  { matchName: '瑞士 v 加拿大', marketType: '足球 让球', selection: '加拿大', line: '+0 / 0.5', odds: 0.83 }
];

export function sampleMarkets(sourceUrl = 'screenshot://provided') {
  return SAMPLE_LINES.map((item) => buildMarket({ ...item, sourceUrl }));
}

export function parseStakeText(text, sourceUrl = '') {
  const cleaned = String(text || '').replace(/\u00a0/g, ' ');
  const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const markets = [];

  for (let i = 0; i < lines.length; i += 1) {
    const marketType = normalizeMarketType(lines[i]);
    if (!marketType) continue;

    const matchName = findMatchName(lines, i + 1);
    const pick = findPickLine(lines, i + 1);
    if (!matchName || !pick) continue;

    markets.push(buildMarket({
      matchName,
      marketType,
      selection: pick.selection,
      line: pick.line,
      odds: pick.odds,
      sourceUrl
    }));
    i = Math.max(i, pick.index);
  }

  markets.push(...parseStakeDetailLines(lines, sourceUrl));
  return dedupeMarkets(markets);
}

function normalizeMarketType(line) {
  if (/足球\s*让球/.test(line)) return '足球 让球';
  if (/足球\s*大\s*\/\s*小/.test(line)) return '足球 大/小';
  return '';
}

function findMatchName(lines, start) {
  for (let i = start; i < Math.min(lines.length, start + 8); i += 1) {
    const line = lines[i];
    if (/世界/.test(line) || /@\s*[-+]?\d/.test(line) || normalizeMarketType(line)) continue;
    if (/\s+v\s+|\s+vs\.?\s+/i.test(line)) return line.replace(/\s+/g, ' ');
  }
  return '';
}

function findPickLine(lines, start) {
  for (let i = start; i < Math.min(lines.length, start + 12); i += 1) {
    const parsed = parsePickLine(lines[i]);
    if (parsed) return { ...parsed, index: i };
  }
  return null;
}

export function parsePickLine(line) {
  const match = String(line).match(/^(.+?)\s+([+-]?\d+(?:\.\d+)?(?:\s*\/\s*[+-]?\d+(?:\.\d+)?)?)\s*@\s*(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  return {
    selection: match[1].trim(),
    line: match[2].replace(/\s+/g, ' ').trim(),
    odds: Number(match[3])
  };
}

function dedupeMarkets(markets) {
  const seen = new Set();
  return markets.filter((market) => {
    const key = [market.matchName, market.marketType, market.selection, market.line, market.odds].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseStakeDetailLines(lines, sourceUrl) {
  const markets = [];
  const teams = findDetailTeams(lines);
  if (teams.length < 2) return markets;
  const matchName = `${teams[0]} v ${teams[1]}`;

  const moneylineIndex = lines.findIndex((line) => line === '亚洲盘');
  if (moneylineIndex >= 0) {
    const moneyline = parseMoneyline(lines, moneylineIndex, matchName, sourceUrl);
    markets.push(...moneyline);
  }

  const handicapIndex = lines.findIndex((line) => line === '亚洲让分盘');
  if (handicapIndex >= 0) {
    markets.push(...parseAsianHandicap(lines, handicapIndex, teams, matchName, sourceUrl));
  }

  markets.push(...parseTotals(lines, matchName, sourceUrl));
  markets.push(...parseExactScores(lines, matchName, sourceUrl));

  return markets;
}

function findDetailTeams(lines) {
  const dashLine = lines.find((line) => /^[^\d]+ - [^\d]+$/.test(line));
  if (!dashLine) return [];
  const [leftRaw, rightRaw] = dashLine.split(' - ').map((x) => x.trim()).filter(Boolean);
  const left = normalizeTeamName(leftRaw, lines);
  const right = normalizeTeamName(rightRaw, lines);
  return left && right ? [left, right] : [];
}

function normalizeTeamName(name, lines) {
  if (lines.includes(name)) return name;
  const candidate = lines.find((line) => line.startsWith(name) && line.length <= name.length + 2);
  return candidate || name;
}

function parseMoneyline(lines, index, matchName, sourceUrl) {
  const markets = [];
  for (let i = index + 1; i < Math.min(lines.length - 1, index + 12); i += 2) {
    const selection = lines[i];
    const odds = Number(lines[i + 1]);
    if (!selection || !Number.isFinite(odds) || odds <= 1) continue;
    if (!/^[^\d]+$/.test(selection)) continue;
    markets.push(buildMarket({
      matchName,
      marketType: '足球 胜平负',
      selection,
      line: '胜平负',
      odds,
      sourceUrl
    }));
  }
  return markets.slice(0, 3);
}

function parseAsianHandicap(lines, index, teams, matchName, sourceUrl) {
  const markets = [];
  let start = index + 1;
  if (lines[start] === teams[0]) start += 1;
  if (lines[start] === teams[1]) start += 1;

  for (let i = start; i < Math.min(lines.length - 1, start + 36); i += 2) {
    if (/&|平局返还|准确|总进球|Stake/.test(lines[i])) break;
    const line = Number(lines[i]);
    const odds = Number(lines[i + 1]);
    if (!isQuarterLine(line) || !Number.isFinite(odds) || odds <= 1 || odds > 20) continue;
    const selection = line < 0 ? teams[1] : teams[0];
    markets.push(buildMarket({
      matchName,
      marketType: '足球 亚洲让分盘',
      selection,
      line: formatHandicap(line),
      odds,
      sourceUrl
    }));
  }

  return markets;
}

function parseTotals(lines, matchName, sourceUrl) {
  const markets = [];
  const seen = new Set();

  for (let i = 0; i < lines.length - 3; i += 1) {
    const lineA = Number(lines[i]);
    const oddsA = Number(lines[i + 1]);
    const lineB = Number(lines[i + 2]);
    const oddsB = Number(lines[i + 3]);

    if (!isTotalLine(lineA) || lineA !== lineB) continue;
    if (!isReasonableOdds(oddsA) || !isReasonableOdds(oddsB)) continue;

    const key = `${lineA}|${oddsA}|${oddsB}`;
    if (seen.has(key)) continue;
    seen.add(key);

    markets.push(buildMarket({
      matchName,
      marketType: '足球 大小球',
      selection: '大',
      line: formatTotal(lineA),
      odds: oddsA,
      sourceUrl
    }));
    markets.push(buildMarket({
      matchName,
      marketType: '足球 大小球',
      selection: '小',
      line: formatTotal(lineB),
      odds: oddsB,
      sourceUrl
    }));
  }

  return markets.slice(0, 16);
}

function parseExactScores(lines, matchName, sourceUrl) {
  const markets = [];
  const sectionIndex = lines.findIndex((line) => /^(正确比分|准确比分|正确进球|比分)$/.test(line));
  if (sectionIndex === -1) return markets;

  for (let i = sectionIndex + 1; i < Math.min(lines.length - 1, sectionIndex + 80); i += 2) {
    const selection = lines[i];
    const odds = Number(lines[i + 1]);
    if (/上半场|半场\/全场|热门|Stake/.test(selection)) break;
    if (!isExactScoreSelection(selection) || !isScoreOdds(odds)) continue;
    markets.push(buildMarket({
      matchName,
      marketType: '足球 比分',
      selection: selection.replace(/\s+/g, ''),
      line: '正确比分',
      odds,
      sourceUrl
    }));
  }

  return markets;
}

function isExactScoreSelection(value) {
  return /^\d+\s*[-:]\s*\d+$/.test(value) || value === '其他';
}

function isQuarterLine(value) {
  if (!Number.isFinite(value) || Math.abs(value) > 3) return false;
  return Math.abs(value * 4 - Math.round(value * 4)) < 0.001;
}

function isTotalLine(value) {
  if (!Number.isFinite(value) || value < 0.5 || value > 8) return false;
  return Math.abs(value * 4 - Math.round(value * 4)) < 0.001;
}

function isReasonableOdds(value) {
  return Number.isFinite(value) && value > 1 && value <= 80;
}

function isScoreOdds(value) {
  return Number.isFinite(value) && value > 1 && value <= 1000;
}

function formatHandicap(value) {
  if (Object.is(value, -0)) return '0';
  return value > 0 ? `+${value}` : String(value);
}

function formatTotal(value) {
  return Number.isInteger(value) ? String(value) : String(value);
}
