import { evaluateRanking } from '../../src/evaluation.js';

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});

const TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

const HISTORY_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const HISTORY_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  month: 'short',
  day: 'numeric',
  weekday: 'short'
});

export function accountIdentity(user = {}) {
  const metadata = user.user_metadata || {};
  const rawProvider = String(user.app_metadata?.provider || metadata.provider || '').toLowerCase();
  const provider = rawProvider.includes('telegram')
    ? 'Telegram'
    : rawProvider.includes('google')
      ? 'Google'
      : 'FutBots';
  const name = String(
    metadata.full_name
    || metadata.name
    || metadata.user_name
    || metadata.username
    || user.email
    || 'FutBots user'
  );
  const avatarUrl = String(
    metadata.avatar_url
    || metadata.picture
    || metadata.photo_url
    || metadata.photoUrl
    || ''
  );
  return { name, avatarUrl, provider };
}

export function hasPlayerInformation(context = {}) {
  if (Array.isArray(context.players) && context.players.length > 0) return true;
  if (Array.isArray(context.lineup?.players) && context.lineup.players.length > 0) return true;
  if (!Array.isArray(context.lineups)) return false;
  return context.lineups.some((lineup) => (
    (Array.isArray(lineup?.players) && lineup.players.length > 0)
    || (Array.isArray(lineup?.startXI) && lineup.startXI.length > 0)
    || (Array.isArray(lineup?.substitutes) && lineup.substitutes.length > 0)
  ));
}


export function teamCrestUrl(source = '') {
  const value = String(source || '').trim();
  const match = value.match(/^https:\/\/media\.api-sports\.io\/football\/teams\/(\d+)\.png$/);
  return match ? `/media/team-crests/${match[1]}.png` : value;
}

export function formatMatchDate(kickoff, fallbackDate = '', fallbackTime = '') {
  const parsed = new Date(kickoff || '');
  if (!Number.isNaN(parsed.getTime())) {
    return `${DATE_FORMATTER.format(parsed)} | ${TIME_FORMATTER.format(parsed)}`;
  }
  if (!fallbackDate) return 'Date TBD';
  const fallback = new Date(`${fallbackDate}T00:00:00+08:00`);
  const dateLabel = Number.isNaN(fallback.getTime()) ? fallbackDate : DATE_FORMATTER.format(fallback);
  return fallbackTime ? `${dateLabel} | ${fallbackTime}` : dateLabel;
}

export function normalizeMatches(payload = {}) {
  const rows = Array.isArray(payload.matches) ? payload.matches : [];
  return rows.map((match) => ({
    id: String(match.matchId || match.id || ''),
    date: formatMatchDate(match.kickoff, match.date, match.time),
    kickoff: match.kickoff || '',
    teamA: { name: match.home || match.teams?.[0] || 'Home', flag: match.homeLogo || '' },
    teamB: { name: match.away || match.teams?.[1] || 'Away', flag: match.awayLogo || '' },
    status: match.status === 'finished' ? 'complete' : match.status === 'live' ? 'live' : 'upcoming',
    score: match.score || '',
    round: match.competition || 'Football'
  })).filter((match) => match.id);
}

export function analysisRequestPlan(authenticated, matchId, model = 'all') {
  const id = String(matchId || '');
  return {
    importContext: Boolean(authenticated),
    rankingBody: { matchId: id, contextId: id, model: String(model || 'all') }
  };
}

export function userFacingError(error, fallback = 'Something went wrong. Try again.') {
  const message = String(error?.message || '').trim();
  if (!message || /[\p{Script=Han}]/u.test(message) || /(?:API_FOOTBALL_KEY|SUPABASE_SECRET|SERVICE_ROLE)/i.test(message)) {
    return fallback;
  }
  return message;
}

/**
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   getAccessToken?: () => string | Promise<string>,
 *   onUnauthorized?: () => void
 * }} options
 */
