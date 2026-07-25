import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import * as frontendApi from '../frontend/src/api.js';
import {
  createApiClient,
  analysisRequestPlan,
  formatMatchDate,
  normalizeMatches,
  rankingView,
  teamCrestUrl,
  userFacingError
} from '../frontend/src/api.js';

test('predictionHistory groups account predictions by fixture date with crests and match verdicts', () => {
  const rankings = [
    rankingView({
      contextId: 'finished-hit',
      contextName: 'Qingdao v Tianjin',
      createdAt: '2026-07-20T03:00:00.000Z',
      results: [{ modelName: 'Qwen', scorePicks: [{ score: '2:1' }, { score: '1:1' }], picks: [] }]
    }),
    rankingView({
      contextId: 'pending',
      contextName: 'Spain v Argentina',
      createdAt: '2026-07-19T03:00:00.000Z',
      results: [{ modelName: 'Qwen', scorePicks: [{ score: '1:0' }], picks: [] }]
    }),
    rankingView({
      contextId: 'finished-miss',
      contextName: 'France v Germany',
      createdAt: '2026-07-18T03:00:00.000Z',
      results: [{ modelName: 'Qwen', scorePicks: [{ score: '0:0' }], picks: [] }]
    })
  ];
  const contexts = [
    {
      matchId: 'finished-hit',
      kickoff: '2026-07-25T09:30:00.000Z',
      actualScore: '2:1',
      competition: 'Super League',
      fixture: {
        country: 'China',
        home: { name: 'Qingdao', logo: 'https://media.api-sports.io/football/teams/1.png' },
        away: { name: 'Tianjin', logo: 'https://media.api-sports.io/football/teams/2.png' }
      }
    },
    {
      matchId: 'pending',
      kickoff: '2026-07-26T19:00:00+08:00',
      competition: 'World Cup',
      fixture: {
        country: 'World',
        home: { name: 'Spain', logo: 'spain.png' },
        away: { name: 'Argentina', logo: 'argentina.png' }
      }
    },
    {
      matchId: 'finished-miss',
      kickoff: '2026-07-25T20:00:00+08:00',
      actualScore: '3:2',
      competition: 'Friendly',
      fixture: {
        country: 'France',
        home: { name: 'France', logo: 'france.png' },
        away: { name: 'Germany', logo: 'germany.png' }
      }
    }
  ];

  assert.equal(typeof frontendApi.predictionHistory, 'function');
  const groups = frontendApi.predictionHistory(rankings, contexts);

  assert.deepEqual(groups.map((group) => group.date), ['2026-07-26', '2026-07-25']);
  assert.equal(groups[1].matches[0].teamA.flag, 'france.png');
  assert.equal(groups[1].matches[1].teamB.flag, '/media/team-crests/2.png');
  assert.equal(groups[1].matches[1].countryFlag, '🇨🇳');
  assert.equal(groups[1].matches[0].result, 'miss');
  assert.equal(groups[1].matches[1].result, 'hit');
  assert.equal(groups[0].matches[0].result, 'pending');
  assert.equal(groups[1].matches[1].ranking, rankings[0]);
});

test('normalizeMatches converts the API-Football schedule into FutBots cards', () => {
  const matches = normalizeMatches({
    matches: [{
      matchId: '123',
      kickoff: '2026-07-25T19:30:00+08:00',
      competition: 'World Cup',
      home: 'Spain',
      away: 'Argentina',
      homeLogo: 'https://img.example/spain.png',
      awayLogo: 'https://img.example/argentina.png',
      status: 'scheduled',
      score: ''
    }]
  });

  assert.deepEqual(matches, [{
    id: '123',
    date: 'Jul 25, 2026 | 19:30',
    kickoff: '2026-07-25T19:30:00+08:00',
    teamA: { name: 'Spain', flag: 'https://img.example/spain.png' },
    teamB: { name: 'Argentina', flag: 'https://img.example/argentina.png' },
    status: 'upcoming',
    score: '',
    round: 'World Cup'
  }]);
});

test('formatMatchDate keeps invalid dates readable', () => {
  assert.equal(formatMatchDate('', '2026-07-25', '14:00'), 'Jul 25, 2026 | 14:00');
  assert.equal(formatMatchDate('not-a-date', 'Date TBD', ''), 'Date TBD');
});

