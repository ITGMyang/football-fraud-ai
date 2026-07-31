import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchTeamNews, findDataGaps, newsConfig, teamNewsPromptSummary } from '../src/team-news.js';

const ENV = { XAI_API_KEY: 'xai-test' };

const NOW = Date.parse('2026-07-30T16:00:00Z');
const COVERED = {
  injuries: { state: 'available', count: 6 },
  standings: { state: 'available', count: 20 },
  lineups: { state: 'available', count: 36 }
};

function context(fetchStatus) {
  return {
    fixture: { home: { name: 'FC Midtjylland' }, away: { name: 'Beşiktaş' } },
    kickoff: '2026-07-30T17:00:00Z',
    fetchStatus: { ...COVERED, ...fetchStatus }
  };
}

const fields = (gaps) => gaps.map((gap) => gap.field);

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

test('a field the provider covered is never searched for', () => {
  assert.deepEqual(findDataGaps(context({}), NOW), []);
});

test('each empty or failed field becomes its own gap', () => {
  assert.deepEqual(fields(findDataGaps(context({ injuries: { state: 'empty', count: 0 } }), NOW)), ['injuries']);
  assert.deepEqual(fields(findDataGaps(context({ standings: { state: 'empty', count: 0 } }), NOW)), ['standings']);

  const both = findDataGaps(context({ injuries: { state: 'error', error: 'rate limited' }, standings: { state: 'empty' } }), NOW);
  assert.deepEqual(fields(both), ['injuries', 'standings']);
  assert.match(both[0].reason, /rate limited/);

  // A context with no fetchStatus at all is all gaps within the lineup window.
  assert.deepEqual(fields(findDataGaps({ kickoff: '2026-07-30T17:00:00Z' }, NOW)), ['injuries', 'lineups', 'standings']);
});

// Lineups are absent on every fixture until close to kickoff, so their absence far
// out is expected and searching would only return speculation.
test('lineups are only searched for inside the window where they exist', () => {
  const gap = { lineups: { state: 'empty', count: 0 } };
  const threeDaysOut = Date.parse('2026-07-27T17:00:00Z');

  assert.deepEqual(fields(findDataGaps(context(gap), threeDaysOut)), []);
  assert.deepEqual(fields(findDataGaps(context(gap), NOW)), ['lineups']);
  // After kickoff there is nothing left to leak.
  assert.deepEqual(fields(findDataGaps(context(gap), Date.parse('2026-07-30T18:00:00Z'))), []);
});

// teamStatistics is the only field feeding the maths, so a searched goal count could
// produce a confident, wrong lambda that nothing downstream would catch.
test('the fields that feed the maths and the post-match fields are never searched', () => {
  const noise = {
    teamStatistics: { state: 'empty', count: 0 },
    fixtureStatistics: { state: 'empty', count: 0 },
    playerStatistics: { state: 'empty', count: 0 },
    events: { state: 'empty', count: 0 },
    topScorers: { state: 'empty', count: 0 },
    squads: { state: 'empty', count: 0 },
    coaches: { state: 'empty', count: 0 }
  };
  assert.deepEqual(findDataGaps(context(noise), NOW), []);
});

test('a fixture the provider covered costs nothing', async () => {
  let called = false;
  const result = await fetchTeamNews(context({}), ENV, async () => { called = true; }, NOW);

  assert.equal(called, false);
  assert.equal(result.searched, false);
  assert.match(result.reason, /covered every field/);
});

test('search is skipped when it is unconfigured or switched off', async () => {
  const gap = context({ injuries: { state: 'empty', count: 0 } });

  assert.match(newsConfig({}).reason, /XAI_API_KEY/);
  assert.equal((await fetchTeamNews(gap, {}, async () => { throw new Error('must not call'); }, NOW)).searched, false);

  const off = await fetchTeamNews(gap, { ...ENV, TEAM_NEWS_SEARCH_ENABLED: 'false' }, async () => { throw new Error('must not call'); }, NOW);
  assert.equal(off.searched, false);
  assert.match(off.reason, /TEAM_NEWS_SEARCH_ENABLED/);
});

