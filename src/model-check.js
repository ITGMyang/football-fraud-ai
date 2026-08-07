import { configuredModels, modelClient, modelRequest } from './openrouter.js';

// A minimal live ping of every configured model, built by the same client and request
// code a prediction uses. Its own copy of that code reported every provider as
// unreachable while predictions ran perfectly: the keys were never trimmed, so a
// trailing newline in a secret became "Missing Authentication header", and GPT was
// asked on the wrong endpoint with the wrong token parameter. A check that does not
// exercise the real path is only checking itself.
//
// Local results say nothing about production either: the Worker calls out from
// Cloudflare's network, so a model a developer machine cannot reach may be perfectly
// reachable once deployed, and the reverse.
export async function checkModels(env = process.env, fetchImpl = fetch, now = () => Date.now()) {
  const models = configuredModels(env);
  const checks = await Promise.all(models.map(async ([label, model, , provider]) => {
    const startedAt = now();
    try {
      const client = modelClient(provider, env);
      const request = modelRequest({
        client,
        provider,
        model,
        env,
        system: 'Reply with JSON.',
        user: 'Return the JSON {"ok":true}.',
        temperature: 0,
        maxTokens: 16
      });
      const response = await fetchImpl(request.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${client.apiKey}`,
          'Content-Type': 'application/json',
          ...client.extraHeaders
        },
        body: JSON.stringify(request.body)
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
