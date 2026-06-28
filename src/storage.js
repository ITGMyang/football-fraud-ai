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

export function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

export function writeDb(db) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

export function upsertMarkets(markets) {
  const db = readDb();
  for (const market of markets) {
    const idx = db.markets.findIndex((item) => item.id === market.id || marketKey(item) === marketKey(market));
    if (idx >= 0) db.markets[idx] = market;
    else db.markets.unshift(market);
  }
  writeDb(db);
  return markets;
}

export function clearMarkets() {
  const db = readDb();
  db.markets = [];
  db.reports = [];
  db.rankings = [];
  writeDb(db);
}

export function saveReport(report) {
  const db = readDb();
  db.reports.unshift(report);
  writeDb(db);
  return report;
}

export function saveRanking(ranking, { mergeLatest = false } = {}) {
  const db = readDb();
  if (!Array.isArray(db.rankings)) db.rankings = [];
  if (mergeLatest && db.rankings.length) {
    const mergeIndex = ranking.contextId
      ? db.rankings.findIndex((item) => item.contextId === ranking.contextId)
      : 0;
    const latest = db.rankings[mergeIndex >= 0 ? mergeIndex : 0];
    const incoming = ranking.results || [];
    const byModel = new Map((latest.results || []).map((result) => [result.modelName, result]));
    for (const result of incoming) byModel.set(result.modelName, result);
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
  db.rankings.unshift(ranking);
  db.rankings = db.rankings.slice(0, 50);
  writeDb(db);
  return ranking;
}

export function upsertMatchContext(context) {
  const db = readDb();
  if (!Array.isArray(db.matchContexts)) db.matchContexts = [];
  const idx = db.matchContexts.findIndex((item) => item.id === context.id || item.sourceUrl === context.sourceUrl);
  if (idx >= 0) db.matchContexts[idx] = context;
  else db.matchContexts.unshift(context);
  db.matchContexts = db.matchContexts.slice(0, 20);
  writeDb(db);
  return context;
}

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(initialState, null, 2));
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
