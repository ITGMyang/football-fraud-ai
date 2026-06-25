import { loadEnv } from '../src/env.js';
import { configuredModels } from '../src/openrouter.js';
import { ProxyAgent } from 'undici';

loadEnv();

const proxyUrl = process.env.OPENROUTER_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
const baseUrl = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');

if (!process.env.OPENROUTER_API_KEY) {
  console.error('Missing OPENROUTER_API_KEY');
  process.exit(1);
}

console.log(`Proxy: ${proxyUrl ? maskProxy(proxyUrl) : 'none'}`);

for (const [label, model] of configuredModels(process.env)) {
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      dispatcher,
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'Football Odds LLM Predictor'
      },
      body: JSON.stringify({
        model,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'Say ok.' }]
      })
    });
    const text = await response.text();
    console.log(JSON.stringify({
      label,
      model,
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      message: response.ok ? 'ok' : text.slice(0, 220)
    }));
  } catch (error) {
    console.log(JSON.stringify({
      label,
      model,
      ok: false,
      ms: Date.now() - started,
      message: error.message
    }));
  }
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
