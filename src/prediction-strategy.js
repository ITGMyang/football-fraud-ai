import { configuredModels } from './openrouter.js';
import { predictionModelKey, predictionPhase } from './prediction-cache.js';
import { buildAnalytics } from './evaluation.js';
import { contextKey } from './context-utils.js';
import { buildPoissonBaseline } from './poisson.js';
import { buildMarketBaseline, compareToBaseline } from './market-odds.js';

const DEFAULT_SETTINGS = Object.freeze({
  championModelKey: 'qwen',
  liveModelKeys: ['gpt', 'claude', 'gemini'],
  modelWeights: {}
});

const DEFAULT_ALIASES = Object.freeze({
  gpt: 'GPT',
  claude: 'Claude',
  gemini: 'Gemini',
  qwen: 'Qwen'
});

export async function resolveOptimizedPrediction({
  fixtureId,
  contextName = '',
  markets = [],
  env = process.env,
  fetchImpl = fetch,
  storage,
  rankFn,
  matchContext = null,
  now = Date.now(),
  waitIntervalMs = 250,
  waitAttempts = 80
}) {
  const phase = predictionPhase(matchContext, now);
  const current = await storage.readCurrentPredictionConsensus(fixtureId);
  if (current?.phase === phase && current.ranking) {
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
    const settings = normalizeSettings(await storage.readPredictionSettings?.());
    const modelKeys = phase === 'live'
      ? settings.liveModelKeys.slice(0, 3)
      : [settings.championModelKey];
    const aliases = configuredModelAliases(env);
    const generated = await Promise.all(modelKeys.map(async (modelKey) => {
      const modelName = aliases.get(modelKey) || DEFAULT_ALIASES[modelKey] || modelKey;
      try {
        const ranking = await rankFn(markets, modelName, env, fetchImpl, matchContext);
        const result = (ranking.results || []).find((item) => !item.error) || ranking.results?.[0];
        return result
          ? { ...result, predictionPhase: phase }
          : { modelName, modelId: modelKey, error: 'Model returned no result', predictionPhase: phase };
      } catch (error) {
        return {
          modelName,
          modelId: modelKey,
          error: error instanceof Error ? error.message : String(error),
          predictionPhase: phase,
          generatedAt: new Date(now).toISOString()
        };
      }
    }));
    const snapshots = generated.filter(Boolean).map((result) => ({
      id: crypto.randomUUID(),
      fixtureId: String(fixtureId),
      phase,
      modelKey: predictionModelKey(result.modelName || result.modelId),
      modelId: result.modelId || null,
      result,
      generatedAt: result.generatedAt || new Date(now).toISOString()
    }));
    await storage.appendPredictionSnapshots(snapshots);
    const successfulResults = generated.filter((result) => result && !result.error);
    if (!successfulResults.length) throw new Error('No prediction model returned a valid result');

    const publicResult = phase === 'live'
      ? { ...buildWeightedConsensus(successfulResults, settings.modelWeights), predictionPhase: phase }
      : successfulResults[0];
    const ranking = {
      id: crypto.randomUUID(),
      results: [publicResult],
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
      freshResults: successfulResults,
      ranking,
      phase,
      source: phase === 'live' ? 'weighted-consensus' : 'weekly-champion'
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
  const rows = [...groups.values()].map((row) => ({
    ...row,
    eligible: row.samples >= minimumSamples,
    isChampion: false
  })).sort((a, b) => b.accuracy - a.accuracy || b.samples - a.samples || a.modelKey.localeCompare(b.modelKey));
  const champion = rows.find((row) => row.eligible) || null;
  if (champion) champion.isChampion = true;
  return { weekStart, minimumSamples, championModelKey: champion?.modelKey || '', rows };
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

function normalizeSettings(value = {}) {
  return {
    championModelKey: predictionModelKey(value?.championModelKey || DEFAULT_SETTINGS.championModelKey),
    liveModelKeys: [...new Set((value?.liveModelKeys || DEFAULT_SETTINGS.liveModelKeys).map(predictionModelKey))].filter(Boolean),
    modelWeights: value?.modelWeights && typeof value.modelWeights === 'object' ? value.modelWeights : {}
  };
}

function configuredModelAliases(env) {
  return new Map(configuredModels(env).map(([label,, alias]) => [predictionModelKey(label || alias), alias]));
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
