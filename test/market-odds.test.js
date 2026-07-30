import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMarketBaseline, compareToBaseline, marketPromptSummary, removeMargin } from '../src/market-odds.js';

function context({ euro, asia, size } = {}) {
  return {
    index: {
      live: {
        euro: euro ?? [
          { company: 'Bet365', home: '2.00', line: '3.40', away: '4.00' },
          { company: 'Pinnacle', home: '2.05', line: '3.50', away: '3.90' }
        ],
        size: size ?? [
          { company: 'Bet365', line: '2.5', home: '1.90', away: '1.95' },
          { company: 'Pinnacle', line: '2.5', home: '1.92', away: '1.98' },
          { company: 'Bet365', line: '3.5', home: '3.20', away: '1.35' }
        ],
        asia: asia ?? [
          { company: 'Bet365', lineValue: '-0.5', home: '1.95', away: '1.90' },
          { company: 'Bet365', lineValue: '-1.25', home: '2.60', away: '1.50' }
        ]
      }
    }
  };
}

test('the margin is removed before a price is ever called a probability', () => {
  // A 1X2 book quoted with roughly 5% overround.
  const removed = removeMargin([2.00, 3.40, 4.00]);

  assert.ok(removed.margin > 0.03 && removed.margin < 0.08, `unexpected margin ${removed.margin}`);
  const total = removed.probabilities.reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, 'de-margined probabilities must sum to 1');
  // Order is preserved and the favourite stays the favourite.
  assert.ok(removed.probabilities[0] > removed.probabilities[1]);
  assert.ok(removed.probabilities[1] > removed.probabilities[2]);
});

test('a book with no usable prices yields nothing rather than a fake probability', () => {
  assert.equal(removeMargin([]), null);
  assert.equal(removeMargin([0, 0, 0]), null);
  assert.equal(removeMargin(['', null, undefined]), null);
  // A price of 1.0 or below implies no risk and is treated as unquoted.
  assert.equal(removeMargin([1, 0.5]), null);
});

test('bookmakers are averaged into one consensus per market', () => {
  const market = buildMarketBaseline(context());

  assert.equal(market.available, true);
  assert.equal(market.outcome.books, 2);
  const { home, draw, away } = market.outcome;
  // Each figure is rounded to 4dp for display, so the sum can drift by a few 1e-4.
  assert.ok(Math.abs(home + draw + away - 1) < 1e-3);
  assert.ok(home > away, 'the shorter price must carry the higher probability');

  const over25 = market.totals.find((entry) => entry.line === 2.5);
  assert.equal(over25.books, 2);
  assert.ok(Math.abs(over25.over + over25.under - 1) < 1e-3);
  assert.deepEqual(market.totals.map((entry) => entry.line), [2.5, 3.5]);
});

test('handicap lines keep their sign and are ordered by distance from level', () => {
  const market = buildMarketBaseline(context());

  assert.deepEqual(market.handicaps.map((entry) => entry.line), [-0.5, -1.25]);
  // A quarter line is carried as quoted; splitting it would change what covering means.
  const quarter = market.handicaps.find((entry) => entry.line === -1.25);
  assert.ok(quarter.home < quarter.away, 'giving 1.25 goals should be the longer price');
});

test('a fixture without odds says so instead of returning empty probabilities', () => {
  assert.equal(buildMarketBaseline(null).available, false);
  assert.match(buildMarketBaseline({}).reason, /no odds/i);

  const blank = buildMarketBaseline({ index: { live: { euro: [], asia: [], size: [] } } });
  assert.equal(blank.available, false);
  assert.match(blank.reason, /No priced market/);
});

test('one readable market is enough; the others are simply absent', () => {
  const totalsOnly = buildMarketBaseline(context({ euro: [], asia: [] }));

  assert.equal(totalsOnly.available, true);
  assert.equal(totalsOnly.outcome, undefined);
  assert.equal(totalsOnly.handicaps, undefined);
  assert.ok(totalsOnly.totals.length > 0);
});

test('divergence measures the model against the market on shared markets only', () => {
  const market = buildMarketBaseline(context());
  const poisson = {
    available: true,
    outcome: { home: 0.62, draw: 0.22, away: 0.16 },
    totals: [{ line: 2.5, over: 0.40, under: 0.60 }, { line: 4.5, over: 0.1, under: 0.9 }]
  };

  const comparison = compareToBaseline(market, poisson);

  // 4.5 is priced by the model but not by the book, so it is not compared.
  assert.deepEqual(comparison.rows.map((row) => row.market), ['1X2 home', '1X2 draw', '1X2 away', 'Over 2.5']);
  for (const row of comparison.rows) {
    assert.ok(Math.abs(Math.abs(row.model - row.marketProbability) - row.divergence) < 1e-9);
  }
  assert.equal(comparison.largestDivergence.market, comparison.rows
    .reduce((worst, row) => (row.divergence > worst.divergence ? row : worst)).market);
  assert.ok(comparison.meanDivergence > 0);
});

test('no comparison is attempted when either side is missing', () => {
  const market = buildMarketBaseline(context());
  assert.equal(compareToBaseline(market, { available: false }), null);
  assert.equal(compareToBaseline({ available: false }, { available: true }), null);
});

test('the prompt summary stays small and tells the model how to weigh the market', () => {
  const market = buildMarketBaseline(context());
  const comparison = compareToBaseline(market, {
    available: true,
    outcome: { home: 0.62, draw: 0.22, away: 0.16 },
    totals: [{ line: 2.5, over: 0.40, under: 0.60 }]
  });

  assert.equal(marketPromptSummary({ available: false }), null);

  const summary = marketPromptSummary(market, comparison);
  assert.match(summary.source, /margin removed/i);
  assert.match(summary.note, /outranks|information the statistical model cannot see|prices information/i);
  assert.ok(summary.largestDisagreementWithModel);
  assert.ok(JSON.stringify(summary).length < 900, 'the summary must stay negligible next to the context');
});
