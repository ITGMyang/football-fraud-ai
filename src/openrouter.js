import { aggregateReport, validatePrediction } from './domain.js';

const SCORE_PICK_COUNT = 4;
const SCORE_PICK_TYPES = ['mainline', 'mainline', 'market_fit', 'aggressive'];

export function configuredModels(env = process.env) {
  return [
    [cleanEnvValue(env.MODEL_GPT_LABEL) || 'GPT', cleanEnvValue(env.MODEL_GPT), 'GPT', gptProvider(env)],
    [cleanEnvValue(env.MODEL_CLAUDE_LABEL) || 'Claude', cleanEnvValue(env.MODEL_CLAUDE), 'Claude', modelProvider(env, 'CLAUDE', 'apimart')],
    [cleanEnvValue(env.MODEL_GEMINI_LABEL) || 'Gemini', cleanEnvValue(env.MODEL_GEMINI), 'Gemini', modelProvider(env, 'GEMINI', 'openrouter')],
    [cleanEnvValue(env.MODEL_DEEPSEEK_LABEL) || 'DeepSeek', cleanEnvValue(env.MODEL_DEEPSEEK), 'DeepSeek', modelProvider(env, 'DEEPSEEK', 'openrouter')],
    [cleanEnvValue(env.MODEL_QWEN_LABEL) || 'Qwen', cleanEnvValue(env.MODEL_QWEN), 'Qwen', modelProvider(env, 'QWEN', 'openrouter')]
  ].filter(([, model]) => model);
}

function gptProvider(env = process.env) {
  const explicit = cleanEnvValue(env.MODEL_GPT_PROVIDER).toLowerCase();
  if (explicit) return explicit;
  return cleanEnvValue(env.MODEL_GPT).toLowerCase().startsWith('gpt-') ? 'openai' : 'openrouter';
}

function modelProvider(env, name, fallback) {
  return cleanEnvValue(env[`MODEL_${name}_PROVIDER`] || fallback).toLowerCase();
}

export async function predictMarket(market, env = process.env, fetchImpl = fetch) {
  if (!hasAnyApiKey(env)) {
    throw new Error('缺少模型 API Key，请配置 OPENROUTER_API_KEY / OPENAI_API_KEY / APIMART_API_KEY');
  }

  const models = configuredModels(env);
  if (models.length === 0) throw new Error('没有配置模型，请设置 MODEL_GPT/MODEL_GEMINI/MODEL_DEEPSEEK/MODEL_QWEN');

  const predictions = [];
  for (const [label, model,, provider] of models) {
    const result = await callModelWithRetry({ label, model, provider, market, env, fetchImpl });
    predictions.push(result);
  }

  return {
    id: crypto.randomUUID(),
    market,
    predictions,
    consensus: aggregateReport(market, predictions),
    disclaimer: '非财务建议，非稳赢预测。模型输出仅用于概率分析和复盘。',
    createdAt: new Date().toISOString()
  };
}

export async function rankMarkets(markets, modelLabel = 'all', env = process.env, fetchImpl = fetch, matchContext = null) {
  if (!hasAnyApiKey(env)) {
    throw new Error('缺少模型 API Key，请配置 OPENROUTER_API_KEY / OPENAI_API_KEY / APIMART_API_KEY');
  }

  const models = configuredModels(env);
  const selected = modelLabel === 'all'
    ? models
    : models.filter(([label,, alias]) => [label, alias].some((value) => String(value).toLowerCase() === String(modelLabel).toLowerCase()));
  if (selected.length === 0) throw new Error(`没有找到模型: ${modelLabel}`);

  const sourceMarkets = buildRankingMarkets(markets, matchContext);
  const compactMarkets = sourceMarkets.map((market) => ({
    id: market.id,
    matchName: market.matchName,
    marketType: market.marketType,
    selection: market.selection,
    line: market.line,
    odds: market.odds
  }));

  const results = [];
  for (const [label, model,, provider] of selected) {
    results.push(await callRankingModelWithRetry({ label, model, provider, markets: compactMarkets, env, fetchImpl, matchContext }));
  }

  return {
    id: crypto.randomUUID(),
    results,
    marketCount: compactMarkets.length,
    createdAt: new Date().toISOString(),
    disclaimer: 'AI 概率来自模型预测，不是赔率换算；非财务建议，非稳赢预测。'
  };
}

async function callModelWithRetry(args) {
  const first = await callModel(args);
  if (!first.error) return first;
  const second = await callModel({ ...args, retry: true });
  return second.error ? { ...second, firstError: first.error } : second;
}

async function callRankingModelWithRetry(args) {
  const first = await callRankingModel(args);
  if (!first.error) return first;
  const second = await callRankingModel({ ...args, retry: true });
  return second.error ? { ...second, firstError: first.error } : second;
}

async function callModel({ label, model, provider, market, env, fetchImpl, retry = false }) {
  try {
    const client = modelClient(provider, env);
    const request = modelRequest({
      client,
      provider,
      model,
      system: systemPrompt(),
      user: userPrompt(market, retry),
      temperature: retry ? 0 : 0.2,
      maxTokens: 4000
    });
    const response = await fetchImpl(request.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${client.apiKey}`,
        'Content-Type': 'application/json',
        ...client.extraHeaders
      },
      body: JSON.stringify(request.body)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${client.name} ${response.status}: ${body.slice(0, 300)}`);
    }

    const data = await readModelResponse(response);
    const content = extractModelContent(data);
    const parsed = parseModelJson(content);
    return {
      modelName: label,
      modelId: model,
      provider: client.name,
      prediction: validatePrediction(parsed, label)
    };
  } catch (error) {
    return {
      modelName: label,
      modelId: model,
      provider: providerLabel(provider),
      error: error.message
    };
  }
}

