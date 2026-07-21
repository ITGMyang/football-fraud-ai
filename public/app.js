const $ = (selector) => document.querySelector(selector);

const marketsEl = $('#markets');
const reportsEl = $('#reports');
const rankingsEl = $('#rankings');
const contextsEl = $('#contexts');
const analyticsContentEl = $('#analyticsContent');
const matchScheduleEl = $('#matchSchedule');
const contextTabsEl = $('#contextTabs');
const contextExplorerEl = $('#contextExplorer');
const aiContextDateEl = $('#aiContextDate');
const aiContextRangeEl = $('#aiContextRange');
const aiContextSortEl = $('#aiContextSort');
const aiContextTabsEl = $('#aiContextTabs');
const matchPanel = $('#matchPanel');
const matchDetailEl = $('#matchDetail');
const contextModalEl = $('#contextModal');
const contextModalBodyEl = $('#contextModalBody');
const contextModalTitleEl = $('#contextModalTitle');
const guestAccessEl = $('#guestAccess');
const guestAccessTitleEl = $('#guestAccessTitle');
const guestAccessDetailEl = $('#guestAccessDetail');
const backendContentEl = $('#backendContent');
const backendSummaryEl = $('#backendSummary');
const adminDashboardEl = $('#adminDashboard');
const adminCoreMetricsEl = $('#adminCoreMetrics');
const billingStatusEl = $('#billingStatus');
const billingStatusTitleEl = $('#billingStatusTitle');
const billingStatusDetailEl = $('#billingStatusDetail');
const billingMessageEl = $('#billingMessage');

const ACTIVE_CONTEXT_STORAGE_KEY = 'footballFraud.activeContextId';
const AI_CONTEXT_DATE_STORAGE_KEY = 'footballFraud.aiContextDate';
const AI_CONTEXT_RANGE_STORAGE_KEY = 'footballFraud.aiContextRange';
const AI_CONTEXT_SORT_STORAGE_KEY = 'footballFraud.aiContextSort';
const QWEN_VARIANT_STORAGE_KEY = 'footballFraud.qwenVariant';
const BILLING_ORDER_STORAGE_KEY = 'footballFraud.billingOrderId';
const RANK_MODELS = ['GPT', 'Claude', 'Gemini', 'DeepSeek', 'Qwen'];
let activeRankingModel = 'all';
let activeContextId = readStoredActiveContextId();
let activeAiContextDate = readStoredValue(AI_CONTEXT_DATE_STORAGE_KEY);
let activeAiContextRange = readStoredValue(AI_CONTEXT_RANGE_STORAGE_KEY) || 'week';
let activeAiContextSort = readStoredValue(AI_CONTEXT_SORT_STORAGE_KEY) || 'imported';
let accessState = { authenticated: false, guestPredictionUsed: false };
let backendSchedules = [];
const analyticsState = {
  raw: null,
  date: '',
  category: 'all',
  match: 'all',
  model: 'all',
  hitsOnly: false
};

const MARKET_GROUPS = [
  { key: 'moneyline', label: 'Moneyline', help: 'Home win, draw, or away win in a 1X2 market.' },
  { key: 'score', label: 'Correct Score', help: 'Exact scoreline candidates.' },
  { key: 'handicap', label: 'Asian Handicap', help: 'Giving or receiving a handicap, such as Germany -0.5 or Ecuador +0.5.' },
  { key: 'total', label: 'Goals Total', help: 'Total goals over or under a line, such as Over 2.5.' },
  { key: 'other', label: 'Other', help: 'Unclassified markets that may require manual review.' }
];

bind('#loadSample', 'click', async () => {
  await api('/api/sample', { method: 'POST' });
  await refresh();
});

bind('#refresh', 'click', refresh);
bind('#refreshAnalytics', 'click', refreshAnalyticsData);
bind('#reloadBackend', 'click', loadBackendSchedules);
bind('#reloadAdmin', 'click', loadAdminDashboard);
bind('#backendSearch', 'input', renderBackendSchedules);
bind('#backendCompetition', 'change', renderBackendSchedules);
bind('#backendStatus', 'change', renderBackendSchedules);
bind('#loadApiFootballMatches', 'click', loadApiFootballMatches);
bind('#competitionFilter', 'change', loadApiFootballMatches);
bind('#matchDate', 'change', loadApiFootballMatches);
bind('#guestLogin', 'click', () => window.footballAuth?.open());
bind('#aiContextDate', 'change', handleAiContextDateChange);
bind('#aiContextRange', 'change', handleAiContextRangeChange);
bind('#aiContextSort', 'change', handleAiContextSortChange);
initQwenVariantSelector();

document.querySelectorAll('[data-billing-plan]').forEach((button) => {
  button.addEventListener('click', () => startBillingCheckout(button.dataset.billingPlan, button));
});

document.querySelectorAll('a[href="#subscriptionPanel"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    const panel = $('#subscriptionPanel');
    if (!panel) return;
    event.preventDefault();
    const navHeight = $('.floating-nav')?.getBoundingClientRect().height || 0;
    const top = window.scrollY + panel.getBoundingClientRect().top - navHeight - 24;
    window.history.replaceState({}, '', '#subscriptionPanel');
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  });
});

bind('#clearMarkets', 'click', async () => {
  await api('/api/markets/clear', { method: 'POST' });
  await refresh();
});

document.querySelectorAll('[data-rank-model]').forEach((button) => {
  button.addEventListener('click', () => runRanking(button.dataset.rankModel, button));
});

document.querySelectorAll('[data-close-context-modal]').forEach((element) => {
  element.addEventListener('click', closeContextModal);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeContextModal();
});

document.addEventListener('change', (event) => {
  const target = event.target;
  if (!target?.matches?.('[data-analytics-filter]')) return;
  analyticsState[target.dataset.analyticsFilter] = target.value;
  if (target.dataset.analyticsFilter === 'date') {
    analyticsState.match = 'all';
  }
  renderAnalyticsView();
});

document.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-analytics-hit-toggle]');
  if (!button) return;
  analyticsState.hitsOnly = !analyticsState.hitsOnly;
  renderAnalyticsView();
});

document.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-backend-fixture]');
  if (!button) return;
  openBackendFixture(button.dataset.backendFixture, button);
});

bind('#importText', 'click', async () => {
  const result = await importStakeText();
  alert(`Imported ${result.markets.length} markets`);
});

bind('#manualForm', 'submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = Object.fromEntries(form.entries());
  body.odds = Number(body.odds);
  await api('/api/markets', { method: 'POST', body: JSON.stringify(body) });
  event.currentTarget.reset();
  await refresh();
});

window.addEventListener('popstate', () => {
  if (window.footballAuth?.isAuthenticated()) refresh();
});
window.addEventListener('football-auth-change', (event) => {
  accessState.authenticated = Boolean(event.detail?.session);
  if (!window.footballAppInitialized) initializeApp();
  else refreshForAccountChange();
});
initMatchDate();
initializeApp();

async function initializeApp() {
  await (window.footballAuthReady || Promise.resolve());
  if (window.footballAppInitialized) return;
  window.footballAppInitialized = true;
  if (location.pathname === '/backend' || location.pathname === '/admin') {
    renderRoute([], [], []);
    await syncAccessStatus();
    if (location.pathname === '/backend') await loadBackendSchedules();
    else await loadAdminDashboard();
    return;
  }
  await Promise.all([refresh(), loadApiFootballMatches(), syncAccessStatus()]);
  await resumeBillingCheckout();
}

async function refreshForAccountChange() {
  await syncAccessStatus();
  if (location.pathname === '/admin') {
    await loadAdminDashboard();
    return;
  }
  if (location.pathname === '/backend') {
    await loadBackendSchedules();
    return;
  }
  await refresh();
}

async function loadBackendSchedules() {
  if (!backendContentEl) return;
  backendContentEl.innerHTML = '<p class="backend-loading">Loading the Supabase cache...</p>';
  try {
    const result = await api('/api/backend/schedules');
    backendSchedules = Array.isArray(result.schedules)
      ? result.schedules.filter((schedule) => schedule?.source === 'api-football')
      : [];
    renderBackendCompetitionOptions();
    renderBackendSchedules();
    const updated = $('#backendUpdatedAt');
    if (updated) updated.textContent = `Loaded at ${formatBackendTime(result.generatedAt)}`;
  } catch (error) {
    backendSchedules = [];
    renderBackendSummary([]);
    backendContentEl.innerHTML = `
      <div class="backend-empty">
        <strong>${error.status === 401 ? 'Sign In Required' : 'Load Failed'}</strong>
        <span>${escapeHtml(error.message)}</span>
      </div>
    `;
  }
}

async function loadAdminDashboard() {
  if (!adminDashboardEl) return;
  const notice = $('#adminNotice');
  notice.dataset.tone = 'loading';
  notice.textContent = 'Loading live operational data...';
  try {
    const { dashboard } = await api('/api/admin/dashboard');
    renderAdminDashboard(dashboard || {});
    notice.textContent = '';
    notice.dataset.tone = '';
  } catch (error) {
    notice.dataset.tone = 'error';
    notice.textContent = error.status === 403
      ? 'This page is restricted to administrator accounts.'
      : error.status === 401 ? 'Sign in with the administrator account to continue.' : error.message;
  }
}

function renderAdminDashboard(dashboard) {
  const core = dashboard.core || {};
  const apiLimit = Number(core.apiFootballDailyLimit) || 0;
  const apiCalls = Number(core.apiFootballCallsToday) || 0;
  const apiPercent = apiLimit ? Math.min(100, (apiCalls / apiLimit) * 100) : 0;
  const updated = $('#adminUpdatedAt');
  if (updated) updated.textContent = `Updated ${formatAdminDate(dashboard.generatedAt)}`;
  adminCoreMetricsEl.innerHTML = [
    adminMetric('API-Football Today', formatNumber(apiCalls), apiLimit ? `of ${formatNumber(apiLimit)} calls` : 'Limit unavailable', apiPercent),
    adminMetric('AI Calls Today', formatNumber(core.modelCallsToday), 'All providers'),
    adminMetric('Reported AI Cost', money(core.modelCostTodayUsd), core.modelCostReportedCalls ? `${core.modelCostReportedCalls} priced calls` : 'Provider cost not reported'),
    adminMetric('Cached Matches', formatNumber(core.cachedMatches), `Refresh ${adminStatusLabel(core.lastRefreshStatus)}`),
    adminMetric('Registered Users', formatNumber(dashboard.users?.total), `${formatNumber(dashboard.users?.activeToday)} active today`),
    adminMetric('Paid Access', formatNumber(dashboard.users?.paid), `${formatNumber(dashboard.users?.active30d)} active in 30 days`),
    adminMetric('Confirmed Revenue', money(dashboard.orders?.confirmedRevenueUsd), `${formatNumber(dashboard.orders?.confirmedCount)} completed orders`),
    adminMetric('Pending Orders', formatNumber(dashboard.orders?.pendingCount), `${formatNumber(dashboard.orders?.failedCount)} failed`)
  ].join('');

  $('#adminModelUsage').innerHTML = adminTable(
    ['Model', 'Provider', 'Requests', 'Input', 'Output', 'Total Tokens', 'Cost', 'Errors'],
    (dashboard.models || []).map((row) => [
      row.modelName, row.provider, formatNumber(row.requests), formatNumber(row.inputTokens),
      formatNumber(row.outputTokens), formatNumber(row.totalTokens),
      row.costReportedCalls ? money(row.costUsd) : 'Not reported', formatNumber(row.errors)
    ]),
    'No model calls have been recorded today.'
  );
  $('#adminLeaguePerformance').innerHTML = adminTable(
    ['Competition', 'Cached Matches', 'Private Imports', 'AI Results'],
    (dashboard.leagues || []).map((row) => [row.name, formatNumber(row.cachedMatches), formatNumber(row.imports), formatNumber(row.predictions)]),
    'No competition activity is available.'
  );
  $('#adminUserAccess').innerHTML = adminTable(
    ['Account', 'Provider', 'Plan', 'Prediction Runs', 'Calls Today', 'Last Sign-in'],
    (dashboard.userRows || []).map((row) => [
      row.email || shortId(row.id), row.provider, row.planId, formatNumber(row.predictionRuns),
      formatNumber(row.callsToday), formatAdminDate(row.lastSeenAt)
    ]),
    'No users found.'
  );
  $('#adminOrders').innerHTML = adminTable(
    ['Order', 'Account', 'Plan', 'Amount', 'Status', 'Created'],
    (dashboard.recentOrders || []).map((row) => [
      shortId(row.id), shortId(row.ownerId), row.planId, money(row.amountUsd), orderStatus(row.status), formatAdminDate(row.createdAt)
    ]),
    'No orders have been created.'
  );
}

function adminMetric(label, value, detail, progress = null) {
  return `<div class="admin-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small>${progress === null ? '' : `<i><b style="width:${progress.toFixed(2)}%"></b></i>`}</div>`;
}

