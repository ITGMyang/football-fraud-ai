import test from 'node:test';
import assert from 'node:assert/strict';

import {
  predictionDailyLimit,
  validatePredictionFixture,
  visibleScheduleWindow
} from '../src/prediction-policy.js';

test('paid plans use the agreed daily request limits while developers stay unlimited', () => {
  assert.equal(predictionDailyLimit('day'), 20);
  assert.equal(predictionDailyLimit('week'), 20);
  assert.equal(predictionDailyLimit('month'), 30);
  assert.equal(predictionDailyLimit('developer'), null);
});

test('all public match data is limited to the next 72 hours', () => {
  const now = Date.parse('2026-07-22T00:00:00Z');
  assert.deepEqual(visibleScheduleWindow(now), {
    startsAt: '2026-07-22T00:00:00.000Z',
    endsAt: '2026-07-25T00:00:00.000Z'
  });
  assert.equal(validatePredictionFixture({ kickoff: '2026-07-24T23:59:59Z' }, { planId: 'month', validUntil: '2026-08-21T00:00:00Z' }, now).ok, true);
  assert.equal(validatePredictionFixture({ kickoff: '2026-07-25T00:00:01Z' }, { planId: 'month', validUntil: '2026-08-21T00:00:00Z' }, now).code, 'MATCH_OUTSIDE_DATA_WINDOW');
});

test('a 24-hour pass cannot predict a match after the pass expires', () => {
  const now = Date.parse('2026-07-22T00:00:00Z');
  const entitlement = { planId: 'day', validUntil: '2026-07-23T00:00:00Z' };
  assert.equal(validatePredictionFixture({ kickoff: '2026-07-22T23:00:00Z' }, entitlement, now).ok, true);
  assert.equal(validatePredictionFixture({ kickoff: '2026-07-23T01:00:00Z' }, entitlement, now).code, 'MATCH_AFTER_PASS_EXPIRY');
});
