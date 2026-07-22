const USD_PER_MILLION_TOKENS = Object.freeze({
  openai: [
    { model: /^gpt-5\.5(?:-|$)/, input: 5, cachedInput: 0.5, output: 30 }
  ],
  apimart: [
    { model: /^claude-opus-4-8(?:-|$)/, input: 4, output: 20 },
    { model: /^gemini-3\.1-pro-preview(?:-|$)/, input: 1.6, output: 9.6 }
  ]
});

export function calculateModelCostUsd({ provider, model, inputTokens = 0, outputTokens = 0, cachedInputTokens = 0 } = {}) {
  const rates = USD_PER_MILLION_TOKENS[normalize(provider)] || [];
  const modelName = normalizeModel(model);
  const rate = rates.find((item) => item.model.test(modelName));
  if (!rate) return null;

  const input = positiveNumber(inputTokens);
  const cached = Math.min(input, positiveNumber(cachedInputTokens));
  const uncached = input - cached;
  const cost = (uncached * rate.input) + (cached * (rate.cachedInput ?? rate.input)) + (positiveNumber(outputTokens) * rate.output);
  return Math.round((cost / 1_000_000) * 100_000_000) / 100_000_000;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeModel(value) {
  return normalize(value).replace(/\s+/g, '-');
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