test('API-Sports team crests use the same-origin production cache', () => {
  assert.equal(
    teamCrestUrl('https://media.api-sports.io/football/teams/1431.png'),
    '/media/team-crests/1431.png'
  );
  assert.equal(teamCrestUrl('https://img.example/spain.png'), 'https://img.example/spain.png');
  assert.equal(teamCrestUrl(''), '');
});

test('the model prediction rail exposes every FutBot model while analysis is running', () => {
  assert.equal(typeof frontendApi.predictionModelRail, 'function');
  assert.deepEqual(
    frontendApi.predictionModelRail([], true),
    [
      { name: 'GPT 5.5', status: 'analyzing' },
      { name: 'Claude 4.8', status: 'analyzing' },
      { name: 'Gemini', status: 'analyzing' },
      { name: 'DeepSeek', status: 'analyzing' },
      { name: 'Qwen 3.7 Max', status: 'analyzing' }
    ]
  );
  assert.deepEqual(
    frontendApi.predictionModelRail([{ name: 'Qwen 3.7 Max' }], false).at(-1),
    { name: 'Qwen 3.7 Max', status: 'complete' }
  );
});

test('account identity uses Google and Telegram profile metadata', () => {
  assert.equal(typeof frontendApi.accountIdentity, 'function');
  assert.deepEqual(
    frontendApi.accountIdentity({
      email: 'fan@example.com',
      app_metadata: { provider: 'google' },
      user_metadata: {
        full_name: 'Football Fan',
        avatar_url: 'https://lh3.googleusercontent.com/avatar.png'
      }
    }),
    {
      name: 'Football Fan',
      avatarUrl: 'https://lh3.googleusercontent.com/avatar.png',
      provider: 'Google'
    }
  );
  assert.deepEqual(
    frontendApi.accountIdentity({
      app_metadata: { provider: 'custom:telegram' },
      user_metadata: { name: 'Goal Bot', picture: 'https://t.me/i/userpic/avatar.jpg' }
    }),
    {
      name: 'Goal Bot',
      avatarUrl: 'https://t.me/i/userpic/avatar.jpg',
      provider: 'Telegram'
    }
  );
});

test('player information status is explicit when lineup data is absent', () => {
  assert.equal(typeof frontendApi.hasPlayerInformation, 'function');
  assert.equal(frontendApi.hasPlayerInformation({}), false);
  assert.equal(frontendApi.hasPlayerInformation({ lineups: [] }), false);
  assert.equal(frontendApi.hasPlayerInformation({ players: [{ id: 9 }] }), true);
  assert.equal(frontendApi.hasPlayerInformation({ lineup: { players: [{ id: 9 }] } }), true);
});

test('userFacingError never exposes server-only or non-English diagnostics', () => {
  assert.equal(
    userFacingError(new Error('缺少 API_FOOTBALL_KEY，请配置 Secret'), 'Match data is unavailable.'),
    'Match data is unavailable.'
  );
  assert.equal(userFacingError(new Error('Payment required'), 'Try again.'), 'Payment required');
});

