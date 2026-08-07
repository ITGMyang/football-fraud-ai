// Node 5 & 6 of the expert pipeline: the deterministic half.
//
// Every market comes out of one 7x7 Dixon-Coles matrix, so the five answers cannot
// contradict each other the way separately-asked questions can. No tokens are spent
// here and the numbers are reproducible from the two goal expectations alone.
//
// Thresholds and constants are the ones specified in the architecture document.

export const MAX_GOALS = 7;
export const TAU = -0.05;
export const DELTA_CLAMP = 0.15;
export const MIN_GOAL_EXPECTATION = 0.2;

// Node 7 risk gates, as specified.
export const ENTROPY_LIMIT = 3.10;
export const MIN_TOP_1X2 = 0.48;
export const MAX_DIVERGENCE = 0.20;
export const MIN_EV = 0.03;
export const KELLY_FRACTION = 0.25;

export function dixonColesMatrix(lambdaHome, muAway, tau = TAU, maxGoals = MAX_GOALS) {
  const matrix = [];
  let total = 0;
  for (let home = 0; home < maxGoals; home += 1) {
    matrix[home] = [];
    for (let away = 0; away < maxGoals; away += 1) {
      const cell = poisson(home, lambdaHome) * poisson(away, muAway) * lowScoreAdjustment(home, away, lambdaHome, muAway, tau);
      matrix[home][away] = cell;
      total += cell;
    }
  }
  for (let home = 0; home < maxGoals; home += 1) {
    for (let away = 0; away < maxGoals; away += 1) matrix[home][away] /= total;
  }
  return matrix;
}

// The goal expectations the maths runs on: a statistical base moved by whatever the
// experts concluded, after the auditor's discount and clamped either way.
export function fitGoalExpectations({ baseHomeXg, baseAwayXg, tactical = {}, intelligence = {}, audit = {} }) {
  const tacticalDiscount = clamp(number(audit.tacticalDiscount, 1), 0, 1);
  const intelligenceDiscount = clamp(number(audit.intelligenceDiscount, 1), 0, 1);
  const homeShift = number(tactical.homeTacticalAdv, 0) * tacticalDiscount
    + number(intelligence.homeOverallMotivation, 0) * intelligenceDiscount;
  const awayShift = number(tactical.awayTacticalAdv, 0) * tacticalDiscount
    + number(intelligence.awayOverallMotivation, 0) * intelligenceDiscount;

  const deltaLambda = clamp(homeShift, -DELTA_CLAMP, DELTA_CLAMP);
  const deltaMu = clamp(awayShift, -DELTA_CLAMP, DELTA_CLAMP);
  return {
    lambdaHome: Math.max(MIN_GOAL_EXPECTATION, number(baseHomeXg, 0) + deltaLambda),
    muAway: Math.max(MIN_GOAL_EXPECTATION, number(baseAwayXg, 0) + deltaMu),
    deltaLambda: round(deltaLambda, 4),
    deltaMu: round(deltaMu, 4)
  };
}

export function marketProbabilities(matrix, { handicapLine = -0.5, totalLine = 2.5, scoreCount = 3 } = {}) {
  let win = 0;
  let draw = 0;
  let loss = 0;
  let bttsYes = 0;
  let over = 0;
  let homeCovers = 0;
  const scores = [];

  for (let home = 0; home < matrix.length; home += 1) {
    for (let away = 0; away < matrix[home].length; away += 1) {
      const probability = matrix[home][away];
      if (home > away) win += probability;
      else if (home === away) draw += probability;
      else loss += probability;
      if (home >= 1 && away >= 1) bttsYes += probability;
      if (home + away > totalLine) over += probability;
      // Home covers when its margin beats the line it gives away. A whole-number line
      // can also be drawn exactly, which is a stake returned rather than a loss; that
      // refund is not modelled here, so a whole-number handicap reads pessimistically.
      if (home - away > -handicapLine) homeCovers += probability;
      scores.push({ score: `${home}-${away}`, prob: probability });
    }
  }

  scores.sort((left, right) => right.prob - left.prob);
  return {
    '1X2_Win': round(win, 4),
    '1X2_Draw': round(draw, 4),
    '1X2_Loss': round(loss, 4),
    BTTS_Yes: round(bttsYes, 4),
    BTTS_No: round(1 - bttsYes, 4),
    [`OU_${totalLine}_Over`]: round(over, 4),
    [`OU_${totalLine}_Under`]: round(1 - over, 4),
    [`AH_${handicapLine}_Home`]: round(homeCovers, 4),
    [`AH_${handicapLine}_Away`]: round(1 - homeCovers, 4),
    Top_Scores: scores.slice(0, scoreCount).map((entry) => ({ score: entry.score, prob: round(entry.prob, 4) }))
  };
}

export function shannonEntropy(matrix) {
  let entropy = 0;
  for (const row of matrix) {
    for (const probability of row) {
      if (probability > 0) entropy -= probability * Math.log2(probability);
    }
  }
  return round(entropy, 4);
}

