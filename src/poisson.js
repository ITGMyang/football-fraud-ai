// Statistical baseline for a fixture: a bivariate Poisson goal model fitted from
// the season goal records API-Football already returns. It costs no tokens and
// gives every downstream model a probability floor to argue against instead of
// inventing scorelines from prose.

const MAX_GOALS = 8;
// Dixon-Coles low-score correction. Independent Poisson margins understate 0-0 and
// 1-1 and overstate 1-0 and 0-1, because goals in low-scoring games are not
// independent. A negative rho shifts probability back the way the record shows.
const DIXON_COLES_RHO = -0.13;
const TOTAL_LINES = [0.5, 1.5, 2.5, 3.5, 4.5];
const DEFAULT_SCORE_COUNT = 6;
// Home sides score roughly 1.15x and concede roughly 0.87x the neutral rate across
// the major European leagues. Applied only when a venue split is unavailable.
const HOME_ADVANTAGE = 1.15;
const AWAY_DISADVANTAGE = 0.87;
const MIN_SAMPLE = 4;

export function buildPoissonBaseline(context, { scoreCount = DEFAULT_SCORE_COUNT, rho = DIXON_COLES_RHO } = {}) {
  const teams = fixtureTeams(context);
  if (!teams) return unavailable('Fixture is missing home and away team names');

  const rows = teamStatisticRows(context);
  const home = matchTeamRow(rows, teams.home);
  const away = matchTeamRow(rows, teams.away);
  if (!home || !away) return unavailable('Season goal records are missing for one or both teams');

  const homeRates = venueRates(home, 'home');
  const awayRates = venueRates(away, 'away');
  if (!homeRates || !awayRates) return unavailable('Season goal records cover fewer than four matches');

  // League scale is approximated from the two sides in this fixture. With only the
  // fixture catalog available that is the best unbiased anchor we have; it cancels
  // out of the strength ratios and only sets the overall goal level.
  const leagueGoals = (homeRates.scored + homeRates.conceded + awayRates.scored + awayRates.conceded) / 4;
  if (!(leagueGoals > 0)) return unavailable('Season goal records contain no goals');

  const homeAttack = homeRates.scored / leagueGoals;
  const homeDefence = homeRates.conceded / leagueGoals;
  const awayAttack = awayRates.scored / leagueGoals;
  const awayDefence = awayRates.conceded / leagueGoals;

  const lambdaHome = round(homeAttack * awayDefence * leagueGoals * homeRates.venueFactor, 3);
  const lambdaAway = round(awayAttack * homeDefence * leagueGoals * awayRates.venueFactor, 3);

  const grid = scoreGrid(lambdaHome, lambdaAway, rho);
  return {
    available: true,
    method: 'poisson',
    lambdaHome,
    lambdaAway,
    rho,
    sample: { home: homeRates.played, away: awayRates.played, venueSplit: homeRates.split && awayRates.split },
    outcome: outcomeProbabilities(grid),
    scores: topScores(grid, scoreCount),
    totals: totalProbabilities(grid),
    btts: bttsProbabilities(grid)
  };
}

// Compact enough to sit in a model prompt without meaningfully moving input cost.
export function poissonPromptSummary(baseline) {
  if (!baseline?.available) return null;
  return {
    method: 'Dixon-Coles goal model fitted from season goal records',
    expectedGoals: { home: baseline.lambdaHome, away: baseline.lambdaAway },
    outcomeProbability: baseline.outcome,
    likelyScores: baseline.scores.map((entry) => `${entry.score} ${percent(entry.probability)}`),
    totalsProbability: baseline.totals.map((entry) => `Over ${entry.line} ${percent(entry.over)}`),
    bttsProbability: { yes: baseline.btts.yes, no: baseline.btts.no },
    note: 'Statistical prior only. It ignores lineups, injuries, motivation and market moves. Depart from it when the evidence justifies it, and say why.'
  };
}

function unavailable(reason) {
  return { available: false, method: 'poisson', reason };
}

function fixtureTeams(context) {
  const home = context?.fixture?.home?.name || context?.teams?.[0] || '';
  const away = context?.fixture?.away?.name || context?.teams?.[1] || '';
  return home && away ? { home, away } : null;
}

function teamStatisticRows(context) {
  const rows = context?.catalog?.teamStatistics;
  return Array.isArray(rows) ? rows : [];
}

