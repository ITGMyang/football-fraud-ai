// Pre-match evidence from xAI's live search, fetched only for the fields the data
// provider failed to return.
//
// API-Football carries injuries for well-covered leagues and nothing at all for
// others - a Europa League qualifier came back with injuries: empty while search
// found six absent players. Searching every fixture would pay for information we
// already hold, so the gaps in fetchStatus are the trigger.
//
// Two rules decide what is worth filling. Post-match fields are never searched
// before kickoff: fixture statistics, player statistics and events do not exist yet.
// And teamStatistics is never searched at any point - it is the one field that feeds
// the maths, and a hallucinated goal count would produce a confident, wrong lambda
// that nothing downstream could detect. A missing baseline reports itself; a
// corrupted one does not.

const ENDPOINT = 'https://api.x.ai/v1/responses';
const DEFAULT_MODEL = 'grok-4.3';

export function newsConfig(env = {}) {
  const apiKey = clean(env.XAI_API_KEY);
  if (!apiKey) return { ok: false, reason: 'XAI_API_KEY is not set' };
  if (clean(env.TEAM_NEWS_SEARCH_ENABLED).toLowerCase() === 'false') {
    return { ok: false, reason: 'TEAM_NEWS_SEARCH_ENABLED is false' };
  }
  return {
    ok: true,
    apiKey,
    model: clean(env.XAI_MODEL) || DEFAULT_MODEL,
    baseUrl: clean(env.XAI_BASE_URL) || ENDPOINT
  };
}

// Lineups are absent on every fixture until roughly an hour before kickoff, so before
// that window their absence is expected and searching would only return speculation.
const LINEUP_WINDOW_MS = 90 * 60 * 1000;

const TOPICS = [
  {
    field: 'injuries',
    label: 'injuries',
    ask: 'injuries, suspensions and doubtful players, named'
  },
  {
    field: 'lineups',
    label: 'lineups',
    ask: 'the confirmed or leaked starting XI and any manager comment on rotation',
    // Asking three days out returns guesswork dressed as reporting.
    when: (context, now) => {
      const kickoff = Date.parse(context?.kickoff || '');
      return Number.isFinite(kickoff) && kickoff - now <= LINEUP_WINDOW_MS && kickoff > now;
    }
  },
  {
    field: 'standings',
    label: 'form and stakes',
    ask: 'current league position, recent form, and what each side still has to play for'
  }
];

function missing(status) {
  if (!status) return 'no fetch was recorded';
  if (status.state === 'error') return `fetch failed: ${status.error || 'unknown error'}`;
  if (!Number(status.count)) return 'the provider returned nothing';
  return '';
}

export function findDataGaps(context, now = Date.now()) {
  return TOPICS
    .filter((topic) => !topic.when || topic.when(context, now))
    .map((topic) => ({ ...topic, gap: missing(context?.fetchStatus?.[topic.field]) }))
    .filter((topic) => topic.gap)
    .map(({ field, label, ask, gap }) => ({ field, label, ask, reason: `${field}: ${gap}` }));
}

export async function fetchTeamNews(context, env = {}, fetchImpl = fetch, now = Date.now()) {
  const gaps = findDataGaps(context, now);
  if (!gaps.length) return { searched: false, reason: 'The provider covered every field worth searching' };
  const gapReason = gaps.map((topic) => topic.reason).join('; ');

  const config = newsConfig(env);
  if (!config.ok) return { searched: false, reason: config.reason };

  const home = context?.fixture?.home?.name || context?.teams?.[0] || '';
  const away = context?.fixture?.away?.name || context?.teams?.[1] || '';
  if (!home || !away) return { searched: false, reason: 'Fixture is missing team names' };
  const fields = gaps.map((topic) => topic.field);

  try {
    const response = await fetchImpl(config.baseUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        // X carries lineup and fitness news hours before it reaches a news site, and
        // it is the source the web index does not cover.
        tools: [{ type: 'x_search' }, { type: 'web_search' }],
        input: [{ role: 'user', content: prompt(home, away, context?.kickoff, gaps) }]
      })
    });

    const body = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(body);
    } catch {
      return { searched: true, ok: false, error: `xAI returned a non-JSON response (${response.status})`, fields, gapReason };
    }
    if (!response.ok) {
      return {
        searched: true,
        ok: false,
        error: String(payload?.error?.message || payload?.error || `xAI returned ${response.status}`).slice(0, 200),
        fields,
        gapReason
      };
    }

    const { text, citations } = readOutput(payload);
    // An uncited claim about a player's fitness is not usable evidence.
    if (!citations.length) {
      return { searched: true, ok: false, error: 'Search returned no citations', fields, gapReason };
    }
    if (/^\s*NO_INTEL\b/i.test(text)) {
      return { searched: true, ok: true, found: false, fields, gapReason, citations: citations.length };
    }

    return {
      searched: true,
      ok: true,
      found: true,
      fields,
      gapReason,
      summary: text.slice(0, 1200),
      citations: citations.slice(0, 8),
      usage: {
        inputTokens: Number(payload?.usage?.input_tokens) || 0,
        outputTokens: Number(payload?.usage?.output_tokens) || 0
      }
    };
  } catch (error) {
    return {
      searched: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      fields,
      gapReason
    };
  }
}

export function teamNewsPromptSummary(news) {
  if (!news?.ok || !news.found) return null;
  return {
    source: `Live search, used because the data provider returned nothing for: ${(news.fields || []).join(', ')}`,
    findings: news.summary,
    citations: news.citations,
    note: 'Unverified reporting, not provider data. Weigh a named and cited absence; ignore anything vague, and never let it override the market.'
  };
}

// One call covers every gap, so the cost does not grow with the number of them.
function prompt(home, away, kickoff, gaps) {
  return [
    `Match: ${home} vs ${away}${kickoff ? `, kicking off ${kickoff}` : ''}.`,
    'Report ONLY verifiable pre-match facts from the last 48 hours, covering:',
    gaps.map((topic, index) => `(${index + 1}) ${topic.ask}`).join('; ') + '.',
    'Name players and cite every claim. Do not speculate, do not predict the result,',
    'and do not report goal counts or season statistics.',
    'If nothing verifiable is found, reply exactly NO_INTEL.'
  ].join(' ');
}

function readOutput(payload) {
  const text = [];
  const citations = [];
  for (const item of payload?.output || []) {
    if (item?.type !== 'message') continue;
    for (const part of item?.content || []) {
      if (part?.text) text.push(part.text);
      for (const annotation of part?.annotations || []) {
        if (annotation?.url) citations.push(annotation.url);
      }
    }
  }
  return { text: text.join('\n').trim(), citations };
}

function clean(value) {
  return String(value || '').replace(/^﻿/, '').trim();
}
