import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('match schedule refresh never rewrites the competition select options', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const loader = source.slice(source.indexOf('async function loadApiFootballMatches'), source.indexOf('function renderMatchSchedule'));
  assert.match(loader, /const button = \$\('#loadApiFootballMatches'\)/);
  assert.doesNotMatch(loader, /event\?\.currentTarget/);
  assert.match(loader, /button\.textContent\s*=\s*'Loading\.\.\.'/);
});

test('AI context cards stay neutral when the inner button is hovered', async () => {
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.ai-context-main:hover\s*\{[^}]*background:\s*transparent;/s);
  assert.match(styles, /\.ai-context-main:hover\s*\{[^}]*color:\s*var\(--ink\);/s);
});

test('imported context team labels expand without overlapping status rows', async () => {
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.context-card-main\s*\{[^}]*flex:\s*1 1 auto;/s);
  assert.match(styles, /\.context-teams \.team-flag\s*\{[^}]*width:\s*auto;[^}]*height:\s*auto;/s);
  assert.match(styles, /\.context-card-main > span:last-child\s*\{[^}]*display:\s*block;/s);
});

test('AI context cards use API-Football team images instead of flag emoji', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(source, /function contextTeamLogo\(context, index\)/);
  assert.match(source, /context\?\.fixture\?\.home\?\.logo/);
  assert.match(source, /context\?\.fixture\?\.away\?\.logo/);
  assert.match(source, /renderTeamCrest\(contextTeamLogo\(latest, index\), team\)/);
  assert.match(source, /renderAiContextTeam\(teams\[0\], 'home', contextTeamLogo\(context, 0\)\)/);
  assert.match(styles, /\.team-crest\s*\{[^}]*object-fit:\s*contain;/s);
});

test('landing page omits the requested promotional and schedule helper copy', async () => {
  const markup = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.doesNotMatch(markup, /把明日赛程、阵容、指数、天气/);
  assert.doesNotMatch(markup, /懂球帝公开数据|多模型交叉预测|后台赛程每 20 分钟更新/);
  assert.doesNotMatch(markup, /<span>不自动下注<\/span>/);
  assert.doesNotMatch(source, /今天没有尚未开始的比赛。可以切换日期/);
});

test('match UI uses API-Football instead of Dongqiudi endpoints', async () => {
  const [markup, source, worker, server, config] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../worker/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/server.js', import.meta.url), 'utf8'),
    readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
  ]);

  assert.match(markup, /id="loadApiFootballMatches"/);
  assert.match(markup, /<option value="all" selected>All Competitions<\/option>/);
  assert.match(markup, /<option value="1">FIFA World Cup<\/option>/);
  assert.doesNotMatch(markup, /Plus \/ Stable/);
  assert.match(markup, /<option value="max" selected>Max \/ Advanced Reasoning<\/option>/);
  assert.match(source, /function selectedQwenVariant\(\)\s*\{\s*return 'max';/);
  assert.doesNotMatch(`${source}\n${worker}\n${server}\n${config}`, /qwen3\.7-plus|Qwen 3\.7 Plus/);
  assert.match(config, /qwen\/qwen3\.7-max/);
  assert.match(source, /\/api\/football\/matches/);
  assert.match(source, /\/api\/import\/api-football/);
  assert.doesNotMatch(source, /\/api\/dongqiudi|\/api\/import\/dongqiudi/);
  assert.doesNotMatch(`${markup}\n${source}`, /懂球帝/);
});

test('backend cache monitor is a separate read-only Supabase view', async () => {
  const markup = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');

  assert.match(markup, /href="\/backend"[^>]*>Data Console</);
  assert.match(markup, /id="backendPanel"/);
  assert.match(source, /api\('\/api\/backend\/schedules'\)/);
  assert.match(source, /location\.pathname === '\/backend'/);
  assert.match(worker, /url\.pathname === '\/api\/backend\/schedules'/);
  assert.match(worker, /access\.role !== 'user'/);
  assert.match(worker, /filterApiFootballSchedules\(await storage\.listMatchSchedules\(\)\)/);
  assert.match(source, /result\.schedules\.filter\(\(schedule\) => schedule\?\.source === 'api-football'\)/);
});

test('backend fixture rows open an authenticated API-Football detail view', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');

  assert.match(source, /data-backend-fixture=/);
  assert.match(source, /\/api\/backend\/fixtures\//);
  assert.match(source, /renderBackendFixtureDetail/);
  assert.match(source, /API Fetch Status/);
  assert.match(source, /Empty Response/);
  assert.match(source, /Fetch Failed/);
  assert.match(source, /fetchStatus/);
  assert.match(worker, /backendFixtureMatch = url\.pathname\.match/);
  assert.match(worker, /api\\\/backend\\\/fixtures/);
  assert.match(worker, /includeCatalog:\s*true/);
});

test('contexts API enriches legacy imports with shared schedule team images', async () => {
  const worker = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');

  assert.match(worker, /enrichContextsWithScheduleTeams/);
  assert.match(worker, /await storage\.listMatchSchedules\(\)/);
});

test('user API-Football imports persist the full shared catalog context', async () => {
  const worker = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');

  assert.match(worker, /function apiFootballContextOptions/);
  assert.match(worker, /includeCatalog:\s*true/);
  assert.match(worker, /catalogCache:/);
  assert.match(worker, /fetchApiFootballContext\(fixtureId, apiFootballContextOptions\(env, storage\)/);
});

test('Cloudflare serves the current app shell for the backend route', async () => {
  const worker = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');
  const config = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

  assert.match(worker, /APP_SHELL_ROUTES\.has\(url\.pathname\)/);
  assert.match(worker, /new URL\('\/index\.html', url\.origin\)/);
  assert.match(config, /"html_handling":\s*"none"/);
});

test('pricing page creates AllScale checkout and displays account entitlement', async () => {
  const markup = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');

  assert.match(markup, /2\.99/);
  assert.match(markup, /11\.99/);
  assert.match(markup, /29\.99/);
  assert.match(markup, /data-billing-plan="day"/);
  assert.match(source, /\/api\/billing\/checkout/);
  assert.match(source, /\/api\/billing\/status/);
  assert.match(worker, /\/api\/billing\/webhook/);
  assert.match(worker, /SUBSCRIPTION_REQUIRED/);
});
