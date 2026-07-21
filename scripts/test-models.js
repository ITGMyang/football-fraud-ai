import { loadEnv } from '../src/env.js';
import { configuredModels } from '../src/openrouter.js';
import { ProxyAgent } from 'undici';

loadEnv();

const proxyUrl = process.env.OPENROUTER_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

if (!process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY && !process.env.APIMART_API_KEY) {
  console.error('Missing OPENROUTER_API_KEY, OPENAI_API_KEY or APIMART_API_KEY');
  process.exit(1);
}

console.log(`Proxy: ${proxyUrl ? maskProxy(proxyUrl) : 'none'}`);

for (const [label, model,, provider] of configuredModels(process.env)) {
  const started = Date.now();
  try {
    const client = testClient(provider);
    const response = await fetch(`${client.baseUrl}/chat/completions`, {
      method: 'POST',
      dispatcher: provider === 'openrouter' ? dispatcher : undefined,
      headers: {
        Authorization: `Bearer ${client.apiKey}`,
        'Content-Type': 'application/json',
        ...client.extraHeaders
      },
      body: JSON.stringify({
        model,
        max_tokens: 32,
        stream: false,
        messages: [{ role: 'user', content: 'Say ok.' }]
      })
    });
    const text = await response.text();
    console.log(JSON.stringify({
      label,
      model,
      provider,
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      message: response.ok ? 'ok' : text.slice(0, 220)
    }));
  } catch (error) {
    console.log(JSON.stringify({
      label,
      model,
      provider,
      ok: false,
      ms: Date.now() - started,
      message: error.message
    }));
  }
}

function testClient(provider = 'openrouter') {
  if (provider === 'openai') {
    return {
      baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      apiKey: process.env.OPENAI_API_KEY,
      extraHeaders: {}
    };
  }

  if (provider === 'apimart') {
    return {
      baseUrl: (process.env.APIMART_BASE_URL || 'https://api.apimart.ai/api/v1').replace(/\/$/, ''),
      apiKey: process.env.APIMART_API_KEY,
      extraHeaders: {}
    };
  }

  return {
    baseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
    apiKey: process.env.OPENROUTER_API_KEY,
    extraHeaders: {
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'Football Odds LLM Predictor'
    }
  };
}

function maskProxy(value) {
  try {
    const url = new URL(value);
    if (url.username) url.username = '***';
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return 'configured';
  }
}
