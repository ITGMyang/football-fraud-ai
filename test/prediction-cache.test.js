import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSharedRanking } from '../src/prediction-cache.js';

test('a second account reuses the first successful prediction without another model call', async () => {
  const cache = new Map();
  let modelCalls = 0;
  const storage = cacheStorage(cache);
  const rankFn = async (_markets, model) => {
    modelCalls += 1;
    return rankingFor(model, [{ modelName: 'Qwen 3.7 Max', modelId: 'qwen/qwen3.7-max', picks: [{ marketId: 'm1' }] }]);
  };
  const input = {
    fixtureId: '1591866',
    contextName: 'Spain v Argentina',
    markets: [{ id: 'm1' }],
    requestedModel: 'Qwen',
    env: { MODEL_QWEN: 'qwen/qwen3.7-max', MODEL_QWEN_LABEL: 'Qwen 3.7 Max' },
    fetchImpl: async () => {},
    storage,
    rankFn
  };

  const first = await resolveSharedRanking(input);
  const second = await resolveSharedRanking(input);

  assert.equal(modelCalls, 1);
  assert.equal(first.cacheHit, false);
  assert.equal(first.freshResults.length, 1);
  assert.equal(second.cacheHit, true);
  assert.equal(second.freshResults.length, 0);
  assert.deepEqual(second.ranking.results, first.ranking.results);
});

test('an all-model request only calls models missing from the shared cache', async () => {
  const cache = new Map([
    ['gpt', { modelName: 'GPT 5.5', modelId: 'gpt-5.5', picks: [{ marketId: 'gpt-pick' }] }]
  ]);
  const requestedModels = [];
  const storage = cacheStorage(cache);
  const rankFn = async (_markets, model) => {
    requestedModels.push(model);
    return rankingFor(model, [{ modelName: 'Qwen 3.7 Max', modelId: 'qwen/qwen3.7-max', picks: [{ marketId: 'qwen-pick' }] }]);
  };

  const result = await resolveSharedRanking({
    fixtureId: '1591866',
    contextName: 'Spain v Argentina',
    markets: [],
    requestedModel: 'all',
    env: {
      MODEL_GPT: 'gpt-5.5', MODEL_GPT_LABEL: 'GPT 5.5',
      MODEL_QWEN: 'qwen/qwen3.7-max', MODEL_QWEN_LABEL: 'Qwen 3.7 Max'
    },
    fetchImpl: async () => {},
    storage,
    rankFn
  });

  assert.deepEqual(requestedModels, ['Qwen']);
  assert.deepEqual(result.ranking.results.map((item) => item.modelName), ['GPT 5.5', 'Qwen 3.7 Max']);
  assert.equal(result.freshResults.length, 1);
});

function cacheStorage(cache) {
  return {
    async readSharedPredictionResults() {
      return [...cache.entries()].map(([modelKey, result]) => ({ modelKey, result }));
    },
    async saveSharedPredictionResults(_fixtureId, results) {
      for (const result of results) {
        const name = String(result.modelName || '').toLowerCase();
        const key = name.includes('gpt') ? 'gpt' : name.includes('qwen') ? 'qwen' : name;
        cache.set(key, result);
      }
    }
  };
}

function rankingFor(model, results) {
  return {
    id: `ranking-${model}`,
    results,
    marketCount: 1,
    createdAt: '2026-07-21T14:00:00.000Z',
    disclaimer: 'test'
  };
}
