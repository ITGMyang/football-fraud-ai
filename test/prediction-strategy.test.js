import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWeightedConsensus,
  buildWeeklySettlementFromSnapshots,
  resolveOptimizedPrediction,
  settleWeeklyModelPerformance
} from '../src/prediction-strategy.js';

test('early prediction calls only the weekly champion and then reuses the public result', async () => {
  const storage = memoryStorage({
    settings: {
      championModelKey: 'claude',
      liveModelKeys: ['gpt', 'claude', 'gemini'],
      modelWeights: { gpt: 1, claude: 1.2, gemini: 1 }
    }
  });
  const calls = [];
  const rankFn = async (_markets, model) => {
    calls.push(model);
    return ranking([modelResult(model, 'home')]);
  };
  const input = {
    fixtureId: 'fixture-early',
    contextName: 'Alpha v Beta',
    markets: [],
    matchContext: { kickoff: '2026-07-25T12:00:00Z', lineup: { players: [] } },
    now: Date.parse('2026-07-25T08:00:00Z'),
    storage,
    rankFn
  };

  const first = await resolveOptimizedPrediction(input);
  const second = await resolveOptimizedPrediction(input);

  assert.deepEqual(calls, ['Claude']);
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(first.ranking.results.length, 1);
  assert.equal(first.ranking.results[0].predictionPhase, 'early');
  assert.equal(storage.snapshots.length, 1);
  assert.equal(storage.consensus.length, 1);
});

test('live prediction runs three configured models concurrently and publishes one consensus', async () => {
  const storage = memoryStorage({
    settings: {
      championModelKey: 'qwen',
      liveModelKeys: ['gpt', 'claude', 'gemini'],
      modelWeights: { gpt: 1, claude: 1.25, gemini: 0.8 }
    }
  });
  let active = 0;
  let maximumActive = 0;
  const rankFn = async (_markets, model) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return ranking([modelResult(model, model === 'Gemini' ? 'draw' : 'home')]);
  };

  const result = await resolveOptimizedPrediction({
    fixtureId: 'fixture-live',
    contextName: 'Alpha v Beta',
    markets: [],
    matchContext: {
      kickoff: '2026-07-25T12:00:00Z',
      lineup: { players: [{ id: 1 }] }
    },
    now: Date.parse('2026-07-25T11:15:00Z'),
    storage,
    rankFn
  });

  assert.equal(maximumActive, 3);
  assert.equal(storage.snapshots.length, 3);
  assert.equal(result.ranking.results.length, 1);
  assert.equal(result.ranking.results[0].modelName, 'FutBots Consensus');
  assert.equal(result.ranking.results[0].predictionPhase, 'live');
  assert.equal(result.ranking.results[0].picks[0].market.selection, 'Alpha');
});

test('live prediction retains failed model snapshots and builds consensus from successful models', async () => {
  const storage = memoryStorage({
    settings: {
      championModelKey: 'qwen',
      liveModelKeys: ['gpt', 'claude', 'gemini'],
      modelWeights: {}
    }
  });
  const result = await resolveOptimizedPrediction({
    fixtureId: 'fixture-partial-live',
    markets: [],
    matchContext: {
      kickoff: '2026-07-25T12:00:00Z',
      lineup: { players: [{ id: 1 }] }
    },
    now: Date.parse('2026-07-25T11:15:00Z'),
    storage,
    rankFn: async (_markets, model) => {
      if (model === 'Claude') throw new Error('provider timeout');
      if (model === 'Gemini') return ranking([{ modelName: model, modelId: 'gemini', error: 'invalid JSON' }]);
      return ranking([modelResult(model, 'home')]);
    }
  });

  assert.equal(storage.snapshots.length, 3);
  assert.equal(storage.snapshots.filter((row) => row.result.error).length, 2);
  assert.equal(storage.consensus[0].sourceSnapshotIds.length, 1);
  assert.equal(result.ranking.results[0].sourceModels.length, 1);
});

test('two simultaneous users share one fixture generation lease', async () => {
  const storage = memoryStorage({
    settings: {
      championModelKey: 'claude',
      liveModelKeys: ['gpt', 'claude', 'gemini'],
      modelWeights: {}
    }
  });
  let calls = 0;
  const input = {
    fixtureId: 'fixture-race',
    contextName: 'Alpha v Beta',
    markets: [],
    matchContext: { kickoff: '2026-07-25T12:00:00Z', lineup: { players: [] } },
    now: Date.parse('2026-07-25T08:00:00Z'),
    storage,
    waitIntervalMs: 2,
    waitAttempts: 30,
    rankFn: async (_markets, model) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 12));
      return ranking([modelResult(model, 'home')]);
    }
  };

  const [first, second] = await Promise.all([
    resolveOptimizedPrediction(input),
    resolveOptimizedPrediction(input)
  ]);

  assert.equal(calls, 1);
  assert.equal([first.cacheHit, second.cacheHit].filter(Boolean).length, 1);
  assert.deepEqual(first.ranking.results, second.ranking.results);
});

test('weighted consensus rewards agreement and keeps four unique score predictions', () => {
  const consensus = buildWeightedConsensus([
    modelResult('GPT', 'home', ['2:0', '2:1', '1:0', '1:1']),
    modelResult('Claude', 'home', ['2:0', '1:0', '2:1', '3:1']),
    modelResult('Gemini', 'draw', ['1:1', '0:0', '2:2', '1:0'])
  ], { gpt: 1, claude: 1.5, gemini: 0.5 });

  assert.equal(consensus.picks[0].market.selection, 'Alpha');
  assert.equal(consensus.scorePicks.length, 4);
  assert.equal(new Set(consensus.scorePicks.map((pick) => pick.score)).size, 4);
  assert.match(consensus.picks[0].reason, /weighted consensus/i);
});

