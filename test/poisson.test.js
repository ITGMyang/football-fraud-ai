import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPoissonBaseline, poissonPromptSummary } from '../src/poisson.js';

function context({ home = {}, away = {} } = {}) {
  return {
    fixture: { home: { name: 'Arsenal' }, away: { name: 'Chelsea' } },
    catalog: {
      teamStatistics: [
        {
          team: 'Arsenal',
          played: 20, playedHome: 10, playedAway: 10,
          goalsFor: 40, goalsForHome: 25, goalsForAway: 15,
          goalsAgainst: 20, goalsAgainstHome: 8, goalsAgainstAway: 12,
          ...home
        },
        {
          team: 'Chelsea',
          played: 20, playedHome: 10, playedAway: 10,
          goalsFor: 25, goalsForHome: 15, goalsForAway: 10,
          goalsAgainst: 30, goalsAgainstHome: 12, goalsAgainstAway: 18,
          ...away
        }
      ]
    }
  };
}

test('the baseline produces a normalised probability distribution', () => {
  const baseline = buildPoissonBaseline(context());

  assert.equal(baseline.available, true);
  assert.ok(baseline.lambdaHome > 0 && baseline.lambdaAway > 0);

  const { home, draw, away } = baseline.outcome;
  assert.ok(Math.abs(home + draw + away - 1) < 1e-6, 'outcome probabilities must sum to 1');

  for (const total of baseline.totals) {
    assert.ok(Math.abs(total.over + total.under - 1) < 1e-6, `total ${total.line} must sum to 1`);
  }
  assert.ok(Math.abs(baseline.btts.yes + baseline.btts.no - 1) < 1e-6);
});

test('the stronger attack at home carries the higher expected goals and win probability', () => {
  const baseline = buildPoissonBaseline(context());

  assert.ok(baseline.lambdaHome > baseline.lambdaAway);
  assert.ok(baseline.outcome.home > baseline.outcome.away);
  assert.equal(baseline.sample.venueSplit, true);
});

test('venue splits are preferred over season totals when both are present', () => {
  // Same season totals, but every goal scored away from home.
  const lopsided = buildPoissonBaseline(context({
    home: { goalsForHome: 5, goalsForAway: 35, goalsAgainstHome: 18, goalsAgainstAway: 2 }
  }));
  const balanced = buildPoissonBaseline(context());

  assert.ok(lopsided.lambdaHome < balanced.lambdaHome);
});

test('season totals with a home-advantage factor are used when the venue split is missing', () => {
  const baseline = buildPoissonBaseline(context({
    home: { playedHome: '', playedAway: '', goalsForHome: '', goalsForAway: '', goalsAgainstHome: '', goalsAgainstAway: '' },
    away: { playedHome: '', playedAway: '', goalsForHome: '', goalsForAway: '', goalsAgainstHome: '', goalsAgainstAway: '' }
  }));

  assert.equal(baseline.available, true);
  assert.equal(baseline.sample.venueSplit, false);
  assert.ok(baseline.lambdaHome > baseline.lambdaAway);
});

test('higher expected goals move the totals and both-teams-to-score markets up', () => {
  const low = buildPoissonBaseline(context({
    home: { goalsForHome: 6, goalsAgainstHome: 4 },
    away: { goalsForAway: 4, goalsAgainstAway: 6 }
  }));
  const high = buildPoissonBaseline(context({
    home: { goalsForHome: 30, goalsAgainstHome: 20 },
    away: { goalsForAway: 25, goalsAgainstAway: 25 }
  }));

  const overLine = (baseline) => baseline.totals.find((entry) => entry.line === 2.5).over;
  assert.ok(overLine(high) > overLine(low));
  assert.ok(high.btts.yes > low.btts.yes);
});

test('scorelines are ranked by probability and drawn from the same distribution', () => {
  const baseline = buildPoissonBaseline(context());
  const probabilities = baseline.scores.map((entry) => entry.probability);

  assert.equal(baseline.scores.length, 6);
  assert.deepEqual(probabilities, [...probabilities].sort((left, right) => right - left));
  for (const entry of baseline.scores) {
    assert.match(entry.score, /^\d+:\d+$/);
    assert.ok(entry.probability > 0 && entry.probability < 1);
  }
});

