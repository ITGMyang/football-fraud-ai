import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

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

const env = {
  // A secret pasted with a trailing newline is the normal case, not an odd one.
  OPENROUTER_API_KEY: 'or-key\n',
  APIMART_API_KEY: ' apimart-key ',
  OPENAI_API_KEY: '﻿openai-key',
  OPENROUTER_BASE_URL: 'https://openrouter.test/v1',
  APIMART_BASE_URL: 'https://apimart.test/v1',
  OPENAI_BASE_URL: 'https://openai.test/v1',
  MODEL_QWEN: 'qwen/qwen3.7-max', MODEL_QWEN_PROVIDER: 'openrouter', MODEL_QWEN_LABEL: 'Qwen',
  MODEL_CLAUDE: 'claude-opus-4-8', MODEL_CLAUDE_PROVIDER: 'apimart', MODEL_CLAUDE_LABEL: 'Claude',
  MODEL_GPT: 'gpt-5.5', MODEL_GPT_PROVIDER: 'openai', MODEL_GPT_LABEL: 'GPT'
};

test('the check sends what a prediction sends, with the key cleaned the same way', async () => {
  const sent = [];
  await checkModels(env, async (url, options) => {
    sent.push({ url: String(url), auth: options.headers.Authorization, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
  });

  // Every provider reported 401 in production while predictions ran perfectly: the
  // check read the keys raw, so a trailing newline became "Missing Authentication
  // header". Anything that reaches for a key must clean it the same way.
  for (const call of sent) {
    assert.doesNotMatch(call.auth, /[\n\r﻿]/, call.auth);
    assert.doesNotMatch(call.auth, /Bearer\s\s|\s$/);
  }

  // GPT answers on /responses and rejects max_tokens outright; asking it the way the
  // other providers are asked fails on the parameter, not on reachability.
  const openai = sent.find((call) => call.url.includes('openai.test'));
  assert.match(openai.url, /\/responses$/);
  assert.equal(openai.body.max_tokens, undefined);
  assert.equal(openai.body.max_output_tokens, 16);

  const openrouter = sent.find((call) => call.url.includes('openrouter.test'));
  assert.match(openrouter.url, /\/chat\/completions$/);
  assert.equal(openrouter.body.max_tokens, 16);
});

test('the check has no request code of its own to drift from the real one', async () => {
  const source = await readFile(new URL('../src/model-check.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ configuredModels, modelClient, modelRequest \}/);
  // Its own copy of the client is what let the two drift apart in the first place.
  assert.doesNotMatch(source, /baseUrl:|apiKey: env\./);
});

test('a failure reports the provider and the message, not just a status', async () => {
  const result = await checkModels(
    { ...env, MODEL_CLAUDE: '', MODEL_GPT: '' },
    async () => new Response(JSON.stringify({ error: { message: 'no such model', metadata: { provider_name: 'Alibaba' } } }), { status: 400 })
  );

  assert.equal(result.reachable, 0);
  assert.equal(result.checks[0].status, 400);
  // A wrong model id and a blocked region look identical until you read the message.
  assert.equal(result.checks[0].message, 'Alibaba: no such model');
});
