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

const ACTIVE_CONTEXT_STORAGE_KEY = 'footballFraud.activeContextId';
const AI_CONTEXT_DATE_STORAGE_KEY = 'footballFraud.aiContextDate';
const AI_CONTEXT_RANGE_STORAGE_KEY = 'footballFraud.aiContextRange';
const AI_CONTEXT_SORT_STORAGE_KEY = 'footballFraud.aiContextSort';
const QWEN_VARIANT_STORAGE_KEY = 'footballFraud.qwenVariant';
const RANK_MODELS = ['GPT', 'Claude', 'Gemini', 'DeepSeek', 'Qwen'];
let activeRankingModel = 'all';
let activeContextId = readStoredActiveContextId();
let activeAiContextDate = readStoredValue(AI_CONTEXT_DATE_STORAGE_KEY);
let activeAiContextRange = readStoredValue(AI_CONTEXT_RANGE_STORAGE_KEY) || 'week';
let activeAiContextSort = readStoredValue(AI_CONTEXT_SORT_STORAGE_KEY) || 'imported';
const analyticsState = {
  raw: null,
  date: '',
  category: 'all',
  match: 'all',
  model: 'all',
  hitsOnly: false
};

const MARKET_GROUPS = [
  { key: 'moneyline', label: '胜平负', help: '主胜、平局、客胜这类 1X2 市场。' },
  { key: 'score', label: '比分', help: '正确比分候选项。' },
  { key: 'handicap', label: '亚洲让分盘', help: '让球/受让盘口，例如 德国 -0.5、厄瓜多尔 +0.5。' },
  { key: 'total', label: '大小球', help: '总进球大/小，例如 大 2.5、小 2.5。' },
  { key: 'other', label: '其他', help: '暂未归类或需要手动修正的盘口。' }
];

bind('#loadSample', 'click', async () => {
  await api('/api/sample', { method: 'POST' });
  await refresh();
});

bind('#refresh', 'click', refresh);
bind('#refreshAnalytics', 'click', refreshAnalyticsData);
bind('#loadDongqiudiMatches', 'click', loadDongqiudiMatches);
bind('#competitionFilter', 'change', loadDongqiudiMatches);
bind('#matchDate', 'change', loadDongqiudiMatches);
bind('#aiContextDate', 'change', handleAiContextDateChange);
bind('#aiContextRange', 'change', handleAiContextRangeChange);
bind('#aiContextSort', 'change', handleAiContextSortChange);
initQwenVariantSelector();

bind('#importDongqiudiUrl', 'click', importDongqiudiUrl);

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