test('every gap is covered by one request, not one request per gap', async () => {
  const requests = [];
  const gaps = context({ injuries: { state: 'empty' }, standings: { state: 'empty' }, lineups: { state: 'empty' } });
  await fetchTeamNews(gaps, ENV, async (url, options) => {
    requests.push({ url: String(url), headers: options.headers, body: JSON.parse(options.body) });
    return reply('Beşiktaş: Ndidi injured, Uduokhai suspended.');
  }, NOW);

  assert.equal(requests.length, 1, 'cost must not grow with the number of gaps');
  const [request] = requests;
  assert.equal(request.url, 'https://api.x.ai/v1/responses');
  assert.equal(request.headers.Authorization, 'Bearer xai-test');
  assert.deepEqual(request.body.tools, [{ type: 'x_search' }, { type: 'web_search' }]);

  const asked = request.body.input[0].content;
  assert.match(asked, /FC Midtjylland vs Beşiktaş/);
  assert.match(asked, /last 48 hours/);
  assert.match(asked, /NO_INTEL/);
  assert.match(asked, /\(1\).*\(2\).*\(3\)/s, 'all three gaps must be numbered in the ask');
  // Season numbers stay out of scope; they feed the maths and are not searched.
  assert.match(asked, /do not report goal counts or season statistics/i);
});

test('findings are returned with their citations and token cost', async () => {
  const result = await fetchTeamNews(
    context({ injuries: { state: 'empty', count: 0 } }),
    ENV,
    async () => reply('Beşiktaş: Ndidi (injured), Uduokhai (suspended).', ['https://x.com/a', 'https://x.com/b']),
    NOW
  );

  assert.equal(result.ok, true);
  assert.equal(result.found, true);
  assert.match(result.summary, /Ndidi/);
  assert.deepEqual(result.citations, ['https://x.com/a', 'https://x.com/b']);
  assert.equal(result.usage.inputTokens, 7342);
  assert.deepEqual(result.fields, ['injuries']);
  assert.match(result.gapReason, /injuries: the provider returned nothing/);
});

// An uncited claim about a player's fitness is indistinguishable from a guess.
test('an uncited answer is rejected rather than passed on as evidence', async () => {
  const result = await fetchTeamNews(
    context({ injuries: { state: 'empty', count: 0 } }),
    ENV,
    async () => reply('Half the squad is out.', []),
    NOW
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /no citations/i);
});

test('an honest empty answer is recorded as searched but not found', async () => {
  const result = await fetchTeamNews(
    context({ injuries: { state: 'empty', count: 0 } }),
    ENV,
    async () => reply('NO_INTEL'),
    NOW
  );

  assert.equal(result.searched, true);
  assert.equal(result.ok, true);
  assert.equal(result.found, false);
  assert.equal(result.summary, undefined);
});

test('a failed search never throws into the prediction', async () => {
  const http = await fetchTeamNews(context({ injuries: { state: 'empty' } }), ENV, async () => ({
    ok: false, status: 429, text: async () => JSON.stringify({ error: { message: 'rate limit exceeded' } })
  }), NOW);
  assert.equal(http.ok, false);
  assert.match(http.error, /rate limit/);

  const garbled = await fetchTeamNews(context({ injuries: { state: 'empty' } }), ENV, async () => ({
    ok: false, status: 502, text: async () => '<html>bad gateway</html>'
  }), NOW);
  assert.match(garbled.error, /non-JSON response \(502\)/);

  const thrown = await fetchTeamNews(context({ injuries: { state: 'empty' } }), ENV, async () => {
    throw new Error('socket hang up');
  }, NOW);
  assert.equal(thrown.ok, false);
  assert.equal(thrown.error, 'socket hang up');
});

test('only a cited finding reaches the prompt, and it is labelled unverified', () => {
  assert.equal(teamNewsPromptSummary(null), null);
  assert.equal(teamNewsPromptSummary({ ok: false, error: 'x' }), null);
  assert.equal(teamNewsPromptSummary({ ok: true, found: false }), null);

  const summary = teamNewsPromptSummary({
    ok: true, found: true, summary: 'Ndidi injured', citations: ['https://x.com/a'], fields: ['injuries', 'standings']
  });
  assert.match(summary.source, /injuries, standings/);
  assert.match(summary.note, /Unverified/);
  assert.match(summary.note, /never let it override the market/);
  assert.deepEqual(summary.citations, ['https://x.com/a']);
});
