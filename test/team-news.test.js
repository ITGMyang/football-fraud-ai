import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchTeamNews, needsTeamNews, newsConfig, teamNewsPromptSummary } from '../src/team-news.js';

const ENV = { XAI_API_KEY: 'xai-test' };

function context(fetchStatus) {
  return {
    fixture: { home: { name: 'FC Midtjylland' }, away: { name: 'Beşiktaş' } },
    kickoff: '2026-07-30T17:00:00Z',
    fetchStatus
  };
}

function reply(text, citations = ['https://x.com/i/status/1']) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      output: [{
        type: 'message',
        content: [{ text, annotations: citations.map((url) => ({ url })) }]
      }],
      usage: { input_tokens: 7342, output_tokens: 1173 }
    })
  };
}

test('only a real gap in injury data justifies the spend', () => {
  assert.equal(needsTeamNews(context({ injuries: { state: 'available', count: 6 } })).needed, false);

  assert.equal(needsTeamNews(context({ injuries: { state: 'empty', count: 0 } })).needed, true);
  assert.equal(needsTeamNews(context({ injuries: { state: 'error', count: 0, error: 'rate limited' } })).needed, true);
  assert.equal(needsTeamNews(context({})).needed, true);
  assert.equal(needsTeamNews(null).needed, true);

  assert.match(needsTeamNews(context({ injuries: { state: 'error', error: 'rate limited' } })).reason, /rate limited/);
});

// Lineups are absent on every fixture until close to kickoff, so their absence is
// not evidence of a gap and must not trigger a paid search on its own.
test('missing lineups alone never triggers a search', () => {
  const withInjuries = context({ injuries: { state: 'available', count: 3 }, lineups: { state: 'empty', count: 0 } });
  assert.equal(needsTeamNews(withInjuries).needed, false);
});

test('a fixture the provider covered costs nothing', async () => {
  let called = false;
  const result = await fetchTeamNews(
    context({ injuries: { state: 'available', count: 6 } }),
    ENV,
    async () => { called = true; }
  );

  assert.equal(called, false);
  assert.equal(result.searched, false);
  assert.match(result.reason, /already returned 6/);
});

test('search is skipped when it is unconfigured or switched off', async () => {
  const gap = context({ injuries: { state: 'empty', count: 0 } });

  assert.match(newsConfig({}).reason, /XAI_API_KEY/);
  assert.equal((await fetchTeamNews(gap, {}, async () => { throw new Error('must not call'); })).searched, false);

  const off = await fetchTeamNews(gap, { ...ENV, TEAM_NEWS_SEARCH_ENABLED: 'false' }, async () => { throw new Error('must not call'); });
  assert.equal(off.searched, false);
  assert.match(off.reason, /TEAM_NEWS_SEARCH_ENABLED/);
});

test('the request asks xAI for X and web search with both team names', async () => {
  let request = null;
  await fetchTeamNews(context({ injuries: { state: 'empty', count: 0 } }), ENV, async (url, options) => {
    request = { url: String(url), headers: options.headers, body: JSON.parse(options.body) };
    return reply('Beşiktaş: Ndidi injured, Uduokhai suspended.');
  });

  assert.equal(request.url, 'https://api.x.ai/v1/responses');
  assert.equal(request.headers.Authorization, 'Bearer xai-test');
  assert.deepEqual(request.body.tools, [{ type: 'x_search' }, { type: 'web_search' }]);
  const asked = request.body.input[0].content;
  assert.match(asked, /FC Midtjylland vs Beşiktaş/);
  assert.match(asked, /last 48 hours/);
  assert.match(asked, /NO_INTEL/);
});

test('findings are returned with their citations and token cost', async () => {
  const result = await fetchTeamNews(
    context({ injuries: { state: 'empty', count: 0 } }),
    ENV,
    async () => reply('Beşiktaş: Ndidi (injured), Uduokhai (suspended).', ['https://x.com/a', 'https://x.com/b'])
  );

  assert.equal(result.ok, true);
  assert.equal(result.found, true);
  assert.match(result.summary, /Ndidi/);
  assert.deepEqual(result.citations, ['https://x.com/a', 'https://x.com/b']);
  assert.equal(result.usage.inputTokens, 7342);
  assert.match(result.gapReason, /no injuries/);
});

// An uncited claim about a player's fitness is indistinguishable from a guess.
test('an uncited answer is rejected rather than passed on as evidence', async () => {
  const result = await fetchTeamNews(
    context({ injuries: { state: 'empty', count: 0 } }),
    ENV,
    async () => reply('Half the squad is out.', [])
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /no citations/i);
});

test('an honest empty answer is recorded as searched but not found', async () => {
  const result = await fetchTeamNews(
    context({ injuries: { state: 'empty', count: 0 } }),
    ENV,
    async () => reply('NO_INTEL')
  );

  assert.equal(result.searched, true);
  assert.equal(result.ok, true);
  assert.equal(result.found, false);
  assert.equal(result.summary, undefined);
});

test('a failed search never throws into the prediction', async () => {
  const http = await fetchTeamNews(context({ injuries: { state: 'empty' } }), ENV, async () => ({
    ok: false, status: 429, text: async () => JSON.stringify({ error: { message: 'rate limit exceeded' } })
  }));
  assert.equal(http.ok, false);
  assert.match(http.error, /rate limit/);

  const garbled = await fetchTeamNews(context({ injuries: { state: 'empty' } }), ENV, async () => ({
    ok: false, status: 502, text: async () => '<html>bad gateway</html>'
  }));
  assert.match(garbled.error, /non-JSON response \(502\)/);

  const thrown = await fetchTeamNews(context({ injuries: { state: 'empty' } }), ENV, async () => {
    throw new Error('socket hang up');
  });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.error, 'socket hang up');
});

test('only a cited finding reaches the prompt, and it is labelled unverified', () => {
  assert.equal(teamNewsPromptSummary(null), null);
  assert.equal(teamNewsPromptSummary({ ok: false, error: 'x' }), null);
  assert.equal(teamNewsPromptSummary({ ok: true, found: false }), null);

  const summary = teamNewsPromptSummary({
    ok: true, found: true, summary: 'Ndidi injured', citations: ['https://x.com/a']
  });
  assert.match(summary.note, /Unverified/);
  assert.match(summary.note, /never let it override the market/);
  assert.deepEqual(summary.citations, ['https://x.com/a']);
});