// Proportional margin removal: the quoted prices for one market imply more than 100%,
// and the excess is the bookmaker's cut rather than anybody's opinion.
export function marketPureProbabilities(oddsGroup = {}) {
  const implied = Object.entries(oddsGroup)
    .map(([key, odds]) => [key, Number(odds) > 1 ? 1 / Number(odds) : 0])
    .filter(([, value]) => value > 0);
  const total = implied.reduce((sum, [, value]) => sum + value, 0);
  if (!(total > 0)) return {};
  return Object.fromEntries(implied.map(([key, value]) => [key, round(value / total, 4)]));
}

export function expectedValue(quantProbability, odds) {
  const price = Number(odds);
  if (!(price > 1)) return null;
  return round(quantProbability * price - 1, 4);
}

export function kellyStake(quantProbability, odds, fraction = KELLY_FRACTION) {
  const b = Number(odds) - 1;
  const p = Number(quantProbability);
  const q = 1 - p;
  if (!(b > 0) || !(b * p - q > 0)) return 0;
  return round(((b * p - q) / b) * fraction, 4);
}

export function compareToMarket(quantProbabilities, marketOdds = {}) {
  const comparison = {};
  for (const [key, quantProbability] of Object.entries(quantProbabilities)) {
    if (key === 'Top_Scores') continue;
    const odds = marketOdds[key];
    if (!(Number(odds) > 1)) continue;
    // Margin is removed across the sides of the same market, which is the group that
    // shares one bookmaker cut.
    const group = Object.fromEntries(
      Object.entries(marketOdds).filter(([other]) => marketGroup(other) === marketGroup(key))
    );
    const pure = marketPureProbabilities(group)[key];
    comparison[key] = {
      quant_prob: quantProbability,
      stake_odds: Number(odds),
      market_pure_prob: pure ?? null,
      ev: expectedValue(quantProbability, odds),
      divergence: pure === undefined ? null : round(Math.abs(quantProbability - pure), 4)
    };
  }
  return comparison;
}

// Node 7's three hard gates, checked in the order the document specifies.
export function riskDecision({ matrix, probabilities, comparison = {} }) {
  const entropy = shannonEntropy(matrix);
  if (entropy > ENTROPY_LIMIT) {
    return pass(`高随机性拦截：矩阵香农熵 (${entropy.toFixed(2)} > ${ENTROPY_LIMIT})。`, entropy);
  }

  const top1x2 = Math.max(probabilities['1X2_Win'], probabilities['1X2_Draw'], probabilities['1X2_Loss']);
  if (top1x2 < MIN_TOP_1X2) {
    return pass(`低置信度：胜平负最高概率未达标 (${(top1x2 * 100).toFixed(1)}% < ${MIN_TOP_1X2 * 100}%)。`, entropy);
  }

  const priced = Object.entries(comparison).filter(([, row]) => row.ev !== null);
  if (!priced.length) return pass('数据缺失：未匹配到对应盘口。', entropy);

  const [name, best] = priced.sort((left, right) => right[1].ev - left[1].ev)[0];
  if (best.divergence !== null && best.divergence > MAX_DIVERGENCE) {
    return pass(`诱盘/隐患拦截：模型与盘口背离度过高 (${(best.divergence * 100).toFixed(1)}% > ${MAX_DIVERGENCE * 100}%)。`, entropy);
  }
  if (best.ev < MIN_EV) {
    return pass(`低价值拦截：最佳选项 EV 未达标 (${(best.ev * 100).toFixed(1)}% < +${MIN_EV * 100}%)。`, entropy);
  }

  return {
    status: 'RECOMMEND',
    pass_reason: null,
    matrix_entropy: entropy,
    primary_recommendation: name,
    recommended_odds: best.stake_odds,
    expected_value_ev: best.ev,
    suggested_kelly_stake: kellyStake(best.quant_prob, best.stake_odds)
  };
}

function pass(reason, entropy) {
  return {
    status: 'PASS',
    pass_reason: reason,
    matrix_entropy: entropy,
    primary_recommendation: null,
    recommended_odds: null,
    expected_value_ev: null,
    suggested_kelly_stake: 0
  };
}

function marketGroup(key) {
  const [head, ...rest] = String(key).split('_');
  return rest.length > 1 ? `${head}_${rest[0]}` : head;
}

function poisson(goals, rate) {
  return (rate ** goals) * Math.exp(-rate) / factorial(goals);
}

function factorial(value) {
  let result = 1;
  for (let index = 2; index <= value; index += 1) result *= index;
  return result;
}

function lowScoreAdjustment(home, away, lambdaHome, muAway, tau) {
  if (home === 0 && away === 0) return Math.max(1 - lambdaHome * muAway * tau, 0.0001);
  if (home === 0 && away === 1) return Math.max(1 + lambdaHome * tau, 0.0001);
  if (home === 1 && away === 0) return Math.max(1 + muAway * tau, 0.0001);
  if (home === 1 && away === 1) return Math.max(1 - tau, 0.0001);
  return 1;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, Number(value)));
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}
