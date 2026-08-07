// Runs the expert pipeline for one fixture and presents its answer in the shape the
// site already renders.
//
// The pipeline speaks the architecture document's language - decision, probabilities,
// market_comparison, audit_trail - and the site speaks picks, scorePicks and bttsPick.
// Translating here keeps both honest: the document's engine underneath, nothing in the
// app rewritten, and the full report carried alongside for the console and for the day
// the app grows a place to show expected value.

import { buildPoissonBaseline } from './poisson.js';
import { mainHandicapLine } from './openrouter.js';
import { runExpertPipeline } from './expert-pipeline.js';

const DEFAULT_TOTAL_LINE = 2.5;
const SCORE_PICK_COUNT = 4;

export async function predictWithExperts({
  fixtureId,
  matchName = '',
  context = {},
  teamNews = null,
  env = process.env,
  fetchImpl = fetch
}) {
  const poisson = buildPoissonBaseline(context);
  const home = context?.teams?.[0] || context?.fixture?.home?.name || 'Home';
  const away = context?.teams?.[1] || context?.fixture?.away?.name || 'Away';

  const handicap = mainHandicapLine(context?.index?.live?.asia || []);
  const totals = mainTotalLine(context?.index?.live?.size || []);
  const handicapLine = handicap ? handicap.line : -0.5;
  const totalLine = totals ? totals.line : DEFAULT_TOTAL_LINE;

  const report = await runExpertPipeline({
    fixtureId,
    matchName: matchName || `${home} v ${away}`,
    context,
    // Without season goal records there is no statistical base to move, so the fixture
    // falls back to a neutral one rather than to nothing: the experts still adjust it
    // and every market still comes off one matrix.
    baseline: poisson.available
      ? { homeXg: poisson.lambdaHome, awayXg: poisson.lambdaAway, method: 'poisson', sample: poisson.sample }
      : { homeXg: 1.35, awayXg: 1.15, method: 'league-average-fallback', reason: poisson.reason },
    marketOdds: marketOddsFor(context, handicap, totals, handicapLine, totalLine),
    handicapLine,
    totalLine,
    teamNews,
    env,
    fetchImpl
  });

  return {
    ...expertResult(report, { home, away, matchName: matchName || `${home} v ${away}`, handicapLine, totalLine, handicap, totals }),
    report
  };
}

// The document's five markets, each as one pick on the side the maths prefers.
export function expertResult(report, { home, away, matchName, handicapLine, totalLine, handicap = null, totals = null }) {
  const probabilities = report.probabilities || {};
  const reason = report.decision?.verdict || report.audit_trail?.tactical_reason || '';
  const risks = [report.audit_trail?.critique, report.audit_trail?.breaking_summary].filter(Boolean);

  const outcomes = [
    ['Moneyline', home, '1X2', probabilities['1X2_Win']],
    ['Moneyline', 'Draw', '1X2', probabilities['1X2_Draw']],
    ['Moneyline', away, '1X2', probabilities['1X2_Loss']]
  ];
  const bestOutcome = outcomes.slice().sort((left, right) => right[3] - left[3])[0];

  const homeCovers = probabilities[`AH_${handicapLine}_Home`];
  const awayCovers = probabilities[`AH_${handicapLine}_Away`];
  const overProbability = probabilities[`OU_${totalLine}_Over`];
  const underProbability = probabilities[`OU_${totalLine}_Under`];

  const picks = [
    pick('moneyline', matchName, bestOutcome[0], bestOutcome[1], bestOutcome[2], bestOutcome[3], oddsFor(report, outcomeKey(bestOutcome[1], home, away)), reason, risks),
    homeCovers >= awayCovers
      ? pick('handicap', matchName, 'Asian Handicap', home, signed(handicapLine), homeCovers, handicap?.homeOdds, reason, risks)
      : pick('handicap', matchName, 'Asian Handicap', away, signed(-handicapLine), awayCovers, handicap?.awayOdds, reason, risks),
    overProbability >= underProbability
      ? pick('total', matchName, 'Goals Total', 'Over', String(totalLine), overProbability, totals?.overOdds, reason, risks)
      : pick('total', matchName, 'Goals Total', 'Under', String(totalLine), underProbability, totals?.underOdds, reason, risks)
  ].filter((entry) => Number.isFinite(entry.estimatedProbability));

  const scorePicks = (probabilities.Top_Scores || []).slice(0, SCORE_PICK_COUNT).map((entry, index) => ({
    marketId: `expert-score-${entry.score}`,
    market: { id: `expert-score-${entry.score}`, matchName, marketType: 'Correct Score', selection: entry.score, line: 'Correct Score', odds: null },
    score: entry.score,
    scoreType: index === 0 ? 'mainline' : 'alternative',
    estimatedProbability: entry.prob,
    confidence: entry.prob,
    reason,
    risks
  }));

  const bttsYes = probabilities.BTTS_Yes;
  const bttsNo = probabilities.BTTS_No;
  const bttsPick = Number.isFinite(bttsYes)
    ? {
      selection: bttsYes >= bttsNo ? 'Yes' : 'No',
      estimatedProbability: Math.max(bttsYes, bttsNo),
      confidence: Math.max(bttsYes, bttsNo),
      reason,
      risks
    }
    : null;

  return {
    modelName: 'FutBots Expert Pipeline',
    modelId: 'futbots-expert-pipeline',
    provider: 'FutBots',
    generatedAt: new Date().toISOString(),
    usage: totalUsage(report.usage),
    picks,
    scorePicks,
    bttsPick,
    decision: report.decision,
    expectedGoals: report.expected_goals,
    marketComparison: report.market_comparison,
    auditTrail: report.audit_trail
  };
}

