import { configuredModels, rankMarkets } from './openrouter.js';

export async function resolveSharedRanking({
  fixtureId,
  contextName = '',
  markets = [],
  requestedModel = 'all',
  env = process.env,
  fetchImpl = fetch,
  storage,
  rankFn = rankMarkets,
  matchContext = null,
  now = Date.now()
}) {
  const targets = selectedModels(requestedModel, env);
  const cachedRows = await storage.readSharedPredictionResults(fixtureId);
  const cachedByModel = new Map(cachedRows.map((row) => [row.modelKey, row.result]));
  const phase = predictionPhase(matchContext, now);
  const missing = targets.filter((target) => shouldRefreshCachedResult(cachedByModel.get(target.key), phase));
  const freshResults = [];
  let latestRanking = null;

  if (missing.length === targets.length && requestedModel === 'all') {
    latestRanking = await rankFn(markets, 'all', env, fetchImpl, matchContext);
    freshResults.push(...(latestRanking.results || []));
  } else {
    for (const target of missing) {
      const ranking = await rankFn(markets, target.alias, env, fetchImpl, matchContext);
      latestRanking = ranking;
      freshResults.push(...(ranking.results || []));
    }
  }

  const successfulResults = freshResults
    .filter((result) => !result.error)
    .map((result) => ({ ...result, predictionPhase: phase }));
  if (successfulResults.length) {
    await storage.saveSharedPredictionResults(fixtureId, successfulResults);
    for (const result of successfulResults) cachedByModel.set(predictionModelKey(result.modelName || result.modelId), result);
  }
  for (const result of freshResults.filter((item) => item.error)) {
    cachedByModel.set(predictionModelKey(result.modelName || result.modelId), result);
  }

  return {
    cacheHit: missing.length === 0,
    freshResults,
    ranking: {
      id: crypto.randomUUID(),
      results: targets.map((target) => cachedByModel.get(target.key)).filter(Boolean),
      marketCount: latestRanking?.marketCount ?? markets.length,
      contextId: String(fixtureId),
      contextName,
      createdAt: latestRanking?.createdAt || new Date().toISOString(),
      disclaimer: latestRanking?.disclaimer || 'AI predictions are probabilistic and are not financial advice.'
    }
  };
}

export function predictionPhase(context = {}, now = Date.now()) {
  const kickoff = Date.parse(context?.kickoff || context?.fixture?.date || '');
  const hasLineup = Array.isArray(context?.lineup?.players) && context.lineup.players.length > 0;
  return hasLineup && Number.isFinite(kickoff) && kickoff - now <= 60 * 60 * 1000 ? 'live' : 'early';
}

function shouldRefreshCachedResult(result, requestedPhase) {
  if (!result) return true;
  return requestedPhase === 'live' && result.predictionPhase !== 'live';
}

export function predictionModelKey(value = '') {
  const text = String(value || '').toLowerCase();
  if (text.includes('gpt') || text.includes('openai')) return 'gpt';
  if (text.includes('claude')) return 'claude';
  if (text.includes('gemini')) return 'gemini';
  if (text.includes('deepseek')) return 'deepseek';
  if (text.includes('qwen') || text.includes('通义')) return 'qwen';
  return text || 'ai';
}

function selectedModels(requestedModel, env) {
  const models = configuredModels(env).map(([label, model, alias]) => ({
    alias,
    key: predictionModelKey(label || model)
  }));
  if (requestedModel === 'all') return models;
  const requestedKey = predictionModelKey(requestedModel);
  const selected = models.filter((model) => model.key === requestedKey);
  if (!selected.length) throw new Error(`没有找到模型: ${requestedModel}`);
  return selected;
}
