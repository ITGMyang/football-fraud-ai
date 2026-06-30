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
    kickoff: '2026-06-26 04:00',
    index: {
      live: {
        asia: [
          { company: '\u6fb3\u95e8', home: '0.98', line: '\u53d7\u534a/\u4e00', lineValue: '-0.75', away: '0.86' }
        ],
        size: [
          { company: '\u6fb3\u95e8', home: '0.91', line: '2.5/3', away: '0.89' }
        ]
      }
    }
  });

  assert.ok(sentMarkets.length > 0);
  assert.equal(ranking.results[0].picks.length, 4);
  assert.ok(sentMarkets.every((market) => market.id.startsWith('ctx-')));
  const handicapLines = sentMarkets
    .filter((market) => /handicap/.test(market.id))
    .map((market) => market.line);
  assert.deepEqual(handicapLines, ['+0.75', '-0.75']);
  const totalLines = sentMarkets
    .filter((market) => /total/.test(market.id))
    .map((market) => `${market.selection}:${market.line}`);
  assert.deepEqual(totalLines, ['\u5927:2.5/3', '\u5c0f:2.5/3']);
});

test('ranking maps positive Dongqiudi handicap value as home giving goals', async () => {
  let sentMarkets = [];
  const fakeFetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const user = JSON.parse(body.messages.find((message) => message.role === 'user').content);
    sentMarkets = user.markets;
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
                reason: 'test',
                risks: []
              }))
            })
          }
        }]
      })
    };
  };

  await rankMarkets([], 'GPT', {
    OPENROUTER_API_KEY: 'test',
    MODEL_GPT: 'openai/test'
  }, fakeFetch, {
    teams: ['\u5fb7\u56fd', '\u5df4\u62c9\u572d'],
    matchName: '\u5fb7\u56fd v \u5df4\u62c9\u572d',
    index: {
      live: {
        asia: [
          { company: '\u6fb3\u95e8', home: '1.02', line: '\u7403\u534a', lineValue: '1.50', away: '0.82' }
        ]
      }
    }
  });

  const handicapLines = sentMarkets
    .filter((market) => /handicap/.test(market.id))
    .map((market) => `${market.selection}:${market.line}`);
  assert.deepEqual(handicapLines, ['\u5fb7\u56fd:-1.5', '\u5df4\u62c9\u572d:+1.5']);
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

test('ranking parser repairs missing commas between JSON array items', async () => {
  const markets = [
    buildMarket({ id: 'a', matchName: 'A v B', marketType: '足球 大小球', selection: '大', line: '2.5', odds: 1.8 }),
    buildMarket({ id: 'b', matchName: 'A v B', marketType: '足球 胜平负', selection: 'A', line: '胜平负', odds: 2.1 })
  ];
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: '{"picks":[{"marketId":"a","estimatedProbability":0.62,"confidence":0.5,"reason":"over","risks":["pace" "finishing"]} {"marketId":"b","estimatedProbability":0.58,"confidence":0.45,"reason":"home","risks":["rotation"]}],"scorePicks":[{"score":"2:1","estimatedProbability":0.18,"confidence":0.35,"reason":"fits"}]}'
        }
      }]
    })
  });

  const ranking = await rankMarkets(markets, 'GPT', {
    OPENROUTER_API_KEY: 'test',
    MODEL_GPT: 'openai/test'
  }, fakeFetch);

  assert.equal(ranking.results[0].error, undefined);
  assert.deepEqual(ranking.results[0].picks.map((pick) => pick.marketId).slice(0, 2), ['a', 'b']);
});

test('ranking keeps four score predictions separately', async () => {
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

  assert.deepEqual(ranking.results[0].scorePicks.map((pick) => pick.score), ['1:0', '2:1', '1:1', '0:1']);
  assert.deepEqual(ranking.results[0].scorePicks.map((pick) => pick.scoreType), ['mainline', 'mainline', 'market_fit', 'aggressive']);
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

  assert.deepEqual(ranking.results[0].scorePicks.map((pick) => pick.score), ['1:0', '2:1', '1:1', '0:1']);
  assert.ok(ranking.results[0].scorePicks.every((pick) => pick.marketId.startsWith('ai-score-')));
});

