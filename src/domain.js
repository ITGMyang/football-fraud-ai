export function impliedProbability(decimalOdds) {
  const odds = Number(decimalOdds);
  if (!Number.isFinite(odds) || odds <= 0) return null;
  return 1 / (1 + odds);
}

export function buildMarket({ id, matchName, teams, marketType, line, selection, odds, sourceUrl, capturedAt }) {
  const probability = impliedProbability(odds);
  return {
    id: id || crypto.randomUUID(),
    matchName: String(matchName || '').trim(),
    teams: Array.isArray(teams) ? teams.map(String) : splitTeams(matchName),
    marketType: String(marketType || '').trim(),
    line: String(line || '').trim(),
    selection: String(selection || '').trim(),
    odds: Number(odds),
    impliedProbability: probability,
    sourceUrl: sourceUrl || '',
    capturedAt: capturedAt || new Date().toISOString()
  };
}

export function splitTeams(matchName = '') {
  const clean = String(matchName).replace(/\s+/g, ' ').trim();
  const parts = clean.split(/\s+v\s+|\s+vs\.?\s+| - /i).map((x) => x.trim()).filter(Boolean);
  return parts.length >= 2 ? parts.slice(0, 2) : [];
}
