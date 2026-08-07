import { predictWithExperts } from './expert-result.js';
import { predictionModelKey, predictionPhase } from './prediction-cache.js';
import { buildAnalytics } from './evaluation.js';
import { contextKey } from './context-utils.js';
import { buildPoissonBaseline } from './poisson.js';
import { buildMarketBaseline, compareToBaseline } from './market-odds.js';

// Bump this whenever a change alters what a prediction would say. A published
// consensus records the version that produced it, and one from an older pipeline is
// not served as if it were current - it regenerates the next time somebody asks for
// that fixture, rather than every stored prediction being recomputed at once for
// fixtures nobody is looking at.
//
// "What a prediction would say" includes how much of it there is: the scoreline count
// changed and the version did not, so fixtures already answered kept serving three
// while new ones got four. Anything that changes the output belongs in this string.
export const PREDICTION_PIPELINE_VERSION = '2026-08-06.expert-pipeline.4-scores';

export async function resolveOptimizedPrediction({
  fixtureId,
  contextName = '',
  markets = [],
  env = process.env,
  fetchImpl = fetch,
  storage,
  predictFn = predictWithExperts,
  matchContext = null,
  now = Date.now(),
  waitIntervalMs = 250,
  waitAttempts = 80
}) {
  const phase = predictionPhase(matchContext, now);
  const current = await storage.readCurrentPredictionConsensus(fixtureId);
  if (current?.phase === phase && current.ranking && current.ranking.pipelineVersion === PREDICTION_PIPELINE_VERSION) {
    return {
      cacheHit: true,
      freshResults: [],
      ranking: current.ranking,
      phase,
      source: 'consensus'
    };
  }

  const leaseId = crypto.randomUUID();
  const usesLease = typeof storage.reservePredictionGeneration === 'function'
    && typeof storage.releasePredictionGeneration === 'function';
  if (usesLease) {
    const lease = await storage.reservePredictionGeneration({
      fixtureId: String(fixtureId),
      phase,
      leaseId
    });
    if (!lease?.acquired) {
      const shared = await waitForConsensus({
        storage,
        fixtureId,
        phase,
        waitIntervalMs,
        waitAttempts
      });
      if (!shared) throw new Error('Prediction generation is already in progress');
      return {
        cacheHit: true,
        freshResults: [],
        ranking: shared.ranking,
        phase,
        source: 'consensus'
      };
    }
  }

  const poissonBaseline = buildPoissonBaseline(matchContext);
  const marketBaseline = buildMarketBaseline(matchContext);

  try {
    // One pipeline rather than a pool of models: the experts are specialists inside it
    // and no model names a market, so there is nothing here to pick a winner between.
    // The phase still matters for caching - an early answer is regenerated once the
    // lineups land, which is when the tactical expert has something to read.
    const expert = await predictFn({
      fixtureId,
      matchName: contextName,
      context: matchContext || {},
      env,
      fetchImpl
    });
    const result = { ...expert, predictionPhase: phase, generatedAt: new Date(now).toISOString() };

    const snapshots = [{
      id: crypto.randomUUID(),
      fixtureId: String(fixtureId),
      phase,
      modelKey: predictionModelKey(result.modelId || result.modelName),
      modelId: result.modelId || null,
      result,
      generatedAt: result.generatedAt
    }];
    await storage.appendPredictionSnapshots(snapshots);

    if (!result.picks?.length && !result.scorePicks?.length) {
      const reasons = result.auditTrail?.failed_experts || [];
      console.error(JSON.stringify({
        event: 'prediction_pipeline_empty',
        fixtureId: String(fixtureId),
        phase,
        reasons
      }));
      throw new Error(`No prediction model returned a valid result (${reasons.join('; ') || 'pipeline produced no markets'})`);
    }

    const publicResult = result;
    const ranking = {
      id: crypto.randomUUID(),
      results: [publicResult],
      // The document's own report, carried whole so the console and any later screen
      // can show expected value, the risk verdict and who said what.
      expertReport: expert.report || null,
      marketCount: markets.length,
      contextId: String(fixtureId),
      contextName,
      // Stored alongside the published consensus so post-match reviews can score the
      // models against both references they were given.
      statisticalBaseline: poissonBaseline,
      marketBaseline,
      marketComparison: compareToBaseline(marketBaseline, poissonBaseline),
      createdAt: new Date(now).toISOString(),
      predictionPhase: phase,
      pipelineVersion: PREDICTION_PIPELINE_VERSION,
      disclaimer: 'AI predictions are probabilistic and are not financial advice.'
    };
    await storage.publishPredictionConsensus({
      id: crypto.randomUUID(),
      fixtureId: String(fixtureId),
      phase,
      ranking,
      sourceSnapshotIds: snapshots.filter((snapshot) => !snapshot.result.error).map((snapshot) => snapshot.id),
      generatedAt: ranking.createdAt
    });

    return {
      cacheHit: false,
      freshResults: [result],
      ranking,
      phase,
      source: 'expert-pipeline'
    };
  } finally {
    if (usesLease) await storage.releasePredictionGeneration(leaseId);
  }
}