test('ranking infers main picks when model only returns score predictions', async () => {
  const markets = [
    buildMarket({ id: 'home', matchName: 'A v B', marketType: '足球 胜平负', selection: 'A', line: '胜平负', odds: 2 }),
    buildMarket({ id: 'draw', matchName: 'A v B', marketType: '足球 胜平负', selection: '平局', line: '胜平负', odds: 3 }),
    buildMarket({ id: 'away', matchName: 'A v B', marketType: '足球 胜平负', selection: 'B', line: '胜平负', odds: 2.2 }),
    buildMarket({ id: 'under25', matchName: 'A v B', marketType: '足球 大小球', selection: '小', line: '2.5', odds: 1.8 }),
    buildMarket({ id: 'awayPlus05', matchName: 'A v B', marketType: '足球 亚洲让分盘', selection: 'B', line: '+0.5', odds: 1.7 }),
    buildMarket({ id: 's02', matchName: 'A v B', marketType: '足球 比分', selection: '0:2', line: '正确比分', odds: 8 })
  ];
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            scorePicks: [
              { score: '0:2', estimatedProbability: 0.17, confidence: 0.4, reason: 'away stronger' },
              { score: '0:1', estimatedProbability: 0.15, confidence: 0.36, reason: 'low scoring' },
              { score: '1:2', estimatedProbability: 0.11, confidence: 0.3, reason: 'away edge' }
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

  assert.deepEqual(ranking.results[0].scorePicks.map((pick) => pick.score), ['0:2', '0:1', '1:2', '1:0']);
  assert.ok(ranking.results[0].picks.length >= 2);
  assert.ok(ranking.results[0].picks.some((pick) => pick.marketId === 'away'));
  assert.ok(ranking.results[0].picks.some((pick) => pick.marketId === 'under25'));
});

test('ranking score predictions stay consistent with over total pick', async () => {
  const markets = [
    buildMarket({ id: 'over25', matchName: 'A v B', marketType: '足球 大小球', selection: '大', line: '2.5', odds: 1.8 }),
    buildMarket({ id: 'under25', matchName: 'A v B', marketType: '足球 大小球', selection: '小', line: '2.5', odds: 1.9 }),
    buildMarket({ id: 's10', matchName: 'A v B', marketType: '足球 比分', selection: '1:0', line: '正确比分', odds: 7 }),
    buildMarket({ id: 's11', matchName: 'A v B', marketType: '足球 比分', selection: '1:1', line: '正确比分', odds: 6 }),
    buildMarket({ id: 's21', matchName: 'A v B', marketType: '足球 比分', selection: '2:1', line: '正确比分', odds: 8 }),
    buildMarket({ id: 's22', matchName: 'A v B', marketType: '足球 比分', selection: '2:2', line: '正确比分', odds: 10 })
  ];
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            picks: [
              { marketId: 'over25', estimatedProbability: 0.72, confidence: 0.6, reason: 'open game', risks: [] }
            ],
            scorePicks: [
              { score: '1:0', estimatedProbability: 0.18, confidence: 0.4, reason: 'conflict' },
              { score: '1:1', estimatedProbability: 0.16, confidence: 0.36, reason: 'conflict' },
              { score: '2:1', estimatedProbability: 0.14, confidence: 0.32, reason: 'fits' }
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

  assert.equal(ranking.results[0].scorePicks.length, 4);
  assert.ok(ranking.results[0].scorePicks.every((pick) => {
    const [home, away] = pick.score.split(':').map(Number);
    return home + away >= 3;
  }));
});

test('ranking score predictions stay consistent with under total pick', async () => {
  const markets = [
    buildMarket({ id: 'over25', matchName: 'A v B', marketType: '足球 大小球', selection: '大', line: '2.5', odds: 1.8 }),
    buildMarket({ id: 'under25', matchName: 'A v B', marketType: '足球 大小球', selection: '小', line: '2.5', odds: 1.9 }),
    buildMarket({ id: 's10', matchName: 'A v B', marketType: '足球 比分', selection: '1:0', line: '正确比分', odds: 7 }),
    buildMarket({ id: 's11', matchName: 'A v B', marketType: '足球 比分', selection: '1:1', line: '正确比分', odds: 6 }),
    buildMarket({ id: 's21', matchName: 'A v B', marketType: '足球 比分', selection: '2:1', line: '正确比分', odds: 8 }),
    buildMarket({ id: 's31', matchName: 'A v B', marketType: '足球 比分', selection: '3:1', line: '正确比分', odds: 12 })
  ];
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            picks: [
              { marketId: 'under25', estimatedProbability: 0.68, confidence: 0.58, reason: 'tight game', risks: [] }
            ],
            scorePicks: [
              { score: '3:1', estimatedProbability: 0.18, confidence: 0.4, reason: 'conflict' },
              { score: '2:1', estimatedProbability: 0.16, confidence: 0.36, reason: 'conflict' },
              { score: '1:1', estimatedProbability: 0.14, confidence: 0.32, reason: 'fits' }
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

  assert.equal(ranking.results[0].scorePicks.length, 4);
  assert.ok(ranking.results[0].scorePicks.every((pick) => {
    const [home, away] = pick.score.split(':').map(Number);
    return home + away <= 2;
  }));
});

test('gpt-prefixed model uses OpenAI provider automatically', async () => {
  const markets = [
    buildMarket({ id: 'a', matchName: 'A v B', marketType: '足球 胜平负', selection: 'A', line: '胜平负', odds: 2 })
  ];
  let requestedUrl = '';
  let requestBody = null;
  const fakeFetch = async (url, options) => {
    requestedUrl = String(url);
    requestBody = JSON.parse(options.body);
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
  assert.equal(requestBody.max_tokens, undefined);
  assert.equal(requestBody.max_completion_tokens, 8000);
  assert.equal(requestBody.temperature, undefined);
  assert.equal(ranking.results[0].provider, 'OpenAI');
});

test('ranking parser accepts array content from OpenAI responses', async () => {
  const markets = [
    buildMarket({ id: 'a', matchName: 'A v B', marketType: '足球 胜平负', selection: 'A', line: '胜平负', odds: 2 })
  ];
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                picks: [{ marketId: 'a', estimatedProbability: 0.6, confidence: 0.5, reason: 'home', risks: [] }],
                scorePicks: [
                  { score: '1:0', estimatedProbability: 0.2, confidence: 0.4, reason: 'low' },
                  { score: '2:1', estimatedProbability: 0.18, confidence: 0.35, reason: 'edge' },
                  { score: '1:1', estimatedProbability: 0.16, confidence: 0.3, reason: 'draw' }
                ]
              })
            }
          ]
        }
      }]
    })
  });

  const ranking = await rankMarkets(markets, 'GPT', {
    OPENAI_API_KEY: 'test-openai',
    MODEL_GPT: 'gpt-5.5'
  }, fakeFetch);

  assert.equal(ranking.results[0].picks[0].marketId, 'a');
});

