import test from 'node:test';
import assert from 'node:assert/strict';
import { rankMarkets } from '../src/openrouter.js';
import { buildMarket } from '../src/domain.js';

test('ranks markets from one model and keeps top four sorted by AI probability', async () => {
  const markets = [
    buildMarket({ id: 'a', matchName: 'A v B', marketType: '足球 比分', selection: '1:0', line: '正确比分', odds: 8 }),
    buildMarket({ id: 'b', matchName: 'A v B', marketType: '足球 大小球', selection: '大', line: '2.5', odds: 1.8 }),
    buildMarket({ id: 'c', matchName: 'A v B', marketType: '足球 亚洲让分盘', selection: 'A', line: '+0.5', odds: 1.7 }),
    buildMarket({ id: 'd', matchName: 'A v B', marketType: '足球 胜平负', selection: 'A', line: '胜平负', odds: 2.1 }),
    buildMarket({ id: 'e', matchName: 'A v B', marketType: '足球 胜平负', selection: '平局', line: '胜平负', odds: 3.2 })
  ];
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            picks: [
              { marketId: 'b', estimatedProbability: 0.58, confidence: 0.5, reason: '总进球更稳', risks: [] },
              { marketId: 'a', estimatedProbability: 0.44, confidence: 0.3, reason: '比分赔率高', risks: [] },
              { marketId: 'e', estimatedProbability: 0.51, confidence: 0.4, reason: '平局可选', risks: [] },
              { marketId: 'c', estimatedProbability: 0.61, confidence: 0.6, reason: '受让更稳', risks: [] },
              { marketId: 'd', estimatedProbability: 0.2, confidence: 0.1, reason: '第五个应被截断', risks: [] }
            ]
          })
        }
      }]
    })
  });

  const ranking = await rankMarkets(markets, 'GPT', {
    OPENROUTER_API_KEY: 'test',
    MODEL_GPT: 'openai/test'
  }, fakeFetch);

  assert.equal(ranking.results.length, 1);
  assert.equal(ranking.results[0].picks.length, 4);
  assert.deepEqual(ranking.results[0].picks.map((pick) => pick.marketId), ['c', 'b', 'e', 'a']);
});

test('ranking request sends a capped core market set to the model', async () => {
  const markets = [];
  for (let i = 0; i < 90; i += 1) {
    markets.push(buildMarket({
      id: `m${i}`,
      matchName: '厄瓜多尔 v 德国',
      marketType: i % 3 === 0 ? '足球 比分' : i % 3 === 1 ? '足球 大小球' : '足球 亚洲让分盘',
      selection: i % 3 === 0 ? `${i % 5}:${(i + 1) % 5}` : i % 3 === 1 ? '大' : '德国',
      line: i % 3 === 1 ? '2.5' : i % 3 === 2 ? '-0.5' : '正确比分',
      odds: 2 + i / 10,
      sourceUrl: 'https://stake.com/detail'
    }));
  }

  let sentMarketCount = 0;
  const fakeFetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const user = JSON.parse(body.messages[1].content);
    sentMarketCount = user.markets.length;
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              picks: user.markets.slice(0, 4).map((market, index) => ({
                marketId: market.id,
                estimatedProbability: 0.6 - index / 100,
                confidence: 0.5,
                reason: '核心盘口',
                risks: []
              }))
            })
          }
        }]
      })
    };
  };

  await rankMarkets(markets, 'GPT', {
    OPENROUTER_API_KEY: 'test',
    MODEL_GPT: 'openai/test'
  }, fakeFetch);

  assert.ok(sentMarketCount <= 40);
});

test('ranking can use Dongqiudi context without imported odds markets', async () => {
  let sentMarkets = [];
  const fakeFetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const user = JSON.parse(body.messages[1].content);
    sentMarkets = user.markets;
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              picks: user.markets.slice(0, 4).map((market, index) => ({
                marketId: market.id,
                estimatedProbability: 0.55 - index / 100,
                confidence: 0.4,
                reason: '懂球帝上下文候选',
                risks: []
              }))
            })
          }
        }]
      })
    };
  };

  const ranking = await rankMarkets([], 'GPT', {
    OPENROUTER_API_KEY: 'test',
    MODEL_GPT: 'openai/test'
  }, fakeFetch, {
    teams: ['厄瓜多尔', '德国'],
    matchName: '厄瓜多尔 v 德国',
    kickoff: '2026-06-26 04:00'
  });

  assert.ok(sentMarkets.length > 0);
  assert.equal(ranking.results[0].picks.length, 4);
  assert.ok(sentMarkets.every((market) => market.id.startsWith('ctx-')));
});

test('ranking parser tolerates fenced JSON and trailing commas', async () => {
  const markets = [
    buildMarket({ id: 'a', matchName: 'A v B', marketType: '足球 胜平负', selection: 'A', line: '胜平负', odds: 2 }),
    buildMarket({ id: 'b', matchName: 'A v B', marketType: '足球 大小球', selection: '大', line: '2.5', odds: 1.8 })
  ];
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: '```json\n{"picks":[{"marketId":"a","estimatedProbability":0.62,"confidence":0.5,"reason":"home edge","risks":["low data",],},]}\n```'
        }
      }]
    })
  });

  const ranking = await rankMarkets(markets, 'DeepSeek', {
    OPENROUTER_API_KEY: 'test',
    MODEL_DEEPSEEK: 'deepseek/test'
  }, fakeFetch);

  assert.equal(ranking.results[0].error, undefined);
  assert.equal(ranking.results[0].picks[0].marketId, 'a');
});

