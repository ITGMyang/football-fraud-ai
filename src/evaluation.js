import { splitTeams } from './domain.js';
import { contextKey } from './context-utils.js';

export function buildAnalytics({ rankings = [], contexts = [] } = {}) {
  const contextMap = new Map((contexts || []).map((context) => [contextKey(context), context]));
  const evaluations = [];
  const scoredContexts = (contexts || []).filter((context) => actualResultFromContext(context));
  const finishedWithoutScore = (contexts || []).filter((context) => isLikelyFinished(context) && !actualResultFromContext(context));

  for (const ranking of rankings || []) {
    const context = contextMap.get(ranking.contextId);
    const actual = actualResultFromContext(context);
    if (!actual) continue;
    for (const result of ranking.results || []) {
      if (result.error) continue;
      const modelName = result.modelName || 'AI';
      for (const pick of result.picks || []) {
        const evaluation = evaluatePick(pick, actual, context, ranking, modelName);
        if (evaluation) evaluations.push(evaluation);
      }
      const scoreEvaluation = evaluateScorePicks(result.scorePicks, actual, context, ranking, modelName);
      if (scoreEvaluation) evaluations.push(scoreEvaluation);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    contextCount: contexts.length,
    scoredContextCount: scoredContexts.length,
    finishedWithoutScoreCount: finishedWithoutScore.length,
    evaluatedCount: evaluations.filter((item) => item.counted).length,
    matchCount: new Set(evaluations.map((item) => item.contextId)).size,
    models: summarizeBy(evaluations, (item) => item.modelName),
    categories: summarizeBy(evaluations, (item) => item.category),
    trend: buildTrend(evaluations),
    evaluations: evaluations
      .sort((a, b) => String(b.matchDate).localeCompare(String(a.matchDate)) || String(a.contextName).localeCompare(String(b.contextName)))
      .slice(0, 5000)
  };
}

export function shouldRefreshForAnalytics(context = {}) {
  return Boolean(context.sourceUrl) && isLikelyFinished(context) && !actualResultFromContext(context);
}

export function actualResultFromContext(context = {}) {
  const score = normalizeScore(context.actualScore || context.score || context.result?.score || context.fullTimeScore);
  const parsed = parseScore(score);
  if (!parsed) return null;
  const teams = Array.isArray(context.teams) && context.teams.length >= 2
    ? context.teams
    : splitTeams(context.matchName);
  const [home, away] = teams;
  const totalGoals = parsed.home + parsed.away;
  const margin = parsed.home - parsed.away;
  return {
    score,
    homeScore: parsed.home,
    awayScore: parsed.away,
    totalGoals,
    margin,
    outcome: margin > 0 ? 'home' : margin < 0 ? 'away' : 'draw',
    home,
    away
  };
}

function evaluatePick(pick, actual, context, ranking, modelName) {
  const market = pick.market || {};
  const category = marketCategory(market);
  if (!['moneyline', 'handicap', 'total'].includes(category)) return null;
  const verdict = category === 'moneyline'
    ? evaluateMoneyline(market, actual)
    : category === 'total'
      ? evaluateTotal(market, actual)
      : evaluateHandicap(market, actual);
  if (!verdict) return null;
  return buildEvaluation({
    context,
    ranking,
    modelName,
    category,
    selection: formatSelection(market),
    probability: pick.estimatedProbability,
    actual,
    ...verdict
  });
}

function evaluateScorePicks(picks, actual, context, ranking, modelName) {
  const candidates = (picks || [])
    .map((pick) => ({
      score: normalizeScore(pick.score || pick.market?.selection),
      probability: pick.estimatedProbability
    }))
    .filter((pick) => pick.score);
  if (!candidates.length) return null;
  const hit = candidates.some((pick) => pick.score === actual.score);
  const probabilities = candidates.map((pick) => pick.probability).filter(Number.isFinite);
  return buildEvaluation({
    context,
    ranking,
    modelName,
    category: 'score',
    selection: candidates.map((pick) => pick.score).join(' / '),
    probability: probabilities.length ? Math.max(...probabilities) : null,
    actual,
    hit,
    counted: true,
    outcome: hit ? 'hit' : 'miss'
  });
}

function buildEvaluation({ context, ranking, modelName, category, selection, probability, actual, hit, counted, outcome }) {
  return {
    contextId: contextKey(context),
    contextName: context?.matchName || ranking.contextName || '比赛',
    kickoff: context?.kickoff || '',
    matchDate: String(context?.kickoff || ranking.createdAt || '').slice(0, 10) || 'unknown',
    rankingId: ranking.id,
    predictedAt: ranking.createdAt,
    modelName,
    category,
    selection,
    estimatedProbability: probability ?? null,
    actualScore: actual.score,
    hit: Boolean(hit),
    counted: Boolean(counted),
    outcome
  };
}

function evaluateMoneyline(market, actual) {
  const side = selectionSide(market.selection, actual);
  if (!side) return null;
  return {
    hit: side === actual.outcome,
    counted: true,
    outcome: side === actual.outcome ? 'hit' : 'miss'
  };
}

function evaluateTotal(market, actual) {
  const line = averageLine(market.line || market.selection);
  if (line === null) return null;
  const isOver = /大|over/i.test(String(market.selection || market.line || ''));
  const isUnder = /小|under/i.test(String(market.selection || market.line || ''));
  if (!isOver && !isUnder) return null;
  if (actual.totalGoals === line) return { hit: false, counted: false, outcome: 'push' };
  const hit = isOver ? actual.totalGoals > line : actual.totalGoals < line;
  return { hit, counted: true, outcome: hit ? 'hit' : 'miss' };
}

function evaluateHandicap(market, actual) {
  const side = selectionSide(market.selection, actual);
  const line = averageLine(market.line);
  if (!side || line === null || side === 'draw') return null;
  const sideMargin = side === 'home' ? actual.margin : -actual.margin;
  const adjusted = sideMargin + line;
  if (adjusted === 0) return { hit: false, counted: false, outcome: 'push' };
  return { hit: adjusted > 0, counted: true, outcome: adjusted > 0 ? 'hit' : 'miss' };
}

function selectionSide(selection, actual) {
  const text = String(selection || '').trim();
  if (/平|draw|tie/i.test(text)) return 'draw';
  if (sameTeam(text, actual.home)) return 'home';
  if (sameTeam(text, actual.away)) return 'away';
  return '';
}

function summarizeBy(evaluations, keyFn) {
  const rows = new Map();
  for (const item of evaluations) {
    if (!item.counted) continue;
    const key = keyFn(item) || 'unknown';
    const row = rows.get(key) || { key, total: 0, hits: 0, accuracy: 0 };
    row.total += 1;
    if (item.hit) row.hits += 1;
    row.accuracy = row.total ? row.hits / row.total : 0;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.accuracy - a.accuracy || b.total - a.total);
}

function buildTrend(evaluations) {
  const byDateModel = new Map();
  for (const item of evaluations) {
    if (!item.counted) continue;
    const date = String(item.kickoff || item.predictedAt || '').slice(0, 10) || 'unknown';
    const key = `${date}|${item.modelName}`;
    const row = byDateModel.get(key) || { date, modelName: item.modelName, total: 0, hits: 0, accuracy: 0 };
    row.total += 1;
    if (item.hit) row.hits += 1;
    row.accuracy = row.total ? row.hits / row.total : 0;
    byDateModel.set(key, row);
  }
  return [...byDateModel.values()].sort((a, b) => a.date.localeCompare(b.date) || a.modelName.localeCompare(b.modelName));
}

function isLikelyFinished(context = {}) {
  if (/played|finished|完场|结束|ft/i.test(String(context.status || context.matchStatus || ''))) return true;
  const kickoff = parseKickoffTime(context.kickoff);
  return kickoff ? kickoff.getTime() + 150 * 60 * 1000 < Date.now() : false;
}

function parseKickoffTime(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    const [, year, month, day, hour, minute, second = '00'] = match;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function marketCategory(market) {
  const type = String(market?.marketType || '');
  if (/胜平负|1x2|moneyline/i.test(type)) return 'moneyline';
  if (/比分|score/i.test(type)) return 'score';
  if (/让球|让分|亚洲|handicap/i.test(type)) return 'handicap';
  if (/大\/小|大小|总分|总进球|total|over|under/i.test(type)) return 'total';
  return 'other';
}

function formatSelection(market) {
  return [market.selection, market.line].filter(Boolean).join(' ').trim();
}

function averageLine(value) {
  const nums = String(value || '').match(/[+-]?\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
  if (!nums.length) return null;
  return nums.reduce((sum, num) => sum + num, 0) / nums.length;
}

function normalizeScore(value) {
  const text = String(value || '').trim()
    .replace(/[：\-–—]/g, ':')
    .replace(/\s+/g, '');
  const match = text.match(/(\d+):(\d+)/);
  return match ? `${Number(match[1])}:${Number(match[2])}` : '';
}

function parseScore(value) {
  const match = normalizeScore(value).match(/^(\d+):(\d+)$/);
  return match ? { home: Number(match[1]), away: Number(match[2]) } : null;
}

function sameTeam(selection, team) {
  const normalize = (value) => String(value || '').toLowerCase().replace(/\s+/g, '');
  const a = normalize(selection);
  const b = normalize(team);
  return a && b && (a.includes(b) || b.includes(a));
}