function pick(kind, matchName, marketType, selection, line, probability, odds, reason, risks) {
  const id = `expert-${kind}-${String(selection).toLowerCase().replace(/\s+/g, '-')}`;
  return {
    marketId: id,
    market: { id, matchName, marketType, selection, line, odds: Number.isFinite(Number(odds)) ? Number(odds) : null },
    estimatedProbability: Number(probability),
    confidence: Number(probability),
    reason,
    risks
  };
}

function outcomeKey(selection, home, away) {
  if (selection === home) return '1X2_Win';
  if (selection === away) return '1X2_Loss';
  return '1X2_Draw';
}

function oddsFor(report, key) {
  return report?.market_comparison?.[key]?.stake_odds ?? null;
}

function signed(line) {
  const rounded = Math.round(Number(line) * 100) / 100;
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

// The market's own total line, chosen the same way as the handicap: the one most books
// quote, then the one whose two prices sit closest together.
export function mainTotalLine(rows = []) {
  const byLine = new Map();
  for (const row of rows) {
    const line = Number(String(row?.line || '').split('/')[0]);
    const over = Number(row?.home);
    const under = Number(row?.away);
    if (!Number.isFinite(line) || !(over > 0) || !(under > 0)) continue;
    const bucket = byLine.get(line) || { line, books: 0, spread: 0, over: 0, under: 0 };
    bucket.books += 1;
    bucket.spread += Math.abs(over - under);
    bucket.over += over;
    bucket.under += under;
    byLine.set(line, bucket);
  }
  if (!byLine.size) return null;
  const best = [...byLine.values()]
    .map((bucket) => ({ ...bucket, spread: bucket.spread / bucket.books }))
    .sort((left, right) => right.books - left.books || left.spread - right.spread)[0];
  return {
    line: best.line,
    overOdds: Math.round((best.over / best.books) * 100) / 100,
    underOdds: Math.round((best.under / best.books) * 100) / 100,
    books: best.books
  };
}

function marketOddsFor(context, handicap, totals, handicapLine, totalLine) {
  const odds = {};
  const euro = averageEuro(context?.index?.live?.euro || []);
  if (euro) {
    odds['1X2_Win'] = euro.home;
    odds['1X2_Draw'] = euro.draw;
    odds['1X2_Loss'] = euro.away;
  }
  if (handicap) {
    odds[`AH_${handicapLine}_Home`] = handicap.homeOdds;
    odds[`AH_${handicapLine}_Away`] = handicap.awayOdds;
  }
  if (totals) {
    odds[`OU_${totalLine}_Over`] = totals.overOdds;
    odds[`OU_${totalLine}_Under`] = totals.underOdds;
  }
  return odds;
}

function averageEuro(rows = []) {
  const priced = rows
    .map((row) => [Number(row?.home), Number(row?.line), Number(row?.away)])
    .filter(([home, draw, away]) => home > 1 && draw > 1 && away > 1);
  if (!priced.length) return null;
  const mean = (index) => Math.round((priced.reduce((sum, row) => sum + row[index], 0) / priced.length) * 100) / 100;
  return { home: mean(0), draw: mean(1), away: mean(2) };
}

function totalUsage(usage = []) {
  const rows = usage.filter((entry) => entry?.usage);
  if (!rows.length) return null;
  const sum = (field) => rows.reduce((total, entry) => total + (Number(entry.usage[field]) || 0), 0);
  return {
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    totalTokens: sum('totalTokens'),
    costUsd: Math.round(sum('costUsd') * 1e6) / 1e6,
    costReported: rows.some((entry) => entry.usage.costReported)
  };
}