export function createApiClient({
  fetchImpl = fetch,
  getAccessToken = () => '',
  onUnauthorized = () => {}
} = {}) {
  return async function api(path, options = {}) {
    const token = await getAccessToken();
    const response = await fetchImpl(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) onUnauthorized();
    if (!response.ok) {
      const error = new Error(data.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = data.code || '';
      throw error;
    }
    return data;
  };
}

export function rankingView(ranking = {}) {
  return {
    // The view flattens picks for display and loses the market behind each one, which
    // is what deciding "did this land" needs. Keep the original alongside so the card
    // can be judged by the same code the accuracy tables use.
    raw: ranking,
    contextId: String(ranking.contextId || ''),
    matchName: ranking.contextName || 'Match prediction',
    createdAt: ranking.createdAt || '',
    models: (ranking.results || []).map((result) => {
      const picks = result.picks || [];
      return {
        name: result.modelName || result.model || 'AI model',
        provider: result.provider || '',
        phase: predictionPhaseLabel(result.predictionPhase),
        scores: (result.scorePicks || []).slice(0, 4).map((pick, index) => ({
          score: pick.score || pick.market?.selection || '—',
          type: scoreTypeLabel(pick.scoreType, index),
          probability: asPercent(pick.estimatedProbability),
          reason: pick.reason || ''
        })),
        btts: bttsView(result.bttsPick),
        total: pickView(picks.find((pick) => /total|over|under|大|小/i.test(pick.market?.marketType || ''))),
        handicap: pickView(picks.find((pick) => /handicap|让球|亚洲/i.test(pick.market?.marketType || ''))),
        moneyline: pickView(picks.find((pick) => /1x2|moneyline|胜平负/i.test(pick.market?.marketType || ''))),
        picks: picks.map(pickView).filter(Boolean)
      };
    })
  };
}

export function rankingForMatch(rankings = [], matchId = '') {
  const id = String(matchId || '');
  return rankings.find((ranking) => String(ranking?.contextId || '') === id) || null;
}

export function predictionActionLabel(ranking) {
  return ranking?.models?.length ? 'See Result' : 'Start Predicting';
}

export function predictionHistory(rankings = [], contexts = []) {
  const contextMap = new Map();
  for (const context of contexts || []) {
    for (const key of [context?.matchId, context?.id, String(context?.id || '').replace(/^api-football:/, '')]) {
      if (key) contextMap.set(String(key), context);
    }
  }
  const groups = new Map();
  for (const ranking of rankings || []) {
    const context = contextMap.get(String(ranking?.contextId || '')) || {};
    const kickoff = context.kickoff || ranking.createdAt || '';
    const date = historyDateKey(kickoff);
    const [fallbackHome, fallbackAway] = splitHistoryTeams(ranking.matchName);
    const home = context.fixture?.home || {};
    const away = context.fixture?.away || {};
    const actualScore = normalizeHistoryScore(context.actualScore || context.score || context.result?.score);
    // One badge reading "Match Result: Miss" said nothing about which of the five
    // markets was wrong, and judged only the exact scoreline - the hardest of them -
    // under a label that promised the easiest.
    const markets = evaluateRanking(ranking.raw || ranking, context).map((entry) => ({
      category: entry.category,
      selection: entry.selection,
      hit: Boolean(entry.hit)
    }));
    const decided = markets.length;
    const hits = markets.filter((entry) => entry.hit).length;
    const result = !actualScore ? 'pending' : decided === 0 ? 'pending' : hits > 0 ? 'hit' : 'miss';
    const match = {
      id: String(ranking.contextId || context.matchId || context.id || ''),
      date: formatMatchDate(kickoff),
      kickoff,
      teamA: { name: home.name || context.teams?.[0] || fallbackHome, flag: teamCrestUrl(home.logo || context.homeLogo || '') },
      teamB: { name: away.name || context.teams?.[1] || fallbackAway, flag: teamCrestUrl(away.logo || context.awayLogo || '') },
      status: actualScore ? 'complete' : 'upcoming',
      score: actualScore,
      round: context.competition || context.fixture?.round || 'Football',
      countryFlag: countryFlagEmoji(context.fixture?.country || context.country || ''),
      result,
      markets,
      hits,
      decided,
      ranking
    };
    if (!groups.has(date)) {
      groups.set(date, {
        date,
        label: HISTORY_LABEL_FORMATTER.format(new Date(`${date}T12:00:00+08:00`)),
        matches: []
      });
    }
    groups.get(date).matches.push(match);
  }
  return [...groups.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((group) => ({
      ...group,
      matches: group.matches.sort((a, b) => String(b.kickoff).localeCompare(String(a.kickoff)))
    }));
}

function scoreTypeLabel(value, index) {
  const type = String(value || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (type === 'market_fit') return 'Market-Fit Score';
  if (type === 'aggressive') return 'Aggressive Score';
  return `Primary Score ${Math.min(index + 1, 2)}`;
}

function historyDateKey(value) {
  const parsed = new Date(value || '');
  if (!Number.isNaN(parsed.getTime())) return HISTORY_DATE_FORMATTER.format(parsed);
  return String(value || '').slice(0, 10) || HISTORY_DATE_FORMATTER.format(new Date());
}

function splitHistoryTeams(value) {
  const teams = String(value || '').split(/\s+(?:v(?:s\.?)?|versus)\s+/i);
  return [teams[0] || 'Home', teams[1] || 'Away'];
}

function normalizeHistoryScore(value) {
  const match = String(value || '').replace(/[：\-–—]/g, ':').match(/(\d+)\s*:\s*(\d+)/);
  return match ? `${Number(match[1])}:${Number(match[2])}` : '';
}

function countryFlagEmoji(value) {
  const country = String(value || '').trim().toLowerCase();
  const codes = {
    argentina: 'AR', australia: 'AU', belgium: 'BE', brazil: 'BR', canada: 'CA',
    china: 'CN', croatia: 'HR', denmark: 'DK', england: 'GB', france: 'FR',
    germany: 'DE', italy: 'IT', japan: 'JP', mexico: 'MX', netherlands: 'NL',
    portugal: 'PT', 'saudi arabia': 'SA', 'south korea': 'KR', spain: 'ES',
    turkey: 'TR', usa: 'US', 'united states': 'US', uruguay: 'UY'
  };
  const code = codes[country];
  return code ? [...code].map((character) => String.fromCodePoint(127397 + character.charCodeAt(0))).join('') : '🌐';
}

function predictionPhaseLabel(value) {
  if (value === 'live') return 'Live Prediction';
  if (value === 'early') return 'Early Prediction';
  return 'Prediction';
}

function bttsView(pick) {
  if (!pick) return null;
  return {
    label: pick.selection || '—',
    type: 'Both Teams to Score',
    probability: asPercent(pick.estimatedProbability),
    confidence: asPercent(pick.confidence),
    reason: pick.reason || '',
    risks: Array.isArray(pick.risks) ? pick.risks : []
  };
}

function pickView(pick) {
  if (!pick) return null;
  const market = pick.market || {};
  return {
    label: [market.selection, market.line].filter(Boolean).join(' '),
    type: market.marketType || 'Prediction',
    probability: asPercent(pick.estimatedProbability),
    confidence: asPercent(pick.confidence),
    reason: pick.reason || '',
    risks: Array.isArray(pick.risks) ? pick.risks : []
  };
}

function asPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number <= 1 ? number : number / 100) * 100);
}