async function callRankingModel({ label, model, provider, markets, env, fetchImpl, matchContext = null, retry = false }) {
  try {
    const client = modelClient(provider, env);
    const request = modelRequest({
      client,
      provider,
      model,
      system: rankingSystemPromptV2(),
      user: rankingUserPromptV2(markets, matchContext, retry),
      temperature: retry ? 0 : 0.15,
      maxTokens: 2200
    });
    const response = await fetchImpl(request.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${client.apiKey}`,
        'Content-Type': 'application/json',
        ...client.extraHeaders
      },
      body: JSON.stringify(request.body)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${client.name} ${response.status}: ${body.slice(0, 300)}`);
    }

    const data = await readModelResponse(response);
    const content = extractModelContent(data);
    const parsed = normalizeRankingResponse(parseModelJson(content));
    const rawPicks = validateRankingPicks(parsed, markets);
    const rawScorePicks = validateScorePicks(parsed, markets);
    const rawBttsPick = validateBttsPick(parsed);
    const picks = rawPicks.filter((pick) => pick.estimatedProbability >= 0.6).slice(0, 4);
    const scorePicks = ensureScorePickCount(
      alignScorePicksWithTotals(rawScorePicks, picks, markets),
      picks,
      markets
    ).slice(0, SCORE_PICK_COUNT);
    const bttsPick = rawBttsPick || inferBttsPick(scorePicks);
    return {
      modelName: label,
      modelId: model,
      provider: client.name,
      generatedAt: new Date().toISOString(),
      picks,
      scorePicks,
      bttsPick
    };
  } catch (error) {
    return {
      modelName: label,
      modelId: model,
      provider: providerLabel(provider),
      generatedAt: new Date().toISOString(),
      error: error.message,
      picks: [],
      scorePicks: [],
      bttsPick: null
    };
  }
}

function providerLabel(provider = 'openrouter') {
  if (provider === 'apimart') return 'APIMart';
  return provider === 'openai' ? 'OpenAI' : 'OpenRouter';
}

function hasAnyApiKey(env = process.env) {
  return Boolean(cleanEnvValue(env.OPENROUTER_API_KEY) || cleanEnvValue(env.OPENAI_API_KEY) || cleanEnvValue(env.APIMART_API_KEY));
}

function cleanEnvValue(value = '') {
  return String(value || '').replace(/^\uFEFF/, '').trim();
}

function stripJsonFence(content) {
  return String(content).replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
}

function modelClient(provider = 'openrouter', env = process.env) {
  if (provider === 'apimart') {
    const apiKey = cleanEnvValue(env.APIMART_API_KEY);
    if (!apiKey) throw new Error('缺少 APIMART_API_KEY，GPT 模型无法通过 APIMart 调用');
    return {
      name: 'APIMart',
      baseUrl: cleanEnvValue(env.APIMART_BASE_URL || 'https://api.apimart.ai/api/v1').replace(/\/$/, ''),
      apiKey,
      extraHeaders: {}
    };
  }

  if (provider === 'openai') {
    const apiKey = cleanEnvValue(env.OPENAI_API_KEY);
    if (!apiKey) throw new Error('缺少 OPENAI_API_KEY，GPT 模型无法直连 OpenAI');
    return {
      name: 'OpenAI',
      baseUrl: cleanEnvValue(env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      apiKey,
      extraHeaders: {}
    };
  }

  const apiKey = cleanEnvValue(env.OPENROUTER_API_KEY);
  if (!apiKey) throw new Error('缺少 OPENROUTER_API_KEY，OpenRouter 模型无法调用');
  return {
    name: 'OpenRouter',
    baseUrl: cleanEnvValue(env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
    apiKey,
    extraHeaders: {
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'Football Odds LLM Predictor'
    }
  };
}

function parseModelJson(content) {
  const cleaned = stripJsonFence(content)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/，/g, ',')
    .replace(/：/g, ':')
    .replace(/,\s*([}\]])/g, '$1');
  const repaired = repairLooseJson(cleaned);
  try {
    return JSON.parse(repaired);
  } catch (error) {
    const extracted = extractJsonObject(repaired);
    if (!extracted) throw new Error(`模型返回的 JSON 格式无效: ${error.message}`);
    try {
      return JSON.parse(repairLooseJson(extracted).replace(/,\s*([}\]])/g, '$1'));
    } catch (innerError) {
      throw new Error(`模型返回的 JSON 格式无效: ${innerError.message}`);
    }
  }
}