test('explicit GPT provider can route through APIMart', async () => {
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
    APIMART_API_KEY: 'test-apimart',
    APIMART_BASE_URL: 'https://api.apimart.ai/api/v1',
    MODEL_GPT: 'gpt-5.5',
    MODEL_GPT_PROVIDER: 'apimart'
  }, fakeFetch);

  assert.match(requestedUrl, /^https:\/\/api\.apimart\.ai\/api\/v1\/chat\/completions$/);
  assert.equal(ranking.results[0].provider, 'APIMart');
});

test('Claude model can route through APIMart', async () => {
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

  const ranking = await rankMarkets(markets, 'Claude', {
    APIMART_API_KEY: 'test-apimart',
    MODEL_CLAUDE: 'claude-4.8',
    MODEL_CLAUDE_PROVIDER: 'apimart'
  }, fakeFetch);

  assert.match(requestedUrl, /^https:\/\/api\.apimart\.ai\/api\/v1\/chat\/completions$/);
  assert.equal(ranking.results[0].provider, 'APIMart');
});

test('model ids and api keys tolerate BOM and whitespace from secrets', async () => {
  const markets = [
    buildMarket({ id: 'a', matchName: 'A v B', marketType: '足球 胜平负', selection: 'A', line: '胜平负', odds: 2 })
  ];
  let sentAuth = '';
  let sentModel = '';
  const fakeFetch = async (_url, options) => {
    sentAuth = options.headers.Authorization;
    sentModel = JSON.parse(options.body).model;
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

  await rankMarkets(markets, 'Qwen', {
    OPENROUTER_API_KEY: '\uFEFFsk-or-test\n',
    MODEL_QWEN: '\uFEFFqwen/qwen3.7-max\n'
  }, fakeFetch);

  assert.equal(sentAuth, 'Bearer sk-or-test');
  assert.equal(sentModel, 'qwen/qwen3.7-max');
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