export function buildWeightedConsensus(results = [], modelWeights = {}) {
  const valid = results.filter((result) => result && !result.error);
  const weightedResults = valid.map((result) => ({
    result,
    modelKey: predictionModelKey(result.modelName || result.modelId),
    weight: positiveWeight(modelWeights[predictionModelKey(result.modelName || result.modelId)])
  }));
  const totalWeight = weightedResults.reduce((sum, item) => sum + item.weight, 0) || 1;

  const picks = aggregateSelections(weightedResults, totalWeight, (result) => result.picks || [], (pick) => {
    const market = pick.market || {};
    return String(pick.marketId || market.id || `${market.marketType}|${market.selection}|${market.line}`);
  }).slice(0, 4);
  const scorePicks = aggregateSelections(weightedResults, totalWeight, (result) => result.scorePicks || [], (pick) => {
    return normalizeScore(pick.score || pick.market?.selection);
  }).filter((pick) => pick.score).slice(0, 4);
  const bttsCandidates = aggregateSelections(weightedResults, totalWeight, (result) => result.bttsPick ? [result.bttsPick] : [], (pick) => {
    return String(pick.selection || pick.market?.selection || '').toLowerCase();
  });

  return {
    modelName: 'FutBots Consensus',
    modelId: 'futbots-weighted-consensus',
    provider: 'FutBots',
    sourceModels: weightedResults.map(({ result, modelKey, weight }) => ({
      modelKey,
      modelName: result.modelName,
      weight
    })),
    picks,
    scorePicks,
    bttsPick: bttsCandidates[0] || null,
    generatedAt: new Date().toISOString()
  };
}

export function settleWeeklyModelPerformance(evaluations = [], {
  weekStart,
  minimumSamples = 20
} = {}) {
  const groups = new Map();
  for (const evaluation of evaluations) {
    if (!evaluation?.counted || !evaluation.modelName) continue;
    const modelKey = predictionModelKey(evaluation.modelName);
    if (modelKey === 'futbots consensus') continue;
    const row = groups.get(modelKey) || {
      weekStart,
      modelKey,
      modelName: evaluation.modelName,
      samples: 0,
      hits: 0,
      accuracy: 0,
      categories: {}
    };
    row.samples += 1;
    if (evaluation.hit) row.hits += 1;
    const category = evaluation.category || 'other';
    const categoryRow = row.categories[category] || { samples: 0, hits: 0, accuracy: 0 };
    categoryRow.samples += 1;
    if (evaluation.hit) categoryRow.hits += 1;
    categoryRow.accuracy = categoryRow.samples ? categoryRow.hits / categoryRow.samples : 0;
    row.categories[category] = categoryRow;
    row.accuracy = row.samples ? row.hits / row.samples : 0;
    groups.set(modelKey, row);
  }
  // How each model scored, and nothing more. Crowning one of them meant something
  // when a champion ran the next week's predictions; one pipeline answers every
  // fixture now, so a crown would only suggest a choice that is not being made.
  const rows = [...groups.values()].map((row) => ({
    ...row,
    eligible: row.samples >= minimumSamples
  })).sort((a, b) => (
    // Rows with enough samples first: two from two is 100% and means nothing, and
    // sorting on accuracy alone puts it above a model that answered twenty times.
    Number(b.eligible) - Number(a.eligible)
    || b.accuracy - a.accuracy
    || b.samples - a.samples
    || a.modelKey.localeCompare(b.modelKey)
  ));
  return { weekStart, minimumSamples, rows };
}