function repairLooseJson(value) {
  return String(value || '')
    .replace(/}\s*{/g, '},{')
    .replace(/]\s*{/g, '],{')
    .replace(/"\s+"/g, '","')
    .replace(/(\d)\s+"/g, '$1,"')
    .replace(/(true|false|null)\s+"/g, '$1,"');
}

function extractJsonObject(text) {
  const source = String(text || '');
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start === -1 || end <= start) return '';
  return source.slice(start, end + 1);
}

function systemPrompt() {
  return [
    '你是谨慎的足球盘口概率分析助手。',
    '你不能声称稳赢，不能建议重注，不能忽略风险。',
    '只输出 JSON，不要 Markdown。',
    '字段必须是 direction, estimatedProbability, confidence, reasons, risks, abstain。',
    'estimatedProbability 和 confidence 用 0 到 1 小数。'
  ].join('\n');
}

function rankingSystemPrompt() {
  return [
    '你是谨慎的足球盘口概率排序助手。',
    '你会看到一组已导入盘口，只能从给定 market id 中选择。',
    '你的任务是选出你认为预测概率最高、信息相对最清楚的前 4 个盘口。',
    'estimatedProbability 是你自己对该选择打出的命中概率，0 到 1 小数，不是赔率隐含概率。',
    '不要承诺盈利，不要建议下注金额，不要输出 Markdown。',
    '只输出 JSON。'
  ].join('\n');
}

function rankingSystemPromptV2() {
  return [
    'You are a professional football betting market analyst with strict probability-calibration discipline.',
    'Evaluate only the supplied match and candidate markets. Never invent a marketId, selection, injury, lineup, statistic, weather condition, or team fact.',
    'Your goal is to identify the most predictable, best-supported value opportunities with the clearest information advantage and lowest uncertainty.',
    'Use every data block that is actually present. Do not invent missing data, and do not treat a missing value as evidence for either team.',
    'Evidence priority: (1) current standings, recent form, home/away splits, confirmed lineups and injuries; (2) team and player statistics, tactical matchup and squad availability; (3) bookmaker odds and market movement as consensus signals only; (4) H2H, third-party predictions, coaches, venue and competition stage as supporting context.',
    'H2H must never dominate when the sample is small, old, or drawn from materially different squads.',
    'estimatedProbability is your independent assessment from 0 to 1. Never back-calculate it from the offered odds.',
    'Calibrate conservatively: 0.90-0.95 is exceptional and must be extremely rare; 0.80-0.89 is high; 0.70-0.79 is strong; 0.60-0.69 is acceptable. Return only picks at or above 0.60 and reduce confidence when evidence is incomplete.',
    'Missing information is uncertainty, not evidence of strength or weakness. Never invent a favorable fallback or penalize a team unless a true disadvantage is confirmed in the supplied data.',
    'Return up to 4 picks, but do not force weak or redundant recommendations. Avoid highly correlated markets when one adds no new information.',
    'Use odds to assess market consensus and potential value, not as ground truth. The application calculates implied probability and edge.',
    'Return the existing response contract with picks, scorePicks, and bttsPick. Keep correct-score predictions and both-teams-to-score separate from picks.',
    'Sort picks and scorePicks by estimatedProbability descending. Keep all probabilities logically consistent with totals, handicaps, scorelines, and bttsPick.',
    'All JSON keys and enum values must remain in English. All user-facing reason and risks strings must be written in English. All notes must also be in English.',
    'Never recommend stake sizes, guarantee profit, or claim certainty.',
    'Output one valid raw JSON object only. Do not output Markdown, prose outside JSON, hidden reasoning, or commentary.'
  ].join('\n');
}

function completionTokenLimit(provider, limit) {
  return String(provider).toLowerCase() === 'openai'
    ? { max_completion_tokens: limit }
    : { max_tokens: limit };
}

function completionTokenBudget(provider, fallback, model = '') {
  const normalizedProvider = String(provider).toLowerCase();
  const normalizedModel = String(model).toLowerCase();
  if (normalizedProvider === 'openai') return 8000;
  if (normalizedProvider === 'apimart' && normalizedModel.includes('gemini')) return 8000;
  return fallback;
}

function modelTemperature(provider, value) {
  return String(provider).toLowerCase() === 'openai'
    ? {}
    : { temperature: value };
}

function modelRequest({ client, provider, model, system, user, temperature, maxTokens }) {
  if (String(provider).toLowerCase() === 'openai') {
    return {
      url: `${client.baseUrl}/responses`,
      body: {
        model,
        instructions: system,
        input: user,
        max_output_tokens: completionTokenBudget(provider, maxTokens, model),
        text: { format: { type: 'json_object' } }
      }
    };
  }

  return {
    url: `${client.baseUrl}/chat/completions`,
    body: {
      model,
      ...modelTemperature(provider, temperature),
      ...completionTokenLimit(provider, completionTokenBudget(provider, maxTokens, model)),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      response_format: { type: 'json_object' }
    }
  };
}

function extractModelContent(data) {
  const choice = data?.choices?.[0] || {};
  const message = choice.message || {};
  const content = normalizeContent(message.content || data?.output_text || choice.text || responseOutputText(data));
  if (content) return content;
  if (message.refusal) throw new Error(`模型拒绝返回: ${message.refusal}`);
  if (choice.finish_reason === 'length') {
    throw new Error('模型输出被截断：已消耗全部输出 token，请重跑一次或减少输入数据。');
  }
  throw new Error(`模型没有返回 content${choice.finish_reason ? `，finish_reason=${choice.finish_reason}` : ''}`);
}

async function readModelResponse(response) {
  if (typeof response.text !== 'function') return response.json();
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch (error) {
    const streamed = parseSseCompletion(body);
    if (streamed) return streamed;
    throw error;
  }
}

function parseSseCompletion(body) {
  const chunks = String(body || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== '[DONE]');
  if (!chunks.length) return null;

  let content = '';
  let finishReason = '';
  let latest = null;
  for (const chunk of chunks) {
    const parsed = JSON.parse(chunk);
    const choice = parsed?.choices?.[0] || {};
    content += normalizeContent(choice.delta?.content || choice.message?.content || choice.text);
    finishReason = choice.finish_reason || finishReason;
    latest = parsed;
  }
  if (!latest) return null;
  return {
    ...latest,
    choices: [{
      ...(latest.choices?.[0] || {}),
      message: { ...(latest.choices?.[0]?.message || {}), content },
      finish_reason: finishReason || latest.choices?.[0]?.finish_reason
    }]
  };
}

function responseOutputText(data) {
  if (!Array.isArray(data?.output)) return '';
  return data.output.map((item) => normalizeContent(item?.content)).join('').trim();
}

function normalizeContent(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      return part?.text || part?.content || part?.value || part?.output_text || '';
    }).join('').trim();
  }
  return '';
}

function userPrompt(market, retry) {
  return JSON.stringify({
    task: retry ? '上次输出无效。请严格返回 JSON 对象。' : '分析这条足球盘口是否存在概率价值。',
    market,
    requiredShape: {
      direction: '选择方向，例如 韩国 -0.5/1 或 放弃',
      estimatedProbability: 0.56,
      confidence: 0.42,
      reasons: ['最多 6 条简短理由'],
      risks: ['最多 6 条风险'],
      abstain: false
    },
    rules: [
      '没有足够信息时 abstain=true',
      '不要输出下注金额',
      '不要承诺盈利',
      '优先指出盘口、赔率、信息缺口和模型不确定性'
    ]
  });
}

function rankingUserPrompt(markets, matchContext, retry) {
  return JSON.stringify({
    task: retry ? '上次输出无效。请严格返回 JSON 对象，并只从给定 id 中选择前 4 个。' : '从这些盘口中选出预测概率最高的前 4 个，并按 estimatedProbability 从大到小排序。',
    markets,
    matchContext: compactMatchContext(matchContext),
    requiredShape: {
      picks: [
        {
          marketId: '必须来自 markets[].id',
          estimatedProbability: 0.61,
          confidence: 0.45,
          reason: '一句话理由',
          risks: ['最多 3 条风险']
        }
      ]
    },
    rules: [
      '只能返回 picks 数组，最多 4 个',
      '不要选择你无法理解的盘口',
      'estimatedProbability 是 AI 预测概率，不是赔率换算',
      '如果信息不足，仍可少于 4 个',
      '按 estimatedProbability 从大到小排序'
    ]
  });
}

