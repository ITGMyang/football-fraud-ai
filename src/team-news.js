// Pre-match team news from xAI's live search, fetched only when the fixture context
// is missing it.
//
// API-Football carries injuries for well-covered leagues and nothing at all for
// others - a Europa League qualifier came back with injuries: empty while search
// found six absent players. Searching every fixture would pay for information we
// already hold, so the gap in fetchStatus is the trigger.

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

// Only the absence of injury data justifies the spend. Lineups are absent on every
// fixture until roughly an hour before kickoff, so their absence proves nothing.
export function needsTeamNews(context) {
  const injuries = context?.fetchStatus?.injuries;
  if (!injuries) return { needed: true, reason: 'No injury fetch was recorded' };
  if (injuries.state === 'error') return { needed: true, reason: `Injury fetch failed: ${injuries.error || 'unknown error'}` };
  if (!Number(injuries.count)) return { needed: true, reason: 'The provider returned no injuries for this fixture' };
  return { needed: false, reason: `The provider already returned ${injuries.count} injury rows` };
}

export async function fetchTeamNews(context, env = {}, fetchImpl = fetch) {
  const gap = needsTeamNews(context);
  if (!gap.needed) return { searched: false, reason: gap.reason };

  const config = newsConfig(env);
  if (!config.ok) return { searched: false, reason: config.reason };

  const home = context?.fixture?.home?.name || context?.teams?.[0] || '';
  const away = context?.fixture?.away?.name || context?.teams?.[1] || '';
  if (!home || !away) return { searched: false, reason: 'Fixture is missing team names' };

  try {
    const response = await fetchImpl(config.baseUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        // X carries lineup and fitness news hours before it reaches a news site, and
        // it is the source the web index does not cover.
        tools: [{ type: 'x_search' }, { type: 'web_search' }],
        input: [{ role: 'user', content: prompt(home, away, context?.kickoff) }]
      })
    });

    const body = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(body);
    } catch {
      return { searched: true, ok: false, error: `xAI returned a non-JSON response (${response.status})`, gapReason: gap.reason };
    }
    if (!response.ok) {
      return {
        searched: true,
        ok: false,
        error: String(payload?.error?.message || payload?.error || `xAI returned ${response.status}`).slice(0, 200),
        gapReason: gap.reason
      };
    }

    const { text, citations } = readOutput(payload);
    // An uncited claim about a player's fitness is not usable evidence.
    if (!citations.length) {
      return { searched: true, ok: false, error: 'Search returned no citations', gapReason: gap.reason };
    }
    if (/^\s*NO_INTEL\b/i.test(text)) {
      return { searched: true, ok: true, found: false, gapReason: gap.reason, citations: citations.length };
    }

    return {
      searched: true,
      ok: true,
      found: true,
      gapReason: gap.reason,
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
      gapReason: gap.reason
    };
  }
}

export function teamNewsPromptSummary(news) {
  if (!news?.ok || !news.found) return null;
  return {
    source: 'Live search, used because the data provider carried no injuries for this fixture',
    findings: news.summary,
    citations: news.citations,
    note: 'Unverified reporting, not provider data. Weigh a named and cited absence; ignore anything vague, and never let it override the market.'
  };
}

function prompt(home, away, kickoff) {
  return [
    `Match: ${home} vs ${away}${kickoff ? `, kicking off ${kickoff}` : ''}.`,
    'Report ONLY confirmed pre-match team news from the last 48 hours: injuries, suspensions,',
    'doubtful players, confirmed or leaked starting XI, and manager statements about rotation.',
    'Name the players. Do not speculate, do not summarise form, do not predict the result.',
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
