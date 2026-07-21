import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDongqiudiMatchId, fetchDongqiudiContext, parseDongqiudiMatchList, filterDongqiudiMatches } from '../src/dongqiudi-fetcher.js';

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

test('parses Dongqiudi mobile match list cards', () => {
  const html = `
    <ul class="match-list">
      <li id="id54329964" class="match-calendar-item">
        <h3 class="match-title">2026-06-27 星期六</h3>
        <div class="match-list-item">
          <div class="match-item-a"><img src="home.png"><p>挪威</p></div>
          <div class="match-item-c"><p>03:00 世界杯 <!----></p><p class="spec">1 - 4</p></div>
          <div class="match-item-b"><img src="away.png"><p>法国</p></div>
        </div>
      </li>
      <li id="id54330012" class="match-calendar-item">
        <div class="match-list-item">
          <div class="match-item-a"><img src="h2.png"><p>塞内加尔</p></div>
          <div class="match-item-c"><p>03:00 世界杯 <!----></p></div>
          <div class="match-item-b"><img src="a2.png"><p>伊拉克</p></div>
        </div>
      </li>
    </ul>
  `;

  const matches = parseDongqiudiMatchList(html);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].matchId, '54329964');
  assert.equal(matches[0].matchName, '挪威 v 法国');
  assert.equal(matches[0].competition, '世界杯');
  assert.equal(matches[0].score, '1 - 4');
  assert.equal(matches[1].date, '2026-06-27');
  assert.equal(matches[1].sourceUrl, 'https://www.dongqiudi.com/match/54330012');
});

test('filters a cached schedule without fetching a source', () => {
  const cached = {
    source: 'dongqiudi',
    fetchedAt: '2026-06-27T00:00:00.000Z',
    matches: [
      { matchId: '1', date: '2026-06-27', status: 'scheduled' },
      { matchId: '2', date: '2026-06-27', status: 'finished' },
      { matchId: '3', date: '2026-06-28', status: 'scheduled' }
    ]
  };

  const result = filterDongqiudiMatches(cached, '2026-06-27');
  assert.deepEqual(result.todayMatches.map((match) => match.matchId), ['1', '2']);
  assert.deepEqual(result.upcomingTodayMatches.map((match) => match.matchId), ['1']);
  assert.equal(result.cached, true);
});

test('keeps the competition id in a schedule snapshot for cache upserts', async () => {
  const result = await (await import('../src/dongqiudi-fetcher.js')).fetchDongqiudiMatches({
    competitionId: '125',
    date: '2026-06-27'
  }, async () => ({
    ok: true,
    text: async () => '<ul></ul>'
  }));
  assert.equal(result.competitionId, '125');
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
