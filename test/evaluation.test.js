import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalytics, shouldRefreshForAnalytics } from '../src/evaluation.js';

test('builds post-match analytics from finished contexts and rankings', () => {
  const contexts = [{
    matchId: 'm1',
    matchName: '巴拿马 v 英格兰',
    teams: ['巴拿马', '英格兰'],
    kickoff: '2026-06-27 21:00',
    actualScore: '0:2'
  }];
  const rankings = [{
    id: 'r1',
    contextId: 'm1',
    contextName: '巴拿马 v 英格兰',
    createdAt: '2026-06-27T10:00:00.000Z',
    results: [{
      modelName: 'GPT 5.5',
      picks: [
        { market: { matchName: '巴拿马 v 英格兰', marketType: '足球 胜平负', selection: '英格兰', line: '胜平负' }, estimatedProbability: 0.7 },
        { market: { matchName: '巴拿马 v 英格兰', marketType: '足球 大小球', selection: '小', line: '2.5' }, estimatedProbability: 0.6 },
        { market: { matchName: '巴拿马 v 英格兰', marketType: '足球 亚洲让分盘', selection: '英格兰', line: '-1' }, estimatedProbability: 0.55 }
      ],
      scorePicks: [
        { score: '0:2', estimatedProbability: 0.18 },
        { score: '0:1', estimatedProbability: 0.14 }
      ]
    }]
  }];

  const analytics = buildAnalytics({ rankings, contexts });

  assert.equal(analytics.matchCount, 1);
  assert.equal(analytics.evaluatedCount, 4);
  assert.equal(analytics.models[0].key, 'GPT 5.5');
  assert.equal(analytics.models[0].hits, 4);
  assert.equal(analytics.models[0].total, 4);
  assert.equal(analytics.categories.find((row) => row.key === 'score').hits, 1);
  assert.equal(analytics.categories.find((row) => row.key === 'score').total, 1);
  assert.equal(analytics.categories.find((row) => row.key === 'score').accuracy, 1);
  assert.equal(analytics.evaluations.find((row) => row.category === 'score').selection, '0:2 / 0:1');
});

test('counts four correct-score candidates as one match-level prediction', () => {
  const contexts = [
    {
      matchId: 'score-hit',
      matchName: 'Alpha v Beta',
      kickoff: '2026-07-22 20:00',
      actualScore: '2:1'
    },
    {
      matchId: 'score-miss',
      matchName: 'Gamma v Delta',
      kickoff: '2026-07-22 22:00',
      actualScore: '3:3'
    }
  ];
  const rankings = contexts.map((context, index) => ({
    id: `score-ranking-${index}`,
    contextId: context.matchId,
    createdAt: '2026-07-22T10:00:00.000Z',
    results: [{
      modelName: 'Qwen',
      picks: [],
      scorePicks: [
        { score: '1:0' },
        { score: '2:1' },
        { score: '1:1' },
        { score: '0:1' }
      ]
    }]
  }));

  const analytics = buildAnalytics({ rankings, contexts });
  const scoreSummary = analytics.categories.find((row) => row.key === 'score');

  assert.equal(analytics.evaluatedCount, 2);
  assert.equal(scoreSummary.hits, 1);
  assert.equal(scoreSummary.total, 2);
  assert.equal(scoreSummary.accuracy, 0.5);
  assert.equal(analytics.evaluations.filter((row) => row.category === 'score').length, 2);
});

test('ignores unfinished contexts without actual score', () => {
  const analytics = buildAnalytics({
    contexts: [{ matchId: 'm2', matchName: 'A v B' }],
    rankings: [{ id: 'r2', contextId: 'm2', results: [{ modelName: 'Qwen', picks: [], scorePicks: [] }] }]
  });

  assert.equal(analytics.evaluatedCount, 0);
  assert.equal(analytics.matchCount, 0);
});

test('marks likely finished contexts without scores for analytics refresh', () => {
  assert.equal(shouldRefreshForAnalytics({
    sourceUrl: 'https://www.dongqiudi.com/match/1',
    kickoff: '2026-06-20 12:00:00'
  }), true);
  assert.equal(shouldRefreshForAnalytics({
    sourceUrl: 'https://www.dongqiudi.com/match/2',
    status: 'Played',
    actualScore: '2:1'
  }), false);
});
