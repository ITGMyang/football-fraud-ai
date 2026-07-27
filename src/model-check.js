import { configuredModels } from './openrouter.js';

// A minimal live ping of every configured model. Local results say nothing about
// production: the Worker calls out from Cloudflare's network, so a model a developer
// machine cannot reach may be perfectly reachable once deployed, and the reverse.
export async function checkModels(env = process.env, fetchImpl = fetch, now = () => Date.now()) {
  const models = configuredModels(env);
  const checks = await Promise.all(models.map(async ([label, model, , provider]) => {
    const startedAt = now();
    try {
      const client = checkClient(provider, env);
      const response = await fetchImpl(`${client.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${client.apiKey}`,
          'Content-Type': 'application/json',
          ...client.extraHeaders
        },
        body: JSON.stringify({
          model,
          max_tokens: 16,
          stream: false,
          messages: [{ role: 'user', content: 'Say ok.' }]
        })
      });
      const body = await response.text();
      return {
        label,
        model,
        provider: client.name,
        ok: response.ok,
        status: response.status,
        ms: now() - startedAt,
        message: response.ok ? 'ok' : summarize(body)
      };
    } catch (error) {
      return {
        label,
        model,
        provider,
        ok: false,
        status: 0,
        ms: now() - startedAt,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }));

  return {
    checkedAt: new Date(now()).toISOString(),
    reachable: checks.filter((check) => check.ok).length,
    total: checks.length,
    checks
  };
}

// The provider name and error text are what make a failure actionable: a wrong model
// id and a blocked region look identical until you read them.
function summarize(body) {
  try {
    const parsed = JSON.parse(body);
    const error = parsed.error || parsed;
    const provider = error?.metadata?.provider_name;
    const message = String(error?.message || body).trim();
    return provider ? `${provider}: ${message}` : message;
  } catch {
    return String(body || '').slice(0, 300);
  }
}

function checkClient(provider, env) {
  if (provider === 'openai') {
    return {
      name: 'OpenAI',
      baseUrl: String(env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      apiKey: env.OPENAI_API_KEY,
      extraHeaders: {}
    };
  }
  if (provider === 'apimart') {
    return {
      name: 'APIMart',
      baseUrl: String(env.APIMART_BASE_URL || 'https://api.apimart.ai/api/v1').replace(/\/$/, ''),
      apiKey: env.APIMART_API_KEY,
      extraHeaders: {}
    };
  }
  return {
    name: 'OpenRouter',
    baseUrl: String(env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
    apiKey: env.OPENROUTER_API_KEY,
    extraHeaders: {
      'HTTP-Referer': 'https://futbots.cc',
      'X-Title': 'FutBots'
    }
  };
}
