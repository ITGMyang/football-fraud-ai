import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDongqiudiSections } from '../src/dongqiudi.js';

test('parses Dongqiudi match context sections', () => {
  const context = parseDongqiudiSections({
    sourceUrl: 'https://www.dongqiudi.com/match/54329952',
    sections: [
      {
        name: '分析',
        text: [
          '世界杯',
          '2026-06-26 04:00',
          '厄瓜多尔',
          '未开始',
          'VS',
          '德国',
          '近期战绩',
          '厄瓜多尔',
          '29% 胜率',
          '赛事\t日期\t主队\t比分\t客队',
          '世界杯\t06-21\t厄瓜多尔\t0 - 0\t库拉索',
          '德国',
          '60% 胜率',
          '赛事\t日期\t主队\t比分\t客队',
          '世界杯\t06-20\t德国\t2 - 1\t科特迪瓦'
        ].join('\n')
      },
      {
        name: '阵容',
        text: [
          '预测阵容',
          '厄瓜多尔',
          '3-5-2 vs 4-2-3-1',
          '德国',
          '23',
          '莫伊塞斯-凯塞多',
          '2',
          '吕迪格',
          '施洛特贝克',
          '受伤'
        ].join('\n')
      },
      {
        name: '指数',
        text: '让球\n欧指\n进球数\n澳\t澳门\t0.75\t受一球\t1.09\t0.84\t受一球\t1.00'
      }
    ]
  });

  assert.equal(context.matchName, '厄瓜多尔 v 德国');
  assert.equal(context.kickoff, '2026-06-26 04:00');
  assert.ok(context.lineup.players.some((player) => player.includes('莫伊塞斯-凯塞多')));
  assert.ok(context.index.handicapRows.length > 0);
});
