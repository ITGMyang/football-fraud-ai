const $ = (selector) => document.querySelector(selector);

const marketsEl = $('#markets');
const reportsEl = $('#reports');
const rankingsEl = $('#rankings');
const contextsEl = $('#contexts');
const matchPanel = $('#matchPanel');
const matchDetailEl = $('#matchDetail');

let activeRankingModel = 'all';

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
refresh();

function bind(selector, event, handler) {
  const element = $(selector);
  if (element) element.addEventListener(event, handler);
}

async function refresh() {
  const [{ markets }, { reports }, { rankings }, { contexts }] = await Promise.all([
    api('/api/markets'),
    api('/api/reports'),
    api('/api/rankings'),
    api('/api/contexts')
  ]);

  window.currentMarkets = markets;
  renderContexts(contexts);
  renderMarkets(markets);
  renderRankings(rankings, markets);
  renderReports(reports);
  renderRoute(markets, reports);
  setupRevealAnimations();
}

function renderContexts(contexts) {
  const latest = contexts?.[0];
  if (!latest) {
    contextsEl.innerHTML = '<p class="meta">尚未导入懂球帝比赛数据。AI 预测目前只能参考手动盘口。</p>';
    return;
  }

  contextsEl.innerHTML = `
    <div class="context-card">
      <div>
        <strong>已导入懂球帝数据：${escapeHtml(latest.matchName || '比赛')}</strong>
        <span>${escapeHtml(latest.kickoff || '')} · 阵容/战绩/指数/专家/文字直播上下文会随 AI 预测发送</span>
      </div>
      <a href="${escapeHtml(latest.sourceUrl || '#')}" target="_blank" rel="noreferrer">来源</a>
    </div>
  `;
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

  const newest = rankings?.[0];
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
            ${escapeHtml(item.result.modelName)}
            <span>${escapeHtml(new Date(item.ranking.createdAt).toLocaleTimeString())} · Top ${(item.result.picks || []).length}</span>
          </button>
        `).join('')}
      </div>
    </div>
    ${renderCategorySummary(activeResult, marketMap)}
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
    });
  });
}

function collectLatestGeneratedResults(rankings) {
  const latest = rankings?.[0];
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

function isActiveRankingItem(item) {
  return item.key === activeRankingModel
    || String(item.result?.modelName || '').toLowerCase() === String(activeRankingModel || '').toLowerCase();
}

function renderModelRanking(result, marketMap) {
  if (result?.error) {
    return `
      <article class="model-ranking error">
        <h3>${escapeHtml(result.modelName)}</h3>
        <p>${escapeHtml(formatModelError(result.error))}</p>
      </article>
    `;
  }

  const picks = result?.picks || [];
  return `
    <article class="model-ranking">
      <div class="model-ranking-head">
        <div>
          <h3>${escapeHtml(result?.modelName || 'AI')}</h3>
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

function renderCategorySummary(result, marketMap) {
  if (!result || result.error) return '';
  const picks = result.picks || [];
  return `
    <div class="category-summary">
      ${MARKET_GROUPS.slice(0, 4).map((group) => {
        const topPick = picks.find((pick) => {
          const market = pick.market || marketMap.get(pick.marketId) || {};
          return marketCategory(market) === group.key;
        });
        const market = topPick ? (topPick.market || marketMap.get(topPick.marketId) || {}) : null;
        const label = market ? formatCategorySummaryLabel(group.key, market) : '';
        return `
          <div class="category-chip ${topPick ? 'filled' : ''}">
            <span>${escapeHtml(group.label)}</span>
            <strong>${topPick ? escapeHtml(label) : '未入 Top 4'}</strong>
            <em>${topPick ? percent(topPick.estimatedProbability) : 'N/A'}</em>
          </div>
        `;
      }).join('')}
    </div>
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
  try {
    button.disabled = true;
    button.textContent = '预测中...';
    await api('/api/rankings', {
      method: 'POST',
      body: JSON.stringify({ model })
    });
    activeRankingModel = model === 'all'
      ? 'all'
      : model;
    await refresh();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function renderRoute(markets, reports) {
  const match = location.pathname.match(/^\/match\/([^/]+)$/);
  matchPanel.hidden = true;
  if (location.pathname === '/history') {
    $('#historyPanel')?.scrollIntoView({ block: 'start' });
    return;
  }
  if (!match) return;

  const id = decodeURIComponent(match[1]);
  const market = markets.find((item) => item.id === id);
  const related = reports.filter((report) => report.market?.id === id || report.consensus?.marketId === id);
  matchPanel.hidden = false;
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
