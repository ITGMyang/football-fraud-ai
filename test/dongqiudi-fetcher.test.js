import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDongqiudiMatchId, fetchDongqiudiContext } from '../src/dongqiudi-fetcher.js';

test('extracts Dongqiudi match id from url', () => {
  assert.equal(extractDongqiudiMatchId('https://www.dongqiudi.com/match/54329995'), '54329995');
  assert.equal(extractDongqiudiMatchId('54329995'), '54329995');
});

test('fetches and normalizes Dongqiudi public match APIs', async () => {
  const fakeFetch = async (url) => {
    const body = responseForUrl(String(url));
    return {
      ok: true,
      text: async () => `\uFEFF${JSON.stringify(body)}`
    };
  };

  const context = await fetchDongqiudiContext('https://www.dongqiudi.com/match/54329995', fakeFetch);
  assert.equal(context.matchId, '54329995');
  assert.equal(context.matchName, '库拉索 v 科特迪瓦');
  assert.deepEqual(context.teams, ['库拉索', '科特迪瓦']);
  assert.equal(context.kickoff, '2026-06-25 20:00:00');
  assert.ok(context.analysis.recent['库拉索'][0].includes('0-0'));
  assert.ok(context.analysis.standings[0].includes('德国'));
  assert.equal(context.lineup.formation, '5-3-2 vs 4-4-2');
  assert.equal(context.experts[0].author, '老郑聊球');
});

function responseForUrl(url) {
  if (url.includes('/magicball/v1/match/app/detail')) {
    return {
      matchSample: {
        match_id: '54329995',
        team_A_name: '???',
        team_B_name: '????',
        start_play: '2026-06-25 20:00:00',
        competition_name: '世界杯',
        cmp_type: 'soccer'
      }
    };
  }
  if (url.includes('/api/data/match/pre_analysis_v1/')) {
    return {
      team_A: '库拉索',
      team_B: '科特迪瓦',
      start_time: '2026-06-25 20:00:00',
      battle_history: { list: [] },
      recent_record: {
        team_A: [{ year: '2026', date: '06-21', competition: '世界杯', team_A_name: '厄瓜多尔', score: '0-0', team_B_name: '库拉索', handicap: '两球', handicap_result: '赢' }],
        team_B: [{ year: '2026', date: '06-20', competition: '世界杯', team_A_name: '科特迪瓦', score: '2-0', team_B_name: '厄瓜多尔' }]
      },
      cup_table: {
        list: [{ rank: '1', name: '德国', matches_won: '2', matches_draw: '0', matches_lost: '0', goals_pro: '9', goals_against: '2', points: '6' }]
      }
    };
  }
  if (url.includes('/sport-data/soccer/biz/dqd/v1/match/lineup/')) {
    return {
      base: { weather: '晴', temperature: '30°C', field: '硬地', referee: '测试裁判' },
      persons: {
        team_A: { formation: '5-3-2', lineups: [{ shirtnumber: '9', person: 'A球员', position: '前锋' }] },
        team_B: { formation: '4-4-2', lineups: [{ shirtnumber: '10', person: 'B球员', position: '中场' }] }
      }
    };
  }
  if (url.includes('/sport-data/soccer/biz/dqd/v1/match/odds/index/')) {
    return { asia: [{ company: '平均', home: '1.00', handicap: '受一球', away: '0.80' }], euro: [], size: [] };
  }
  if (url.includes('/zc/plan/index')) {
    return {
      data: {
        list: [{
          expertInfo: { name: '老郑聊球', labels: [{ tag: '世界杯近15中14' }] },
          planInfo: { summary: '世界杯赛前档案', play_name: '让球' }
        }]
      }
    };
  }
  return {};
}
