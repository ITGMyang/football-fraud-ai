// The five stages of the expert pipeline, in the order the architecture specifies.
//
//   Stage 1  tactical and long-context experts, concurrently
//   Stage 2  the intelligence expert, given the long-context report as background
//   Stage 3  the auditor discounts both of them
//   Stage 4  goal expectations are fitted and every market is derived by maths
//   Stage 5  the hard gates decide RECOMMEND or PASS
//
// Stages 1 and 2 are the only concurrency: everything after depends on what came
// before. Any expert may fail without taking the prediction with it, because the
// deterministic engine can produce every market from the statistical base alone.

import { callModelForJson } from './openrouter.js';
import {
  EXPERT_ROLES,
  MATERIAL_ROLES,
  runAuditExpert,
  runIntelligenceExpert,
  runLongContextExpert,
  runRiskNarrator,
  runTacticalExpert
} from './experts.js';
import {
  compareToMarket,
  dixonColesMatrix,
  fitGoalExpectations,
  marketProbabilities,
  riskDecision
} from './quant-engine.js';

export function expertModel(role, env = {}) {
  const spec = EXPERT_ROLES[role];
  if (!spec) throw new Error(`Unknown expert role: ${role}`);
  const model = clean(env[`MODEL_${spec.env}`]) || spec.fallbackModel;
  const provider = clean(env[`MODEL_${spec.env}_PROVIDER`]).toLowerCase() || spec.fallbackProvider;
  return { model, provider, label: clean(env[`MODEL_${spec.env}_LABEL`]) || model };
}

export async function runExpertPipeline({
  fixtureId,
  matchName = '',
  context = {},
  baseline,
  marketOdds = {},
  handicapLine = -0.5,
  totalLine = 2.5,
  teamNews = null,
  env = process.env,
  fetchImpl = fetch
}) {
  const usage = [];
  const callJson = async (role, system, payload) => {
    const { model, provider, label } = expertModel(role, env);
    const answer = await callModelForJson({
      provider, model, env, fetchImpl, system, user: JSON.stringify(payload)
    });
    usage.push({ role, model, provider, label, ok: answer.ok, error: answer.error || null, usage: answer.usage });
    return answer;
  };

  // Stage 1
  const [tactical, longContext] = await Promise.all([
    runTacticalExpert({
      match: matchName,
      lineups: context?.lineup || null,
      injuries: context?.lineup?.notes || [],
      headToHead: context?.analysis?.headToHead || null,
      baseline
    }, callJson),
    runLongContextExpert({
      match: matchName,
      recentForm: context?.analysis || null,
      schedule: context?.fixture || null,
      news: newsLines(teamNews)
    }, callJson)
  ]);

  // Stage 2
  const intelligence = await runIntelligenceExpert({
    match: matchName,
    kickoff: context?.kickoff || '',
    long_context_baseline: longContext,
    recent_findings: newsLines(teamNews)
  }, callJson);

  // Stage 3
  const audit = await runAuditExpert({
    tactical_report: tactical,
    intelligence_report: intelligence,
    base_stats: baseline
  }, callJson);

  // Stage 4
  const fitted = fitGoalExpectations({
    baseHomeXg: baseline?.homeXg,
    baseAwayXg: baseline?.awayXg,
    tactical,
    intelligence,
    audit
  });
  const matrix = dixonColesMatrix(fitted.lambdaHome, fitted.muAway);
  const probabilities = marketProbabilities(matrix, { handicapLine, totalLine });
  const comparison = compareToMarket(probabilities, marketOdds);

  // Stage 5
  const decision = riskDecision({ matrix, probabilities, comparison });
  const verdict = await runRiskNarrator({
    match: matchName,
    decision,
    probabilities,
    market_comparison: comparison
  }, callJson);

  return {
    fixture_id: String(fixtureId),
    match: matchName,
    decision: { ...decision, verdict },
    expected_goals: {
      home_xG: round(fitted.lambdaHome, 2),
      away_xG: round(fitted.muAway, 2),
      delta_lambda: fitted.deltaLambda,
      delta_mu: fitted.deltaMu
    },
    probabilities,
    market_comparison: comparison,
    audit_trail: {
      tactical_reason: tactical.tacticalReason,
      tactical_adv: { home: tactical.homeTacticalAdv, away: tactical.awayTacticalAdv },
      fatigue: { home: longContext.homeFatigueScore, away: longContext.awayFatigueScore },
      internal_friction: longContext.internalFriction,
      breaking_summary: intelligence.breakingSummary,
      motivation: { home: intelligence.homeOverallMotivation, away: intelligence.awayOverallMotivation },
      tactical_discount: audit.tacticalDiscount,
      intelligence_discount: audit.intelligenceDiscount,
      critique: audit.critique,
      failed_experts: usage.filter((entry) => !entry.ok).map((entry) => `${entry.role}: ${entry.error}`),
      // Measured on a real fixture: losing every expert moved the home win from 54.3%
      // to 50.0%, which at evens is the difference between +8.6% expected value and
      // none. The shape of the answer survives; the edge does not.
      degraded: usage.some((entry) => !entry.ok && MATERIAL_ROLES.includes(entry.role))
    },
    usage
  };
}

function newsLines(teamNews) {
  if (!teamNews || teamNews.searched === false) return [];
  const findings = teamNews.findings || teamNews.topics || [];
  return (Array.isArray(findings) ? findings : []).map((entry) => (
    typeof entry === 'string' ? entry : `${entry.field || ''}: ${entry.summary || entry.text || ''}`
  )).filter(Boolean).slice(0, 40);
}

function clean(value) {
  return String(value || '').replace(/^﻿/, '').trim();
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}
