import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePickLine, parseStakeText, sampleMarkets } from '../src/parser.js';

test('parses screenshot sample markets', () => {
  const markets = sampleMarkets();
  assert.equal(markets.length, 6);
  assert.equal(markets[0].matchName, '南非 v 韩国');
  assert.equal(markets[4].marketType, '足球 大/小');
});

test('parses a Stake pick line', () => {
  assert.deepEqual(parsePickLine('韩国 -0.5 / 1 @ 0.75'), {
    selection: '韩国',
    line: '-0.5 / 1',
    odds: 0.75
  });
});

test('parses visible Stake-like text', () => {
  const text = `
足球 让球
世界杯2026(美加墨)
南非 v 韩国
韩国 -0.5 / 1 @ 0.75

足球 大 / 小
世界杯2026(美加墨)
波斯尼亚和黑塞哥维那 v 卡塔尔
大 3 @ 0.96
`;
  const markets = parseStakeText(text, 'https://stake.com/zh/sports/soccer/international/world-cup');
  assert.equal(markets.length, 2);
  assert.equal(markets[1].selection, '大');
});

test('parses Stake event detail Asian handicap text', () => {
  const text = `
厄瓜多 - 德国
厄瓜多尔
德国
亚洲盘
厄瓜多尔
4.90
平局
4.30
德国
1.58
亚洲让分盘
厄瓜多尔
德国
0.5
2.33
-0.5
1.58
0.75
2.05
-0.75
1.72
2.5
1.60
2.5
2.24
正确比分
1-0
11.00
0-1
7.50
1.25
1.61
-1.25
2.22
`;
  const markets = parseStakeText(text, 'https://stake.com/detail');
  assert.ok(markets.length >= 11);
  assert.ok(markets.some((market) => market.selection === '德国' && market.line === '-0.5'));
  assert.ok(markets.some((market) => market.marketType === '足球 胜平负' && market.selection === '平局'));
  assert.ok(markets.some((market) => market.marketType === '足球 大小球' && market.selection === '大' && market.line === '2.5'));
  assert.ok(markets.some((market) => market.marketType === '足球 比分' && market.selection === '1-0'));
});

test('parses Stake Chinese correct goals as exact score markets', () => {
  const text = `
厄瓜多 - 德国
厄瓜多尔
德国
正确进球
赔率滑块
全部
0:0
17.00
1:0
16.00
4:0
301.00
0:1
8.40
其他
13.00
上半场 - 正确进球
赔率滑块
全部
0:0
3.55
`;
  const markets = parseStakeText(text, 'https://stake.com/detail');
  assert.ok(markets.some((market) => market.marketType === '足球 比分' && market.selection === '0:0'));
  assert.ok(markets.some((market) => market.marketType === '足球 比分' && market.selection === '4:0' && market.odds === 301));
  assert.ok(markets.some((market) => market.marketType === '足球 比分' && market.selection === '其他'));
  assert.ok(!markets.some((market) => market.odds === 3.55));
});