export function buildWeeklySettlementFromSnapshots({
  snapshots = [],
  contexts = [],
  weekStart,
  weekEnd,
  minimumSamples = 20
} = {}) {
  const contextPayloads = contexts.map((row) => row.payload || row);
  const eligibleContexts = contextPayloads.filter((context) => {
    const kickoff = String(context?.kickoff || context?.fixture?.date || '');
    return kickoff >= weekStart && kickoff < weekEnd;
  });
  const contextIds = new Set(eligibleContexts.map((context) => String(contextKey(context))).filter(Boolean));
  const selected = new Map();
  for (const row of snapshots) {
    const fixtureId = String(row.fixture_id || row.fixtureId || '');
    const result = row.payload || row.result;
    if (!fixtureId || !result || !contextIds.has(fixtureId)) continue;
    const modelKey = predictionModelKey(row.model_key || row.modelKey || result.modelName || result.modelId);
    const key = `${fixtureId}|${modelKey}`;
    const candidate = {
      fixtureId,
      modelKey,
      phase: row.phase || result.predictionPhase || 'early',
      generatedAt: row.generated_at || row.generatedAt || result.generatedAt || '',
      result
    };
    const current = selected.get(key);
    if (!current
      || phasePriority(candidate.phase) > phasePriority(current.phase)
      || (candidate.phase === current.phase && Date.parse(candidate.generatedAt) > Date.parse(current.generatedAt))) {
      selected.set(key, candidate);
    }
  }
  const rankings = [...selected.values()].map((row) => ({
    id: `snapshot:${row.fixtureId}:${row.modelKey}:${row.phase}`,
    contextId: row.fixtureId,
    createdAt: row.generatedAt,
    results: [row.result]
  }));
  const analytics = buildAnalytics({ rankings, contexts: eligibleContexts });
  return {
    ...settleWeeklyModelPerformance(analytics.evaluations, { weekStart, minimumSamples }),
    evaluations: analytics.evaluations
  };
}

function aggregateSelections(weightedResults, totalWeight, listFn, keyFn) {
  const groups = new Map();
  for (const { result, weight } of weightedResults) {
    for (const item of listFn(result)) {
      const key = keyFn(item);
      if (!key) continue;
      const row = groups.get(key) || {
        sample: item,
        weightedProbability: 0,
        weightedConfidence: 0,
        support: 0
      };
      row.weightedProbability += weight * bounded(item.estimatedProbability);
      row.weightedConfidence += weight * bounded(item.confidence);
      row.support += 1;
      groups.set(key, row);
    }
  }
  return [...groups.values()].map(({ sample, weightedProbability, weightedConfidence, support }) => ({
    ...sample,
    ...(sample.score || normalizeScore(sample.market?.selection)
      ? { score: normalizeScore(sample.score || sample.market?.selection) }
      : {}),
    estimatedProbability: weightedProbability / totalWeight,
    confidence: weightedConfidence / totalWeight,
    reason: `Weighted consensus supported by ${support} of ${weightedResults.length} models.`,
    risks: ['Model agreement does not remove lineup, market-movement, or match-variance risk.'],
    consensusSupport: support
  })).sort((a, b) => b.estimatedProbability - a.estimatedProbability || b.consensusSupport - a.consensusSupport);
}



function positiveWeight(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function bounded(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function normalizeScore(value) {
  const match = String(value || '').replace(/[：\-–—]/g, ':').match(/(\d+)\s*:\s*(\d+)/);
  return match ? `${Number(match[1])}:${Number(match[2])}` : '';
}

function phasePriority(phase) {
  return phase === 'live' ? 2 : 1;
}

async function waitForConsensus({
  storage,
  fixtureId,
  phase,
  waitIntervalMs,
  waitAttempts
}) {
  for (let attempt = 0; attempt < waitAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, waitIntervalMs));
    const current = await storage.readCurrentPredictionConsensus(fixtureId);
    if (current?.phase === phase && current.ranking) return current;
  }
  return null;
}
