import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareToMarket,
  dixonColesMatrix,
  ENTROPY_LIMIT,
  expectedValue,
  fitGoalExpectations,
  kellyStake,
  marketProbabilities,
  marketPureProbabilities,
  riskDecision,
  shannonEntropy
} from '../src/quant-engine.js';

test('the matrix is a probability distribution and every market reads off it', () => {
  const matrix = dixonColesMatrix(1.78, 0.94);
  const total = matrix.flat().reduce((sum, cell) => sum + cell, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);

  const probabilities = marketProbabilities(matrix, { handicapLine: -0.5, totalLine: 2.5 });
  // Every market comes off one matrix, so no two of them can contradict each other -
  // which is the whole reason for asking the maths rather than asking a model.
  for (const [left, right] of [['1X2_Win', null], ['BTTS_Yes', 'BTTS_No'], ['OU_2.5_Over', 'OU_2.5_Under'], ['AH_-0.5_Home', 'AH_-0.5_Away']]) {
    if (!right) continue;
    assert.ok(Math.abs(probabilities[left] + probabilities[right] - 1) < 1e-3, `${left} + ${right}`);
  }
  const outcome = probabilities['1X2_Win'] + probabilities['1X2_Draw'] + probabilities['1X2_Loss'];
  assert.ok(Math.abs(outcome - 1) < 1e-3);
  // A half-goal handicap is the same question as winning the match.
  assert.equal(probabilities['AH_-0.5_Home'], probabilities['1X2_Win']);
  // The card shows four scorelines; three left a visible gap.
  assert.equal(probabilities.Top_Scores.length, 4);
  const ordered = probabilities.Top_Scores.map((entry) => entry.prob);
  assert.deepEqual(ordered, [...ordered].sort((left, right) => right - left));
});

test('expert opinion moves the goal expectations, discounted and clamped', () => {
  const fitted = fitGoalExpectations({
    baseHomeXg: 1.7,
    baseAwayXg: 1.0,
    tactical: { homeTacticalAdv: 0.08, awayTacticalAdv: -0.05 },
    intelligence: { homeOverallMotivation: 0.02, awayOverallMotivation: -0.03 },
    audit: { tacticalDiscount: 0.85, intelligenceDiscount: 0.7 }
  });
  assert.equal(fitted.deltaLambda, 0.082);
  assert.equal(fitted.deltaMu, -0.0635);

  // An expert that runs away with itself cannot move the match more than the clamp,
  // and a rate can never fall to zero.
  const runaway = fitGoalExpectations({
    baseHomeXg: 0.1,
    baseAwayXg: 2,
    tactical: { homeTacticalAdv: 5, awayTacticalAdv: -5 },
    audit: { tacticalDiscount: 1, intelligenceDiscount: 1 }
  });
  assert.equal(runaway.deltaLambda, 0.15);
  assert.equal(runaway.deltaMu, -0.15);
  assert.equal(runaway.lambdaHome, 0.25);

  // A missing audit trusts the experts rather than silently zeroing them.
  const unaudited = fitGoalExpectations({ baseHomeXg: 1.5, baseAwayXg: 1.1, tactical: { homeTacticalAdv: 0.1 } });
  assert.equal(unaudited.deltaLambda, 0.1);
});

test('margin removal turns quoted prices into what the market believes', () => {
  const pure = marketPureProbabilities({ '1X2_Win': 2.05, '1X2_Draw': 3.6, '1X2_Loss': 3.9 });
  const total = Object.values(pure).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 1e-3, 'the cut is removed, not redistributed unevenly');
  assert.ok(pure['1X2_Win'] < 1 / 2.05, 'every side loses its share of the cut');
});

test('value and stake are read against the price, not against another model', () => {
  assert.equal(expectedValue(0.55, 2.05), 0.1275);
  assert.equal(expectedValue(0.4, 2), -0.2);
  assert.equal(expectedValue(0.5, 0.9), null, 'a price below evens is not a price');

  // Quarter Kelly: the full fraction is famously too large to survive a bad run.
  assert.equal(kellyStake(0.55, 2.05), 0.0304);
  assert.equal(kellyStake(0.4, 2), 0, 'no edge, no stake');
});

test('each market is compared only against the sides that share its cut', () => {
  const comparison = compareToMarket(
    { '1X2_Win': 0.55, 'OU_2.5_Over': 0.51, Top_Scores: [] },
    { '1X2_Win': 2.05, '1X2_Draw': 3.6, '1X2_Loss': 3.9, 'OU_2.5_Over': 1.85, 'OU_2.5_Under': 2.01 }
  );
  // Removing the margin across unrelated markets would invent a divergence that is
  // really just the number of options quoted.
  assert.ok(comparison['1X2_Win'].market_pure_prob < 0.5);
  assert.ok(comparison['OU_2.5_Over'].market_pure_prob > 0.5);
  assert.equal(comparison.Top_Scores, undefined);
});

test('the risk gates fire in the order they are specified', () => {
  const matrix = dixonColesMatrix(1.78, 0.94);
  const probabilities = marketProbabilities(matrix);
  const comparison = compareToMarket(probabilities, { 'AH_-0.5_Home': 1.98, 'AH_-0.5_Away': 1.88 });

  // Entropy is checked first and, at the specified limit, is what a real match trips:
  // the 49-cell scoreline spread sits near 4.2 however certain the outcome is.
  assert.ok(shannonEntropy(matrix) > ENTROPY_LIMIT);
  const decided = riskDecision({ matrix, probabilities, comparison });
  assert.equal(decided.status, 'PASS');
  assert.match(decided.pass_reason, /香农熵/);

  // With the entropy gate satisfied, the later gates are reachable and do their job.
  const calm = { matrix: [[0.97, 0.01], [0.01, 0.01]], probabilities: { '1X2_Win': 0.2, '1X2_Draw': 0.4, '1X2_Loss': 0.4 } };
  assert.match(riskDecision({ ...calm, comparison }).pass_reason, /最高概率未达标/);

  const confident = { ...calm, probabilities: { '1X2_Win': 0.7, '1X2_Draw': 0.2, '1X2_Loss': 0.1 } };
  assert.match(
    riskDecision({ ...confident, comparison: { A: { quant_prob: 0.7, stake_odds: 1.2, ev: 0.01, divergence: 0.02 } } }).pass_reason,
    /EV 未达标/
  );
  assert.match(
    riskDecision({ ...confident, comparison: { A: { quant_prob: 0.7, stake_odds: 2.0, ev: 0.4, divergence: 0.35 } } }).pass_reason,
    /背离度过高/
  );

  const recommended = riskDecision({ ...confident, comparison: { A: { quant_prob: 0.7, stake_odds: 1.6, ev: 0.12, divergence: 0.05 } } });
  assert.equal(recommended.status, 'RECOMMEND');
  assert.equal(recommended.primary_recommendation, 'A');
  assert.ok(recommended.suggested_kelly_stake > 0);
});
