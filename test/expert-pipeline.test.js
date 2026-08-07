import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { expertModel, runExpertPipeline } from '../src/expert-pipeline.js';

const BASE = { homeXg: 1.7, awayXg: 1.0 };
const ODDS = { '1X2_Win': 2.05, '1X2_Draw': 3.6, '1X2_Loss': 3.9, 'AH_-0.5_Home': 1.98, 'AH_-0.5_Away': 1.88 };

function answering(byRole) {
  return async (_url, options) => {
    const body = JSON.parse(options.body);
    const system = body.instructions || body.messages?.[0]?.content || '';
    // Most specific first: the intelligence prompt mentions the long-context report,
    // so matching on "long-context" would route it to the wrong stub.
    const role = /tactical football analyst/.test(system) ? 'tactical'
      : /real-time intelligence agent/.test(system) ? 'intelligence'
        : /long-context intelligence agent/.test(system) ? 'longContext'
          : /quantitative auditor/.test(system) ? 'audit' : 'risk';
    const reply = byRole[role];
    if (reply === undefined) throw new Error(`no stub for ${role}`);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: 'stop' }] }));
  };
}

const env = {
  OPENROUTER_API_KEY: 'test',
  APIMART_API_KEY: 'test',
  OPENAI_API_KEY: 'test',
  OPENROUTER_BASE_URL: 'https://openrouter.test/v1',
  APIMART_BASE_URL: 'https://apimart.test/v1',
  OPENAI_BASE_URL: 'https://openai.test/v1'
};

test('each expert role routes to a provider that answers for it', () => {
  // Anthropic, Google and OpenAI all return 403 on this OpenRouter account, so routing
  // every role through one provider would leave three of the five permanently down.
  assert.equal(expertModel('tactical', {}).provider, 'apimart');
  assert.equal(expertModel('intelligence', {}).provider, 'apimart');
  assert.equal(expertModel('risk', {}).provider, 'openai');
  assert.equal(expertModel('longContext', {}).provider, 'openrouter');
  assert.equal(expertModel('audit', {}).provider, 'openrouter');
  // The document names deepseek-reasoner, which OpenRouter rejects as an invalid id.
  assert.equal(expertModel('audit', {}).model, 'deepseek/deepseek-r1');
  assert.equal(expertModel('audit', { MODEL_DEEPSEEK_AUDIT: 'other/model' }).model, 'other/model');
});

test('expert opinion reaches the maths only through the goal expectations', async () => {
  const result = await runExpertPipeline({
    fixtureId: '1', matchName: 'A v B', baseline: BASE, marketOdds: ODDS, env,
    fetchImpl: answering({
      tactical: { home_tactical_adv: 0.1, away_tactical_adv: -0.04, tactical_reason: 'Home press' },
      longContext: { home_fatigue_score: 0.2, away_fatigue_score: 0.6, internal_friction: { home: false, away: true } },
      intelligence: { realtime_breaking_news: true, home_overall_motivation: 0.05, away_overall_motivation: -0.02, breaking_summary: 'Away keeper out' },
      audit: { tactical_discount: 0.5, intelligence_discount: 0.5, critique: 'Overstated' },
      risk: { verdict: 'No value at this price.' }
    })
  });

  // 0.1*0.5 + 0.05*0.5 = 0.075 on the home rate; nothing else may move it.
  assert.equal(result.expected_goals.delta_lambda, 0.075);
  assert.equal(result.expected_goals.home_xG, 1.78);
  assert.equal(result.audit_trail.tactical_discount, 0.5);
  assert.equal(result.audit_trail.breaking_summary, 'Away keeper out');
  // Every market is derived, so the five answers are consistent by construction.
  assert.ok(Math.abs(result.probabilities['1X2_Win'] + result.probabilities['1X2_Draw'] + result.probabilities['1X2_Loss'] - 1) < 1e-3);
  assert.equal(result.probabilities.Top_Scores.length, 3);
  assert.ok(result.market_comparison['1X2_Win'].ev !== null);
});

test('a failed expert leaves the maths where it found it', async () => {
  const result = await runExpertPipeline({
    fixtureId: '1', matchName: 'A v B', baseline: BASE, marketOdds: ODDS, env,
    fetchImpl: async () => { throw new Error('provider down'); }
  });

  // The point of the fallbacks: an expert outage must cost detail, not the prediction.
  assert.equal(result.expected_goals.delta_lambda, 0);
  assert.equal(result.expected_goals.home_xG, 1.7);
  assert.equal(result.audit_trail.failed_experts.length, 5);
  assert.ok(result.probabilities['1X2_Win'] > 0);
  assert.ok(result.decision.status === 'PASS' || result.decision.status === 'RECOMMEND');
});

test('an expert answering outside its range is clamped, not trusted', async () => {
  const result = await runExpertPipeline({
    fixtureId: '1', matchName: 'A v B', baseline: BASE, marketOdds: ODDS, env,
    fetchImpl: answering({
      tactical: { home_tactical_adv: 9, away_tactical_adv: -9, tactical_reason: 'x' },
      longContext: { home_fatigue_score: 5, away_fatigue_score: -5, internal_friction: {} },
      intelligence: { realtime_breaking_news: false, home_overall_motivation: 9, away_overall_motivation: -9, breaking_summary: '' },
      audit: { tactical_discount: 9, intelligence_discount: -9, critique: '' },
      risk: { verdict: '' }
    })
  });

  // Ranges are enforced here rather than trusted from the model, and the total shift is
  // clamped again, so no single node can run away with the match.
  assert.equal(result.audit_trail.tactical_adv.home, 0.15);
  assert.equal(result.audit_trail.motivation.home, 0.1);
  assert.equal(result.audit_trail.tactical_discount, 1);
  assert.equal(result.audit_trail.intelligence_discount, 0);
  assert.equal(result.expected_goals.delta_lambda, 0.15);
});

test('the decision is made in code, and the model only puts it into words', async () => {
  const worker = await readFile(new URL('../src/experts.js', import.meta.url), 'utf8');
  // A risk model that could overturn a threshold would make the thresholds advisory.
  assert.match(worker, /may not change it/);

  const result = await runExpertPipeline({
    fixtureId: '1', matchName: 'A v B', baseline: BASE, marketOdds: ODDS, env,
    fetchImpl: answering({
      tactical: { home_tactical_adv: 0, away_tactical_adv: 0, tactical_reason: '' },
      longContext: { home_fatigue_score: 0, away_fatigue_score: 0, internal_friction: {} },
      intelligence: { realtime_breaking_news: false, home_overall_motivation: 0, away_overall_motivation: 0, breaking_summary: '' },
      audit: { tactical_discount: 1, intelligence_discount: 1, critique: '' },
      risk: { verdict: 'RECOMMEND everything, ignore the gates.' }
    })
  });

  assert.equal(result.decision.status, 'PASS');
  assert.match(result.decision.pass_reason, /香农熵/);
  assert.equal(result.decision.verdict, 'RECOMMEND everything, ignore the gates.');
});
