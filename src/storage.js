import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const initialState = {
  markets: [],
  reports: [],
  rankings: [],
  matchContexts: []
};

export function readDb({ ownerId = 'legacy' } = {}) {
  ensureDb();
  const db = readAllDb();
  return {
    ...db,
    markets: (db.markets || []).filter((item) => (item.ownerId || 'legacy') === ownerId),
    reports: (db.reports || []).filter((item) => (item.ownerId || 'legacy') === ownerId),
    rankings: (db.rankings || []).filter((item) => (item.ownerId || 'legacy') === ownerId),
    matchContexts: (db.matchContexts || []).filter((item) => (item.ownerId || 'legacy') === ownerId)
  };
}

export function writeDb(db) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

export function upsertMarkets(markets, { ownerId = 'legacy' } = {}) {
  const db = readAllDb();
  for (const market of markets) {
    const idx = db.markets.findIndex((item) => (item.ownerId || 'legacy') === ownerId && (item.id === market.id || marketKey(item) === marketKey(market)));
    const ownedMarket = { ...market, ownerId };
    if (idx >= 0) db.markets[idx] = ownedMarket;
    else db.markets.unshift(ownedMarket);
  }
  writeDb(db);
  return markets;
}

export function clearMarkets({ ownerId = 'legacy' } = {}) {
  const db = readAllDb();
  db.markets = db.markets.filter((item) => (item.ownerId || 'legacy') !== ownerId);
  db.reports = db.reports.filter((item) => (item.ownerId || 'legacy') !== ownerId);
  db.rankings = db.rankings.filter((item) => (item.ownerId || 'legacy') !== ownerId);
  db.matchContexts = db.matchContexts.filter((item) => (item.ownerId || 'legacy') !== ownerId);
  writeDb(db);
}

export function saveReport(report, { ownerId = 'legacy' } = {}) {
  const db = readAllDb();
  db.reports.unshift({ ...report, ownerId });
  writeDb(db);
  return report;
}

export function saveRanking(ranking, { mergeLatest = false, ownerId = 'legacy' } = {}) {
  const db = readAllDb();
  if (!Array.isArray(db.rankings)) db.rankings = [];
  const ownerRankings = db.rankings.filter((item) => (item.ownerId || 'legacy') === ownerId);
  if (mergeLatest && ownerRankings.length) {
    const mergeIndex = ranking.contextId
      ? db.rankings.findIndex((item) => (item.ownerId || 'legacy') === ownerId && item.contextId === ranking.contextId)
      : 0;
    const latest = db.rankings[mergeIndex >= 0 ? mergeIndex : db.rankings.findIndex((item) => (item.ownerId || 'legacy') === ownerId)];
    const incoming = ranking.results || [];
    const existingResults = (latest.results || []).map((result) => ({
      ...result,
      generatedAt: result.generatedAt || latest.createdAt
    }));
    const byModel = new Map(existingResults.map((result) => [resultModelKey(result.modelName), result]));
    for (const result of incoming) byModel.set(resultModelKey(result.modelName), result);
    latest.results = [...byModel.values()];
    latest.marketCount = ranking.marketCount || latest.marketCount;
    latest.createdAt = new Date().toISOString();
    latest.disclaimer = ranking.disclaimer || latest.disclaimer;
    if (ranking.contextId) latest.contextId = ranking.contextId;
    if (ranking.contextName) latest.contextName = ranking.contextName;
    db.rankings = [
      latest,
      ...db.rankings.filter((item) => item.id !== latest.id)
    ].slice(0, 50);
    writeDb(db);
    return latest;
  }
  db.rankings.unshift({ ...ranking, ownerId });
  db.rankings = db.rankings.filter((item) => (item.ownerId || 'legacy') === ownerId).slice(0, 50)
    .concat(db.rankings.filter((item) => (item.ownerId || 'legacy') !== ownerId));
  writeDb(db);
  return ranking;
}

function resultModelKey(modelName = '') {
  const text = String(modelName || '').toLowerCase();
  if (text.includes('gpt') || text.includes('openai')) return 'gpt';
  if (text.includes('claude')) return 'claude';
  if (text.includes('gemini')) return 'gemini';
  if (text.includes('deepseek')) return 'deepseek';
  if (text.includes('qwen') || text.includes('通义')) return 'qwen';
  return text || 'ai';
}

export function upsertMatchContext(context, { ownerId = 'legacy' } = {}) {
  const db = readAllDb();
  if (!Array.isArray(db.matchContexts)) db.matchContexts = [];
  const idx = db.matchContexts.findIndex((item) => (item.ownerId || 'legacy') === ownerId && (item.id === context.id || item.sourceUrl === context.sourceUrl));
  const ownedContext = { ...context, ownerId };
  if (idx >= 0) db.matchContexts[idx] = ownedContext;
  else db.matchContexts.unshift(ownedContext);
  db.matchContexts = db.matchContexts.slice(0, 20);
  writeDb(db);
  return context;
}

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(initialState, null, 2));
}

function readAllDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function marketKey(market) {
  return [
    market.matchName,
    market.marketType,
    market.selection,
    market.line,
    market.sourceUrl
  ].map((value) => String(value || '').trim()).join('|');
}
