// Nodes 1-4 and 7 of the expert pipeline: the parts that ask a model something.
//
// No node sets its own token cap. A cap is not a spend - only tokens actually produced
// are billed - and a small one silently truncates any model that reasons before it
// answers, which is how the auditor came back empty while still costing money.
//
// Each node answers one narrow question inside a stated numeric range, and every one
// of them has a fallback that changes nothing. A node that fails must leave the maths
// where it found it rather than taking the prediction down with it - the deterministic
// engine can still produce every market from the statistical base alone.
//
// Roles and ranges are as specified in the architecture document. Routing is not: the
// OpenRouter account cannot reach Anthropic, Google or OpenAI, which answer 403 there,
// so those three go to the providers that do answer.

export const EXPERT_ROLES = Object.freeze({
  tactical: { env: 'CLAUDE', fallbackModel: 'claude-opus-4-8', fallbackProvider: 'apimart' },
  longContext: { env: 'KIMI', fallbackModel: 'moonshotai/kimi-k3', fallbackProvider: 'openrouter' },
  intelligence: { env: 'GEMINI', fallbackModel: 'gemini-3.1-pro-preview', fallbackProvider: 'apimart' },
  audit: { env: 'DEEPSEEK_AUDIT', fallbackModel: 'deepseek/deepseek-r1', fallbackProvider: 'openrouter' },
  risk: { env: 'GPT', fallbackModel: 'gpt-5.5', fallbackProvider: 'openai' }
});

const TACTICAL_PROMPT = `You are a master tactical football analyst.
Analyze the tactical matchup, formation counters, and missing key players from API-Football data.
Output STRICT JSON:
{
  "home_tactical_adv": float [-0.15 to +0.15],
  "away_tactical_adv": float [-0.15 to +0.15],
  "tactical_reason": "Short reason (max 15 words)"
}`;

const LONG_CONTEXT_PROMPT = `You are a long-context intelligence agent. Analyze the news log and schedule density.
Output STRICT JSON:
{
  "home_fatigue_score": float [0.0 to 1.0],
  "away_fatigue_score": float [0.0 to 1.0],
  "internal_friction": {"home": bool, "away": bool}
}`;

const INTELLIGENCE_PROMPT = `You are a real-time intelligence agent. Using the supplied recent findings, judge breaking news within the last 24 hours regarding injury, illness or squad changes for this match.
Combine those findings with the provided long-context baseline report.
Output STRICT JSON:
{
  "realtime_breaking_news": bool,
  "home_overall_motivation": float [-0.10 to +0.10],
  "away_overall_motivation": float [-0.10 to +0.10],
  "breaking_summary": "String (max 20 words)"
}`;

const AUDIT_PROMPT = `You are a skeptical and cold-headed quantitative auditor.
Review the tactical report and the intelligence report against the hard baseline stats.
Detect optical illusions, hypes, or over-reactions.
Output STRICT JSON:
{
  "tactical_discount": float [0.0 to 1.0],
  "intelligence_discount": float [0.0 to 1.0],
  "critique": "Short explanation why you discounted their opinions (max 20 words)"
}`;

export async function runTacticalExpert(payload, callJson) {
  const answer = await callJson('tactical', TACTICAL_PROMPT, payload);
  if (!answer.ok) {
    return { homeTacticalAdv: 0, awayTacticalAdv: 0, tacticalReason: `Fallback: ${answer.error}`, failed: true };
  }
  return {
    homeTacticalAdv: clamp(answer.data.home_tactical_adv, -0.15, 0.15),
    awayTacticalAdv: clamp(answer.data.away_tactical_adv, -0.15, 0.15),
    tacticalReason: text(answer.data.tactical_reason, 120),
    failed: false
  };
}

export async function runLongContextExpert(payload, callJson) {
  const answer = await callJson('longContext', LONG_CONTEXT_PROMPT, payload);
  if (!answer.ok) {
    return { homeFatigueScore: 0, awayFatigueScore: 0, internalFriction: { home: false, away: false }, failed: true };
  }
  return {
    homeFatigueScore: clamp(answer.data.home_fatigue_score, 0, 1),
    awayFatigueScore: clamp(answer.data.away_fatigue_score, 0, 1),
    internalFriction: {
      home: Boolean(answer.data.internal_friction?.home),
      away: Boolean(answer.data.internal_friction?.away)
    },
    failed: false
  };
}

export async function runIntelligenceExpert(payload, callJson) {
  const answer = await callJson('intelligence', INTELLIGENCE_PROMPT, payload);
  if (!answer.ok) {
    return {
      realtimeBreakingNews: false,
      homeOverallMotivation: 0,
      awayOverallMotivation: 0,
      breakingSummary: 'Search failed, zero adjustment.',
      failed: true
    };
  }
  return {
    realtimeBreakingNews: Boolean(answer.data.realtime_breaking_news),
    homeOverallMotivation: clamp(answer.data.home_overall_motivation, -0.1, 0.1),
    awayOverallMotivation: clamp(answer.data.away_overall_motivation, -0.1, 0.1),
    breakingSummary: text(answer.data.breaking_summary, 160),
    failed: false
  };
}

export async function runAuditExpert(payload, callJson) {
  const answer = await callJson('audit', AUDIT_PROMPT, payload);
  if (!answer.ok) {
    // Halving both when the auditor is unavailable is the specified fallback: with
    // nobody checking the experts, their opinions carry less weight, not more.
    return { tacticalDiscount: 0.5, intelligenceDiscount: 0.5, critique: 'Audit failure fallback.', failed: true };
  }
  return {
    tacticalDiscount: clamp(answer.data.tactical_discount, 0, 1, 1),
    intelligenceDiscount: clamp(answer.data.intelligence_discount, 0, 1, 1),
    critique: text(answer.data.critique, 160),
    failed: false
  };
}

// The hard gates are decided in code before this runs. The model is asked only to put
// the decision into words, so a talkative model cannot overturn a threshold.
export async function runRiskNarrator(payload, callJson) {
  const answer = await callJson('risk', `You are a risk reviewer. The decision has already been made by hard rules and you may not change it.
Explain it in one or two sentences for a reader who bets on football.
Output STRICT JSON: { "verdict": "String (max 40 words)" }`, payload);
  return answer.ok ? text(answer.data.verdict, 300) : '';
}

function clamp(value, low, high, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(low, Math.min(high, parsed));
}

function text(value, limit) {
  return String(value ?? '').trim().slice(0, limit);
}
