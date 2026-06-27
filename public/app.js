const $ = (selector) => document.querySelector(selector);

const marketsEl = $('#markets');
const reportsEl = $('#reports');
const rankingsEl = $('#rankings');
const contextsEl = $('#contexts');
const matchScheduleEl = $('#matchSchedule');
const contextTabsEl = $('#contextTabs');
const contextExplorerEl = $('#contextExplorer');
const matchPanel = $('#matchPanel');
const matchDetailEl = $('#matchDetail');

const ACTIVE_CONTEXT_STORAGE_KEY = 'footballFraud.activeContextId';
let activeRankingModel = 'all';
let activeContextId = readStoredActiveContextId();

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
bind('#loadDongqiudiMatches', 'click', loadDongqiudiMatches);
bind('#competitionFilter', 'change', loadDongqiudiMatches);
bind('#matchDate', 'change', loadDongqiudiMatches);

bind('#importDongqiudiUrl', 'click', importDongqiudiUrl);

bind('#clearMarkets', 'click', async () => {
  await api('/api/markets/clear', { method: 'POST' });
  await refresh();
});

document.querySelectorAll('[data-rank-model]').forEach((button) => {
  button.addEventListener('click', () => runRanking(button.dataset.rankModel, button));
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
  try {
    return localStorage.getItem(ACTIVE_CONTEXT_STORAGE_KEY) || '';
  } catch {
    return '';
  }
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
  const [{ markets }, { reports }, { rankings }, { contexts }] = await Promise.all([
    api('/api/markets'),
    api('/api/reports'),
    api('/api/rankings'),
    api('/api/contexts')
  ]);
  const orderedContexts = sortContextsForDisplay(contexts);
  if (activeContextId && !orderedContexts.some((context) => contextKey(context) === activeContextId)) {
    setActiveContextId('');
  }

  window.currentMarkets = markets;
  window.currentRankings = rankings;
  window.currentContexts = orderedContexts;
  renderRoute(markets, reports, orderedContexts);
  renderContexts(orderedContexts);
  if (marketsEl) renderMarkets(markets);
  renderRankings(rankings, markets);
  updateRankButtons(rankings);
  renderReports(reports);
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
    const { context, alreadyImported } = await api('/api/import/dongqiudi-url', {
      method: 'POST',
      body: JSON.stringify({ sourceUrl })
    });
    setActiveContextId(contextKey(context));
    await refresh();
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
        </div>
        <span>阵容/战绩/指数/专家/文字直播上下文会随 AI 预测发送</span>
      </div>
      <a href="${escapeHtml(latest.sourceUrl || '#')}" target="_blank" rel="noreferrer">来源</a>
    </div>
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
  contextExplorerEl.innerHTML = `
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
        ${renderDataModule('指数摘要', context.index?.handicapRows || [], 'odds')}
        ${renderExpertModule(context.experts || [])}
      </div>
    </article>
  `;
  contextExplorerEl.querySelector('[data-refresh-context]')?.addEventListener('click', refreshContextData);
}

function contextKey(context = {}) {
  const sourceUrl = String(context.sourceUrl || '');
  return context.matchId || sourceUrl.match(/dongqiudi\.com\/match\/(\d+)/i)?.[1] || sourceUrl || context.matchName || '';
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
  return `<span class="model-brand ${key}" aria-hidden="true">${label}</span>`;
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
  const visible = (rows || []).slice(0, type === 'players' ? 30 : 10);
  return `
    <section class="data-module ${type}">
      <h4>${escapeHtml(title)} <span>${visible.length}</span></h4>
      ${visible.length ? `<ul>${visible.map((row) => `<li>${escapeHtml(row)}</li>`).join('')}</ul>` : '<p class="meta">未抓到这类数据。</p>'}
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
    ? '<div class="ranking-notice">当前只显示最新一轮预测结果；旧结果请到历史区复盘。</div>'
    : '<div class="ranking-notice">最新一轮没有有效 Top 4，当前显示这一轮的模型错误。你可以点击上方按钮重新预测。</div>';
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
  const latest = currentContextRanking(rankings);
  if (!latest) return [];
  const results = latest.results || [];
  const successful = results.filter((result) => (result.picks || []).length > 0);
  const visibleResults = successful.length ? successful : results;
  return visibleResults.map((result) => ({
    key: `${latest.id}:${result.modelName}`,
    ranking: latest,
    result
  }));
}

function currentContextRanking(rankings = []) {
  if (!rankings?.length) return null;
  if (!activeContextId) return rankings[0] || null;
  return rankings.find((ranking) => ranking.contextId === activeContextId) || null;
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
  const picks = (scorePicks || []).slice(0, 3);
  return `
    <section class="score-predictions">
      <div class="score-head">
        <strong>比分预测</strong>
        <span>每个模型单独给出 3 个比分候选</span>
      </div>
      <div class="score-grid">
        ${picks.length ? picks.map((pick, index) => `
          <article class="score-card">
            <span>#${index + 1}</span>
            <strong>${escapeHtml(pick.score || pick.market?.selection || '')}</strong>
            <div>AI 概率 ${percent(pick.estimatedProbability)}</div>
            <p>${escapeHtml(pick.reason || '无理由')}</p>
          </article>
        `).join('') : '<p class="meta">这个模型暂时没有给出比分预测。重跑后会尝试生成 3 个比分。</p>'}
      </div>
    </section>
  `;
}

function renderRankingPick(pick, marketMap, index) {
  const market = pick.market || marketMap.get(pick.marketId) || {};
  const categoryKey = marketCategory(market);
  const category = MARKET_GROUPS.find((group) => group.key === categoryKey) || MARKET_GROUPS.at(-1);
  const risks = Array.isArray(pick.risks) ? pick.risks.filter(Boolean).slice(0, 3) : [];
  const outcome = marketOutcomeLabel(market);
  const outcomeDisplay = marketOutcomeDisplay(market);
  return `
    <article class="prediction-card ${categoryKey} reveal">
      <div class="prediction-rank">
        <span>#${index + 1}</span>
        <b class="pill ${categoryKey}">${escapeHtml(category.label)}</b>
      </div>
      ${categoryKey === 'moneyline' ? `<div class="outcome-banner">${escapeHtml(outcomeDisplay)}</div>` : ''}
      <div class="prediction-main">
        <h4>${escapeHtml(formatPredictionTitle(market))}</h4>
        <p>${escapeHtml(market.matchName || '未知比赛')}</p>
      </div>
      <div class="prediction-metrics">
        <div><span>${categoryKey === 'moneyline' ? '三选一' : '盘口'}</span><strong>${escapeHtml(categoryKey === 'moneyline' ? outcome : (market.line || '无'))}</strong></div>
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
  const original = button.textContent;
  let completed = false;
  try {
    button.disabled = true;
    button.textContent = '预测中...';
    await api('/api/rankings', {
      method: 'POST',
      body: JSON.stringify({ model, contextId: activeContextId })
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
    if (!completed) button.textContent = original;
  }
}

function renderRoute(markets, reports, contexts = []) {
  const match = location.pathname.match(/^\/match\/([^/]+)$/);
  const dataPage = $('#dataPage');
  const dataBackHome = $('#dataBackHome');
  const matchCenter = $('.match-center');
  const aiPanel = $('#ai-panel');
  const historyPanel = $('#historyPanel');
  const isHome = location.pathname === '/';
  const unfinishedContexts = contexts.filter(isUnfinishedContext);

  if (matchPanel) matchPanel.hidden = true;
  if (dataPage) dataPage.hidden = !(location.pathname === '/data' || (isHome && unfinishedContexts.length));
  if (dataBackHome) dataBackHome.hidden = isHome;
  if (matchCenter) matchCenter.hidden = location.pathname === '/data' || location.pathname === '/history' || Boolean(match);
  if (aiPanel) aiPanel.hidden = location.pathname === '/data' || location.pathname === '/history' || Boolean(match);
  if (historyPanel) historyPanel.hidden = location.pathname === '/data' || Boolean(match);

  if (location.pathname === '/data') {
    renderContextExplorer(contexts);
    dataPage?.scrollIntoView({ block: 'start' });
    return;
  }
  if (isHome) {
    renderContextExplorer(unfinishedContexts);
  }
  if (location.pathname === '/history') {
    $('#historyPanel')?.scrollIntoView({ block: 'start' });
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
  if (category === 'total') return `${market.selection || ''} ${market.line || ''} 球`;
  return `${market.selection || ''} ${market.line || ''}`.trim();
}

function formatPredictionTitle(market) {
  const category = marketCategory(market);
  if (category === 'moneyline') return marketOutcomeDisplay(market);
  if (category === 'score') return `比分 ${market.selection || ''}`.trim();
  if (category === 'handicap') return `${market.selection || ''} ${market.line || ''}`.trim();
  if (category === 'total') return `${market.selection || ''} ${market.line || ''} 球`.trim();
  return `${market.selection || ''} ${market.line || ''}`.trim();
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
