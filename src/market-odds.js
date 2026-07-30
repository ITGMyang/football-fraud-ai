// Market prices from the odds API-Football already returns with every fixture.
//
// Bookmaker odds are the densest single signal available: they price information no
// model here can see. They are also quoted with a margin baked in, so the raw
// reciprocal of a price is not a probability and must never be treated as one.

const MAX_BOOKMAKERS = 12;

export function buildMarketBaseline(context) {
  const live = context?.index?.live;
  if (!live) return unavailable('Fixture carries no odds');

  const outcome = consensusOutcome(live.euro);
  const totals = consensusTotals(live.size);
  const handicaps = consensusHandicaps(live.asia);

  if (!outcome && !totals.length && !handicaps.length) {
    return unavailable('No priced market could be read from the odds');
  }

  return {
    available: true,
    ...(outcome ? { outcome } : {}),
    ...(totals.length ? { totals } : {}),
    ...(handicaps.length ? { handicaps } : {})
  };
}

// Divergence is the point of holding both numbers: a market that disagrees sharply
// with the model usually knows something the model does not.
export function compareToBaseline(market, poisson) {
  if (!market?.available || !poisson?.available) return null;
  const rows = [];

  if (market.outcome) {
    rows.push(
      row('1X2 home', poisson.outcome.home, market.outcome.home),
      row('1X2 draw', poisson.outcome.draw, market.outcome.draw),
      row('1X2 away', poisson.outcome.away, market.outcome.away)
    );
  }
  for (const total of market.totals || []) {
    const modelled = poisson.totals.find((entry) => entry.line === total.line);
    if (modelled) rows.push(row(`Over ${total.line}`, modelled.over, total.over));
  }

  const largest = rows.reduce((worst, item) => (item.divergence > (worst?.divergence ?? -1) ? item : worst), null);
  return {
    rows,
    largestDivergence: largest ? { market: largest.market, divergence: largest.divergence } : null,
    // A single number the console and the settlement can sort on.
    meanDivergence: rows.length
      ? round(rows.reduce((sum, item) => sum + item.divergence, 0) / rows.length, 4)
      : 0
  };
}

export function marketPromptSummary(market, comparison) {
  if (!market?.available) return null;
  return {
    source: 'Bookmaker consensus, margin removed',
    ...(market.outcome ? { outcomeProbability: market.outcome } : {}),
    ...(market.totals?.length
      ? { totalsProbability: market.totals.map((entry) => `Over ${entry.line} ${percent(entry.over)}`) }
      : {}),
    ...(market.handicaps?.length
      ? { asianHandicap: market.handicaps.map((entry) => `${entry.line >= 0 ? '+' : ''}${entry.line} home ${percent(entry.home)}`) }
      : {}),
    ...(comparison?.largestDivergence
      ? { largestDisagreementWithModel: `${comparison.largestDivergence.market} ${percent(comparison.largestDivergence.divergence)}` }
      : {}),
    note: 'The market prices information the statistical model cannot see. Where the two disagree, say which one you are siding with and why.'
  };
}

/* ---- margin removal ---- */

// Proportional (multiplicative) removal. Shin's method models insider money and is
// better on lopsided books, but it needs iteration and a favourite-longshot prior
// that would be guesswork here; proportional is the honest simple choice.
export function removeMargin(prices = []) {
  const implied = prices.map((price) => (price > 1 ? 1 / price : 0));
  const total = implied.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;
  return { probabilities: implied.map((value) => value / total), margin: round(total - 1, 4) };
}

function consensusOutcome(rows = []) {
  const books = rows.slice(0, MAX_BOOKMAKERS)
    .map((row) => removeMargin([number(row?.home), number(row?.line), number(row?.away)]))
    .filter(Boolean);
  if (!books.length) return null;
  const [home, draw, away] = [0, 1, 2].map((index) => mean(books.map((book) => book.probabilities[index])));
  return { home: round(home, 4), draw: round(draw, 4), away: round(away, 4), books: books.length, margin: round(mean(books.map((book) => book.margin)), 4) };
}

function consensusTotals(rows = []) {
  const byLine = new Map();
  for (const row of rows.slice(0, MAX_BOOKMAKERS * 3)) {
    const line = number(row?.line);
    const removed = removeMargin([number(row?.home), number(row?.away)]);
    if (!(line > 0) || !removed) continue;
    const bucket = byLine.get(line) || [];
    bucket.push(removed);
    byLine.set(line, bucket);
  }
  return [...byLine.entries()]
    .map(([line, books]) => ({
      line,
      over: round(mean(books.map((book) => book.probabilities[0])), 4),
      under: round(mean(books.map((book) => book.probabilities[1])), 4),
      books: books.length
    }))
    .sort((left, right) => left.line - right.line);
}

// The handicap line is signed from the home side: negative means the home team gives
// goals away. Quarter lines are kept as quoted rather than being split here, because
// splitting them changes what "home covers" means and that belongs with settlement.
function consensusHandicaps(rows = []) {
  const byLine = new Map();
  for (const row of rows.slice(0, MAX_BOOKMAKERS * 3)) {
    const line = Number(row?.lineValue);
    const removed = removeMargin([number(row?.home), number(row?.away)]);
    if (!Number.isFinite(line) || !removed) continue;
    const bucket = byLine.get(line) || [];
    bucket.push(removed);
    byLine.set(line, bucket);
  }
  return [...byLine.entries()]
    .map(([line, books]) => ({
      line,
      home: round(mean(books.map((book) => book.probabilities[0])), 4),
      away: round(mean(books.map((book) => book.probabilities[1])), 4),
      books: books.length
    }))
    .sort((left, right) => Math.abs(left.line) - Math.abs(right.line));
}

function row(market, model, marketProbability) {
  return {
    market,
    model: round(model, 4),
    marketProbability: round(marketProbability, 4),
    divergence: round(Math.abs(model - marketProbability), 4)
  };
}

function unavailable(reason) {
  return { available: false, reason };
}

function number(value) {
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percent(value) {
  return `${Math.round(value * 1000) / 10}%`;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
