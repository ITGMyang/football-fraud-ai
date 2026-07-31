import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarket, impliedProbability } from '../src/domain.js';

test('calculates Hong Kong odds implied probability', () => {
  assert.equal(Number(impliedProbability(0.75).toFixed(4)), 0.5714);
});

test('builds a market with its implied probability and split teams', () => {
  const market = buildMarket({
    matchName: '南非 v 韩国',
    marketType: '足球 让球',
    selection: '韩国',
    line: '-0.5 / 1',
    odds: 0.75
  });

  assert.deepEqual(market.teams, ['南非', '韩国']);
  assert.equal(Number(market.impliedProbability.toFixed(4)), 0.5714);
});