test('missing or too-thin goal records report why no baseline is available', () => {
  assert.equal(buildPoissonBaseline(null).available, false);
  assert.match(buildPoissonBaseline({}).reason, /team names/i);

  const noStats = buildPoissonBaseline({ fixture: { home: { name: 'A' }, away: { name: 'B' } }, catalog: {} });
  assert.equal(noStats.available, false);
  assert.match(noStats.reason, /goal records are missing/i);

  const thin = buildPoissonBaseline(context({
    home: { played: 2, playedHome: 1, playedAway: 1 },
    away: { played: 2, playedHome: 1, playedAway: 1 }
  }));
  assert.equal(thin.available, false);
  assert.match(thin.reason, /fewer than four/i);
});

test('team names are matched loosely so catalog spellings still resolve', () => {
  const baseline = buildPoissonBaseline({
    fixture: { home: { name: 'Arsenal' }, away: { name: 'Chelsea' } },
    catalog: {
      teamStatistics: [
        { team: 'Arsenal FC', played: 20, goalsFor: 40, goalsAgainst: 20 },
        { team: 'Chelsea FC', played: 20, goalsFor: 25, goalsAgainst: 30 }
      ]
    }
  });

  assert.equal(baseline.available, true);
});

test('the prompt summary stays compact and only ships when a baseline exists', () => {
  assert.equal(poissonPromptSummary({ available: false }), null);

  const summary = poissonPromptSummary(buildPoissonBaseline(context()));
  assert.equal(summary.likelyScores.length, 6);
  assert.match(summary.likelyScores[0], /^\d+:\d+ \d+(\.\d)?%$/);
  assert.equal(summary.totalsProbability.length, 5);
  assert.match(summary.note, /Statistical prior only/);
  assert.ok(JSON.stringify(summary).length < 900, 'summary must stay a rounding error next to the match context');
});

test('the low-score correction moves probability the way the record does', () => {
  const base = buildPoissonBaseline(context());
  const scoreOf = (baseline, score) => baseline.scores.find((entry) => entry.score === score)?.probability;

  // rho is negative, so 0-0 and 1-1 gain and the split low scores give way.
  assert.equal(base.rho < 0, true);
  assert.equal(base.method, 'poisson');

  // Compare against the same fixture priced with the correction switched off.
  const plain = buildPoissonBaseline(context(), { rho: 0 });
  for (const score of ['0:0', '1:1']) {
    const corrected = scoreOf(base, score);
    const independent = scoreOf(plain, score);
    if (corrected !== undefined && independent !== undefined) {
      assert.ok(corrected > independent, `${score} should gain: ${corrected} vs ${independent}`);
    }
  }
  for (const score of ['1:0', '0:1']) {
    const corrected = scoreOf(base, score);
    const independent = scoreOf(plain, score);
    if (corrected !== undefined && independent !== undefined) {
      assert.ok(corrected < independent, `${score} should give way: ${corrected} vs ${independent}`);
    }
  }
});

test('the correction leaves every derived market summing to one', () => {
  for (const rho of [-0.2, -0.13, 0, 0.1]) {
    const baseline = buildPoissonBaseline(context(), { rho });
    const { home, draw, away } = baseline.outcome;
    assert.ok(Math.abs(home + draw + away - 1) < 1e-9, `outcome at rho=${rho}`);
    assert.ok(Math.abs(baseline.btts.yes + baseline.btts.no - 1) < 1e-9, `btts at rho=${rho}`);
    for (const total of baseline.totals) {
      assert.ok(Math.abs(total.over + total.under - 1) < 1e-9, `total ${total.line} at rho=${rho}`);
    }
    for (const entry of baseline.scores) assert.ok(entry.probability > 0, `positive cells at rho=${rho}`);
  }
});

test('scores above one goal a side are untouched by the correction', () => {
  const withRho = buildPoissonBaseline(context());
  const without = buildPoissonBaseline(context(), { rho: 0 });
  // 2:1 shifts only through renormalisation, never through the tau function itself.
  const a = withRho.scores.find((entry) => entry.score === '2:1')?.probability;
  const b = without.scores.find((entry) => entry.score === '2:1')?.probability;
  if (a !== undefined && b !== undefined) assert.ok(Math.abs(a - b) / b < 0.1);
});