function rankingUserPromptV2(markets, matchContext, retry) {
  return JSON.stringify({
    task: retry
      ? 'The previous output was invalid. Return one valid JSON object with up to 4 qualifying picks, exactly 4 scorePicks, and exactly 1 bttsPick. Use English for every reason, risk, and note.'
      : 'Return up to 4 best-supported markets with independent estimatedProbability of at least 0.60, then provide exactly 4 correct-score paths and 1 both-teams-to-score assessment. Use English for every reason, risk, and note.',
    markets,
    matchContext: compactMatchContext(matchContext),
    requiredShape: {
      picks: [
        {
          marketId: 'must come from markets[].id',
          estimatedProbability: 0.61,
          confidence: 0.45,
          reason: 'One concise evidence-based reason in English',
          risks: ['Up to 3 concise risks in English']
        }
      ],
      scorePicks: [
        {
          marketId: 'must be a score market id from markets[] when available',
          score: '2:1',
          scoreType: 'mainline | market_fit | aggressive',
          estimatedProbability: 0.18,
          confidence: 0.36,
          reason: 'One concise scoreline reason in English'
        }
      ],
      bttsPick: {
        selection: 'Yes | No',
        estimatedProbability: 0.62,
        confidence: 0.48,
        reason: 'One concise evidence-based reason in English',
        risks: ['Up to 3 concise risks in English']
      }
    },
    rules: [
      'Return raw JSON only, with no Markdown.',
      'picks may contain 0-4 non-score selections, every estimatedProbability must be at least 0.60, and every marketId must exist in markets[].id.',
      'Return fewer picks when fewer than 4 markets meet the threshold. Never fill the list with a weaker selection.',
      'When evidence permits, diversify across moneyline, handicap, and total markets, but do not add a correlated market merely to cover a category.',
      'Do not place correct-score markets in picks unless no other valid market exists; correct scores belong in scorePicks.',
      'scorePicks must contain exactly 4 entries: two mainline, one market_fit, and one aggressive.',
      'The mainline scores are the two most realistic paths; market_fit must fit the strongest handicap/total view; aggressive is higher variance but still plausible.',
      'Assess the total-goals direction before selecting scorelines, and keep every scorePick consistent with the strongest total pick.',
      'If picks contains Over 2.5, every scorePick must total at least 3 goals; if it contains Under 2.5, every scorePick must total at most 2 goals.',
      'If picks contains Over 3.5, every scorePick must total at least 4 goals; if it contains Under 3.5, every scorePick must total at most 3 goals.',
      'Use an existing score marketId when available; otherwise still provide the score text.',
      'bttsPick selection must be exactly "Yes" or "No" and must be logically consistent with the weighted scorePicks.',
      'estimatedProbability is an independent model probability, not an odds conversion.',
      'Sort picks and scorePicks by estimatedProbability descending.',
      'Write reason, risks, scorePicks.reason, and bttsPick.reason in English only.',
      'Do not promise profit or recommend a stake amount.'
    ]
  });
}
function compactMatchContext(context) {
  if (!context) return null;
  return {
    source: context.source,
    matchName: context.matchName,
    kickoff: context.kickoff,
    fixture: context.fixture,
    catalog: context.catalog,
    analysis: context.analysis,
    lineup: context.lineup,
    index: context.index,
    experts: context.experts,
    live: context.live
  };
}

function contextCandidateMarkets(context) {
  if (!context?.teams?.length) return [];
  const [home, away] = context.teams;
  const matchName = context.matchName || `${home} v ${away}`;
  const scores = ['0:0', '0:1', '1:1', '1:2', '0:2', '1:0', '2:1', '2:2', '3:0', '0:3', '3:1', '1:3', '4:0', '0:4'];
  const liveHandicapMarkets = liveHandicapMarketsFromContext(context, home, away, matchName);
  const liveTotalMarkets = liveTotalMarketsFromContext(context, matchName);
  const fallbackHandicapMarkets = [
    { id: 'ctx-handicap-home-plus-0.5', matchName, marketType: '\u8db3\u7403 \u4e9a\u6d32\u8ba9\u5206\u76d8', selection: home, line: '+0.5', odds: null },
    { id: 'ctx-handicap-away-minus-0.5', matchName, marketType: '\u8db3\u7403 \u4e9a\u6d32\u8ba9\u5206\u76d8', selection: away, line: '-0.5', odds: null },
    { id: 'ctx-handicap-home-plus-1', matchName, marketType: '\u8db3\u7403 \u4e9a\u6d32\u8ba9\u5206\u76d8', selection: home, line: '+1', odds: null },
    { id: 'ctx-handicap-away-minus-1', matchName, marketType: '\u8db3\u7403 \u4e9a\u6d32\u8ba9\u5206\u76d8', selection: away, line: '-1', odds: null }
  ];
  return [
    { id: 'ctx-moneyline-home', matchName, marketType: '\u8db3\u7403 \u80dc\u5e73\u8d1f', selection: home, line: '\u80dc\u5e73\u8d1f', odds: null },
    { id: 'ctx-moneyline-draw', matchName, marketType: '\u8db3\u7403 \u80dc\u5e73\u8d1f', selection: '\u5e73\u5c40', line: '\u80dc\u5e73\u8d1f', odds: null },
    { id: 'ctx-moneyline-away', matchName, marketType: '\u8db3\u7403 \u80dc\u5e73\u8d1f', selection: away, line: '\u80dc\u5e73\u8d1f', odds: null },
    ...(liveHandicapMarkets.length ? liveHandicapMarkets : fallbackHandicapMarkets),
    ...(liveTotalMarkets.length ? liveTotalMarkets : [
      { id: 'ctx-total-over-2.5', matchName, marketType: '\u8db3\u7403 \u5927\u5c0f\u7403', selection: '\u5927', line: '2.5', odds: null },
      { id: 'ctx-total-under-2.5', matchName, marketType: '\u8db3\u7403 \u5927\u5c0f\u7403', selection: '\u5c0f', line: '2.5', odds: null },
      { id: 'ctx-total-over-3.5', matchName, marketType: '\u8db3\u7403 \u5927\u5c0f\u7403', selection: '\u5927', line: '3.5', odds: null },
      { id: 'ctx-total-under-3.5', matchName, marketType: '\u8db3\u7403 \u5927\u5c0f\u7403', selection: '\u5c0f', line: '3.5', odds: null }
    ]),
    ...scores.map((score) => ({ id: `ctx-score-${score}`, matchName, marketType: '\u8db3\u7403 \u6bd4\u5206', selection: score, line: '\u6b63\u786e\u6bd4\u5206', odds: null }))
  ];
}