bind('#importText', 'click', async () => {
  const result = await importStakeText();
  alert(`导入 ${result.markets.length} 条盘口`);
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

window.addEventListener('popstate', refresh);
initMatchDate();
refresh();
loadDongqiudiMatches();

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
  input.value = dateInShanghai(1);
}

async function loadDongqiudiMatches(event) {
  const button = event?.currentTarget || $('#loadDongqiudiMatches');
  const original = button?.textContent;
  try {
    if (button) {
      button.disabled = true;
      button.textContent = '抓取中...';
    }
    if (matchScheduleEl) matchScheduleEl.innerHTML = '<p class="meta">正在抓取懂球帝比赛列表...</p>';
    const date = $('#matchDate')?.value || '';
    const competitionId = $('#competitionFilter')?.value || '125';
    const schedule = await api(`/api/dongqiudi/matches?competitionId=${encodeURIComponent(competitionId)}${date ? `&date=${encodeURIComponent(date)}` : ''}`);
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
  const selectedDate = schedule.todayMatches || [];
  const matches = selectedDate.length ? selectedDate : (schedule.matches || []).slice(0, 24);
  if (!matches.length) {
    matchScheduleEl.innerHTML = '<p class="meta">没有抓到比赛列表。可以继续用上方懂球帝 URL 手动导入。</p>';
    return;
  }

  const notice = selectedDate.length
    ? `${escapeHtml(schedule.date)} 共 ${selectedDate.length} 场`
    : `没有匹配 ${escapeHtml(schedule.date)} 的场次，显示最近 ${matches.length} 场抓取结果`;

  matchScheduleEl.innerHTML = `
    <div class="schedule-summary">
      <strong>${notice}</strong>
      <span>来源：${escapeHtml(shortUrl(schedule.sourceUrl))} · 抓取时间 ${escapeHtml(new Date(schedule.fetchedAt).toLocaleTimeString())}</span>
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
        <a href="${escapeHtml(match.sourceUrl)}" target="_blank" rel="noreferrer">打开源页</a>
        <button data-import-match="${escapeHtml(match.sourceUrl)}">导入并分析</button>
      </div>
    </article>
  `;
}

async function importScheduleMatch(sourceUrl, button) {
  const original = button?.textContent;
  try {
    if (button) {
      button.disabled = true;
      button.textContent = '导入中...';
    }
    const { context, alreadyImported, refreshed } = await api('/api/import/dongqiudi-url', {
      method: 'POST',
      body: JSON.stringify({ sourceUrl })
    });
    setActiveContextId(contextKey(context));
    setActiveAiContextDate(contextDate(context));
    await refresh();
    if (refreshed) {
      $('#ai-panel')?.scrollIntoView({ block: 'start' });
      alert(`已刷新该场数据：${context.matchName || sourceUrl}`);
      return;
    }
    if (alreadyImported) {
      alert(`该场次已导入：${context.matchName || sourceUrl}`);
    } else {
      $('#ai-panel')?.scrollIntoView({ block: 'start' });
      alert(`已导入：${context.matchName || sourceUrl}`);
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
    contextsEl.innerHTML = '<p class="meta">尚未导入懂球帝比赛数据。AI 预测目前只能参考手动盘口。</p>';
    return;
  }

  const teams = contextTeams(latest);
  const timing = lineupTiming(latest);
  const playerStatus = playerInfoStatus(latest);
  contextsEl.innerHTML = `
    <div class="context-card">
      <div class="context-card-main">
        <strong>已导入懂球帝数据：${escapeHtml(latest.matchName || '比赛')}</strong>
        <div class="context-teams" aria-label="比赛双方">
          ${teams.map((team, index) => `
            <span class="team-flag">
              <b>${escapeHtml(countryFlag(team))}</b>
              ${escapeHtml(team || (index === 0 ? '主队' : '客队'))}
            </span>
            ${index === 0 ? '<em>v</em>' : ''}
          `).join('')}
        </div>
        <div class="context-time-row">
          <span class="kickoff-pill primary-time">当地开赛 ${escapeHtml(formatKickoff(latest))}</span>
          <span class="kickoff-pill secondary-time">北京时间 ${escapeHtml(formatBeijingKickoff(latest.kickoff))}</span>
          <span class="lineup-window ${timing.state}">${escapeHtml(timing.label)}</span>
          <span class="player-info-pill ${playerStatus.state}">${escapeHtml(playerStatus.label)}</span>
        </div>
        <span>阵容/战绩/指数/专家/文字直播上下文会随 AI 预测发送</span>
      </div>
      <a href="${escapeHtml(latest.sourceUrl || '#')}" target="_blank" rel="noreferrer">来源</a>
    </div>
  `;
}

function renderAiContextSelector(contexts = []) {
  if (!aiContextDateEl || !aiContextTabsEl) return;
  if (aiContextRangeEl) aiContextRangeEl.value = activeAiContextRange;
  if (aiContextSortEl) aiContextSortEl.value = activeAiContextSort;

  const datedContexts = filterContextsByAiRange(contexts.filter((context) => contextDate(context)));
  if (!datedContexts.length) {
    aiContextDateEl.innerHTML = '<option value="">暂无已导入数据</option>';
    aiContextTabsEl.innerHTML = '<p class="meta">当前范围里还没有已导入比赛。</p>';
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
    return `<option value="${escapeHtml(date)}" ${date === activeAiContextDate ? 'selected' : ''}>${escapeHtml(date)}（已导入 ${count} 场）</option>`;
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
  aiContextTabsEl.querySelectorAll('[data-context-model]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectAiContext(button.dataset.contextId, contexts, { silent: true });
      await runRanking(button.dataset.contextModel, button);
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
  const predictedModels = predictedModelsForContext(context);
  const hasPrediction = predictedModels.size > 0;
  const urgent = isInOneHourCountdown(context);
  const statusClass = urgent ? 'urgent' : hasPrediction ? 'predicted' : 'future';
  const statusLabel = urgent ? '红色 1 小时预警' : hasPrediction ? '已预测' : '未来预测';
  return `
    <article class="ai-context-tab-card ${key === activeContextId ? 'active' : ''} ${urgent ? 'needs-predict' : ''}">
      <button class="ai-context-main" data-ai-context-tab="${escapeHtml(key)}" type="button">
        <div class="ai-context-teams">
          ${renderAiContextTeam(teams[0], 'home')}
          <span class="ai-context-v">v</span>
          ${renderAiContextTeam(teams[1], 'away')}
        </div>
        <div class="ai-context-meta-line">
          <span>${escapeHtml(formatBeijingKickoff(context.kickoff))}</span>
          <em class="${players.state}">${escapeHtml(players.shortLabel)}</em>
          <small class="${statusClass}">${statusLabel}</small>
        </div>
      </button>
      <div class="ai-context-actions">
        <div class="context-model-icons" aria-label="单模型预测">
          ${RANK_MODELS.map((model) => modelIconButton(model, key, predictedModels.has(modelBrandKey(model)))).join('')}
        </div>
        <button class="context-detail-button" data-context-detail="${escapeHtml(key)}" type="button">详情</button>
      </div>
    </article>
  `;
}

function renderAiContextTeam(team, side) {
  return `
    <div class="ai-context-team ${side}">
      <b>${escapeHtml(countryFlag(team))}</b>
      <strong>${escapeHtml(team || '未知')}</strong>
    </div>
  `;
}

function rankingForContext(context) {
  const key = contextKey(context);
  return (window.currentRankings || []).find((ranking) => ranking.contextId === key) || null;
}

function predictedModelsForContext(context) {
  const key = contextKey(context);
  const models = new Set();
  for (const ranking of window.currentRankings || []) {
    if (ranking.contextId !== key) continue;
    for (const model of predictedModelsForRanking(ranking)) models.add(model);
  }
  return models;
}

function predictedModelsForRanking(ranking) {
  const models = new Set();
  for (const result of ranking?.results || []) {
    const hasResult = (result.picks || []).length || (result.scorePicks || []).length;
    if (!hasResult || result.error) continue;
    models.add(modelBrandKey(result.modelName));
  }
  return models;
}

function isInOneHourCountdown(context = {}) {
  const kickoff = parseKickoffTime(context.kickoff);
  if (!kickoff) return false;
  const diff = kickoff.getTime() - Date.now();
  return diff >= 0 && diff <= 60 * 60 * 1000;
}

function modelIconButton(model, contextId, predicted) {
  return `
    <button class="model-icon-button ${predicted ? 'predicted' : ''}" data-context-model="${escapeHtml(model)}" data-context-id="${escapeHtml(contextId)}" type="button" title="${escapeHtml(model)} 预测" aria-label="${escapeHtml(model)} 预测">
      ${modelBrand(model)}
    </button>
  `;
}

function renderContextExplorer(contexts) {
  if (!contextExplorerEl) return;
  if (!contexts?.length) {
    if (contextTabsEl) contextTabsEl.innerHTML = '';
    contextExplorerEl.innerHTML = '<p class="meta">还没有抓取比赛详情。先在“今日开场”里选择一场导入。</p>';
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
        <strong>${escapeHtml(context.matchName || `比赛 ${index + 1}`)}</strong>
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
  return `
    <article class="data-match-card featured">
      <div class="data-match-head">
        <div>
          <span>${activeIndex === 0 ? '最新导入' : '已导入数据'}</span>
          <h3>${escapeHtml(context.matchName || '比赛')}</h3>
          <p>${escapeHtml(context.competition || '')} · ${escapeHtml(context.kickoff || '')}</p>
        </div>
        <div class="data-actions">
          <button class="secondary" data-refresh-context="${escapeHtml(context.sourceUrl || '')}" type="button">刷新该场数据</button>
          <a href="${escapeHtml(context.sourceUrl || '#')}" target="_blank" rel="noreferrer">源页</a>
        </div>
      </div>
      <div class="data-snapshot">
        ${renderInfoTile('天气/场地', context.live?.join(' · ') || context.lineup?.notes?.join(' · ') || '未抓到')}
        ${renderInfoTile('阵型', context.lineup?.formation || '未抓到')}
        ${renderInfoTile('指数标签', context.index?.tabs?.join(' / ') || '未抓到')}
        ${renderInfoTile('专家信息', `${context.experts?.length || 0} 条公开标题`)}
      </div>
      <div class="data-modules">
        ${renderDataModule('首发/球员', context.lineup?.players || [], 'players')}
        ${renderDataModule('近期战绩', flattenRecent(context.analysis?.recent), 'recent')}
        ${renderDataModule('积分/排名', context.analysis?.standings || [], 'standings')}
        ${renderOddsModule(context.index)}
        ${renderExpertModule(context.experts || [])}
      </div>
    </article>
  `;
}

function openContextModal(context, contexts = []) {
  if (!contextModalEl || !contextModalBodyEl) return;
  const activeIndex = Math.max(0, contexts.findIndex((item) => contextKey(item) === contextKey(context)));
  if (contextModalTitleEl) contextModalTitleEl.textContent = context.matchName || '比赛详情';
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
  return context.matchId || sourceUrl.match(/dongqiudi\.com\/match\/(\d+)/i)?.[1] || sourceUrl || context.matchName || '';
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
  if (!kickoff) return context.kickoff || '时间未知';
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
  return venueLabel ? `${label} · ${venueLabel}` : `${label} · 比赛地`;
}

function formatBeijingKickoff(value) {
  const kickoff = parseKickoffTime(value);
  if (!kickoff) return value || '时间未知';
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
  if (!kickoff) return { state: 'muted', label: '开赛时间未知：先做前期预测，赛前再刷新阵容' };
  const diff = kickoff.getTime() - Date.now();
  const oneHour = 60 * 60 * 1000;
  const finalWhistle = kickoff.getTime() + (150 * 60 * 1000);
  if (diff > oneHour) return { state: 'early', label: '请在此前期预测；首发通常赛前 1 小时重点刷新' };
  if (diff >= 0) return { state: 'hot', label: '赛前 1 小时窗口：高亮检查队员/首发信息' };
  if (Date.now() < finalWhistle) return { state: 'live', label: '比赛进行中：队员信息优先参考，谨慎重跑' };
  return { state: 'done', label: '比赛可能已结束：仅适合复盘，不建议预测' };
}

function playerInfoStatus(context = {}) {
  const kickoff = parseKickoffTime(context.kickoff);
  const captured = context.capturedAt ? new Date(context.capturedAt) : null;
  if (!kickoff || !captured || Number.isNaN(captured.getTime())) {
    return {
      state: 'unknown',
      label: '队员信息状态未知',
      shortLabel: '队员未知'
    };
  }
  const diff = kickoff.getTime() - captured.getTime();
  const inOneHourWindow = diff >= 0 && diff <= 60 * 60 * 1000;
  if (inOneHourWindow) {
    return {
      state: 'has-players',
      label: '赛前 1 小时内导入：含队员信息',
      shortLabel: '含队员'
    };
  }
  return {
    state: 'no-players',
    label: '非赛前 1 小时导入：无队员信息',
    shortLabel: '无队员'
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
    button.textContent = '刷新中...';
    const { context } = await api('/api/contexts/refresh', {
      method: 'POST',
      body: JSON.stringify({ sourceUrl })
    });
    setActiveContextId(contextKey(context));
    setActiveAiContextDate(contextDate(context));
    await refresh();
    alert(`已刷新：${context.matchName || sourceUrl}`);
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
      <strong>${escapeHtml(value || '未抓到')}</strong>
    </div>
  `;
}

function renderDataModule(title, rows, type) {
  if (type === 'odds' && rows?.live) return renderOddsModule(rows);
  const visible = (rows || []).slice(0, type === 'players' ? 30 : 10);
  return `
    <section class="data-module ${type}">
      <h4>${escapeHtml(title)} <span>${visible.length}</span></h4>
      ${visible.length ? `<ul>${visible.map((row) => `<li>${escapeHtml(row)}</li>`).join('')}</ul>` : '<p class="meta">未抓到这类数据。</p>'}
    </section>
  `;
}

function renderOddsModule(index = {}) {
  const live = index.live || {};
  const groups = [
    { key: 'asia', title: '即时让球', empty: '未抓到即时让球盘。' },
    { key: 'size', title: '即时大小球', empty: '未抓到即时大小球。' },
    { key: 'euro', title: '即时欧指', empty: '未抓到即时欧指。' }
  ].map((group) => ({ ...group, rows: live[group.key] || [] }));
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  if (!total) return renderDataModule('指数摘要', index.handicapRows || [], 'odds-fallback');
  return `
    <section class="data-module odds live-odds">
      <h4>即时盘口 <span>${total}</span></h4>
      ${groups.map((group) => `
        <div class="odds-group">
          <div class="odds-group-title">${escapeHtml(group.title)} <span>${group.rows.length}</span></div>
          ${group.rows.length ? `
            <div class="odds-table-wrap">
              <table class="odds-table">
                <thead>
                  <tr><th>公司</th><th>主</th><th>${group.key === 'euro' ? '平' : '盘口'}</th><th>客</th><th>更新</th></tr>
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
      <h4>专家公开信息 <span>${visible.length}</span></h4>
      ${visible.length ? visible.map((item) => `
        <article class="expert-row">
          <strong>${escapeHtml(item.author || '未知')}</strong>
          <p>${escapeHtml(item.title || '')}</p>
          <span>${escapeHtml([item.market, ...(item.tags || [])].filter(Boolean).join(' · '))}</span>
        </article>
      `).join('') : '<p class="meta">未抓到专家公开信息。</p>'}
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

async function importDongqiudiUrl(event) {
  const button = event?.currentTarget;
  const original = button?.textContent;
  try {
    if (button) {
      button.disabled = true;
      button.textContent = '提取中...';
    }
    const sourceUrl = $('#dongqiudiUrl')?.value?.trim();
    const { context } = await api('/api/import/dongqiudi-url', {
      method: 'POST',
      body: JSON.stringify({ sourceUrl })
    });
    setActiveContextId(contextKey(context));
    setActiveAiContextDate(contextDate(context));
    await refresh();
    alert(`已导入：${context.matchName || '懂球帝比赛'}`);
  } catch (error) {
    alert(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

function renderMarkets(markets) {
  if (!marketsEl) return;
  if (!markets.length) {
    marketsEl.innerHTML = '<p class="meta">旧盘口已清空。当前 AI 预测会基于懂球帝上下文生成候选项。</p>';
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
        <span class="count">${items.length} 条</span>
      </div>
      <div class="market-grid"></div>
    `;
    const grid = section.querySelector('.market-grid');
    if (!items.length) {
      grid.innerHTML = '<p class="meta empty">当前导入内容没有展开这个市场。</p>';
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
      <span>赔率参考</span>
      <strong>${percent(market.impliedProbability)}</strong>
    </div>
    <div class="source-row">${escapeHtml(shortUrl(market.sourceUrl))}</div>
    <div class="actions">
      <button data-predict="${market.id}">多模型预测</button>
      <a href="/match/${encodeURIComponent(market.id)}">详情</a>
    </div>
  `;
  card.querySelector('button').addEventListener('click', () => predict(market.id));
  return card;
}

function renderRankings(rankings, markets) {
  const generated = collectLatestGeneratedResults(rankings);
  if (!generated.length) {
    rankingsEl.innerHTML = '<p class="meta">还没有 AI 总预测。点击上方按钮后，每个模型会给出自己的 Top 4，并可在模型标签之间切换。</p>';
    return;
  }

  const newest = currentContextRanking(rankings);
  const latestHasSuccess = newest?.results?.some((result) => (result.picks || []).length > 0);
  const latestNotice = latestHasSuccess
    ? '<div class="ranking-notice">当前按模型保留这场比赛最近一次结果；单模型重跑失败不会隐藏其他模型标签。</div>'
    : '<div class="ranking-notice">最新一轮没有有效 Top 4；下方仍保留这场比赛其他模型的最近结果。</div>';
  const marketMap = new Map(markets.map((market) => [market.id, market]));
  if (!generated.some((item) => isActiveRankingItem(item)) || activeRankingModel === 'all') {
    activeRankingModel = generated[0].key;
  }
  const activeItem = generated.find((item) => isActiveRankingItem(item)) || generated[0];
  activeRankingModel = activeItem.key;
  const activeResult = activeItem.result;

  rankingsEl.innerHTML = `
    <div class="ranking-meta">
      <strong>最新 AI 预测</strong>
      <span>${escapeHtml(new Date(activeItem.ranking.createdAt).toLocaleString())} · 候选 ${activeItem.ranking.marketCount} 项 · 当前显示 ${escapeHtml(activeResult.modelName)}</span>
    </div>
    ${latestNotice}
    <div class="generated-switch">
      <div>
        <strong>最新一轮模型</strong>
        <span>只切换最新生成的 AI 结果，不会重新预测，也不会调用 API。</span>
      </div>
      <div class="model-tabs" role="tablist" aria-label="切换已生成的 AI 预测结果">
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
      button.textContent = hasRanking ? '重新预测全部 AI' : '开始预测全部 AI';
      return;
    }
    button.textContent = hasRanking ? `重跑 ${model}` : `开始 ${model}`;
  });
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
          <p>按 AI 预测概率从大到小排序。概率来自模型判断，不是赔率换算。</p>
        </div>
        <span>Top ${picks.length}</span>
      </div>
      ${renderScorePredictions(result.scorePicks || [])}
      <div class="prediction-cards">
        ${picks.length ? picks.map((pick, index) => renderRankingPick(pick, marketMap, index)).join('') : '<p class="meta">这个模型没有给出有效选择。</p>'}
      </div>
    </article>
  `;
}

function renderScorePredictions(scorePicks) {
  const picks = (scorePicks || []).slice(0, 4);
  return `
    <section class="score-predictions">
      <div class="score-head">
        <strong>比分预测</strong>
        <span>2 个主线 + 1 个盘口匹配 + 1 个激进比分</span>
      </div>
      <div class="score-grid">
        ${picks.length ? picks.map((pick, index) => `
          <article class="score-card">
            <span>#${index + 1}</span>
            <em>${escapeHtml(scoreTypeLabel(pick.scoreType, index))}</em>
            <strong>${escapeHtml(pick.score || pick.market?.selection || '')}</strong>
            <div>AI 概率 ${percent(pick.estimatedProbability)}</div>
            <p>${escapeHtml(pick.reason || '无理由')}</p>
          </article>
        `).join('') : '<p class="meta">??????????????????????? 4 ????</p>'}
      </div>
    </section>
  `;
}

function scoreTypeLabel(type, index = 0) {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'market_fit') return '盘口比分';
  if (normalized === 'aggressive') return '激进比分';
  return index <= 1 ? `主线比分 ${index + 1}` : index === 2 ? '盘口比分' : '激进比分';
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
        <p>${escapeHtml(market.matchName || '未知比赛')}</p>
      </div>
      <div class="prediction-metrics">
        <div><span>${categoryKey === 'moneyline' ? '三选一' : '盘口'}</span><strong>${escapeHtml(categoryKey === 'moneyline' ? outcome : (displayMarketLine(market) || '无'))}</strong></div>
        <div><span>AI 概率</span><strong>${percent(pick.estimatedProbability)}</strong></div>
        <div><span>置信度</span><strong>${percent(pick.confidence)}</strong></div>
        <div><span>选择</span><strong>${escapeHtml(market.selection || '无')}</strong></div>
      </div>
      <div class="prediction-reason">
        <span>分析</span>
        <p>${escapeHtml(pick.reason || '无理由')}</p>
      </div>
      <div class="prediction-risks">
        <span>风险</span>
        ${risks.length ? risks.map((risk) => `<b>${escapeHtml(risk)}</b>`).join('') : '<b>模型未列出具体风险</b>'}
      </div>
    </article>
  `;
}

function renderMoneylineFlag(market) {
  const selection = String(market?.selection || '').trim();
  const isDraw = /å¹³|draw|tie/i.test(selection);
  return `<span class="winner-flag" title="${escapeHtml(isDraw ? '平局' : selection)}">${escapeHtml(isDraw ? '平' : countryFlag(selection))}</span>`;
}

function renderReports(reports) {
  reportsEl.innerHTML = reports.length ? '' : '<p class="meta">暂无历史报告。</p>';
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
        <div><span>方向</span><strong>${escapeHtml(consensus.finalDirection)}</strong></div>
        <div><span>综合概率</span><strong>${percent(consensus.combinedProbability)}</strong></div>
        <div><span>一致度</span><strong>${percent(consensus.agreement)}</strong></div>
        <div><span>风险</span><strong>${escapeHtml(consensus.riskLevel)}</strong></div>
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
        <strong>暂无可计算准确率的数据</strong>
        <p class="meta">已导入 ${analytics?.contextCount || 0} 场；已有赛果 ${analytics?.scoredContextCount || 0} 场；疑似完赛但缺比分 ${analytics?.finishedWithoutScoreCount || 0} 场。点击“刷新赛后数据”会重新抓这些完赛场次。</p>
      </div>
    `;
    return;
  }

  analyticsContentEl.innerHTML = `
    <div class="analytics-stats">
      <article><span>已评估预测</span><strong>${analytics.evaluatedCount}</strong></article>
      <article><span>完场比赛</span><strong>${analytics.matchCount}</strong></article>
      <article><span>模型数</span><strong>${analytics.models.length}</strong></article>
    </div>
    <div class="analytics-grid">
      <section class="analytics-card">
        <div class="section-heading compact-heading">
          <h3>模型准确率</h3>
          <span class="count">${analytics.models.length}</span>
        </div>
        <div class="accuracy-bars">
          ${analytics.models.map(renderAccuracyBar).join('')}
        </div>
      </section>
      <section class="analytics-card">
        <div class="section-heading compact-heading">
          <h3>玩法准确率</h3>
          <span class="count">${analytics.categories.length}</span>
        </div>
        <div class="accuracy-bars">
          ${analytics.categories.map((row) => renderAccuracyBar({ ...row, key: categoryName(row.key) })).join('')}
        </div>
      </section>
      <section class="analytics-card wide">
        <div class="section-heading compact-heading">
          <h3>准确率走势</h3>
          <p>按比赛日期聚合</p>
        </div>
        ${renderTrendChart(analytics.trend || [])}
      </section>
      <section class="analytics-card wide">
        <div class="section-heading compact-heading">
          <h3>赛后复盘明细</h3>
          <span class="count">${analytics.evaluations.length}</span>
        </div>
        <div class="analytics-table-wrap">
          <table class="analytics-table">
            <thead>
              <tr><th>比赛</th><th>模型</th><th>玩法</th><th>预测</th><th>赛果</th><th>结果</th></tr>
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
        <strong>暂无可计算准确率的数据</strong>
        <p class="meta">已导入 ${analytics?.contextCount || 0} 场；已有赛果 ${analytics?.scoredContextCount || 0} 场；疑似完赛但缺比分 ${analytics?.finishedWithoutScoreCount || 0} 场。点击“刷新赛后数据”会重新抓这些完赛场次。</p>
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
        <span>比赛日期</span>
        <select data-analytics-filter="date">
          <option value="all"${analyticsState.date === 'all' ? ' selected' : ''}>全部日期（${allEvaluations.length} 条）</option>
          ${dateOptions.map((row) => `<option value="${escapeHtml(row.key)}"${analyticsState.date === row.key ? ' selected' : ''}>${escapeHtml(row.key)}（${row.count} 条）</option>`).join('')}
        </select>
      </label>
      <label>
        <span>玩法</span>
        <select data-analytics-filter="category">
          <option value="all"${analyticsState.category === 'all' ? ' selected' : ''}>全部玩法</option>
          ${categoryOptions.map((row) => `<option value="${escapeHtml(row.key)}"${analyticsState.category === row.key ? ' selected' : ''}>${escapeHtml(categoryName(row.key))}（${row.count}）</option>`).join('')}
        </select>
      </label>
      <label>
        <span>比赛</span>
        <select data-analytics-filter="match">
          <option value="all"${analyticsState.match === 'all' ? ' selected' : ''}>全部比赛</option>
          ${matchOptions.map((row) => `<option value="${escapeHtml(row.key)}"${analyticsState.match === row.key ? ' selected' : ''}>${escapeHtml(row.key)}（${row.count}）</option>`).join('')}
        </select>
      </label>
      <label>
        <span>模型</span>
        <select data-analytics-filter="model">
          <option value="all"${analyticsState.model === 'all' ? ' selected' : ''}>全部模型</option>
          ${modelOptions.map((row) => `<option value="${escapeHtml(row.key)}"${analyticsState.model === row.key ? ' selected' : ''}>${escapeHtml(row.key)}（${row.count}）</option>`).join('')}
        </select>
      </label>
      <button class="analytics-hit-toggle ${analyticsState.hitsOnly ? 'active' : ''}" type="button" data-analytics-hit-toggle>
        ${analyticsState.hitsOnly ? '只看命中' : '全部结果'}
      </button>
    </div>
    <div class="analytics-stats">
      <article><span>已评估预测</span><strong>${filtered.length}</strong></article>
      <article><span>完场比赛</span><strong>${matchCount}</strong></article>
      <article><span>模型数</span><strong>${models.length}</strong></article>
    </div>
    <div class="analytics-grid">
      <section class="analytics-card">
        <div class="section-heading compact-heading">
          <h3>模型准确率</h3>
          <span class="count">${models.length}</span>
        </div>
        <div class="accuracy-bars">
          ${models.length ? models.map(renderAccuracyBar).join('') : '<p class="meta">当前筛选无模型数据。</p>'}
        </div>
      </section>
      <section class="analytics-card">
        <div class="section-heading compact-heading">
          <h3>玩法准确率</h3>
          <span class="count">${categories.length}</span>
        </div>
        <div class="accuracy-bars">
          ${categories.length ? categories.map((row) => renderAccuracyBar({ ...row, key: categoryName(row.key) })).join('') : '<p class="meta">当前筛选无玩法数据。</p>'}
        </div>
      </section>
      <section class="analytics-card wide">
        <div class="section-heading compact-heading">
          <h3>准确率走势</h3>
          <p>按比赛日期和模型聚合；点位使用模型图标。</p>
        </div>
        ${renderTrendChart(trend)}
      </section>
      <section class="analytics-card wide">
        <div class="section-heading compact-heading">
          <h3>赛后复盘明细</h3>
          <span class="count">${filtered.length}</span>
        </div>
        <div class="analytics-table-wrap">
          <table class="analytics-table">
            <thead>
              <tr><th>比赛</th><th>日期</th><th>模型</th><th>玩法</th><th>预测</th><th>赛果</th><th>结果</th></tr>
            </thead>
            <tbody>
              ${filtered.slice(0, 160).map(renderEvaluationRowV2).join('') || '<tr><td colspan="7">当前筛选暂无明细。</td></tr>'}
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
      button.textContent = '刷新赛果中...';
    }
    const { analytics, refreshed, attempted, errors } = await api('/api/analytics/refresh', { method: 'POST' });
    renderAnalytics(analytics);
    const suffix = errors?.length ? `，${errors.length} 场失败` : '';
    alert(`已检查 ${attempted || 0} 场，刷新 ${refreshed || 0} 场${suffix}`);
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
  if (!trend.length) return '<p class="meta">暂无走势数据。</p>';
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
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="准确率走势">
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
      <td><b class="${item.counted ? item.hit ? 'hit' : 'miss' : 'push'}">${item.counted ? item.hit ? '命中' : '未中' : '走水'}</b></td>
    </tr>
  `;
}

function renderTrendChart(trend) {
  if (!trend.length) return '<p class="meta">暂无走势数据。</p>';
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
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="准确率走势">
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
      <td><b class="${item.counted ? item.hit ? 'hit' : 'miss' : 'push'}">${item.counted ? item.hit ? '命中' : '未中' : '走水'}</b></td>
    </tr>
  `;
}

function categoryName(category) {
  return {
    moneyline: '胜平负',
    handicap: '亚洲让分盘',
    total: '大小球',
    score: '比分'
  }[category] || category;
}

async function predict(id) {
  try {
    const { report } = await api(`/api/predict/${encodeURIComponent(id)}`, { method: 'POST' });
    alert(`完成：${report.consensus.bucket}`);
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
    button.textContent = '预测中...';
    await api('/api/rankings', {
      method: 'POST',
      body: JSON.stringify({ model, contextId: activeContextId, qwenVariant: selectedQwenVariant() })
    });
    activeRankingModel = model === 'all'
      ? 'all'
      : model;
    await refresh();
    completed = true;
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    if (!completed) button.innerHTML = originalHtml;
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
  const isHome = location.pathname === '/';
  const isAnalytics = location.pathname === '/analytics';

  if (matchPanel) matchPanel.hidden = true;
  if (dataPage) dataPage.hidden = location.pathname !== '/data';
  if (dataBackHome) dataBackHome.hidden = isHome;
  if (matchCenter) matchCenter.hidden = location.pathname === '/data' || location.pathname === '/history' || isAnalytics || Boolean(match);
  if (aiPanel) aiPanel.hidden = location.pathname === '/data' || location.pathname === '/history' || isAnalytics || Boolean(match);
  if (historyPanel) historyPanel.hidden = location.pathname === '/data' || isAnalytics || Boolean(match);
  if (analyticsPanel) analyticsPanel.hidden = !isAnalytics;

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
    matchDetailEl.innerHTML = '<p class="meta">找不到这条盘口，可能已被清理。</p>';
    return;
  }
  matchDetailEl.innerHTML = `
    <div class="card">
      <h3>${escapeHtml(market.matchName)}</h3>
      <div class="meta">
        <div>${escapeHtml(market.marketType)} · ${escapeHtml(market.selection)} ${escapeHtml(market.line)} @ ${formatOdds(market.odds)}</div>
        <div>隐含概率：${percent(market.impliedProbability)}</div>
        <div>历史报告数：${related.length}</div>
      </div>
      <button data-predict-detail="${market.id}">重新预测</button>
      ${related[0] ? `<pre>${escapeHtml(JSON.stringify(related[0].consensus, null, 2))}</pre>` : '<p class="meta">暂无预测报告。</p>'}
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
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
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
  if (category === 'score') return `比分 ${market.selection || ''}`;
  if (category === 'total') return `${market.selection || ''} ${displayMarketLine(market)} \u7403`;
  return `${market.selection || ''} ${displayMarketLine(market)}`.trim();
}

function formatPredictionTitle(market) {
  const category = marketCategory(market);
  if (category === 'moneyline') return marketOutcomeDisplay(market);
  if (category === 'score') return `比分 ${market.selection || ''}`.trim();
  if (category === 'handicap') return `${market.selection || ''} ${displayMarketLine(market)}`.trim();
  if (category === 'total') return `${market.selection || ''} ${displayMarketLine(market)} \u7403`.trim();
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
  if (/平|draw|tie/i.test(selection)) return '平';
  const teams = splitMatchTeams(market.matchName);
  if (teams.length >= 2) {
    if (sameTeam(selection, teams[0])) return '胜';
    if (sameTeam(selection, teams[1])) return '负';
  }
  return selection ? '胜/负' : '未知';
}

function marketOutcomeDisplay(market) {
  const selection = String(market.selection || '').trim();
  return marketOutcomeLabel(market) === '平' ? '平' : (selection || '未知');
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
    return 'OpenAI 401：OpenAI API Key 无效或没有被 Worker 读取。请检查 OPENAI_API_KEY secret 后重跑 GPT。';
  }
  if (/OpenRouter 401|Missing Authentication header/i.test(message)) {
    return 'OpenRouter 401：OpenRouter API Key 缺失、无效，或密钥里混入不可见字符。请更新 OpenRouter key 后重跑该模型覆盖旧错误。';
  }
  if (/APIMart 401|invalid API key/i.test(message)) {
    return 'APIMart 401：APIMart API Key 无效或没有被 Worker 正确读取。请更新 APIMart key 后重跑该模型。';
  }
  if (/more credits|credits|402|can only afford/i.test(message)) {
    return 'OpenRouter 余额不足或请求过大。可以先单独重跑 Qwen/DeepSeek，或充值后再试。';
  }
  if (/JSON|property value|Unexpected/i.test(message)) {
    return '模型返回格式不标准。系统已尝试自动修复；如果仍失败，请重跑该模型。';
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