test('ranking keeps three score predictions separately', async () => {
  const markets = [
    buildMarket({ id: 's10', matchName: 'A v B', marketType: '足球 比分', selection: '1:0', line: '正确比分', odds: 7 }),
    buildMarket({ id: 's11', matchName: 'A v B', marketType: '足球 比分', selection: '1:1', line: '正确比分', odds: 6 }),
    buildMarket({ id: 's21', matchName: 'A v B', marketType: '足球 比分', selection: '2:1', line: '正确比分', odds: 8 }),
    buildMarket({ id: 'h', matchName: 'A v B', marketType: '足球 亚洲让分盘', selection: 'A', line: '-0.5', odds: 1.8 })
  ];
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            picks: [
              { marketId: 'h', estimatedProbability: 0.6, confidence: 0.5, reason: 'main pick', risks: [] }
            ],
            scorePicks: [
              { marketId: 's10', score: '1:0', estimatedProbability: 0.22, confidence: 0.4, reason: 'low scoring' },
              { marketId: 's21', score: '2:1', estimatedProbability: 0.19, confidence: 0.35, reason: 'home edge' },
              { marketId: 's11', score: '1:1', estimatedProbability: 0.18, confidence: 0.32, reason: 'draw path' }
            ]
          })
        }
      }]
    })
  });

  const ranking = await rankMarkets(markets, 'GPT', {
    OPENROUTER_API_KEY: 'test',
    MODEL_GPT: 'openai/test'
  }, fakeFetch);

  assert.deepEqual(ranking.results[0].scorePicks.map((pick) => pick.score), ['1:0', '2:1', '1:1']);
});

test('ranking keeps score predictions even when model omits score market ids', async () => {
  const markets = [
    buildMarket({ id: 'h', matchName: 'A v B', marketType: '足球 亚洲让分盘', selection: 'A', line: '-0.5', odds: 1.8 })
  ];
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            picks: [
              { marketId: 'h', estimatedProbability: 0.6, confidence: 0.5, reason: 'main pick', risks: [] }
            ],
            scorePicks: [
              { score: '1-0', estimatedProbability: 0.22, confidence: 0.4, reason: 'low scoring' },
              { score: '2:1', estimatedProbability: 0.19, confidence: 0.35, reason: 'home edge' },
              { score: '1:1', estimatedProbability: 0.18, confidence: 0.32, reason: 'draw path' }
            ]
          })
        }
      }]
    })
  });

  const ranking = await rankMarkets(markets, 'GPT', {
    OPENROUTER_API_KEY: 'test',
    MODEL_GPT: 'openai/test'
  }, fakeFetch);

  assert.deepEqual(ranking.results[0].scorePicks.map((pick) => pick.score), ['1:0', '2:1', '1:1']);
  assert.ok(ranking.results[0].scorePicks.every((pick) => pick.marketId.startsWith('ai-score-')));
});

test('gpt-prefixed model uses OpenAI provider automatically', async () => {
  const markets = [
    buildMarket({ id: 'a', matchName: 'A v B', marketType: '足球 胜平负', selection: 'A', line: '胜平负', odds: 2 })
  ];
  let requestedUrl = '';
  const fakeFetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              picks: [{ marketId: 'a', estimatedProbability: 0.6, confidence: 0.5, reason: 'home', risks: [] }],
              scorePicks: [
                { score: '1:0', estimatedProbability: 0.2, confidence: 0.4, reason: 'low' },
                { score: '2:1', estimatedProbability: 0.18, confidence: 0.35, reason: 'edge' },
                { score: '1:1', estimatedProbability: 0.16, confidence: 0.3, reason: 'draw' }
              ]
            })
          }
        }]
      })
    };
  };

  const ranking = await rankMarkets(markets, 'GPT', {
    OPENAI_API_KEY: 'test-openai',
    OPENROUTER_API_KEY: 'test-openrouter',
    MODEL_GPT: 'gpt-5.5'
  }, fakeFetch);

  assert.match(requestedUrl, /^https:\/\/api\.openai\.com\/v1\/chat\/completions$/);
  assert.equal(ranking.results[0].provider, 'OpenAI');
});

test('non-gpt model id still uses OpenRouter provider', async () => {
  const markets = [
    buildMarket({ id: 'a', matchName: 'A v B', marketType: '足球 胜平负', selection: 'A', line: '胜平负', odds: 2 })
  ];
  let requestedUrl = '';
  const fakeFetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              picks: [{ marketId: 'a', estimatedProbability: 0.6, confidence: 0.5, reason: 'home', risks: [] }]
            })
          }
        }]
      })
    };
  };

  const ranking = await rankMarkets(markets, 'GPT', {
    OPENROUTER_API_KEY: 'test-openrouter',
    MODEL_GPT: 'openai/gpt-4o'
  }, fakeFetch);

  assert.match(requestedUrl, /^https:\/\/openrouter\.ai\/api\/v1\/chat\/completions$/);
  assert.equal(ranking.results[0].provider, 'OpenRouter');
});