function liveHandicapMarketsFromContext(context, home, away, matchName) {
  const rows = context?.index?.live?.asia || [];
  const seen = new Set();
  const markets = [];
  for (const row of rows) {
    const lineInfo = handicapLinesFromLiveRow(row);
    if (!lineInfo) continue;
    const homeKey = `home:${lineInfo.homeLine}`;
    if (!seen.has(homeKey)) {
      seen.add(homeKey);
      markets.push({
        id: `ctx-live-handicap-home-${slugLine(lineInfo.homeLine)}`,
        matchName,
        marketType: '\u8db3\u7403 \u4e9a\u6d32\u8ba9\u5206\u76d8',
        selection: home,
        line: lineInfo.homeLine,
        odds: numericOrNull(row.home)
      });
    }
    const awayKey = `away:${lineInfo.awayLine}`;
    if (!seen.has(awayKey)) {
      seen.add(awayKey);
      markets.push({
        id: `ctx-live-handicap-away-${slugLine(lineInfo.awayLine)}`,
        matchName,
        marketType: '\u8db3\u7403 \u4e9a\u6d32\u8ba9\u5206\u76d8',
        selection: away,
        line: lineInfo.awayLine,
        odds: numericOrNull(row.away)
      });
    }
    if (markets.length >= 6) break;
  }
  return markets;
}

function liveTotalMarketsFromContext(context, matchName) {
  const rows = context?.index?.live?.size || [];
  const seen = new Set();
  const markets = [];
  for (const row of rows) {
    const line = String(row.line || '').trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    markets.push({
      id: `ctx-live-total-over-${slugLine(line)}`,
      matchName,
      marketType: '\u8db3\u7403 \u5927\u5c0f\u7403',
      selection: '\u5927',
      line,
      odds: numericOrNull(row.home)
    });
    markets.push({
      id: `ctx-live-total-under-${slugLine(line)}`,
      matchName,
      marketType: '\u8db3\u7403 \u5927\u5c0f\u7403',
      selection: '\u5c0f',
      line,
      odds: numericOrNull(row.away)
    });
    if (markets.length >= 6) break;
  }
  return markets;
}

function handicapLinesFromLiveRow(row = {}) {
  const absLine = Math.abs(Number(row.lineValue));
  if (!Number.isFinite(absLine) || absLine <= 0) return null;
  const text = String(row.line || '');
  if (/\u53d7/.test(text)) return { homeLine: formatSignedLine(absLine), awayLine: formatSignedLine(-absLine) };
  if (/\u8ba9/.test(text)) return { homeLine: formatSignedLine(-absLine), awayLine: formatSignedLine(absLine) };
  const signed = Number(row.lineValue);
  return { homeLine: formatSignedLine(-signed), awayLine: formatSignedLine(signed) };
}

function formatSignedLine(value) {
  const rounded = Math.round(Number(value) * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, '').replace(/\.$/, '');
  return rounded > 0 ? `+${text}` : text;
}

function slugLine(line) {
  return String(line)
    .replace('+', 'plus-')
    .replace('-', 'minus-')
    .replace(/[./\s]+/g, '-');
}

function numericOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildRankingMarkets(markets, context) {
  const selected = markets.length ? selectRankingMarkets(markets) : [];
  const contextMarkets = contextCandidateMarkets(context);
  if (!selected.length) return contextMarkets;

  const hasScoreMarkets = selected.some((market) => isScoreMarket(market));
  const withContextScores = hasScoreMarkets
    ? selected
    : [
        ...selected,
        ...contextMarkets.filter((market) => isScoreMarket(market))
      ];

  const seen = new Set();
  return withContextScores
    .filter((market) => {
      if (seen.has(market.id)) return false;
      seen.add(market.id);
      return true;
    })
    .slice(0, 48);
}

function selectRankingMarkets(markets) {
  const latestSource = [...markets]
    .map((market) => market.sourceUrl)
    .filter(Boolean)
    .find((sourceUrl) => sourceUrl.includes('stake.com'));
  const sourceFiltered = latestSource
    ? markets.filter((market) => market.sourceUrl === latestSource)
    : markets;

  const matchName = mostCommon(sourceFiltered.map((market) => market.matchName).filter(Boolean));
  const matchFiltered = matchName
    ? sourceFiltered.filter((market) => market.matchName === matchName)
    : sourceFiltered;

  return [
    ...matchFiltered.filter((market) => /胜平负/.test(market.marketType)).slice(0, 3),
    ...matchFiltered.filter((market) => /亚洲让分盘|让球/.test(market.marketType) && isCoreLine(market.line)).slice(0, 12),
    ...matchFiltered.filter((market) => /大小球|大\/小/.test(market.marketType) && isCoreTotal(market.line)).slice(0, 12),
    ...matchFiltered.filter((market) => /比分/.test(market.marketType) && isCoreScore(market.selection)).slice(0, 16)
  ].slice(0, 40);
}

