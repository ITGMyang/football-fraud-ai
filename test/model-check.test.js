import assert from 'node:assert/strict';
import test from 'node:test';

import { checkModels } from '../src/model-check.js';

const ENV = {
  OPENROUTER_API_KEY: 'router-key',
  APIMART_API_KEY: 'apimart-key',
  MODEL_GPT: 'openai/gpt-5.5',
  MODEL_CLAUDE: 'anthropic/claude-opus-4.8',
  MODEL_CLAUDE_PROVIDER: 'apimart',
  MODEL_QWEN: 'qwen/qwen3.7-max'
};

test('each configured model is pinged through its own provider', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), auth: options.headers.Authorization, body: JSON.parse(options.body) });
    return { ok: true, status: 200, text: async () => '{}' };
  };

  const result = await checkModels(ENV, fetchImpl, () => 1000);

  assert.equal(result.total, 3);
  assert.equal(result.reachable, 3);
  assert.deepEqual(calls.map((call) => call.url), [
    'https://openrouter.ai/api/v1/chat/completions',
    'https://api.apimart.ai/api/v1/chat/completions',
    'https://openrouter.ai/api/v1/chat/completions'
  ]);
  assert.equal(calls[1].auth, 'Bearer apimart-key');
  assert.deepEqual(result.checks.map((row) => row.provider), ['OpenRouter', 'APIMart', 'OpenRouter']);
  // A ping must stay a ping: the whole point is that checking costs almost nothing.
  for (const call of calls) assert.equal(call.body.max_tokens, 16);
});

test('a blocked region is reported with the provider and the upstream wording', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    text: async () => JSON.stringify({
      error: {
        message: 'The request is prohibited due to a violation of provider Terms Of Service.',
        code: 403,
        metadata: { provider_name: 'OpenAI' }
      }
    })
  });

  const result = await checkModels({ ...ENV, MODEL_CLAUDE: '', MODEL_QWEN: '' }, fetchImpl, () => 1000);

  assert.equal(result.reachable, 0);
  assert.equal(result.checks[0].ok, false);
  assert.equal(result.checks[0].status, 403);
  assert.match(result.checks[0].message, /^OpenAI: The request is prohibited/);
});

test('an unknown model id is distinguishable from a blocked one', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ error: { message: 'nope/model is not a valid model ID', code: 400 } })
  });

  const result = await checkModels({ ...ENV, MODEL_CLAUDE: '', MODEL_QWEN: '' }, fetchImpl, () => 1000);

  assert.equal(result.checks[0].status, 400);
  assert.match(result.checks[0].message, /not a valid model ID/);
});

test('a thrown request is reported instead of failing the whole check', async () => {
  let call = 0;
  const fetchImpl = async () => {
    call += 1;
    if (call === 1) throw new Error('Network unreachable');
    return { ok: true, status: 200, text: async () => '{}' };
  };

  const result = await checkModels({ ...ENV, MODEL_CLAUDE: '' }, fetchImpl, () => 1000);

  assert.equal(result.total, 2);
  assert.equal(result.reachable, 1);
  assert.equal(result.checks[0].message, 'Network unreachable');
  assert.equal(result.checks[1].ok, true);
});