function matchTeamRow(rows, teamName) {
  const target = normalizeName(teamName);
  return rows.find((row) => normalizeName(row?.team) === target)
    || rows.find((row) => {
      const name = normalizeName(row?.team);
      return name && target && (name.includes(target) || target.includes(name));
    })
    || null;
}

// Venue splits are strongly preferred: a side's home scoring rate already carries its
// own home advantage, so applying a generic multiplier on top would double-count it.
function venueRates(row, venue) {
  const playedVenue = positive(venue === 'home' ? row.playedHome : row.playedAway);
  const scoredVenue = numeric(venue === 'home' ? row.goalsForHome : row.goalsForAway);
  const concededVenue = numeric(venue === 'home' ? row.goalsAgainstHome : row.goalsAgainstAway);
  if (playedVenue >= MIN_SAMPLE && scoredVenue !== null && concededVenue !== null) {
    return {
      scored: scoredVenue / playedVenue,
      conceded: concededVenue / playedVenue,
      played: playedVenue,
      venueFactor: 1,
      split: true
    };
  }

  const played = positive(row.played);
  const scored = numeric(row.goalsFor);
  const conceded = numeric(row.goalsAgainst);
  if (played < MIN_SAMPLE || scored === null || conceded === null) return null;
  return {
    scored: scored / played,
    conceded: conceded / played,
    played,
    venueFactor: venue === 'home' ? HOME_ADVANTAGE : AWAY_DISADVANTAGE,
    split: false
  };
}

function scoreGrid(lambdaHome, lambdaAway, rho = DIXON_COLES_RHO) {
  const homeProbabilities = poissonSeries(lambdaHome);
  const awayProbabilities = poissonSeries(lambdaAway);
  const grid = [];
  let mass = 0;
  for (let home = 0; home <= MAX_GOALS; home += 1) {
    for (let away = 0; away <= MAX_GOALS; away += 1) {
      const probability = homeProbabilities[home] * awayProbabilities[away]
        * lowScoreAdjustment(home, away, lambdaHome, lambdaAway, rho);
      mass += probability;
      grid.push({ home, away, probability });
    }
  }
  // Renormalise: the correction perturbs total mass, and the tail beyond MAX_GOALS
  // is truncated. Without this the derived markets would not sum to one.
  return mass > 0 ? grid.map((cell) => ({ ...cell, probability: cell.probability / mass })) : grid;
}

// The tau function touches only the four cells where both sides score at most once;
// everything else is left as the independent product.
function lowScoreAdjustment(home, away, lambdaHome, lambdaAway, rho) {
  if (home > 1 || away > 1) return 1;
  if (home === 0 && away === 0) return Math.max(1 - lambdaHome * lambdaAway * rho, 0.0001);
  if (home === 0 && away === 1) return Math.max(1 + lambdaHome * rho, 0.0001);
  if (home === 1 && away === 0) return Math.max(1 + lambdaAway * rho, 0.0001);
  return Math.max(1 - rho, 0.0001);
}

function poissonSeries(lambda) {
  const series = [];
  let term = Math.exp(-lambda);
  for (let goals = 0; goals <= MAX_GOALS; goals += 1) {
    series.push(term);
    term = (term * lambda) / (goals + 1);
  }
  return series;
}

function outcomeProbabilities(grid) {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (const cell of grid) {
    if (cell.home > cell.away) home += cell.probability;
    else if (cell.home === cell.away) draw += cell.probability;
    else away += cell.probability;
  }
  return { home: round(home, 4), draw: round(draw, 4), away: round(away, 4) };
}

function topScores(grid, count) {
  return [...grid]
    .sort((left, right) => right.probability - left.probability)
    .slice(0, count)
    .map((cell) => ({ score: `${cell.home}:${cell.away}`, probability: round(cell.probability, 4) }));
}

function totalProbabilities(grid) {
  return TOTAL_LINES.map((line) => {
    let over = 0;
    for (const cell of grid) {
      if (cell.home + cell.away > line) over += cell.probability;
    }
    return { line, over: round(over, 4), under: round(1 - over, 4) };
  });
}

function bttsProbabilities(grid) {
  let yes = 0;
  for (const cell of grid) {
    if (cell.home > 0 && cell.away > 0) yes += cell.probability;
  }
  return { yes: round(yes, 4), no: round(1 - yes, 4) };
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function percent(value) {
  return `${Math.round(value * 1000) / 10}%`;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