test('createApiClient attaches the Supabase bearer token and surfaces API errors', async () => {
  const requests = [];
  const client = createApiClient({
    getAccessToken: () => 'token-123',
    fetchImpl: async (path, options) => {
      requests.push({ path, options });
      return new Response(JSON.stringify({ error: 'Payment required', code: 'PASS_REQUIRED' }), {
        status: 402,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  await assert.rejects(
    client('/api/rankings', { method: 'POST', body: JSON.stringify({ matchId: '123' }) }),
    (error) => error.message === 'Payment required' && error.status === 402 && error.code === 'PASS_REQUIRED'
  );
  assert.equal(requests[0].options.headers.Authorization, 'Bearer token-123');
  assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
});

test('analysis targets the model selected in the match workspace', () => {
  assert.deepEqual(analysisRequestPlan(false, '123', 'Qwen 3.7 Max'), {
    importContext: false,
    rankingBody: { matchId: '123', contextId: '123', model: 'Qwen 3.7 Max' }
  });
  assert.deepEqual(analysisRequestPlan(true, '123', 'GPT 5.5'), {
    importContext: true,
    rankingBody: { matchId: '123', contextId: '123', model: 'GPT 5.5' }
  });
});

test('rankingView preserves the complete pooled prediction result', () => {
  const view = rankingView({
    contextId: '123',
    contextName: 'Spain v Argentina',
    createdAt: '2026-07-25T12:00:00.000Z',
    results: [{
      modelName: 'Qwen',
      provider: 'OpenRouter',
      predictionPhase: 'early',
      scorePicks: [
        { score: '1:0', scoreType: 'mainline', estimatedProbability: 0.34, reason: 'Tight final' },
        { score: '2:1', scoreType: 'mainline', estimatedProbability: 0.24, reason: 'Narrow home win' },
        { score: '1:1', scoreType: 'market_fit', estimatedProbability: 0.2, reason: 'Fits the total' },
        { score: '2:2', scoreType: 'aggressive', estimatedProbability: 0.12, reason: 'Higher variance' }
      ],
      bttsPick: {
        selection: 'Yes',
        estimatedProbability: 0.68,
        confidence: 0.55,
        reason: 'Both attacks have a credible scoring path.',
        risks: ['A defensive lineup could lower the total.']
      },
      picks: [
        {
          market: { marketType: 'Total Goals', selection: 'Under', line: '2.5' },
          estimatedProbability: 0.62,
          confidence: 0.74,
          reason: 'Both sides defend compactly',
          risks: ['Early goal changes the shape']
        },
        {
          market: { marketType: 'Asian Handicap', selection: 'Argentina', line: '+0.25' },
          estimatedProbability: 0.57,
          confidence: 0.66,
          reason: 'Balanced matchup',
          risks: []
        },
        {
          market: { marketType: 'Total Goals', selection: 'Over', line: '1.5' },
          estimatedProbability: 0.64,
          confidence: 0.61,
          reason: 'Two goals remain likely',
          risks: []
        },
        {
          market: { marketType: '1X2', selection: 'Draw' },
          estimatedProbability: 0.6,
          confidence: 0.51,
          reason: 'Little separates the teams',
          risks: []
        }
      ]
    }]
  });

  assert.equal(view.matchName, 'Spain v Argentina');
  assert.equal(view.contextId, '123');
  assert.equal(view.models[0].name, 'Qwen');
  assert.equal(view.models[0].scores[0].score, '1:0');
  assert.equal(view.models[0].scores[0].type, 'Primary Score 1');
  assert.equal(view.models[0].scores[2].type, 'Market-Fit Score');
  assert.equal(view.models[0].scores[3].type, 'Aggressive Score');
  assert.equal(view.models[0].provider, 'OpenRouter');
  assert.equal(view.models[0].phase, 'Early Prediction');
  assert.equal(view.models[0].btts.label, 'Yes');
  assert.equal(view.models[0].btts.probability, 68);
  assert.equal(view.models[0].total.label, 'Under 2.5');
  assert.equal(view.models[0].handicap.label, 'Argentina +0.25');
  assert.equal(view.models[0].total.probability, 62);
  assert.equal(view.models[0].picks.length, 4);
  assert.equal(view.models[0].picks[3].label, 'Draw');
});

test('completed account predictions resolve to a See Result action by fixture', () => {
  assert.equal(typeof frontendApi.rankingForMatch, 'function');
  assert.equal(typeof frontendApi.predictionActionLabel, 'function');
  const ranking = rankingView({
    contextId: '1523211',
    contextName: 'Qingdao Jonoon v Tianjin Teda',
    results: [{ modelName: 'Qwen 3.7 Max', picks: [], scorePicks: [] }]
  });

  assert.equal(frontendApi.rankingForMatch([ranking], '1523211'), ranking);
  assert.equal(frontendApi.rankingForMatch([ranking], '9999999'), null);
  assert.equal(frontendApi.predictionActionLabel(ranking), 'See Result');
  assert.equal(frontendApi.predictionActionLabel(null), 'Start Predicting');
});

test('new FutBots shell coexists with the legacy data and admin consoles', async () => {
  await access(new URL('../public/legacy.html', import.meta.url));
  const [worker, server] = await Promise.all([
    readFile(new URL('../worker/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/server.js', import.meta.url), 'utf8')
  ]);

  assert.match(worker, /LEGACY_SHELL_ROUTES/);
  assert.match(worker, /'\/legacy\.html'/);
  assert.match(worker, /team-crests/);
  assert.match(server, /LEGACY_SHELL_ROUTES/);
  assert.match(server, /'legacy\.html'/);
  assert.match(server, /team-crests/);
});

test('prediction cards keep metadata, teams, and actions aligned at tablet widths', async () => {
  const css = await readFile(new URL('../frontend/src/styles.css', import.meta.url), 'utf8');

  assert.match(
    css,
    /\.pcard__head\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;/s
  );
  assert.match(
    css,
    /\.teams\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;/s
  );
  assert.match(
    css,
    /@media \(min-width:\s*768px\)[\s\S]*?\.pcard\s*\{[^}]*justify-content:\s*space-between;/s
  );
});

test('match cards open details before a model prediction is requested', async () => {
  const source = await readFile(new URL('../frontend/src/FutBotsApp.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, />Ask FutBot</);
  assert.match(source, /function openMatch\(match: Match\)/);
  assert.match(source, /onPredict=\{\(modelName\) => void analyze\(selectedMatch, modelName\)\}/);
  assert.match(source, /Start Predicting/);
  assert.match(source, /function ModelRoom/);
  assert.match(source, /onRun=\{setConfirmModel\}/);
});

test('completed model lanes and dashboard cards open saved results instead of predicting again', async () => {
  const source = await readFile(new URL('../frontend/src/FutBotsApp.tsx', import.meta.url), 'utf8');

  assert.match(source, /completed \? "See Result"/);
  assert.match(source, /completed \? onSee\(item\.name\) : onRun\(item\.name\)/);
  assert.match(source, /See Result/);
  assert.match(source, /rankingForMatch\(rankings, match\.id\)/);
});

test('the shell exposes avatar-aware account and login actions', async () => {
  const source = await readFile(new URL('../frontend/src/FutBotsApp.tsx', import.meta.url), 'utf8');

  assert.match(source, /className="account-avatar"/);
  assert.match(source, />Log Out</);
  assert.match(source, />Log In</);
  assert.match(source, /Player information unavailable/);
  assert.match(source, /Detailed match context is imported automatically when prediction starts/);
});

test('prediction details render BTTS and every pooled top pick', async () => {
  const source = await readFile(new URL('../frontend/src/FutBotsApp.tsx', import.meta.url), 'utf8');

  assert.match(source, /Both Teams to Score/);
  assert.match(source, /Top Picks/);
  assert.match(source, /model\?\.picks \|\| \[\]/);
  assert.match(source, /picks\.map/);
  assert.match(source, /pick\.probability/);
});

test('My Predictions uses date tabs and opens crest-aware match result cards', async () => {
  const source = await readFile(new URL('../frontend/src/FutBotsApp.tsx', import.meta.url), 'utf8');

  assert.match(source, /className="history-date-tabs"/);
  assert.match(source, /function HistoryCard/);
  assert.match(source, /Match Result/);
  assert.match(source, /onOpenPrediction\(item\)/);
  assert.match(source, /api\("\/api\/analytics\/refresh"/);
  assert.match(source, /api\("\/api\/contexts"/);
});

test('new and legacy auth routes return to the new shell without a login loop', async () => {
  const [source, legacyAuth] = await Promise.all([
    readFile(new URL('../frontend/src/FutBotsApp.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../public/auth-client.js', import.meta.url), 'utf8')
  ]);

  assert.match(source, /finishAuthSession/);
  assert.match(source, /latestSession = nextSession/);
  assert.match(source, /if \(latestSession\) finishAuthSession\(\)/);
  assert.match(source, /sessionStorage\.removeItem\("footballFraud\.authNext"\)/);
  assert.match(source, /auth\.signOut\(\{ scope: "local" \}\)/);
  assert.match(legacyAuth, /auth\.signOut\(\{ scope: 'local' \}\)/);
  assert.match(legacyAuth, /window\.location\.assign\('\/'\)/);
});

test('production frontend assets use content hashes so releases cannot reuse stale UI', async () => {
  const config = await readFile(new URL('../frontend/vite.config.js', import.meta.url), 'utf8');

  assert.match(config, /entryFileNames:\s*'build\/app-\[hash\]\.js'/);
  assert.match(config, /assetFileNames:\s*'build\/app-\[hash\]\.\[ext\]'/);
});