test('weekly settlement selects the best eligible model and ignores tiny samples', () => {
  const evaluations = [
    ...evaluationRows('Claude', 20, 15),
    ...evaluationRows('GPT', 20, 12),
    ...evaluationRows('Gemini', 2, 2)
  ];

  const result = settleWeeklyModelPerformance(evaluations, {
    weekStart: '2026-07-20',
    minimumSamples: 20
  });

  assert.equal(result.championModelKey, 'claude');
  assert.equal(result.rows.find((row) => row.modelKey === 'gemini').eligible, false);
  assert.equal(result.rows.find((row) => row.modelKey === 'claude').accuracy, 0.75);
});

test('weekly settlement evaluates immutable model snapshots instead of public consensus rows', () => {
  const snapshots = [{
    fixture_id: 'weekly-1',
    phase: 'live',
    model_key: 'claude',
    payload: modelResult('Claude', 'home'),
    generated_at: '2026-07-22T10:00:00Z'
  }];
  const contexts = [{
    payload: {
      matchId: 'weekly-1',
      matchName: 'Alpha v Beta',
      kickoff: '2026-07-22T12:00:00Z',
      actualScore: '2:0'
    }
  }];

  const result = buildWeeklySettlementFromSnapshots({
    snapshots,
    contexts,
    weekStart: '2026-07-20',
    weekEnd: '2026-07-27',
    minimumSamples: 1
  });

  assert.equal(result.championModelKey, 'claude');
  assert.ok(result.rows[0].samples >= 2);
});

test('Cloudflare prediction route uses the optimized shared architecture', async () => {
  const worker = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../worker/index.js', import.meta.url), 'utf8'));
  assert.match(worker, /resolveOptimizedPrediction/);
});

test('local prediction route uses the same optimized shared architecture', async () => {
  const server = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/server.js', import.meta.url), 'utf8'));
  assert.match(server, /resolveOptimizedPrediction/);
});

function memoryStorage({ settings }) {
  const snapshots = [];
  const consensus = [];
  let lease = null;
  return {
    snapshots,
    consensus,
    async readPredictionSettings() {
      return settings;
    },
    async readCurrentPredictionConsensus(fixtureId) {
      return [...consensus].reverse().find((row) => row.fixtureId === fixtureId && row.isCurrent) || null;
    },
    async appendPredictionSnapshots(rows) {
      snapshots.push(...rows);
      return rows;
    },
    async publishPredictionConsensus(row) {
      for (const item of consensus) {
        if (item.fixtureId === row.fixtureId) item.isCurrent = false;
      }
      const saved = { ...row, isCurrent: true };
      consensus.push(saved);
      return saved;
    },
    async reservePredictionGeneration({ fixtureId, phase, leaseId }) {
      if (lease) return { acquired: false };
      lease = { fixtureId, phase, leaseId };
      return { acquired: true, leaseId };
    },
    async releasePredictionGeneration(leaseId) {
      if (lease?.leaseId === leaseId) lease = null;
    }
  };
}

function ranking(results) {
  return {
    id: crypto.randomUUID(),
    results,
    marketCount: 1,
    createdAt: new Date().toISOString(),
    disclaimer: 'test'
  };
}

function modelResult(model, side, scores = ['2:0', '2:1', '1:0', '1:1']) {
  const home = side === 'home';
  const draw = side === 'draw';
  return {
    modelName: model,
    modelId: model.toLowerCase(),
    picks: [{
      marketId: side,
      market: {
        id: side,
        matchName: 'Alpha v Beta',
        marketType: 'Moneyline',
        selection: home ? 'Alpha' : draw ? 'Draw' : 'Beta'
      },
      estimatedProbability: home ? 0.7 : draw ? 0.58 : 0.62,
      confidence: 0.65,
      reason: `${model} analysis`,
      risks: []
    }],
    scorePicks: scores.map((score, index) => ({
      score,
      estimatedProbability: 0.2 - index * 0.02,
      confidence: 0.5,
      reason: `${model} score`
    })),
    bttsPick: {
      selection: 'Yes',
      estimatedProbability: 0.61,
      confidence: 0.55,
      reason: `${model} BTTS`,
      risks: []
    }
  };
}

function evaluationRows(modelName, total, hits) {
  return Array.from({ length: total }, (_, index) => ({
    modelName,
    category: index % 2 ? 'total' : 'moneyline',
    counted: true,
    hit: index < hits
  }));
}

test('every configured model can be named by a settings row', async () => {
  const { readFile } = await import('node:fs/promises');
  const [openrouter, strategy] = await Promise.all([
    readFile(new URL('../src/openrouter.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/prediction-strategy.js', import.meta.url), 'utf8')
  ]);

  // A key that configuredModels can produce but the alias table does not know would
  // resolve to the raw key, and the model call would fail with "model not found".
  const keys = [...openrouter.matchAll(/env\.MODEL_([A-Z]+)\b/g)].map((match) => match[1].toLowerCase());
  for (const key of new Set(keys)) {
    assert.match(strategy, new RegExp(`\\n  ${key}: '`), `${key} is missing from DEFAULT_ALIASES`);
  }
});