function mostCommon(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

function isCoreLine(line) {
  const value = Math.abs(Number(String(line).replace('+', '')));
  return Number.isFinite(value) && value <= 1.5;
}

function isCoreTotal(line) {
  const value = Number(line);
  return Number.isFinite(value) && value >= 2 && value <= 3.5;
}

function isCoreScore(selection) {
  if (selection === '其他') return true;
  const match = String(selection).match(/^(\d+)[:\-](\d+)$/);
  if (!match) return false;
  const total = Number(match[1]) + Number(match[2]);
  return total <= 4;
}

function splitMatchTeams(matchName) {
  return String(matchName || '')
    .split(/\s+(?:v|vs|VS|V|对|vs\.|VS\.)\s+|[-–—]/)
    .map((team) => team.trim())
    .filter(Boolean)
    .slice(0, 2);
}

function sameTeam(selection, team) {
  const normalize = (value) => String(value || '').toLowerCase().replace(/\s+/g, '');
  const a = normalize(selection);
  const b = normalize(team);
  return a && b && (a.includes(b) || b.includes(a));
}

function normalizeRankingResponse(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const selections = Array.isArray(parsed.selections) ? parsed.selections : [];
  const scorelines = Array.isArray(parsed.scorelinePredictions) ? parsed.scorelinePredictions : [];
  const fallbackQuality = selections.find((item) => item?.dataQuality)?.dataQuality;
  const analystNote = String(parsed.analystNote || '').trim();

  return {
    ...parsed,
    picks: Array.isArray(parsed.picks)
      ? parsed.picks
      : selections.map((item) => ({
          ...item,
          confidence: alternateConfidence(item, fallbackQuality),
          reason: alternateReason(item, analystNote),
          risks: Array.isArray(item?.risks) ? item.risks : []
        })),
    scorePicks: Array.isArray(parsed.scorePicks)
      ? parsed.scorePicks
      : scorelines.map((item) => ({
          ...item,
          score: item?.score ?? item?.scoreline,
          confidence: alternateConfidence(item, fallbackQuality),
          reason: alternateReason(item, 'Model scoreline projection.')
        })),
    bttsPick: parsed.bttsPick || (parsed.bothTeamsToScore
      ? {
          ...parsed.bothTeamsToScore,
          confidence: alternateConfidence(parsed.bothTeamsToScore, fallbackQuality),
          reason: alternateReason(parsed.bothTeamsToScore, analystNote),
          risks: Array.isArray(parsed.bothTeamsToScore.risks) ? parsed.bothTeamsToScore.risks : []
        }
      : null)
  };
}

function alternateConfidence(item, fallbackQuality) {
  const explicit = normalizeModelProbability(item?.confidence);
  if (explicit !== null) return explicit;
  const quality = String(item?.dataQuality || fallbackQuality || '').toUpperCase();
  const qualityConfidence = quality === 'FULL' ? 0.65 : quality === 'PARTIAL' ? 0.5 : quality === 'MINIMAL' ? 0.35 : 0.4;
  return item?.confidenceFlag === false ? Math.min(qualityConfidence, 0.35) : qualityConfidence;
}

function alternateReason(item, fallback = '') {
  const reason = String(item?.reason || '').trim();
  if (reason) return reason;
  const factors = Array.isArray(item?.keyFactors)
    ? item.keyFactors.map((factor) => String(factor).trim()).filter(Boolean)
    : [];
  return factors.length ? factors.join('; ') : fallback;
}

function validateRankingPicks(parsed, markets) {
  const allowed = new Map(markets.map((market) => [market.id, market]));
  const rawPicks = Array.isArray(parsed?.picks) ? parsed.picks : [];
  const picks = [];
  const seen = new Set();

  for (const raw of rawPicks) {
    const marketId = String(raw?.marketId || '').trim();
    if (!allowed.has(marketId) || seen.has(marketId)) continue;
    const estimatedProbability = normalizeModelProbability(raw?.estimatedProbability);
    const confidence = normalizeModelProbability(raw?.confidence);
    if (estimatedProbability === null || confidence === null) continue;
    seen.add(marketId);
    picks.push({
      marketId,
      market: allowed.get(marketId),
      estimatedProbability,
      confidence,
      reason: String(raw?.reason || '').trim().slice(0, 240),
      risks: Array.isArray(raw?.risks) ? raw.risks.map(String).slice(0, 3) : []
    });
  }

  return picks.sort((a, b) => b.estimatedProbability - a.estimatedProbability);
}

function completeRankingPicks(picks, scorePicks, markets) {
  const completed = [...picks];
  const seen = new Set(completed.map((pick) => pick.marketId));
  const nonScoreCount = completed.filter((pick) => !isScoreMarket(pick.market)).length;

  if (completed.length >= 4 && nonScoreCount >= 3) {
    return completed.sort((a, b) => b.estimatedProbability - a.estimatedProbability);
  }

  for (const pick of inferPicksFromScores(scorePicks, markets)) {
    if (seen.has(pick.marketId)) continue;
    seen.add(pick.marketId);
    completed.push(pick);
    if (completed.length >= 4) break;
  }

  return completed.sort((a, b) => b.estimatedProbability - a.estimatedProbability);
}

function alignScorePicksWithTotals(scorePicks, picks, markets) {
  const totalPick = strongestTotalPick(picks);
  if (!totalPick) return scorePicks.sort((a, b) => b.estimatedProbability - a.estimatedProbability);

  const seen = new Set();
  const aligned = scorePicks
    .filter((pick) => scoreMatchesTotalPick(pick.score, totalPick))
    .filter((pick) => {
      if (seen.has(pick.score)) return false;
      seen.add(pick.score);
      return true;
    });

  if (aligned.length >= SCORE_PICK_COUNT) {
    return aligned.slice(0, SCORE_PICK_COUNT).map((pick, index) => ({ ...pick, scoreType: normalizeScoreType(pick.scoreType, index) }));
  }

  for (const score of fallbackScoresForTotalPick(totalPick, markets)) {
    if (seen.has(score)) continue;
    seen.add(score);
    aligned.push(syntheticScorePick(score, totalPick, markets, aligned.length));
    if (aligned.length >= SCORE_PICK_COUNT) break;
  }

  return aligned.map((pick, index) => ({ ...pick, scoreType: normalizeScoreType(pick.scoreType, index) }));
}

function ensureScorePickCount(scorePicks, picks, markets) {
  const totalPick = strongestTotalPick(picks);
  const result = [...(scorePicks || [])].map((pick, index) => ({ ...pick, scoreType: normalizeScoreType(pick.scoreType, index) }));
  const seen = new Set(result.map((pick) => pick.score));
  const fallback = totalPick
    ? fallbackScoresForTotalPick(totalPick, markets)
    : fallbackScoresForAnyMatch(markets);
  for (const score of fallback) {
    if (result.length >= SCORE_PICK_COUNT) break;
    if (seen.has(score)) continue;
    seen.add(score);
    result.push(syntheticScorePick(score, totalPick || picks?.[0], markets, result.length));
  }
  return result.slice(0, SCORE_PICK_COUNT).map((pick, index) => ({ ...pick, scoreType: normalizeScoreType(pick.scoreType, index) }));
}

function strongestTotalPick(picks = []) {
  return [...picks]
    .filter((pick) => isTotalMarket(pick.market))
    .sort((a, b) => b.estimatedProbability - a.estimatedProbability)[0] || null;
}

function isTotalMarket(market) {
  return /大小球|大\/小|总进球|total|over|under/i.test(String(market?.marketType || ''));
}

function totalPickRule(pick) {
  const line = Number(String(pick?.market?.line || '').match(/\d+(?:\.\d+)?/)?.[0]);
  if (!Number.isFinite(line)) return null;
  const selection = String(pick?.market?.selection || '');
  const direction = /大|over/i.test(selection) ? 'over' : /小|under/i.test(selection) ? 'under' : '';
  return direction ? { direction, line } : null;
}

function scoreMatchesTotalPick(score, totalPick) {
  const rule = totalPickRule(totalPick);
  const parsed = parseScorePair(score);
  if (!rule || !parsed) return true;
  const totalGoals = parsed[0] + parsed[1];
  return rule.direction === 'over'
    ? totalGoals > rule.line
    : totalGoals < rule.line;
}

function fallbackScoresForTotalPick(totalPick, markets) {
  const rule = totalPickRule(totalPick);
  if (!rule) return [];
  const scoreMarkets = markets
    .filter(isScoreMarket)
    .map((market) => normalizeScore(market.selection))
    .filter(Boolean)
    .filter((score) => scoreMatchesTotalPick(score, totalPick));
  const defaults = rule.direction === 'over'
    ? ['2:1', '1:2', '3:1', '2:2', '3:0', '0:3', '4:1']
    : ['1:0', '0:1', '1:1', '0:0', '2:0', '0:2'];
  return [...scoreMarkets, ...defaults]
    .filter((score, index, list) => list.indexOf(score) === index)
    .slice(0, 8);
}

function fallbackScoresForAnyMatch(markets) {
  const scoreMarkets = markets
    .filter(isScoreMarket)
    .map((market) => normalizeScore(market.selection))
    .filter(Boolean);
  return [...scoreMarkets, '1:0', '0:1', '1:1', '2:1', '1:2', '2:0', '0:2', '3:1', '1:3']
    .filter((score, index, list) => list.indexOf(score) === index)
    .slice(0, 12);
}

function syntheticScorePick(score, totalPick, markets, index = 0) {
  const market = markets.find((item) => normalizeScore(item.selection) === score && isScoreMarket(item))
    || syntheticScoreMarket(score, markets);
  return {
    marketId: market.id,
    market,
    score,
    scoreType: normalizeScoreType(null, index),
    estimatedProbability: Math.max(0.08, Math.min(0.22, Number(totalPick?.estimatedProbability || 0.5) * 0.25)),
    confidence: Math.max(0.2, Math.min(0.45, Number(totalPick?.confidence || 0.35) * 0.75)),
    reason: '根据大小球主判断补齐的兼容比分'
  };
}

function inferPicksFromScores(scorePicks, markets) {
  const topScore = [...(scorePicks || [])].sort((a, b) => b.estimatedProbability - a.estimatedProbability)[0];
  const parsed = parseScorePair(topScore?.score);
  if (!parsed) return [];

  const [homeGoals, awayGoals] = parsed;
  const totalGoals = homeGoals + awayGoals;
  const margin = homeGoals - awayGoals;
  const inferred = [
    inferMoneylinePick(markets, margin, topScore),
    inferTotalPick(markets, totalGoals, topScore),
    inferHandicapPick(markets, margin, topScore)
  ].filter(Boolean);

  return inferred;
}

function inferMoneylinePick(markets, margin, scorePick) {
  const target = markets.find((market) => {
    if (!/胜平负|1x2|moneyline/i.test(String(market.marketType || ''))) return false;
    if (margin === 0) return /平|draw|tie/i.test(String(market.selection || ''));
    const teams = splitMatchTeams(market.matchName);
    return margin > 0
      ? sameTeam(market.selection, teams[0])
      : sameTeam(market.selection, teams[1]);
  });
  return target ? inferredPick(target, scorePick, 'Match result direction inferred from the model\'s highest-probability scoreline.') : null;
}

function inferTotalPick(markets, totalGoals, scorePick) {
  const target = markets.find((market) => {
    if (!/大小球|大\/小|total|over|under/i.test(String(market.marketType || ''))) return false;
    const line = Number(String(market.line || '').match(/\d+(?:\.\d+)?/)?.[0]);
    if (!Number.isFinite(line)) return false;
    const wantsOver = totalGoals > line;
    return wantsOver
      ? /大|over/i.test(String(market.selection || ''))
      : /小|under/i.test(String(market.selection || ''));
  });
  return target ? inferredPick(target, scorePick, 'Goals-total direction inferred from the model\'s highest-probability scoreline.') : null;
}

function inferHandicapPick(markets, margin, scorePick) {
  const candidates = markets.filter((market) => /亚洲让分盘|让球|handicap/i.test(String(market.marketType || '')));
  if (!candidates.length) return null;
  const target = candidates.find((market) => handicapCovers(market, margin))
    || candidates.find((market) => {
      const teams = splitMatchTeams(market.matchName);
      if (margin > 0) return sameTeam(market.selection, teams[0]);
      if (margin < 0) return sameTeam(market.selection, teams[1]);
      return Number(String(market.line || '').replace('+', '')) > 0;
    });
  return target ? inferredPick(target, scorePick, 'Handicap direction inferred from the model\'s highest-probability scoreline.') : null;
}

function inferredPick(market, scorePick, reason) {
  const probability = Math.max(0.42, Math.min(0.72, Number(scorePick?.estimatedProbability || 0.18) + 0.38));
  return {
    marketId: market.id,
    market,
    estimatedProbability: probability,
    confidence: Math.max(0.25, Math.min(0.55, Number(scorePick?.confidence || 0.32))),
    reason,
    inferred: true,
    risks: ['This market was inferred from score predictions rather than selected directly by the model.']
  };
}

function parseScorePair(score) {
  const match = normalizeScore(score).match(/^(\d+):(\d+)$/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function handicapCovers(market, margin) {
  const teams = splitMatchTeams(market.matchName);
  const line = Number(String(market.line || '').replace('+', ''));
  if (!Number.isFinite(line)) return false;
  const selectedMargin = sameTeam(market.selection, teams[0]) ? margin : -margin;
  return selectedMargin + line > 0;
}

function validateScorePicks(parsed, markets) {
  const allowed = new Map(markets.map((market) => [market.id, market]));
  const rawPicks = Array.isArray(parsed?.scorePicks) ? parsed.scorePicks : [];
  const picks = [];
  const seen = new Set();

  for (const raw of rawPicks) {
    const marketId = String(raw?.marketId || '').trim();
    const rawScore = normalizeScore(raw?.score);
    const market = allowed.get(marketId) || markets.find((item) => normalizeScore(item.selection) === rawScore);
    const score = normalizeScore(raw?.score || market?.selection);
    if (!score || seen.has(score)) continue;
    const estimatedProbability = normalizeModelProbability(raw?.estimatedProbability);
    const confidence = normalizeModelProbability(raw?.confidence);
    if (estimatedProbability === null || confidence === null) continue;
    const scoreMarket = market && isScoreMarket(market)
      ? market
      : syntheticScoreMarket(score, markets);
    seen.add(score);
    picks.push({
      marketId: scoreMarket.id,
      market: scoreMarket,
      score,
      scoreType: normalizeScoreType(raw?.scoreType, picks.length),
      estimatedProbability,
      confidence,
      reason: String(raw?.reason || '').trim().slice(0, 180)
    });
  }

  if (picks.length >= SCORE_PICK_COUNT) return picks.slice(0, SCORE_PICK_COUNT);

  const fallback = validateRankingPicks(parsed, markets)
    .filter((pick) => isScoreMarket(pick.market))
    .map((pick) => ({
      marketId: pick.marketId,
      market: pick.market,
      score: normalizeScore(pick.market.selection),
      scoreType: normalizeScoreType(null, picks.length),
      estimatedProbability: pick.estimatedProbability,
      confidence: pick.confidence,
      reason: pick.reason
    }))
    .filter((pick) => pick.score && !seen.has(pick.score));

  return [...picks, ...fallback]
    .slice(0, SCORE_PICK_COUNT)
    .map((pick, index) => ({ ...pick, scoreType: normalizeScoreType(pick.scoreType, index) }));
}

function validateBttsPick(parsed) {
  const raw = parsed?.bttsPick;
  if (!raw || typeof raw !== 'object') return null;
  const selection = normalizeBttsSelection(raw.selection ?? raw.bothTeamsToScore);
  const estimatedProbability = normalizeModelProbability(raw.estimatedProbability);
  const confidence = normalizeModelProbability(raw.confidence);
  if (!selection || estimatedProbability === null || confidence === null) return null;
  return {
    selection,
    estimatedProbability,
    confidence,
    reason: String(raw.reason || '').trim().slice(0, 240),
    risks: Array.isArray(raw.risks) ? raw.risks.map(String).slice(0, 3) : []
  };
}

function normalizeBttsSelection(value) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  const text = String(value || '').trim().toLowerCase();
  if (['是', 'yes', 'y', 'both', 'btts yes'].includes(text)) return 'Yes';
  if (['否', 'no', 'n', 'not both', 'btts no'].includes(text)) return 'No';
  return '';
}

function inferBttsPick(scorePicks = []) {
  const weighted = scorePicks
    .map((pick) => ({ pick, score: parseScorePair(pick.score), weight: Number(pick.estimatedProbability) }))
    .filter((item) => item.score && Number.isFinite(item.weight) && item.weight > 0);
  if (!weighted.length) return null;
  const yesWeight = weighted
    .filter((item) => item.score[0] > 0 && item.score[1] > 0)
    .reduce((sum, item) => sum + item.weight, 0);
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const yes = yesWeight >= totalWeight - yesWeight;
  const estimatedProbability = yes ? yesWeight / totalWeight : (totalWeight - yesWeight) / totalWeight;
  const confidence = weighted.reduce((sum, item) => sum + Number(item.pick.confidence || 0), 0) / weighted.length;
  return {
    selection: yes ? 'Yes' : 'No',
    estimatedProbability: Math.max(0.5, Math.min(0.85, estimatedProbability)),
    confidence: Math.max(0.2, Math.min(0.65, confidence * 0.8)),
    reason: yes ? 'The highest-probability scorelines more often contain goals by both teams.' : 'The highest-probability scorelines more often contain a clean sheet for at least one team.',
    risks: ['This assessment was inferred from score predictions and should be reviewed against confirmed lineups.']
  };
}

function normalizeScoreType(value, index = 0) {
  const text = String(value || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (['mainline', 'main', 'primary'].includes(text)) return 'mainline';
  if (['market_fit', 'market', '盘口', 'fit'].includes(text)) return 'market_fit';
  if (['aggressive', 'high_variance', 'bold', 'upside'].includes(text)) return 'aggressive';
  return SCORE_PICK_TYPES[Math.min(index, SCORE_PICK_TYPES.length - 1)] || 'mainline';
}

function syntheticScoreMarket(score, markets) {
  const base = markets[0] || {};
  return {
    id: `ai-score-${score}`,
    matchName: base.matchName || '比赛',
    marketType: '足球 比分',
    selection: score,
    line: '正确比分',
    odds: null
  };
}

function isScoreMarket(market) {
  return /^ctx-score-/.test(String(market?.id || ''))
    || /比分|score|correct/i.test(String(market?.marketType || ''))
    || Boolean(normalizeScore(market?.selection));
}

function normalizeScore(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})\s*[:\-]\s*(\d{1,2})$/);
  return match ? `${Number(match[1])}:${Number(match[2])}` : '';
}

function normalizeModelProbability(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num > 1 && num <= 100) return num / 100;
  if (num >= 0 && num <= 1) return num;
  return null;
}
