export function predictionPhase(context = {}, now = Date.now()) {
  const kickoff = Date.parse(context?.kickoff || context?.fixture?.date || '');
  const hasLineup = Array.isArray(context?.lineup?.players) && context.lineup.players.length > 0;
  return hasLineup && Number.isFinite(kickoff) && kickoff - now <= 60 * 60 * 1000 ? 'live' : 'early';
}

export function predictionModelKey(value = '') {
  const text = String(value || '').toLowerCase();
  if (text.includes('gpt') || text.includes('openai')) return 'gpt';
  if (text.includes('claude')) return 'claude';
  if (text.includes('gemini')) return 'gemini';
  if (text.includes('deepseek')) return 'deepseek';
  if (text.includes('qwen') || text.includes('通义')) return 'qwen';
  return text || 'ai';
}