function adminTable(headers, rows, empty) {
  if (!rows.length) return `<div class="admin-empty">${escapeHtml(empty)}</div>`;
  return `<table class="admin-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value) || 0);
}

function money(value) {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

function formatAdminDate(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString('en-US', { timeZone: 'Asia/Shanghai', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function shortId(value) {
  const text = String(value || 'Unknown');
  return text.length > 12 ? `${text.slice(0, 8)}...` : text;
}

function adminStatusLabel(status) {
  return status === 'healthy' ? 'healthy' : status === 'warning' ? 'has warnings' : 'not recorded';
}

function orderStatus(status) {
  if (Number(status) === 20) return 'Confirmed';
  if ([0, 1].includes(Number(status))) return 'Pending';
  if (Number(status) < 0) return 'Failed';
  return `Status ${status}`;
}

function renderBackendCompetitionOptions() {
  const select = $('#backendCompetition');
  if (!select) return;
  const selected = select.value || 'all';
  const options = backendSchedules
    .map((schedule) => ({ id: String(schedule.competitionId || ''), name: backendCompetitionName(schedule) }))
    .filter((item) => item.id)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  select.innerHTML = '<option value="all">All Competitions</option>' + options
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
    .join('');
  select.value = options.some((item) => item.id === selected) ? selected : 'all';
}

function renderBackendSchedules() {
  if (!backendContentEl) return;
  renderBackendSummary(backendSchedules);
  const query = String($('#backendSearch')?.value || '').trim().toLowerCase();
  const competition = $('#backendCompetition')?.value || 'all';
  const status = $('#backendStatus')?.value || 'all';
  const rows = backendSchedules.flatMap((schedule) => (schedule.matches || []).map((match) => ({
    schedule,
    match,
    provider: schedule.providerChecks?.[match.date] || null
  }))).filter(({ schedule, match, provider }) => {
    if (competition !== 'all' && String(schedule.competitionId) !== competition) return false;
    if (status === 'odds' && match.hasOdds !== true) return false;
    if (status === 'delayed' && provider?.status !== 'rate-limited') return false;
    if (!query) return true;
    return [match.home, match.away, match.matchId, match.competition]
      .some((value) => String(value || '').toLowerCase().includes(query));
  }).sort((a, b) => Date.parse(b.match.kickoff || '') - Date.parse(a.match.kickoff || ''));

  if (!rows.length) {
    backendContentEl.innerHTML = '<div class="backend-empty"><strong>No matching data</strong><span>Clear the filters and try again.</span></div>';
    return;
  }

  backendContentEl.innerHTML = `
    <div class="backend-table-wrap">
      <table class="backend-table">
        <thead><tr><th>Competition</th><th>Match</th><th>Beijing Time</th><th>Fixture ID</th><th>Odds</th><th>Refresh Status</th><th>Cached At</th><th>Details</th></tr></thead>
        <tbody>${rows.map(renderBackendRow).join('')}</tbody>
      </table>
    </div>
  `;
}

function renderBackendSummary(schedules) {
  if (!backendSummaryEl) return;
  const matches = schedules.flatMap((schedule) => schedule.matches || []);
  const oddsMatches = matches.filter((match) => match.hasOdds === true).length;
  const delayed = schedules.filter((schedule) => Object.values(schedule.providerChecks || {})
    .some((check) => check?.status === 'rate-limited')).length;
  const latest = schedules.reduce((value, schedule) => Math.max(value, Date.parse(schedule.fetchedAt || '') || 0), 0);
  backendSummaryEl.innerHTML = [
    ['Cached Competitions', schedules.length],
    ['Cached Matches', matches.length],
    ['Odds Available', oddsMatches],
    ['Refresh Delays', delayed],
    ['Latest Write', latest ? formatBackendTime(new Date(latest).toISOString()) : 'None']
  ].map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
}

function renderBackendRow({ schedule, match, provider }) {
  const providerStatus = provider?.status === 'rate-limited' ? 'Rate Limited' : provider?.status === 'ready' ? 'Ready' : 'Cached';
  const providerTone = provider?.status === 'rate-limited' ? 'danger' : provider?.status === 'ready' ? 'ok' : 'neutral';
  const fixtureId = String(match.matchId || match.id || '');
  return `
    <tr>
      <td><b>${escapeHtml(backendCompetitionName(schedule))}</b><small>ID ${escapeHtml(schedule.competitionId || '')}</small></td>
      <td><strong>${escapeHtml(match.home || '')}</strong><span>vs</span><strong>${escapeHtml(match.away || '')}</strong></td>
      <td>${escapeHtml(formatBackendTime(match.kickoff))}</td>
      <td><code>${escapeHtml(fixtureId)}</code></td>
      <td><span class="backend-status ${match.hasOdds === true ? 'ok' : 'neutral'}">${match.hasOdds === true ? 'Verified' : 'No Odds'}</span></td>
      <td><span class="backend-status ${providerTone}">${providerStatus}</span></td>
      <td>${escapeHtml(formatBackendTime(schedule.fetchedAt))}</td>
      <td><button class="backend-detail-button secondary" type="button" data-backend-fixture="${escapeHtml(fixtureId)}">View</button></td>
    </tr>
  `;
}

async function openBackendFixture(fixtureId, button) {
  if (!fixtureId || !contextModalEl || !contextModalBodyEl) return;
  const original = button?.textContent || 'View';
  try {
    if (button) {
      button.disabled = true;
      button.textContent = 'Loading';
    }
    if (contextModalTitleEl) contextModalTitleEl.textContent = `Fixture ${fixtureId}`;
    contextModalBodyEl.innerHTML = '<p class="backend-loading">Loading match details from API-Football...</p>';
    contextModalEl.hidden = false;
    document.body.classList.add('modal-open');
    const { context, generatedAt } = await api(`/api/backend/fixtures/${encodeURIComponent(fixtureId)}`);
    if (contextModalTitleEl) contextModalTitleEl.textContent = context.matchName || `Fixture ${fixtureId}`;
    contextModalBodyEl.innerHTML = renderBackendFixtureDetail(context, generatedAt);
  } catch (error) {
    contextModalBodyEl.innerHTML = `<div class="backend-empty"><strong>Unable to Load Details</strong><span>${escapeHtml(error.message)}</span></div>`;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

function renderBackendFixtureDetail(context = {}, generatedAt = '') {
  const fixture = context.fixture || {};
  const catalog = context.catalog || {};
  const lineupPlayers = context.lineup?.players || [];
  const injuryNotes = (context.lineup?.notes || []).filter((note) => String(note).startsWith('伤停'));
  const fixtureStats = context.analysis?.teamStatistics || [];
  const playerStats = context.analysis?.playerStatistics || [];
  const oddsCount = ['asia', 'size', 'euro'].reduce((sum, key) => sum + (context.index?.live?.[key]?.length || 0), 0);
  const apiPrediction = context.analysis?.apiPrediction || {};
  const fetchStatus = context.fetchStatus || {};
  const coverage = [
    ['Fixtures', 1, 'match', fetchStatus.fixtures],
    ['H2H', context.analysis?.h2h?.length || 0, 'match', fetchStatus.h2h],
    ['Live / Events', context.live?.length || 0, 'match', fetchStatus.events],
    ['Odds', oddsCount, 'match', fetchStatus.odds],
    ['Lineups', lineupPlayers.length, 'match', fetchStatus.lineups],
    ['Fixture Statistics', fixtureStats.length, 'match', fetchStatus.fixtureStatistics],
    ['Predictions', apiPrediction.advice || apiPrediction.winner ? 1 : 0, 'match', fetchStatus.predictions],
    ['Injuries', injuryNotes.length, 'match', fetchStatus.injuries],
    ['Players Statistics', playerStats.length, 'match', fetchStatus.playerStatistics],
    ['Standings', catalog.standings?.length || 0, 'league', fetchStatus.standings],
    ['Top Scorers', catalog.topScorers?.length || 0, 'league', fetchStatus.topScorers],
    ['Teams Statistics', catalog.teamStatistics?.length || 0, 'team', fetchStatus.teamStatistics],
    ['Players Squads', catalog.squads?.length || 0, 'team', fetchStatus.squads],
    ['Coaches', catalog.coaches?.length || 0, 'team', fetchStatus.coaches],
    ['Transfers / Trophies / Sidelined', 0, 'non-match', { state: 'not-requested', count: 0 }]
  ];
  const teamSeasonStats = (catalog.teamStatistics || []).map((row) => [
    row.team,
    `Played ${row.played || 0}`,
    `Won ${row.wins || 0}`,
    `Drawn ${row.draws || 0}`,
    `Lost ${row.losses || 0}`,
    `GF ${row.goalsFor || 0}`,
    `GA ${row.goalsAgainst || 0}`,
    `Clean Sheets ${row.cleanSheets || 0}`
  ].join(' · '));
  const matchStats = fixtureStats.map((row) => `${row.team} · ${Object.entries(row.values || {})
    .map(([key, value]) => `${key}: ${value ?? '-'}`).join(' · ')}`);
  const matchPlayerStats = playerStats.map((row) => {
    const stats = row.statistics || {};
    return [row.team, row.player, stats.games?.minutes ? `${stats.games.minutes} minutes` : '', stats.games?.rating ? `Rating ${stats.games.rating}` : '']
      .filter(Boolean).join(' · ');
  });
  const predictionText = [
    apiPrediction.winner ? `Lean: ${apiPrediction.winner}` : '',
    apiPrediction.advice ? `Advice: ${apiPrediction.advice}` : '',
    ...Object.entries(apiPrediction.percent || {}).map(([key, value]) => `${key} ${value}`)
  ].filter(Boolean);

  return `
    <article class="backend-fixture-detail">
      <div class="backend-fixture-overview">
        <div>
          <span>API-FOOTBALL FIXTURE ${escapeHtml(context.matchId || '')}</span>
          <h3>${escapeHtml(context.matchName || 'Match')}</h3>
          <p>${escapeHtml(context.competition || '')} · ${escapeHtml(fixture.country || 'Country unavailable')} · ${escapeHtml(fixture.season || 'Season unavailable')} · ${escapeHtml(fixture.round || 'Round unavailable')}</p>
        </div>
        <small>Loaded at ${escapeHtml(formatBackendTime(generatedAt))}</small>
      </div>
      <div class="backend-fixture-meta">
        ${renderInfoTile('Kickoff', formatBackendTime(context.kickoff))}
        ${renderInfoTile('Match Status', context.status || 'Unavailable')}
        ${renderInfoTile('Venue', fixture.venue?.name ? `${fixture.venue.name}${fixture.venue.city ? ` · ${fixture.venue.city}` : ''}` : 'Unavailable')}
        ${renderInfoTile('Referee', fixture.referee || 'Unavailable')}
        ${renderInfoTile('Formation', context.lineup?.formation || 'Unavailable')}
        ${renderInfoTile('Odds Records', oddsCount ? `${oddsCount} records` : 'Unavailable')}
      </div>
      <section class="backend-coverage">
        <div class="backend-detail-heading"><h4>API Fetch Status</h4><span>Empty responses and failed requests are shown separately</span></div>
        <div class="backend-coverage-grid">
          ${coverage.map(([label, count, scope, status]) => {
            const display = backendCoverageDisplay(count, scope, status);
            return `
            <div class="backend-coverage-item ${display.className}"${display.detail ? ` title="${escapeHtml(display.detail)}"` : ''}>
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(display.label)}</strong>
              <small>${escapeHtml(display.detail || `${scope} level`)}</small>
            </div>
          `;}).join('')}
        </div>
      </section>
      <div class="backend-detail-modules">
        ${renderBackendDetailModule('Lineups and Players', lineupPlayers)}
        ${renderBackendDetailModule('Injuries', injuryNotes)}
        ${renderBackendDetailModule('Head-to-Head', context.analysis?.h2h || [])}
        ${renderBackendDetailModule('Match Events', context.live || [])}
        ${renderBackendDetailModule('Fixture Team Statistics', matchStats)}
        ${renderBackendDetailModule('Fixture Player Statistics', matchPlayerStats)}
        ${renderBackendDetailModule('API Prediction', predictionText)}
        ${renderBackendDetailModule('Standings', catalog.standings || [])}
        ${renderBackendDetailModule('Top Scorers', catalog.topScorers || [])}
        ${renderBackendDetailModule('Season Team Statistics', teamSeasonStats)}
        ${renderBackendDetailModule('Squads', catalog.squads || [])}
        ${renderBackendDetailModule('Coaches', catalog.coaches || [])}
        ${renderOddsModule(context.index || {})}
      </div>
    </article>
  `;
}

function backendCoverageDisplay(count, scope, status = {}) {
  const availableCount = count || (status.state === 'available' ? status.count : 0);
  if (availableCount) return { className: 'available', label: `Captured ${availableCount}`, detail: `${scope} level` };
  if (status.state === 'error') {
    return { className: 'error', label: 'Fetch Failed', detail: status.error || 'API request failed' };
  }
  if (status.state === 'empty') return { className: 'empty', label: 'Empty Response', detail: `${scope} level` };
  if (status.state === 'not-requested' || scope === 'non-match') {
    return { className: 'scope', label: 'Not Queried by Fixture', detail: `${scope} level` };
  }
  return { className: 'empty', label: 'Unknown Status', detail: 'Legacy data did not record API status' };
}

function renderBackendDetailModule(title, rows = []) {
  const visible = rows.filter(Boolean).slice(0, 80);
  return `
    <section class="backend-detail-module">
      <div class="backend-detail-heading"><h4>${escapeHtml(title)}</h4><span>${visible.length}</span></div>
      ${visible.length ? `<ul>${visible.map((row) => `<li>${escapeHtml(row)}</li>`).join('')}</ul>` : '<p>No data is currently available for this module.</p>'}
    </section>
  `;
}

function backendCompetitionName(schedule) {
  const names = {
    '1': 'FIFA World Cup', '2': 'UEFA Champions League', '3': 'UEFA Europa League', '15': 'FIFA Club World Cup', '17': 'AFC Champions League Elite',
    '39': 'Premier League', '61': 'Ligue 1', '78': 'Bundesliga', '135': 'Serie A', '140': 'La Liga',
    '169': 'Chinese Super League', '170': 'China League One', '171': 'China League Two', '188': 'A-League', '307': 'Saudi Pro League'
  };
  return names[String(schedule.competitionId || '')]
    || schedule.matches?.find((match) => match.competition)?.competition
    || `Competition ${schedule.competitionId || ''}`;
}

function formatBackendTime(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return 'Unavailable';
  return date.toLocaleString('en-US', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  });
}

async function syncAccessStatus() {
  try {
    accessState = await api('/api/auth/status');
    if (accessState.authenticated && !accessState.billing) {
      const status = await api('/api/billing/status');
      accessState.billing = status.billing;
      accessState.plans = status.plans;
    }
  } catch {
    accessState = {
      authenticated: Boolean(window.footballAuth?.isAuthenticated()),
      guestPredictionUsed: false
    };
  }
  renderGuestAccess();
  renderBillingStatus();
  const adminLink = $('#adminNavLink');
  if (adminLink) adminLink.hidden = !accessState.admin;
}

function renderGuestAccess() {
  const copy = window.footballAuth?.guestAccessLabel?.(accessState);
  if (!copy || !guestAccessEl) return;
  guestAccessEl.dataset.tone = copy.tone;
  guestAccessTitleEl.textContent = copy.title;
  guestAccessDetailEl.textContent = copy.detail;
  $('#guestLogin').hidden = accessState.authenticated;
  const billing = accessState.billing || {};
  const paid = Boolean(accessState.authenticated && billing.active);
  const blocked = accessState.authenticated
    ? billing.tier === 'locked'
    : Boolean(accessState.guestPredictionUsed);
  document.querySelectorAll('[data-rank-model]').forEach((button) => {
    button.disabled = blocked || (!paid && button.dataset.rankModel !== 'Qwen');
    button.title = !paid && !blocked && button.dataset.rankModel !== 'Qwen'
      ? 'The free trial only runs Qwen. Purchase a pass to use this model.'
      : '';
  });
}

function renderBillingStatus() {
  if (!billingStatusEl) return;
  const billing = accessState.billing || {};
  if (billing.active) {
    billingStatusEl.dataset.tone = 'paid';
    billingStatusTitleEl.textContent = 'All AI Models Unlocked';
    billingStatusDetailEl.textContent = billing.validUntil
      ? `Valid until ${formatBillingDate(billing.validUntil)}`
      : 'Pass active';
  } else if (billing.tier === 'locked') {
    billingStatusEl.dataset.tone = 'locked';
    billingStatusTitleEl.textContent = 'Free Prediction Used';
    billingStatusDetailEl.textContent = 'Purchase a pass to continue';
  } else {
    billingStatusEl.dataset.tone = 'free';
    billingStatusTitleEl.textContent = accessState.authenticated ? '1 Qwen Prediction Remaining' : 'Free Trial';
    billingStatusDetailEl.textContent = accessState.authenticated ? 'Purchase a pass to unlock all models' : 'Sign in to purchase a pass';
  }
}

async function startBillingCheckout(planId, button) {
  if (!accessState.authenticated) {
    window.footballAuth?.open('Sign in before purchasing a pass');
    return;
  }
  const original = button.textContent;
  setBillingMessage('Creating a secure checkout...');
  try {
    button.disabled = true;
    button.textContent = 'Redirecting...';
    const result = await api('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ planId })
    });
    try {
      localStorage.setItem(BILLING_ORDER_STORAGE_KEY, result.orderId);
    } catch {
      // The return URL also contains the order ID.
    }
    window.location.assign(result.checkoutUrl);
  } catch (error) {
    button.disabled = false;
    button.textContent = original;
    setBillingMessage(error.message, true);
  }
}

async function resumeBillingCheckout() {
  if (!accessState.authenticated) return;
  const params = new URLSearchParams(location.search);
  const orderId = params.get('order') || readStoredValue(BILLING_ORDER_STORAGE_KEY);
  if (!orderId || params.get('checkout') !== 'return') return;
  setBillingMessage('Confirming your payment...');
  document.querySelector('#subscriptionPanel')?.scrollIntoView({ block: 'start' });
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const result = await api(`/api/billing/orders/${encodeURIComponent(orderId)}/status`);
      if (Number(result.status) === 20 || result.billing?.active) {
        accessState.billing = result.billing;
        renderGuestAccess();
        renderBillingStatus();
        setBillingMessage('Payment confirmed. All AI models are now unlocked.');
        clearBillingReturnState();
        return;
      }
      if (Number(result.status) < 0) {
        setBillingMessage('The order was not completed. Select a pass and try again.', true);
        return;
      }
    } catch (error) {
      if (attempt === 11) setBillingMessage(error.message, true);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  setBillingMessage('Payment is still being confirmed. Refresh the page shortly to check again.');
}

function clearBillingReturnState() {
  try {
    localStorage.removeItem(BILLING_ORDER_STORAGE_KEY);
  } catch {
    // The entitlement is already persisted server-side.
  }
  const url = new URL(location.href);
  url.searchParams.delete('checkout');
  url.searchParams.delete('order');
  history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function setBillingMessage(message, isError = false) {
  if (!billingMessageEl) return;
  billingMessageEl.textContent = message || '';
  billingMessageEl.classList.toggle('error', isError);
}

function formatBillingDate(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  });
}

function bind(selector, event, handler) {
  const element = $(selector);
  if (element) element.addEventListener(event, handler);
}

function readStoredActiveContextId() {
  return readStoredValue(ACTIVE_CONTEXT_STORAGE_KEY);
}

function readStoredValue(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function initQwenVariantSelector() {
  const select = $('#qwenVariant');
  if (!select) return;
  const stored = readStoredValue(QWEN_VARIANT_STORAGE_KEY);
  select.value = ['plus', 'max'].includes(stored) ? stored : 'plus';
  select.addEventListener('change', () => {
    try {
      localStorage.setItem(QWEN_VARIANT_STORAGE_KEY, select.value);
    } catch {
      // Keep the visible select value when localStorage is unavailable.
    }
  });
}

function selectedQwenVariant() {
  const value = $('#qwenVariant')?.value || readStoredValue(QWEN_VARIANT_STORAGE_KEY) || 'plus';
  return ['plus', 'max'].includes(value) ? value : 'plus';
}

function setActiveContextId(value) {
  activeContextId = String(value || '');
  try {
    if (activeContextId) {
      localStorage.setItem(ACTIVE_CONTEXT_STORAGE_KEY, activeContextId);
    } else {
      localStorage.removeItem(ACTIVE_CONTEXT_STORAGE_KEY);
    }
  } catch {
    // localStorage can be disabled in strict browser modes; the in-memory value still works.
  }
}

function setActiveAiContextDate(value) {
  activeAiContextDate = String(value || '');
  try {
    if (activeAiContextDate) {
      localStorage.setItem(AI_CONTEXT_DATE_STORAGE_KEY, activeAiContextDate);
    } else {
      localStorage.removeItem(AI_CONTEXT_DATE_STORAGE_KEY);
    }
  } catch {
    // Keep the in-memory date when persistent storage is unavailable.
  }
}

function setActiveAiContextRange(value) {
  activeAiContextRange = ['today', 'week', 'month'].includes(value) ? value : 'week';
  try {
    localStorage.setItem(AI_CONTEXT_RANGE_STORAGE_KEY, activeAiContextRange);
  } catch {
    // Keep in-memory filter if storage is unavailable.
  }
}

function setActiveAiContextSort(value) {
  activeAiContextSort = ['imported', 'kickoff', 'lineup'].includes(value) ? value : 'imported';
  try {
    localStorage.setItem(AI_CONTEXT_SORT_STORAGE_KEY, activeAiContextSort);
  } catch {
    // Keep in-memory sorting if storage is unavailable.
  }
}

function sortContextsForDisplay(contexts = []) {
  return [...contexts].sort((a, b) => {
    const capturedDiff = timestampOf(b.capturedAt) - timestampOf(a.capturedAt);
    if (capturedDiff) return capturedDiff;
    return timestampOf(b.kickoff) - timestampOf(a.kickoff);
  });
}

function timestampOf(value) {
  const parsed = Date.parse(value || '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function refresh() {
  const [{ markets }, { reports }, { rankings }, { contexts }, analyticsResponse] = await Promise.all([
    api('/api/markets'),
    api('/api/reports'),
    api('/api/rankings'),
    api('/api/contexts'),
    api('/api/analytics').catch(() => ({ analytics: null }))
  ]);
  const orderedContexts = sortContextsForDisplay(contexts);
  if (activeContextId && !orderedContexts.some((context) => contextKey(context) === activeContextId)) {
    setActiveContextId('');
  }

  window.currentMarkets = markets;
  window.currentRankings = rankings;
  window.currentContexts = orderedContexts;
  renderRoute(markets, reports, orderedContexts);
  renderAiContextSelector(orderedContexts);
  renderContexts(orderedContexts);
  if (marketsEl) renderMarkets(markets);
  renderRankings(rankings, markets);
  updateRankButtons(rankings);
  renderReports(reports);
  renderAnalytics(analyticsResponse.analytics);
  setupRevealAnimations();
}

function initMatchDate() {
  const input = $('#matchDate');
  if (!input) return;
  input.value = dateInShanghai(0);
}

async function loadApiFootballMatches(event) {
  const button = $('#loadApiFootballMatches');
  const original = button?.textContent;
  try {
    if (button) {
      button.disabled = true;
      button.textContent = 'Loading...';
    }
    if (matchScheduleEl) matchScheduleEl.innerHTML = '<p class="meta">Loading matches from API-Football...</p>';
    const date = $('#matchDate')?.value || '';
    const competitionId = $('#competitionFilter')?.value || '1';
    const schedule = await api(`/api/football/matches?competitionId=${encodeURIComponent(competitionId)}${date ? `&date=${encodeURIComponent(date)}` : ''}`);
    renderMatchSchedule(schedule);
  } catch (error) {
    if (matchScheduleEl) matchScheduleEl.innerHTML = `<p class="meta error-text">${escapeHtml(error.message)}</p>`;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

function renderMatchSchedule(schedule) {
  if (!matchScheduleEl) return;
  const selectedDate = schedule.upcomingTodayMatches || [];
  const matches = selectedDate.slice(0, 24);
  if (!matches.length) {
    matchScheduleEl.replaceChildren();
    return;
  }

  const notice = `${matches.length} upcoming matches on ${escapeHtml(schedule.date)}`;

  matchScheduleEl.innerHTML = `
    <div class="schedule-summary">
      <strong>${notice}</strong>
      <span>Source: ${escapeHtml(shortUrl(schedule.sourceUrl))} · Captured at ${escapeHtml(new Date(schedule.fetchedAt).toLocaleTimeString('en-US'))}</span>
    </div>
    ${matches.map(renderScheduleCard).join('')}
  `;

  matchScheduleEl.querySelectorAll('[data-import-match]').forEach((button) => {
    button.addEventListener('click', () => importScheduleMatch(button.dataset.importMatch, button));
  });
}

function dateInShanghai(offsetDays = 0) {
  const now = new Date();
  const shanghaiNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  shanghaiNow.setDate(shanghaiNow.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(shanghaiNow);
}

function renderScheduleCard(match) {
  return `
    <article class="schedule-card">
      <div class="team-logo-row">
        <div><img src="${escapeHtml(match.homeLogo || '')}" alt=""><span>${escapeHtml(match.home || '')}</span></div>
        <strong>${escapeHtml(match.score || match.time || 'vs')}</strong>
        <div><img src="${escapeHtml(match.awayLogo || '')}" alt=""><span>${escapeHtml(match.away || '')}</span></div>
      </div>
      <div class="schedule-meta">
        <span>${escapeHtml(match.date || '')} ${escapeHtml(match.time || '')}</span>
        <b>${escapeHtml(match.competition || '')}</b>
      </div>
      <div class="schedule-actions">
        <span>API-Football</span>
        <button data-import-match="${escapeHtml(match.matchId)}">Import and Analyze</button>
      </div>
    </article>
  `;
}

async function importScheduleMatch(fixtureId, button) {
  const original = button?.textContent;
  try {
    if (button) {
      button.disabled = true;
      button.textContent = 'Importing...';
    }
    const { context, alreadyImported, refreshed } = await api('/api/import/api-football', {
      method: 'POST',
      body: JSON.stringify({ fixtureId })
    });
    setActiveContextId(contextKey(context));
    setActiveAiContextDate(contextDate(context));
    await refresh();
    if (refreshed) {
      $('#ai-panel')?.scrollIntoView({ block: 'start' });
      alert(`Match data refreshed: ${context.matchName || fixtureId}`);
      return;
    }
    if (alreadyImported) {
      alert(`Match already imported: ${context.matchName || fixtureId}`);
    } else {
      $('#ai-panel')?.scrollIntoView({ block: 'start' });
      alert(`Imported: ${context.matchName || fixtureId}`);
    }
  } catch (error) {
    alert(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

function renderContexts(contexts) {
  const active = activeContextId
    ? contexts?.find((context) => contextKey(context) === activeContextId)
    : null;
  const latest = active || contexts?.[0];
  if (!latest) {
    contextsEl.innerHTML = '<p class="meta">No API-Football match data has been imported. AI predictions can currently use manual markets only.</p>';
    return;
  }

  const teams = contextTeams(latest);
  const timing = lineupTiming(latest);
  const playerStatus = playerInfoStatus(latest);
  contextsEl.innerHTML = `
    <div class="context-card">
      <div class="context-card-main">
        <strong>Imported API-Football Data: ${escapeHtml(latest.matchName || 'Match')}</strong>
        <div class="context-teams" aria-label="Teams">
          ${teams.map((team, index) => `
            <span class="team-flag">
              ${renderTeamCrest(contextTeamLogo(latest, index), team)}
              ${escapeHtml(team || (index === 0 ? 'Home Team' : 'Away Team'))}
            </span>
            ${index === 0 ? '<em>v</em>' : ''}
          `).join('')}
        </div>
        <div class="context-time-row">
          <span class="kickoff-pill primary-time">Local Kickoff ${escapeHtml(formatKickoff(latest))}</span>
          <span class="kickoff-pill secondary-time">Beijing Time ${escapeHtml(formatBeijingKickoff(latest.kickoff))}</span>
          <span class="lineup-window ${timing.state}">${escapeHtml(timing.label)}</span>
          <span class="player-info-pill ${playerStatus.state}">${escapeHtml(playerStatus.label)}</span>
        </div>
        <span>Lineups, form, odds, predictions, and live-event context are sent with each AI request</span>
      </div>
      <a href="https://dashboard.api-football.com/" target="_blank" rel="noreferrer">API Source</a>
    </div>
  `;
}

function renderAiContextSelector(contexts = []) {
  if (!aiContextDateEl || !aiContextTabsEl) return;
  if (aiContextRangeEl) aiContextRangeEl.value = activeAiContextRange;
  if (aiContextSortEl) aiContextSortEl.value = activeAiContextSort;

  const datedContexts = filterContextsByAiRange(contexts.filter((context) => contextDate(context)));
  if (!datedContexts.length) {
    aiContextDateEl.innerHTML = '<option value="">No imported data</option>';
    aiContextTabsEl.innerHTML = '<p class="meta">No imported matches are available in this range.</p>';
    return;
  }

  const dates = [...new Set(datedContexts.map(contextDate))].sort((a, b) => b.localeCompare(a));
  const activeContext = activeContextId ? contexts.find((context) => contextKey(context) === activeContextId) : null;
  const activeContextDate = activeContext ? contextDate(activeContext) : '';
  if (!activeAiContextDate && activeContextDate && dates.includes(activeContextDate)) {
    setActiveAiContextDate(activeContextDate);
  }
  if (!activeAiContextDate) {
    const today = dateInShanghai(0);
    setActiveAiContextDate(dates.includes(today) ? today : dates[0]);
  }
  if (!dates.includes(activeAiContextDate)) {
    setActiveAiContextDate(activeContextDate && dates.includes(activeContextDate) ? activeContextDate : dates[0]);
  }

  aiContextDateEl.innerHTML = dates.map((date) => {
    const count = datedContexts.filter((context) => contextDate(context) === date).length;
    return `<option value="${escapeHtml(date)}" ${date === activeAiContextDate ? 'selected' : ''}>${escapeHtml(date)} (${count} imported)</option>`;
  }).join('');

  const visibleContexts = sortAiContexts(datedContexts.filter((context) => contextDate(context) === activeAiContextDate));
  if (!visibleContexts.some((context) => contextKey(context) === activeContextId)) {
    setActiveContextId(contextKey(visibleContexts[0]));
  }

  aiContextTabsEl.innerHTML = visibleContexts.map(renderAiContextTab).join('');

  aiContextTabsEl.querySelectorAll('[data-ai-context-tab]').forEach((button) => {
    button.addEventListener('click', () => selectAiContext(button.dataset.aiContextTab, contexts));
  });
  aiContextTabsEl.querySelectorAll('[data-context-detail]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const context = contexts.find((item) => contextKey(item) === button.dataset.contextDetail);
      if (context) openContextModal(context, contexts);
    });
  });
}

function handleAiContextDateChange(event) {
  const date = event.currentTarget.value;
  setActiveAiContextDate(date);
  const contexts = window.currentContexts || [];
  const first = sortAiContexts(filterContextsByAiRange(contexts).filter((context) => contextDate(context) === date))[0];
  if (first) setActiveContextId(contextKey(first));
  renderAiContextSelector(contexts);
  renderContexts(contexts);
  renderRankings(window.currentRankings || [], window.currentMarkets || []);
  updateRankButtons(window.currentRankings || []);
  setupRevealAnimations();
}

function handleAiContextRangeChange(event) {
  setActiveAiContextRange(event.currentTarget.value);
  const contexts = window.currentContexts || [];
  const visible = sortAiContexts(filterContextsByAiRange(contexts));
  if (visible.length) {
    const current = visible.find((context) => contextKey(context) === activeContextId);
    const selected = current || visible[0];
    setActiveContextId(contextKey(selected));
    setActiveAiContextDate(contextDate(selected));
  }
  renderAiContextSelector(contexts);
  renderContexts(contexts);
  renderRankings(window.currentRankings || [], window.currentMarkets || []);
  updateRankButtons(window.currentRankings || []);
  setupRevealAnimations();
}

function handleAiContextSortChange(event) {
  setActiveAiContextSort(event.currentTarget.value);
  const contexts = window.currentContexts || [];
  renderAiContextSelector(contexts);
  setupRevealAnimations();
}

function selectAiContext(key, contexts = [], options = {}) {
  setActiveContextId(key);
  const selected = contexts.find((context) => contextKey(context) === activeContextId);
  setActiveAiContextDate(contextDate(selected) || activeAiContextDate);
  if (options.silent) return;
  renderAiContextSelector(contexts);
  renderContexts(contexts);
  renderRankings(window.currentRankings || [], window.currentMarkets || []);
  updateRankButtons(window.currentRankings || []);
  setupRevealAnimations();
}

function filterContextsByAiRange(contexts = []) {
  const today = dateInShanghai(0);
  return contexts.filter((context) => {
    const date = contextDate(context);
    if (!date) return false;
    const diff = dateDistanceInDays(date, today);
    if (activeAiContextRange === 'today') return diff === 0;
    if (activeAiContextRange === 'month') return diff >= -30 && diff <= 31;
    return diff >= -6 && diff <= 7;
  });
}

function sortAiContexts(contexts = []) {
  return [...contexts].sort((a, b) => {
    if (activeAiContextSort === 'kickoff') {
      return timestampOf(a.kickoff) - timestampOf(b.kickoff)
        || timestampOf(b.capturedAt) - timestampOf(a.capturedAt);
    }
    if (activeAiContextSort === 'lineup') {
      return lineupSortScore(a) - lineupSortScore(b)
        || timestampOf(a.kickoff) - timestampOf(b.kickoff);
    }
    return timestampOf(b.capturedAt) - timestampOf(a.capturedAt)
      || timestampOf(a.kickoff) - timestampOf(b.kickoff);
  });
}

function dateDistanceInDays(date, baseDate) {
  const parsed = Date.parse(`${date}T00:00:00+08:00`);
  const base = Date.parse(`${baseDate}T00:00:00+08:00`);
  if (Number.isNaN(parsed) || Number.isNaN(base)) return 0;
  return Math.round((parsed - base) / 86400000);
}

function lineupSortScore(context = {}) {
  const kickoff = parseKickoffTime(context.kickoff);
  if (!kickoff) return Number.MAX_SAFE_INTEGER;
  const oneHour = 60 * 60 * 1000;
  const diff = kickoff.getTime() - Date.now();
  return Math.abs(diff - oneHour);
}

function renderAiContextTab(context) {
  const key = contextKey(context);
  const teams = contextTeams(context);
  const players = playerInfoStatus(context);
  const hasPrediction = Boolean(rankingForContext(context));
  const urgent = isInOneHourCountdown(context);
  const statusClass = urgent ? 'urgent' : hasPrediction ? 'predicted' : 'future';
  const statusLabel = urgent ? '1-Hour Lineup Alert' : hasPrediction ? 'Predicted' : 'Upcoming';
  return `
    <article class="ai-context-tab-card ${key === activeContextId ? 'active' : ''} ${urgent ? 'needs-predict' : ''}">
      <button class="ai-context-main" data-ai-context-tab="${escapeHtml(key)}" type="button">
        <div class="ai-context-teams">
          ${renderAiContextTeam(teams[0], 'home', contextTeamLogo(context, 0))}
          <span class="ai-context-v">v</span>
          ${renderAiContextTeam(teams[1], 'away', contextTeamLogo(context, 1))}
        </div>
        <div class="ai-context-meta-line">
          <span>${escapeHtml(formatBeijingKickoff(context.kickoff))}</span>
          <em class="${players.state}">${escapeHtml(players.shortLabel)}</em>
          <small class="${statusClass}">${statusLabel}</small>
        </div>
      </button>
      <div class="ai-context-actions">
        <button class="context-detail-button" data-context-detail="${escapeHtml(key)}" type="button">Details</button>
      </div>
    </article>
  `;
}

function renderAiContextTeam(team, side, logo) {
  return `
    <div class="ai-context-team ${side}">
      ${renderTeamCrest(logo, team)}
      <strong>${escapeHtml(team || 'Unknown')}</strong>
    </div>
  `;
}

function contextTeamLogo(context, index) {
  return String(index === 0
    ? context?.fixture?.home?.logo || ''
    : context?.fixture?.away?.logo || '');
}

function renderTeamCrest(logo, team) {
  if (!logo) return '<span class="team-crest team-crest-placeholder" aria-hidden="true"></span>';
  return `<img class="team-crest" src="${escapeHtml(logo)}" alt="${escapeHtml(team || 'Team')} crest" loading="lazy" referrerpolicy="no-referrer">`;
}

function rankingForContext(context) {
  const key = contextKey(context);
  return (window.currentRankings || []).find((ranking) => ranking.contextId === key) || null;
}

function isInOneHourCountdown(context = {}) {
  const kickoff = parseKickoffTime(context.kickoff);
  if (!kickoff) return false;
  const diff = kickoff.getTime() - Date.now();
  return diff >= 0 && diff <= 60 * 60 * 1000;
}

function renderContextExplorer(contexts) {
  if (!contextExplorerEl) return;
  if (!contexts?.length) {
    if (contextTabsEl) contextTabsEl.innerHTML = '';
    contextExplorerEl.innerHTML = '<p class="meta">No match details have been captured. Select a match from Match Intelligence to import it.</p>';
    return;
  }

  let explorerActiveContextId = activeContextId;
  if (!contexts.some((context) => contextKey(context) === explorerActiveContextId)) {
    explorerActiveContextId = contextKey(contexts[0]);
    if (!activeContextId) setActiveContextId(explorerActiveContextId);
  }
  const activeContext = contexts.find((context) => contextKey(context) === explorerActiveContextId) || contexts[0];
  const activeIndex = contexts.findIndex((context) => contextKey(context) === contextKey(activeContext));

  if (contextTabsEl) {
    contextTabsEl.innerHTML = contexts.map((context, index) => `
      <button class="${contextKey(context) === contextKey(activeContext) ? 'active' : ''}" data-context-tab="${escapeHtml(contextKey(context))}" type="button">
        <strong>${escapeHtml(context.matchName || `Match ${index + 1}`)}</strong>
        <span>${escapeHtml(context.kickoff || context.capturedAt || '')}</span>
      </button>
    `).join('');
    contextTabsEl.querySelectorAll('[data-context-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        setActiveContextId(button.dataset.contextTab);
        renderContextExplorer(contexts);
        renderContexts(window.currentContexts || contexts);
        renderRankings(window.currentRankings || [], window.currentMarkets || []);
        updateRankButtons(window.currentRankings || []);
        setupRevealAnimations();
      });
    });
  }

  const context = activeContext;
  contextExplorerEl.innerHTML = renderContextDetailCard(context, activeIndex);
  contextExplorerEl.querySelector('[data-refresh-context]')?.addEventListener('click', refreshContextData);
}

function renderContextDetailCard(context, activeIndex = 0) {
  const playerCount = Array.isArray(context.lineup?.players) ? context.lineup.players.length : 0;
  return `
    <article class="data-match-card featured">
      <div class="data-match-head">
        <div>
          <span>${activeIndex === 0 ? 'Latest Import' : 'Imported Data'}</span>
          <h3>${escapeHtml(context.matchName || 'Match')}</h3>
          <p>${escapeHtml(context.competition || '')} · ${escapeHtml(context.kickoff || '')}</p>
        </div>
        <div class="data-actions">
          <button class="secondary" data-refresh-context="${escapeHtml(context.sourceUrl || '')}" type="button">Refresh Match Data</button>
          <a href="https://dashboard.api-football.com/" target="_blank" rel="noreferrer">API Source</a>
        </div>
      </div>
      <div class="data-snapshot">
        ${renderInfoTile('Weather / Venue', context.live?.join(' · ') || context.lineup?.notes?.join(' · ') || 'Not captured')}
        ${renderInfoTile('Formation', context.lineup?.formation || 'Not captured')}
        ${renderInfoTile('Odds Categories', context.index?.tabs?.join(' / ') || 'Not captured')}
        ${renderInfoTile('API Predictions', `${context.experts?.length || 0} records`)}
        ${renderInfoTile('Player Data', playerCount ? `${playerCount} players captured` : 'Not captured')}
      </div>
      <div class="data-modules">
        ${renderDataModule(`Player Data${playerCount ? ` · ${playerCount} captured` : ' · Not captured'}`, context.lineup?.players || [], 'players')}
        ${renderDataModule('Recent Form', flattenRecent(context.analysis?.recent), 'recent')}
        ${renderDataModule('Standings', context.analysis?.standings || [], 'standings')}
        ${renderOddsModule(context.index)}
        ${renderExpertModule(context.experts || [])}
      </div>
    </article>
  `;
}

function openContextModal(context, contexts = []) {
  if (!contextModalEl || !contextModalBodyEl) return;
  const activeIndex = Math.max(0, contexts.findIndex((item) => contextKey(item) === contextKey(context)));
  if (contextModalTitleEl) contextModalTitleEl.textContent = context.matchName || 'Match Details';
  contextModalBodyEl.innerHTML = renderContextDetailCard(context, activeIndex);
  contextModalBodyEl.querySelector('[data-refresh-context]')?.addEventListener('click', async (event) => {
    await refreshContextData(event);
    closeContextModal();
  });
  contextModalEl.hidden = false;
  document.body.classList.add('modal-open');
  contextModalEl.querySelector('[data-close-context-modal]')?.focus?.();
}

function closeContextModal() {
  if (!contextModalEl) return;
  contextModalEl.hidden = true;
  document.body.classList.remove('modal-open');
}

function contextKey(context = {}) {
  const sourceUrl = String(context.sourceUrl || '');
  return context.matchId || sourceUrl || context.matchName || '';
}

function contextDate(context = {}) {
  const text = String(context.kickoff || context.capturedAt || '').trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = parseKickoffTime(text);
  if (!parsed) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(parsed);
}

function contextTeams(context = {}) {
  const teams = Array.isArray(context.teams) && context.teams.length >= 2
    ? context.teams
    : splitMatchTeams(context.matchName);
  return [teams[0] || context.lineup?.home || '', teams[1] || context.lineup?.away || ''];
}

function countryFlag(teamName) {
  const text = String(teamName || '').toLowerCase().replace(/\s+/g, '');
  const flags = [
    ['库拉索', '🇨🇼'], ['curacao', '🇨🇼'], ['curaçao', '🇨🇼'],
    ['科特迪瓦', '🇨🇮'], ['ivorycoast', '🇨🇮'], ['cotedivoire', '🇨🇮'],
    ['巴拿马', '🇵🇦'], ['panama', '🇵🇦'],
    ['英格兰', '🏴'], ['england', '🏴'],
    ['挪威', '🇳🇴'], ['norway', '🇳🇴'],
    ['法国', '🇫🇷'], ['france', '🇫🇷'],
    ['厄瓜多尔', '🇪🇨'], ['ecuador', '🇪🇨'],
    ['德国', '🇩🇪'], ['germany', '🇩🇪'],
    ['韩国', '🇰🇷'], ['korea', '🇰🇷'],
    ['墨西哥', '🇲🇽'], ['mexico', '🇲🇽'],
    ['摩洛哥', '🇲🇦'], ['morocco', '🇲🇦'],
    ['海地', '🇭🇹'], ['haiti', '🇭🇹'],
    ['苏格兰', '🏴󠁧󠁢󠁳󠁣󠁴󠁿'], ['scotland', '🏴󠁧󠁢󠁳󠁣󠁴󠁿'],
    ['巴西', '🇧🇷'], ['brazil', '🇧🇷'],
    ['波斯尼亚', '🇧🇦'], ['bosnia', '🇧🇦'],
    ['黑塞哥维那', '🇧🇦'],
    ['卡塔尔', '🇶🇦'], ['qatar', '🇶🇦'],
    ['瑞士', '🇨🇭'], ['switzerland', '🇨🇭'],
    ['加拿大', '🇨🇦'], ['canada', '🇨🇦'],
    ['克罗地亚', '🇭🇷'], ['croatia', '🇭🇷'],
    ['加纳', '🇬🇭'], ['ghana', '🇬🇭'],
    ['哥伦比亚', '🇨🇴'], ['colombia', '🇨🇴'],
    ['葡萄牙', '🇵🇹'], ['portugal', '🇵🇹'],
    ['刚果民主共和国', '🇨🇩'], ['drcongo', '🇨🇩'], ['congodr', '🇨🇩'],
    ['乌兹别克斯坦', '🇺🇿'], ['uzbekistan', '🇺🇿'],
    ['约旦', '🇯🇴'], ['jordan', '🇯🇴'],
    ['阿根廷', '🇦🇷'], ['argentina', '🇦🇷'],
    ['阿尔及利亚', '🇩🇿'], ['algeria', '🇩🇿'],
    ['奥地利', '🇦🇹'], ['austria', '🇦🇹']
  ];
  return flags.find(([name]) => text.includes(name))?.[1] || '🏳';
}

function formatKickoff(context = {}) {
  const kickoff = parseKickoffTime(context.kickoff);
  if (!kickoff) return context.kickoff || 'Time unavailable';
  const venue = venueText(context);
  const timeZone = venueTimeZone(venue) || 'Asia/Shanghai';
  const label = kickoff.toLocaleString('zh-CN', {
    timeZone,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const venueLabel = shortVenue(venue);
  return venueLabel ? `${label} · ${venueLabel}` : `${label} · Match venue`;
}

function formatBeijingKickoff(value) {
  const kickoff = parseKickoffTime(value);
  if (!kickoff) return value || 'Time unavailable';
  return kickoff.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function venueText(context = {}) {
  const items = [
    ...(Array.isArray(context.live) ? context.live : []),
    ...(Array.isArray(context.lineup?.notes) ? context.lineup.notes : [])
  ];
  const found = items.find((item) => /场地|球场|体育场|stadium|venue/i.test(String(item)));
  return String(found || '')
    .replace(/^场地[:：\s]*/i, '')
    .trim();
}

function shortVenue(venue = '') {
  return String(venue || '').split(/[·,，|]/)[0].trim();
}

function venueTimeZone(venue = '') {
  const text = String(venue || '').toLowerCase().replace(/\s+/g, '');
  const zones = [
    ['费城', 'America/New_York'], ['philadelphia', 'America/New_York'],
    ['纽约', 'America/New_York'], ['新泽西', 'America/New_York'], ['newyork', 'America/New_York'], ['newjersey', 'America/New_York'],
    ['迈阿密', 'America/New_York'], ['miami', 'America/New_York'],
    ['亚特兰大', 'America/New_York'], ['atlanta', 'America/New_York'],
    ['波士顿', 'America/New_York'], ['boston', 'America/New_York'],
    ['多伦多', 'America/Toronto'], ['toronto', 'America/Toronto'],
    ['堪萨斯', 'America/Chicago'], ['kansascity', 'America/Chicago'],
    ['达拉斯', 'America/Chicago'], ['dallas', 'America/Chicago'],
    ['休斯敦', 'America/Chicago'], ['休斯顿', 'America/Chicago'], ['houston', 'America/Chicago'],
    ['蒙特雷', 'America/Monterrey'], ['monterrey', 'America/Monterrey'],
    ['墨西哥城', 'America/Mexico_City'], ['mexicocity', 'America/Mexico_City'],
    ['瓜达拉哈拉', 'America/Mexico_City'], ['guadalajara', 'America/Mexico_City'],
    ['洛杉矶', 'America/Los_Angeles'], ['losangeles', 'America/Los_Angeles'],
    ['旧金山', 'America/Los_Angeles'], ['圣克拉拉', 'America/Los_Angeles'], ['sanfrancisco', 'America/Los_Angeles'], ['santaclara', 'America/Los_Angeles'],
    ['西雅图', 'America/Los_Angeles'], ['seattle', 'America/Los_Angeles'],
    ['温哥华', 'America/Vancouver'], ['vancouver', 'America/Vancouver']
  ];
  return zones.find(([name]) => text.includes(name))?.[1] || '';
}

function lineupTiming(context = {}) {
  const kickoff = parseKickoffTime(context.kickoff);
  if (!kickoff) return { state: 'muted', label: 'Kickoff time unavailable. Run an early prediction and refresh lineups before the match.' };
  const diff = kickoff.getTime() - Date.now();
  const oneHour = 60 * 60 * 1000;
  const finalWhistle = kickoff.getTime() + (150 * 60 * 1000);
  if (diff > oneHour) return { state: 'early', label: 'Early prediction window. Starting lineups are usually updated one hour before kickoff.' };
  if (diff >= 0) return { state: 'hot', label: 'One-hour lineup window: check player and starting lineup data.' };
  if (Date.now() < finalWhistle) return { state: 'live', label: 'Match in progress: prioritize player data and rerun with caution.' };
  return { state: 'done', label: 'The match may be finished. Use this data for review, not prediction.' };
}

function playerInfoStatus(context = {}) {
  const playerCount = Array.isArray(context.lineup?.players) ? context.lineup.players.length : 0;
  if (playerCount > 0) {
    return {
      state: 'has-players',
      label: `${playerCount} player records captured, including team, number, and position as returned by API-Football.`,
      shortLabel: `${playerCount} players captured`
    };
  }
  return {
    state: 'no-players',
    label: 'No player data is currently available. Refresh the match one hour before kickoff.',
    shortLabel: 'No player data'
  };
}

function modelBrand(modelName = '') {
  const key = modelBrandKey(modelName);
  const label = {
    gpt: 'GPT',
    claude: 'C',
    gemini: 'G',
    deepseek: 'DS',
    qwen: 'QW',
    ai: 'AI'
  }[key] || 'AI';
  const slug = {
    gpt: 'openai',
    claude: 'anthropic',
    gemini: 'googlegemini',
    deepseek: 'deepseek',
    qwen: 'alibabacloud'
  }[key];
  const icon = slug
    ? `<img src="https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${slug}.svg" alt="" loading="lazy" onerror="this.parentElement.classList.add('no-svg');this.remove()">`
    : '';
  return `<span class="model-brand ${key}" aria-hidden="true">${icon}<b>${label}</b></span>`;
}

function modelBrandKey(modelName = '') {
  const text = String(modelName).toLowerCase();
  if (text.includes('gpt') || text.includes('openai')) return 'gpt';
  if (text.includes('claude')) return 'claude';
  if (text.includes('gemini')) return 'gemini';
  if (text.includes('deepseek')) return 'deepseek';
  if (text.includes('qwen') || text.includes('通义')) return 'qwen';
  return 'ai';
}

async function refreshContextData(event) {
  const button = event.currentTarget;
  const sourceUrl = button.dataset.refreshContext;
  const original = button.textContent;
  try {
    button.disabled = true;
    button.textContent = 'Refreshing...';
    const { context } = await api('/api/contexts/refresh', {
      method: 'POST',
      body: JSON.stringify({ sourceUrl })
    });
    setActiveContextId(contextKey(context));
    setActiveAiContextDate(contextDate(context));
    await refresh();
    alert(`Refreshed: ${context.matchName || sourceUrl}`);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function renderInfoTile(label, value) {
  return `
    <div class="info-tile">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || 'Not captured')}</strong>
    </div>
  `;
}

function renderDataModule(title, rows, type) {
  if (type === 'odds' && rows?.live) return renderOddsModule(rows);
  const visible = (rows || []).slice(0, type === 'players' ? 30 : 10);
  return `
    <section class="data-module ${type}">
      <h4>${escapeHtml(title)} <span>${visible.length}</span></h4>
      ${visible.length ? `<ul>${visible.map((row) => `<li>${escapeHtml(row)}</li>`).join('')}</ul>` : '<p class="meta">No data was captured for this module.</p>'}
    </section>
  `;
}

function renderOddsModule(index = {}) {
  const live = index.live || {};
  const groups = [
    { key: 'asia', title: 'Live Asian Handicap', empty: 'No live Asian handicap was captured.' },
    { key: 'size', title: 'Live Goals Total', empty: 'No live goals total was captured.' },
    { key: 'euro', title: 'Live 1X2 Odds', empty: 'No live 1X2 odds were captured.' }
  ].map((group) => ({ ...group, rows: live[group.key] || [] }));
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  if (!total) return renderDataModule('Odds Summary', index.handicapRows || [], 'odds-fallback');
  return `
    <section class="data-module odds live-odds">
      <h4>Live Odds <span>${total}</span></h4>
      ${groups.map((group) => `
        <div class="odds-group">
          <div class="odds-group-title">${escapeHtml(group.title)} <span>${group.rows.length}</span></div>
          ${group.rows.length ? `
            <div class="odds-table-wrap">
              <table class="odds-table">
                <thead>
                  <tr><th>Bookmaker</th><th>Home</th><th>${group.key === 'euro' ? 'Draw' : 'Line'}</th><th>Away</th><th>Updated</th></tr>
                </thead>
                <tbody>
                  ${group.rows.slice(0, 10).map((row) => `
                    <tr>
                      <td>${escapeHtml(row.company || '-')}</td>
                      <td>${escapeHtml(row.home || '-')}</td>
                      <td>${escapeHtml(row.lineValue || row.line || '-')}</td>
                      <td>${escapeHtml(row.away || '-')}</td>
                      <td>${escapeHtml(row.updatedAt || '-')}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : `<p class="meta">${escapeHtml(group.empty)}</p>`}
        </div>
      `).join('')}
    </section>
  `;
}

function renderExpertModule(experts) {
  const visible = (experts || []).slice(0, 8);
  return `
    <section class="data-module experts">
      <h4>API Predictions <span>${visible.length}</span></h4>
      ${visible.length ? visible.map((item) => `
        <article class="expert-row">
          <strong>${escapeHtml(item.author || 'Unknown')}</strong>
          <p>${escapeHtml(item.title || '')}</p>
          <span>${escapeHtml([item.market, ...(item.tags || [])].filter(Boolean).join(' · '))}</span>
        </article>
      `).join('') : '<p class="meta">No API predictions are currently available.</p>'}
    </section>
  `;
}

function flattenRecent(recent = {}) {
  return Object.entries(recent).flatMap(([team, rows]) => (rows || []).slice(0, 6).map((row) => `${team}: ${row}`));
}

async function importStakeText() {
  const text = $('#stakeText').value;
  const sourceUrl = $('#sourceUrl').value;
  const result = await api('/api/import/text', {
    method: 'POST',
    body: JSON.stringify({ text, sourceUrl })
  });
  await refresh();
  return result;
}

function renderMarkets(markets) {
  if (!marketsEl) return;
  if (!markets.length) {
    marketsEl.innerHTML = '<p class="meta">Legacy markets have been cleared. AI predictions now generate candidates from API-Football context.</p>';
    return;
  }

  const groups = groupMarkets(markets);
  marketsEl.innerHTML = `
    <div class="market-overview">
      ${MARKET_GROUPS.map((group) => `
        <a class="stat-card" href="#market-${group.key}">
          <span>${group.label}</span>
          <strong>${groups[group.key].length}</strong>
        </a>
      `).join('')}
    </div>
  `;

  for (const group of MARKET_GROUPS) {
    const items = groups[group.key];
    const section = document.createElement('section');
    section.className = `market-section ${group.key}`;
    section.id = `market-${group.key}`;
    section.innerHTML = `
      <div class="section-heading">
        <div>
          <h3>${group.label}</h3>
          <p>${group.help}</p>
        </div>
        <span class="count">${items.length} items</span>
      </div>
      <div class="market-grid"></div>
    `;
    const grid = section.querySelector('.market-grid');
    if (!items.length) {
      grid.innerHTML = '<p class="meta empty">The imported data does not include this market.</p>';
    } else {
      for (const market of items) grid.appendChild(renderMarketCard(market, group));
    }
    marketsEl.appendChild(section);
  }
}

function renderMarketCard(market, group) {
  const card = document.createElement('article');
  card.className = 'market-card reveal';
  card.innerHTML = `
    <div class="market-card-top">
      <span class="pill ${group.key}">${group.label}</span>
      <span class="odds">@ ${formatOdds(market.odds)}</span>
    </div>
    <h4>${escapeHtml(market.matchName)}</h4>
    <div class="pick-line">
      <strong>${escapeHtml(market.selection)}</strong>
      <span>${escapeHtml(market.line)}</span>
    </div>
    <div class="prob-row">
      <span>Reference Odds</span>
      <strong>${percent(market.impliedProbability)}</strong>
    </div>
    <div class="source-row">${escapeHtml(shortUrl(market.sourceUrl))}</div>
    <div class="actions">
      <button data-predict="${market.id}">Multi-Model Prediction</button>
      <a href="/match/${encodeURIComponent(market.id)}">Details</a>
    </div>
  `;
  card.querySelector('button').addEventListener('click', () => predict(market.id));
  return card;
}

function renderRankings(rankings, markets) {
  const generated = collectLatestGeneratedResults(rankings);
  if (!generated.length) {
    const hasLegacyResults = currentContextRankings(rankings).some((ranking) => (ranking.results || []).length);
    rankingsEl.innerHTML = hasLegacyResults
      ? '<p class="meta">Legacy non-English predictions are hidden. Run the models again to create a new English prediction.</p>'
      : '<p class="meta">No AI prediction has been generated yet. Run the models to receive each model\'s Top 4 and switch between saved results.</p>';
    return;
  }

  const newest = currentContextRanking(rankings);
  const latestHasSuccess = newest?.results?.some((result) => (result.picks || []).length > 0);
  const latestNotice = latestHasSuccess
    ? '<div class="ranking-notice">The latest result for each model is retained. A failed single-model rerun will not hide other saved models.</div>'
    : '<div class="ranking-notice">The latest run returned no valid Top 4. Earlier valid model results remain available below.</div>';
  const marketMap = new Map(markets.map((market) => [market.id, market]));
  if (!generated.some((item) => isActiveRankingItem(item)) || activeRankingModel === 'all') {
    activeRankingModel = generated[0].key;
  }
  const activeItem = generated.find((item) => isActiveRankingItem(item)) || generated[0];
  activeRankingModel = activeItem.key;
  const activeResult = activeItem.result;

  rankingsEl.innerHTML = `
    <div class="ranking-meta">
      <strong>Latest AI Prediction</strong>
      <span>${escapeHtml(new Date(activeItem.ranking.createdAt).toLocaleString('en-US'))} · ${activeItem.ranking.marketCount} candidates · Showing ${escapeHtml(activeResult.modelName)}</span>
    </div>
    ${latestNotice}
    <div class="generated-switch">
      <div>
        <strong>Latest Model Results</strong>
        <span>Switching tabs only changes the saved result. It does not rerun a model or call an API.</span>
      </div>
      <div class="model-tabs" role="tablist" aria-label="Switch saved AI prediction results">
        ${generated.map((item) => `
          <button class="${item.key === activeRankingModel ? 'active' : ''}" data-model-tab="${escapeHtml(item.key)}" type="button">
            ${modelBrand(item.result.modelName)}
            <strong>${escapeHtml(item.result.modelName)}</strong>
            <span>${escapeHtml(new Date(item.ranking.createdAt).toLocaleTimeString())} · Top ${(item.result.picks || []).length}</span>
          </button>
        `).join('')}
      </div>
    </div>
    <div class="ranking-grid single">
      ${renderModelRanking(activeResult, marketMap)}
    </div>
  `;

  rankingsEl.querySelectorAll('[data-model-tab]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      activeRankingModel = button.dataset.modelTab;
      renderRankings(rankings, markets);
      setupRevealAnimations();
    });
  });
}

function collectLatestGeneratedResults(rankings) {
  const related = currentContextRankings(rankings);
  if (!related.length) return [];
  const byModel = new Map();
  for (const ranking of related) {
    for (const result of ranking.results || []) {
      if (!isEnglishPredictionResult(result)) continue;
      const modelKey = modelBrandKey(result.modelName || '');
      const resultCreatedAt = result.generatedAt || ranking.createdAt;
      const candidate = {
        key: `${ranking.id}:${modelKey}`,
        modelKey,
        ranking: { ...ranking, createdAt: resultCreatedAt },
        result
      };
      const existing = byModel.get(modelKey);
      if (!existing || isNewerModelResult(candidate, existing)) byModel.set(modelKey, candidate);
    }
  }
  const order = new Map(RANK_MODELS.map((model, index) => [modelBrandKey(model), index]));
  return [...byModel.values()].sort((a, b) => {
    const aOrder = order.has(a.modelKey) ? order.get(a.modelKey) : 99;
    const bOrder = order.has(b.modelKey) ? order.get(b.modelKey) : 99;
    return aOrder - bOrder || timestampOf(b.ranking.createdAt) - timestampOf(a.ranking.createdAt);
  });
}

function isEnglishPredictionResult(result) {
  return !/[\u3400-\u9fff]/u.test(JSON.stringify(result || {}));
}

function isNewerModelResult(candidate, existing) {
  const candidateTime = timestampOf(candidate.ranking?.createdAt);
  const existingTime = timestampOf(existing.ranking?.createdAt);
  if (candidateTime !== existingTime) return candidateTime > existingTime;
  return modelResultSpecificity(candidate.result) >= modelResultSpecificity(existing.result);
}

function modelResultSpecificity(result = {}) {
  const name = String(result.modelName || '');
  let score = name.length;
  if (/\d/.test(name)) score += 20;
  if (/max|pro|preview|5\.5|4\.8/i.test(name)) score += 10;
  if (result.error) score -= 5;
  return score;
}

function currentContextRanking(rankings = []) {
  if (!rankings?.length) return null;
  if (!activeContextId) return rankings[0] || null;
  return rankings.find((ranking) => ranking.contextId === activeContextId) || null;
}

function currentContextRankings(rankings = []) {
  if (!rankings?.length) return [];
  if (!activeContextId) return rankings;
  return rankings.filter((ranking) => ranking.contextId === activeContextId);
}

function updateRankButtons(rankings = []) {
  const hasRanking = Boolean(currentContextRanking(rankings));
  document.querySelectorAll('[data-rank-model]').forEach((button) => {
    const model = button.dataset.rankModel;
    if (model === 'all') {
      button.textContent = hasRanking ? 'Rerun All AI Models' : 'Run All AI Models';
      return;
    }
    button.textContent = hasRanking ? `Rerun ${model}` : `Run ${model}`;
  });
  renderGuestAccess();
}

function isActiveRankingItem(item) {
  return item.key === activeRankingModel
    || String(item.result?.modelName || '').toLowerCase() === String(activeRankingModel || '').toLowerCase();
}

function renderModelRanking(result, marketMap) {
  if (result?.error) {
    return `
      <article class="model-ranking error">
        <h3 class="model-title">${modelBrand(result.modelName)} ${escapeHtml(result.modelName)} ${result.provider ? `<span class="provider-badge">${escapeHtml(result.provider)}</span>` : ''}</h3>
        <p>${escapeHtml(formatModelError(result.error))}</p>
      </article>
    `;
  }

  const picks = result?.picks || [];
  return `
    <article class="model-ranking">
      <div class="model-ranking-head">
        <div>
          <h3 class="model-title">${modelBrand(result?.modelName)} ${escapeHtml(result?.modelName || 'AI')}</h3>
          ${result?.provider ? `<span class="provider-badge">${escapeHtml(result.provider)}</span>` : ''}
          <p>Sorted by model-estimated probability, not by implied betting odds.</p>
        </div>
        <span>Top ${picks.length}</span>
      </div>
      ${renderScorePredictions(result.scorePicks || [])}
      ${renderBttsPrediction(result.bttsPick)}
      <div class="prediction-cards">
        ${picks.length ? picks.map((pick, index) => renderRankingPick(pick, marketMap, index)).join('') : '<p class="meta">This model did not return a valid selection.</p>'}
      </div>
    </article>
  `;
}

function renderBttsPrediction(pick) {
  if (!pick) return '';
  const risks = Array.isArray(pick.risks) ? pick.risks.filter(Boolean).slice(0, 3) : [];
  return `
    <section class="btts-prediction" aria-label="Both teams to score prediction">
      <div class="btts-answer">
        <span>Both Teams to Score</span>
        <strong>${escapeHtml(pick.selection || 'Unavailable')}</strong>
      </div>
      <div class="btts-metrics">
        <div><span>AI Probability</span><strong>${percent(pick.estimatedProbability)}</strong></div>
        <div><span>Confidence</span><strong>${percent(pick.confidence)}</strong></div>
      </div>
      <div class="btts-analysis">
        <span>Analysis</span>
        <p>${escapeHtml(pick.reason || 'No analysis provided')}</p>
        ${risks.length ? `<small>${risks.map(escapeHtml).join(' · ')}</small>` : ''}
      </div>
    </section>
  `;
}

function renderScorePredictions(scorePicks) {
  const picks = (scorePicks || []).slice(0, 4);
  return `
    <section class="score-predictions">
      <div class="score-head">
        <strong>Score Predictions</strong>
        <span>2 primary scores + 1 market-fit score + 1 aggressive score</span>
      </div>
      <div class="score-grid">
        ${picks.length ? picks.map((pick, index) => `
          <article class="score-card">
            <span>#${index + 1}</span>
            <em>${escapeHtml(scoreTypeLabel(pick.scoreType, index))}</em>
            <strong>${escapeHtml(pick.score || pick.market?.selection || '')}</strong>
            <div>AI Probability ${percent(pick.estimatedProbability)}</div>
            <p>${escapeHtml(pick.reason || 'No reason provided')}</p>
          </article>
        `).join('') : '<p class="meta">This model did not return four valid score predictions.</p>'}
      </div>
    </section>
  `;
}

function scoreTypeLabel(type, index = 0) {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'market_fit') return 'Market-Fit Score';
  if (normalized === 'aggressive') return 'Aggressive Score';
  return index <= 1 ? `Primary Score ${index + 1}` : index === 2 ? 'Market-Fit Score' : 'Aggressive Score';
}

function renderRankingPick(pick, marketMap, index) {
  const market = pick.market || marketMap.get(pick.marketId) || {};
  const categoryKey = marketCategory(market);
  const category = MARKET_GROUPS.find((group) => group.key === categoryKey) || MARKET_GROUPS.at(-1);
  const risks = Array.isArray(pick.risks) ? pick.risks.filter(Boolean).slice(0, 3) : [];
  const outcome = marketOutcomeLabel(market);
  const outcomeDisplay = marketOutcomeDisplay(market);
  const winnerFlag = categoryKey === 'moneyline' ? renderMoneylineFlag(market) : '';
  return `
    <article class="prediction-card ${categoryKey} reveal">
      <div class="prediction-rank">
        <span>#${index + 1}</span>
        <b class="pill ${categoryKey}">${escapeHtml(category.label)}</b>
      </div>
      <div class="prediction-main">
        <div class="prediction-title-row">
          ${winnerFlag}
          <h4>${escapeHtml(formatPredictionTitle(market))}</h4>
        </div>
        <p>${escapeHtml(market.matchName || 'Unknown Match')}</p>
      </div>
      <div class="prediction-metrics">
        <div><span>${categoryKey === 'moneyline' ? '1X2' : 'Line'}</span><strong>${escapeHtml(categoryKey === 'moneyline' ? outcome : (displayMarketLine(market) || 'None'))}</strong></div>
        <div><span>AI Probability</span><strong>${percent(pick.estimatedProbability)}</strong></div>
        <div><span>Confidence</span><strong>${percent(pick.confidence)}</strong></div>
        <div><span>Selection</span><strong>${escapeHtml(market.selection || 'None')}</strong></div>
      </div>
      <div class="prediction-reason">
        <span>Analysis</span>
        <p>${escapeHtml(pick.reason || 'No reason provided')}</p>
      </div>
      <div class="prediction-risks">
        <span>Risks</span>
        ${risks.length ? risks.map((risk) => `<b>${escapeHtml(risk)}</b>`).join('') : '<b>The model did not list a specific risk</b>'}
      </div>
    </article>
  `;
}

function renderMoneylineFlag(market) {
  const selection = String(market?.selection || '').trim();
  const isDraw = /平|draw|tie/i.test(selection);
  return `<span class="winner-flag" title="${escapeHtml(isDraw ? 'Draw' : selection)}">${escapeHtml(isDraw ? 'D' : countryFlag(selection))}</span>`;
}

function renderReports(reports) {
  reportsEl.innerHTML = reports.length ? '' : '<p class="meta">No prediction history yet.</p>';
  for (const report of reports) {
    const consensus = report.consensus;
    const card = document.createElement('article');
    card.className = 'report-card reveal';
    const badgeClass = consensus.bucket === '放弃' ? 'danger' : consensus.bucket?.includes('观望') ? 'warn' : '';
    card.innerHTML = `
      <div class="report-head">
        <div>
          <h3>${escapeHtml(report.market.matchName)}</h3>
          <p>${escapeHtml(displayMarketType(report.market.marketType))} · ${escapeHtml(report.market.selection)} ${escapeHtml(report.market.line)} @ ${formatOdds(report.market.odds)}</p>
        </div>
        <span class="badge ${badgeClass}">${escapeHtml(consensus.bucket)}</span>
      </div>
      <div class="report-metrics">
        <div><span>Direction</span><strong>${escapeHtml(consensus.finalDirection)}</strong></div>
        <div><span>Combined Probability</span><strong>${percent(consensus.combinedProbability)}</strong></div>
        <div><span>Agreement</span><strong>${percent(consensus.agreement)}</strong></div>
        <div><span>Risk</span><strong>${escapeHtml(consensus.riskLevel)}</strong></div>
      </div>
    `;
    reportsEl.appendChild(card);
  }
}

function renderAnalytics(analytics) {
  if (!analyticsContentEl) return;
  analyticsState.raw = analytics;
  normalizeAnalyticsFilters();
  renderAnalyticsView();
  return;
  if (!analytics || !analytics.evaluatedCount) {
    analyticsContentEl.innerHTML = `
      <div class="empty-analytics">
        <strong>No accuracy data is available yet</strong>
        <p class="meta">${analytics?.contextCount || 0} matches imported; ${analytics?.scoredContextCount || 0} final scores captured; ${analytics?.finishedWithoutScoreCount || 0} likely completed matches are missing scores. Use Refresh Results to update them.</p>
      </div>
    `;
    return;
  }

  analyticsContentEl.innerHTML = `
    <div class="analytics-stats">
      <article><span>Evaluated Predictions</span><strong>${analytics.evaluatedCount}</strong></article>
      <article><span>Completed Matches</span><strong>${analytics.matchCount}</strong></article>
      <article><span>Models</span><strong>${analytics.models.length}</strong></article>
    </div>
    <div class="analytics-grid">
      <section class="analytics-card">
        <div class="section-heading compact-heading">
          <h3>Model Accuracy</h3>
          <span class="count">${analytics.models.length}</span>
        </div>
        <div class="accuracy-bars">
          ${analytics.models.map(renderAccuracyBar).join('')}
        </div>
      </section>
      <section class="analytics-card">
        <div class="section-heading compact-heading">
          <h3>Market Accuracy</h3>
          <span class="count">${analytics.categories.length}</span>
        </div>
        <div class="accuracy-bars">
          ${analytics.categories.map((row) => renderAccuracyBar({ ...row, key: categoryName(row.key) })).join('')}
        </div>
      </section>
      <section class="analytics-card wide">
        <div class="section-heading compact-heading">
          <h3>Accuracy Trend</h3>
          <p>Grouped by match date</p>
        </div>
        ${renderTrendChart(analytics.trend || [])}
      </section>
      <section class="analytics-card wide">
        <div class="section-heading compact-heading">
          <h3>Post-Match Review</h3>
          <span class="count">${analytics.evaluations.length}</span>
        </div>
        <div class="analytics-table-wrap">
          <table class="analytics-table">
            <thead>
              <tr><th>Match</th><th>Model</th><th>Market</th><th>Prediction</th><th>Final Score</th><th>Result</th></tr>
            </thead>
            <tbody>
              ${analytics.evaluations.slice(0, 80).map(renderEvaluationRow).join('')}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function renderAnalyticsView() {
  if (!analyticsContentEl) return;
  const analytics = analyticsState.raw;
  if (!analytics || !analytics.evaluatedCount) {
    analyticsContentEl.innerHTML = `
      <div class="empty-analytics">
        <strong>No accuracy data is available yet</strong>
        <p class="meta">${analytics?.contextCount || 0} matches imported; ${analytics?.scoredContextCount || 0} final scores captured; ${analytics?.finishedWithoutScoreCount || 0} likely completed matches are missing scores. Use Refresh Results to update them.</p>
      </div>
    `;
    return;
  }

  const allEvaluations = (analytics.evaluations || []).filter((item) => item.counted);
  const dateOptions = buildOptionRows(allEvaluations, (item) => evaluationDate(item), true);
  const baseByDate = filterAnalyticsRows(allEvaluations, { category: 'all', match: 'all', model: 'all', hitsOnly: false });
  const matchOptions = buildOptionRows(baseByDate, (item) => item.contextName || item.contextId);
  const modelOptions = buildOptionRows(baseByDate, (item) => item.modelName || 'AI');
  const categoryOptions = buildOptionRows(baseByDate, (item) => item.category || 'other');
  const filtered = filterAnalyticsRows(allEvaluations);
  const models = summarizeAnalyticsRows(filtered, (item) => item.modelName || 'AI');
  const categories = summarizeAnalyticsRows(filtered, (item) => item.category || 'other');
  const trend = buildAnalyticsTrend(filtered);
  const matchCount = new Set(filtered.map((item) => item.contextId)).size;

  analyticsContentEl.innerHTML = `
    <div class="analytics-filters">
      <label>
        <span>Match Date</span>
        <select data-analytics-filter="date">
          <option value="all"${analyticsState.date === 'all' ? ' selected' : ''}>All Dates (${allEvaluations.length})</option>
          ${dateOptions.map((row) => `<option value="${escapeHtml(row.key)}"${analyticsState.date === row.key ? ' selected' : ''}>${escapeHtml(row.key)} (${row.count})</option>`).join('')}
        </select>
      </label>
      <label>
        <span>Market</span>
        <select data-analytics-filter="category">
          <option value="all"${analyticsState.category === 'all' ? ' selected' : ''}>All Markets</option>
          ${categoryOptions.map((row) => `<option value="${escapeHtml(row.key)}"${analyticsState.category === row.key ? ' selected' : ''}>${escapeHtml(categoryName(row.key))}（${row.count}）</option>`).join('')}
        </select>
      </label>
      <label>
        <span>Match</span>
        <select data-analytics-filter="match">
          <option value="all"${analyticsState.match === 'all' ? ' selected' : ''}>All Matches</option>
          ${matchOptions.map((row) => `<option value="${escapeHtml(row.key)}"${analyticsState.match === row.key ? ' selected' : ''}>${escapeHtml(row.key)}（${row.count}）</option>`).join('')}
        </select>
      </label>
      <label>
        <span>Model</span>
        <select data-analytics-filter="model">
          <option value="all"${analyticsState.model === 'all' ? ' selected' : ''}>All Models</option>
          ${modelOptions.map((row) => `<option value="${escapeHtml(row.key)}"${analyticsState.model === row.key ? ' selected' : ''}>${escapeHtml(row.key)}（${row.count}）</option>`).join('')}
        </select>
      </label>
      <button class="analytics-hit-toggle ${analyticsState.hitsOnly ? 'active' : ''}" type="button" data-analytics-hit-toggle>
        ${analyticsState.hitsOnly ? 'Hits Only' : 'All Results'}
      </button>
    </div>
    <div class="analytics-stats">
      <article><span>Evaluated Predictions</span><strong>${filtered.length}</strong></article>
      <article><span>Completed Matches</span><strong>${matchCount}</strong></article>
      <article><span>Models</span><strong>${models.length}</strong></article>
    </div>
    <div class="analytics-grid">
      <section class="analytics-card">
        <div class="section-heading compact-heading">
          <h3>Model Accuracy</h3>
          <span class="count">${models.length}</span>
        </div>
        <div class="accuracy-bars">
          ${models.length ? models.map(renderAccuracyBar).join('') : '<p class="meta">No model data matches the current filters.</p>'}
        </div>
      </section>
      <section class="analytics-card">
        <div class="section-heading compact-heading">
          <h3>Market Accuracy</h3>
          <span class="count">${categories.length}</span>
        </div>
        <div class="accuracy-bars">
          ${categories.length ? categories.map((row) => renderAccuracyBar({ ...row, key: categoryName(row.key) })).join('') : '<p class="meta">No market data matches the current filters.</p>'}
        </div>
      </section>
      <section class="analytics-card wide">
        <div class="section-heading compact-heading">
          <h3>Accuracy Trend</h3>
          <p>Grouped by match date and model.</p>
        </div>
        ${renderTrendChart(trend)}
      </section>
      <section class="analytics-card wide">
        <div class="section-heading compact-heading">
          <h3>Post-Match Review</h3>
          <span class="count">${filtered.length}</span>
        </div>
        <div class="analytics-table-wrap">
          <table class="analytics-table">
            <thead>
              <tr><th>Match</th><th>Date</th><th>Model</th><th>Market</th><th>Prediction</th><th>Final Score</th><th>Result</th></tr>
            </thead>
            <tbody>
              ${filtered.slice(0, 160).map(renderEvaluationRowV2).join('') || '<tr><td colspan="7">No details match the current filters.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function normalizeAnalyticsFilters() {
  const rows = (analyticsState.raw?.evaluations || []).filter((item) => item.counted);
  const dates = buildOptionRows(rows, (item) => evaluationDate(item), true).map((row) => row.key);
  if (!analyticsState.date || (analyticsState.date !== 'all' && !dates.includes(analyticsState.date))) {
    analyticsState.date = dates[0] || 'all';
  }
  const dateRows = filterAnalyticsRows(rows, { category: 'all', match: 'all', model: 'all', hitsOnly: false });
  const matches = new Set(dateRows.map((item) => item.contextName || item.contextId));
  const models = new Set(dateRows.map((item) => item.modelName || 'AI'));
  const categories = new Set(dateRows.map((item) => item.category || 'other'));
  if (analyticsState.match !== 'all' && !matches.has(analyticsState.match)) analyticsState.match = 'all';
  if (analyticsState.model !== 'all' && !models.has(analyticsState.model)) analyticsState.model = 'all';
  if (analyticsState.category !== 'all' && !categories.has(analyticsState.category)) analyticsState.category = 'all';
}

function filterAnalyticsRows(rows, overrides = {}) {
  const filters = { ...analyticsState, ...overrides };
  return rows.filter((item) => {
    if (filters.date !== 'all' && evaluationDate(item) !== filters.date) return false;
    if (filters.category !== 'all' && item.category !== filters.category) return false;
    if (filters.match !== 'all' && (item.contextName || item.contextId) !== filters.match) return false;
    if (filters.model !== 'all' && (item.modelName || 'AI') !== filters.model) return false;
    if (filters.hitsOnly && !item.hit) return false;
    return true;
  });
}

function buildOptionRows(rows, keyFn, desc = false) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => desc ? String(b.key).localeCompare(String(a.key)) : String(a.key).localeCompare(String(b.key)));
}

function summarizeAnalyticsRows(rows, keyFn) {
  const map = new Map();
  for (const item of rows) {
    if (!item.counted) continue;
    const key = keyFn(item) || 'unknown';
    const row = map.get(key) || { key, total: 0, hits: 0, accuracy: 0 };
    row.total += 1;
    if (item.hit) row.hits += 1;
    row.accuracy = row.total ? row.hits / row.total : 0;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.accuracy - a.accuracy || b.total - a.total);
}

function buildAnalyticsTrend(rows) {
  const map = new Map();
  for (const item of rows) {
    if (!item.counted) continue;
    const date = evaluationDate(item);
    const modelName = item.modelName || 'AI';
    const key = `${date}|${modelName}`;
    const row = map.get(key) || { date, modelName, total: 0, hits: 0, accuracy: 0 };
    row.total += 1;
    if (item.hit) row.hits += 1;
    row.accuracy = row.total ? row.hits / row.total : 0;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.modelName.localeCompare(b.modelName));
}

function evaluationDate(item) {
  return item.matchDate || String(item.kickoff || item.predictedAt || '').slice(0, 10) || 'unknown';
}

async function refreshAnalyticsData(event) {
  const button = event?.currentTarget;
  const original = button?.textContent;
  try {
    if (button) {
      button.disabled = true;
      button.textContent = 'Refreshing Results...';
    }
    const { analytics, refreshed, attempted, errors } = await api('/api/analytics/refresh', { method: 'POST' });
    renderAnalytics(analytics);
    const suffix = errors?.length ? `, ${errors.length} failed` : '';
    alert(`Checked ${attempted || 0} matches and refreshed ${refreshed || 0}${suffix}`);
  } catch (error) {
    alert(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

function renderAccuracyBar(row) {
  const pct = Math.round((row.accuracy || 0) * 100);
  return `
    <div class="accuracy-row">
      <div>
        <strong>${escapeHtml(row.key)}</strong>
        <span>${row.hits}/${row.total}</span>
      </div>
      <div class="accuracy-track"><i style="width:${pct}%"></i></div>
      <b>${pct}%</b>
    </div>
  `;
}

function renderTrendChartWithIcons(trend) {
  if (!trend.length) return '<p class="meta">No trend data is available.</p>';
  const points = trend.slice(-24);
  const width = 900;
  const height = 260;
  const pad = 34;
  const maxIndex = Math.max(1, points.length - 1);
  const polyline = points.map((point, index) => {
    const x = pad + (index / maxIndex) * (width - pad * 2);
    const y = height - pad - (point.accuracy || 0) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `
    <div class="trend-chart">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Accuracy trend">
        <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}"></line>
        <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}"></line>
        <polyline points="${polyline}"></polyline>
        ${points.map((point, index) => {
          const x = pad + (index / maxIndex) * (width - pad * 2);
          const y = height - pad - (point.accuracy || 0) * (height - pad * 2);
          return `
            <g>
              <title>${escapeHtml(point.date)} ${escapeHtml(point.modelName)} ${Math.round(point.accuracy * 100)}%</title>
              <foreignObject x="${(x - 15).toFixed(1)}" y="${(y - 15).toFixed(1)}" width="30" height="30">
                <div class="trend-model-point">${modelBrand(point.modelName)}</div>
              </foreignObject>
            </g>
          `;
        }).join('')}
      </svg>
      <div class="trend-legend">
        ${points.slice(-8).map((point) => `<span>${escapeHtml(point.date)} · ${escapeHtml(point.modelName)} · ${Math.round(point.accuracy * 100)}%</span>`).join('')}
      </div>
    </div>
  `;
}

function renderEvaluationRowV2(item) {
  return `
    <tr>
      <td>${escapeHtml(item.contextName)}</td>
      <td>${escapeHtml(evaluationDate(item))}</td>
      <td>${escapeHtml(item.modelName)}</td>
      <td>${escapeHtml(categoryName(item.category))}</td>
      <td>${escapeHtml(item.selection)}</td>
      <td>${escapeHtml(item.actualScore)}</td>
      <td><b class="${item.counted ? item.hit ? 'hit' : 'miss' : 'push'}">${item.counted ? item.hit ? 'Hit' : 'Miss' : 'Push'}</b></td>
    </tr>
  `;
}

function renderTrendChart(trend) {
  if (!trend.length) return '<p class="meta">No trend data is available.</p>';
  const points = trend.slice(-32);
  const width = 900;
  const height = 260;
  const pad = 38;
  const maxIndex = Math.max(1, points.length - 1);
  const polyline = points.map((point, index) => {
    const x = pad + (index / maxIndex) * (width - pad * 2);
    const y = height - pad - (point.accuracy || 0) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `
    <div class="trend-chart">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Accuracy trend">
        <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}"></line>
        <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}"></line>
        <polyline points="${polyline}"></polyline>
        ${points.map((point, index) => {
          const x = pad + (index / maxIndex) * (width - pad * 2);
          const y = height - pad - (point.accuracy || 0) * (height - pad * 2);
          return `
            <g>
              <title>${escapeHtml(point.date)} ${escapeHtml(point.modelName)} ${Math.round(point.accuracy * 100)}%</title>
              <foreignObject x="${(x - 15).toFixed(1)}" y="${(y - 15).toFixed(1)}" width="30" height="30">
                <div class="trend-model-point">${modelBrand(point.modelName)}</div>
              </foreignObject>
            </g>
          `;
        }).join('')}
      </svg>
      <div class="trend-legend">
        ${points.slice(-10).map((point) => `<span>${modelBrand(point.modelName)} ${escapeHtml(point.date)} · ${escapeHtml(point.modelName)} · ${Math.round(point.accuracy * 100)}%</span>`).join('')}
      </div>
    </div>
  `;
}

function renderEvaluationRow(item) {
  return `
    <tr>
      <td>${escapeHtml(item.contextName)}</td>
      <td>${escapeHtml(evaluationDate(item))}</td>
      <td>${escapeHtml(item.modelName)}</td>
      <td>${escapeHtml(categoryName(item.category))}</td>
      <td>${escapeHtml(item.selection)}</td>
      <td>${escapeHtml(item.actualScore)}</td>
      <td><b class="${item.counted ? item.hit ? 'hit' : 'miss' : 'push'}">${item.counted ? item.hit ? 'Hit' : 'Miss' : 'Push'}</b></td>
    </tr>
  `;
}

function categoryName(category) {
  return {
    moneyline: 'Moneyline',
    handicap: 'Asian Handicap',
    total: 'Goals Total',
    score: 'Correct Score'
  }[category] || category;
}

async function predict(id) {
  try {
    const { report } = await api(`/api/predict/${encodeURIComponent(id)}`, { method: 'POST' });
    alert(`Complete: ${report.consensus.bucket}`);
    history.pushState({}, '', `/match/${encodeURIComponent(id)}`);
    await refresh();
  } catch (error) {
    alert(error.message);
  }
}

async function runRanking(model, button) {
  const originalHtml = button.innerHTML;
  let completed = false;
  try {
    button.disabled = true;
    button.textContent = 'Predicting...';
    await api('/api/rankings', {
      method: 'POST',
      body: JSON.stringify({ model, contextId: activeContextId, qwenVariant: selectedQwenVariant() })
    });
    activeRankingModel = model === 'all'
      ? 'all'
      : model;
    await syncAccessStatus();
    await refresh();
    completed = true;
  } catch (error) {
    if (error.code === 'GUEST_LIMIT_REACHED') {
      accessState.guestPredictionUsed = true;
      renderGuestAccess();
      window.footballAuth?.open(error.message);
    } else if (error.code === 'SUBSCRIPTION_REQUIRED') {
      accessState.billing = { tier: 'locked', active: false, freePredictionUsed: true };
      renderGuestAccess();
      renderBillingStatus();
      setBillingMessage(error.message, true);
      $('#subscriptionPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      alert(error.message);
    }
  } finally {
    if (!completed) button.innerHTML = originalHtml;
    renderGuestAccess();
  }
}

function renderRoute(markets, reports, contexts = []) {
  const match = location.pathname.match(/^\/match\/([^/]+)$/);
  const dataPage = $('#dataPage');
  const dataBackHome = $('#dataBackHome');
  const matchCenter = $('.match-center');
  const aiPanel = $('#ai-panel');
  const historyPanel = $('#historyPanel');
  const analyticsPanel = $('#analyticsPanel');
  const backendPanel = $('#backendPanel');
  const adminDashboard = $('#adminDashboard');
  const subscriptionPanel = $('#subscriptionPanel');
  const isHome = location.pathname === '/';
  const isAnalytics = location.pathname === '/analytics';
  const isBackend = location.pathname === '/backend';
  const isAdmin = location.pathname === '/admin';

  document.body.classList.toggle('backend-route', isBackend);
  document.body.classList.toggle('admin-route', isAdmin);

  if (matchPanel) matchPanel.hidden = true;
  if (dataPage) dataPage.hidden = location.pathname !== '/data';
  if (backendPanel) backendPanel.hidden = !isBackend;
  if (adminDashboard) adminDashboard.hidden = !isAdmin;
  if (dataBackHome) dataBackHome.hidden = isHome;
  if (matchCenter) matchCenter.hidden = location.pathname === '/data' || location.pathname === '/history' || isAnalytics || isBackend || isAdmin || Boolean(match);
  if (aiPanel) aiPanel.hidden = location.pathname === '/data' || location.pathname === '/history' || isAnalytics || isBackend || isAdmin || Boolean(match);
  if (historyPanel) historyPanel.hidden = location.pathname === '/data' || isAnalytics || isBackend || isAdmin || Boolean(match);
  if (analyticsPanel) analyticsPanel.hidden = !isAnalytics;
  if (subscriptionPanel) subscriptionPanel.hidden = isBackend || isAdmin || location.pathname === '/data' || isAnalytics || Boolean(match);

  if (isAdmin) {
    setupRevealAnimations();
    return;
  }

  if (isBackend) {
    backendPanel?.scrollIntoView({ block: 'start' });
    setupRevealAnimations();
    return;
  }

  if (location.pathname === '/data') {
    renderContextExplorer(contexts);
    dataPage?.scrollIntoView({ block: 'start' });
    return;
  }
  if (location.pathname === '/history') {
    $('#historyPanel')?.scrollIntoView({ block: 'start' });
    return;
  }
  if (isAnalytics) {
    analyticsPanel?.scrollIntoView({ block: 'start' });
    return;
  }
  if (!match) return;

  const id = decodeURIComponent(match[1]);
  const market = markets.find((item) => item.id === id);
  const related = reports.filter((report) => report.market?.id === id || report.consensus?.marketId === id);
  if (matchPanel) matchPanel.hidden = false;
  if (!market) {
    matchDetailEl.innerHTML = '<p class="meta">This market could not be found and may have been removed.</p>';
    return;
  }
  matchDetailEl.innerHTML = `
    <div class="card">
      <h3>${escapeHtml(market.matchName)}</h3>
      <div class="meta">
        <div>${escapeHtml(market.marketType)} · ${escapeHtml(market.selection)} ${escapeHtml(market.line)} @ ${formatOdds(market.odds)}</div>
        <div>Implied Probability: ${percent(market.impliedProbability)}</div>
        <div>Historical Reports: ${related.length}</div>
      </div>
      <button data-predict-detail="${market.id}">Rerun Prediction</button>
      ${related[0] ? `<pre>${escapeHtml(JSON.stringify(related[0].consensus, null, 2))}</pre>` : '<p class="meta">No prediction report is available.</p>'}
    </div>
  `;
  matchDetailEl.querySelector('button')?.addEventListener('click', () => predict(market.id));
  matchPanel.scrollIntoView({ block: 'start' });
}

function isUnfinishedContext(context) {
  const kickoff = parseKickoffTime(context?.kickoff);
  if (!kickoff) return false;
  const estimatedFinalWhistle = kickoff.getTime() + (150 * 60 * 1000);
  return estimatedFinalWhistle > Date.now();
}

function parseKickoffTime(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    const [, year, month, day, hour, minute, second = '00'] = match;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function api(path, options = {}) {
  await (window.footballAuthReady || Promise.resolve());
  const accessToken = window.footballAuth?.getAccessToken() || '';
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
    }
  });
  const data = await response.json();
  if (response.status === 401) window.footballAuth?.open();
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = data.code || '';
    throw error;
  }
  return data;
}

function groupMarkets(markets) {
  const groups = Object.fromEntries(MARKET_GROUPS.map((group) => [group.key, []]));
  for (const market of markets) groups[marketCategory(market)].push(market);
  return groups;
}

function marketCategory(market) {
  const type = market.marketType || '';
  if (/胜平负|1x2|moneyline/i.test(type)) return 'moneyline';
  if (/比分|score/i.test(type)) return 'score';
  if (/让球|让分|亚洲|handicap/i.test(type)) return 'handicap';
  if (/大\/小|大小|总分|总进球|total|over|under/i.test(type)) return 'total';
  return 'other';
}

function displayMarketType(type) {
  return MARKET_GROUPS.find((group) => group.key === marketCategory({ marketType: type }))?.label || type;
}

function formatCategorySummaryLabel(category, market) {
  if (category === 'moneyline') return marketOutcomeDisplay(market);
  if (category === 'score') return `Score ${market.selection || ''}`;
  if (category === 'total') return `${market.selection || ''} ${displayMarketLine(market)} goals`;
  return `${market.selection || ''} ${displayMarketLine(market)}`.trim();
}

function formatPredictionTitle(market) {
  const category = marketCategory(market);
  if (category === 'moneyline') return marketOutcomeDisplay(market);
  if (category === 'score') return `Score ${market.selection || ''}`.trim();
  if (category === 'handicap') return `${market.selection || ''} ${displayMarketLine(market)}`.trim();
  if (category === 'total') return `${market.selection || ''} ${displayMarketLine(market)} goals`.trim();
  return `${market.selection || ''} ${displayMarketLine(market)}`.trim();
}

function displayMarketLine(market = {}) {
  const raw = String(market.line || '').trim();
  if (marketCategory(market) !== 'handicap') return raw;
  const num = Number(raw);
  if (!Number.isFinite(num)) return raw;
  if (num > 0) return `+${formatLineNumber(num)}`;
  if (num < 0) return `-${formatLineNumber(Math.abs(num))}`;
  return '0';
}

function formatLineNumber(value) {
  const rounded = Math.round(Number(value) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, '').replace(/\.$/, '');
}

function marketOutcomeLabel(market) {
  const selection = String(market.selection || '').trim();
  if (/平|draw|tie/i.test(selection)) return 'Draw';
  const teams = splitMatchTeams(market.matchName);
  if (teams.length >= 2) {
    if (sameTeam(selection, teams[0])) return 'Home Win';
    if (sameTeam(selection, teams[1])) return 'Away Win';
  }
  return selection ? 'Win/Loss' : 'Unknown';
}

function marketOutcomeDisplay(market) {
  const selection = String(market.selection || '').trim();
  return marketOutcomeLabel(market) === 'Draw' ? 'Draw' : (selection || 'Unknown');
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

function percent(value) {
  return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : 'N/A';
}

function formatOdds(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : 'N/A';
}

function shortUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function formatModelError(error) {
  const message = String(error || '');
  if (/OpenAI 401|invalid_api_key|Incorrect API key|Missing Authentication/i.test(message) && /openai|api\.openai/i.test(message)) {
    return 'OpenAI 401: The API key is invalid or unavailable to the Worker. Check the OPENAI_API_KEY secret and rerun GPT.';
  }
  if (/OpenRouter 401|Missing Authentication header/i.test(message)) {
    return 'OpenRouter 401: The API key is missing, invalid, or contains hidden characters. Update the key and rerun the model.';
  }
  if (/APIMart 401|invalid API key/i.test(message)) {
    return 'APIMart 401: The API key is invalid or unavailable to the Worker. Update the key and rerun the model.';
  }
  if (/more credits|credits|402|can only afford/i.test(message)) {
    return 'OpenRouter has insufficient credits or the request is too large. Rerun Qwen or DeepSeek individually, or add credits.';
  }
  if (/JSON|property value|Unexpected/i.test(message)) {
    return 'The model returned an invalid format. Automatic repair was attempted; rerun the model if the error continues.';
  }
  return message;
}

function setupRevealAnimations() {
  const elements = [...document.querySelectorAll('.reveal:not(.is-visible)')];
  if (!elements.length) return;

  if (!('IntersectionObserver' in window)) {
    elements.forEach((element) => element.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  elements.forEach((element) => observer.observe(element));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}
