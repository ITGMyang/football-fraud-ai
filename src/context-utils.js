export function extractDongqiudiMatchId(value = '') {
  const text = String(value || '').trim();
  return text.match(/dongqiudi\.com\/match\/(\d+)/i)?.[1] || text.match(/^(\d{6,})$/)?.[1] || '';
}

export function contextKey(context = {}) {
  return context.matchId || extractDongqiudiMatchId(context.sourceUrl) || context.sourceUrl || context.matchName || '';
}

export function findExistingContext(contexts = [], sourceUrl = '') {
  const targetUrl = String(sourceUrl || '').trim();
  const targetId = extractDongqiudiMatchId(targetUrl);
  return (contexts || []).find((context) => {
    const existingKey = contextKey(context);
    return (targetId && existingKey === targetId)
      || (targetUrl && context.sourceUrl === targetUrl)
      || (targetUrl && existingKey === targetUrl);
  }) || null;
}

export function hasLineupPlayers(context = {}) {
  return Array.isArray(context.lineup?.players) && context.lineup.players.length > 0;
}
