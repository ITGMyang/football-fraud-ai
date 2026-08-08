import test from 'node:test';
import assert from 'node:assert/strict';
import { backfillMatchResults, contextsNeedingResult, scoresFromSchedules } from '../src/result-backfill.js';

const NOW = Date.parse('2026-08-08T12:00:00Z');
const hoursAgo = (hours) => new Date(NOW - hours * 60 * 60 * 1000).toISOString();

test('scores are read from the schedule cache, which the cron already refreshes', () => {
  const scores = scoresFromSchedules([
    { source: 'api-football', competitionId: '39', matches: [{ matchId: '1', score: '2:1' }, { matchId: '2', score: '' }] },
    { source: 'api-football', competitionId: '140', matches: [{ id: '3', score: '0:0' }] },
    { source: 'dongqiudi', competitionId: '39', matches: [{ matchId: '4', score: '9:9' }] }
  ]);

  // No provider request is spent: the schedule already carries the final score, and the
  // refresh backfills a history date for exactly this reason.
  assert.equal(scores.get('1'), '2:1');
  assert.equal(scores.get('3'), '0:0');
  assert.equal(scores.has('2'), false, 'a fixture with no score yet is not settled');
  assert.equal(scores.has('4'), false, 'only api-football schedules are trusted');
});

test('a fixture is only settled once it has had time to finish', () => {
  const scores = new Map([['a', '1:0'], ['b', '2:2'], ['c', '3:1']]);
  const filled = contextsNeedingResult([
    { ownerId: 'u1', context: { id: 'a', matchId: 'a', kickoff: hoursAgo(5) } },
    { ownerId: 'u2', context: { id: 'b', matchId: 'b', kickoff: hoursAgo(1) } },
    { ownerId: 'u3', context: { id: 'c', matchId: 'c', kickoff: hoursAgo(9), actualScore: '0:0' } }
  ], scores, NOW);

  // A score read an hour after kickoff would be stored as final, which is worse than
  // reading it late.
  assert.deepEqual(filled.map((entry) => entry.context.matchId), ['a']);
  assert.equal(filled[0].context.actualScore, '1:0');
  assert.equal(filled[0].ownerId, 'u1', 'the row stays with whoever imported it');
});

test('a fixture nobody can score yet is left alone rather than guessed at', () => {
  const filled = contextsNeedingResult(
    [{ ownerId: 'u1', context: { id: 'x', matchId: 'x', kickoff: hoursAgo(6) } }],
    new Map(),
    NOW
  );
  assert.deepEqual(filled, []);
});

test('the backfill covers every account, and writes them in one request', async () => {
  const writes = [];
  const storage = {
    listContextsAwaitingResult: async () => [
      { ownerId: 'u1', context: { id: 'a', matchId: 'a', kickoff: hoursAgo(6) } },
      { ownerId: 'u2', context: { id: 'b', matchId: 'b', kickoff: hoursAgo(6) } },
      { ownerId: 'u3', context: { id: 'c', matchId: 'c', kickoff: hoursAgo(6) } }
    ],
    listMatchSchedules: async () => [
      { source: 'api-football', competitionId: '39', matches: [{ matchId: 'a', score: '1:0' }, { matchId: 'b', score: '2:2' }] }
    ],
    upsertMatchContexts: async (entries) => { writes.push(entries); return entries; }
  };

  const result = await backfillMatchResults(storage, NOW);

  // The old backfill saw one account's twenty most recent fixtures, and only when that
  // person opened their profile page. Everything else stayed unscored for good.
  assert.equal(result.filled, 2);
  assert.equal(result.checked, 3);
  assert.equal(result.unresolved, 1, 'a fixture the schedule cannot score is reported, not hidden');
  assert.equal(writes.length, 1, 'one request, because a Worker gets fifty subrequests in all');
  assert.deepEqual(writes[0].map((entry) => entry.ownerId), ['u1', 'u2']);
});

test('a run with nothing to settle writes nothing', async () => {
  let wrote = false;
  const result = await backfillMatchResults({
    listContextsAwaitingResult: async () => [],
    listMatchSchedules: async () => [],
    upsertMatchContexts: async () => { wrote = true; }
  }, NOW);

  assert.equal(result.filled, 0);
  assert.equal(wrote, false);
});

test('a kickoff that states its offset is read at that offset', async () => {
  const { isLikelyFinished } = await import('../src/evaluation.js');
  const now = Date.parse('2026-08-08T12:00:00Z');

  // Every timestamp used to be rewritten to +08:00, so a UTC kickoff read as eight
  // hours earlier than it was: a match still being played looked long finished, and
  // the score read at that moment would have been stored as final.
  assert.equal(isLikelyFinished({ kickoff: '2026-08-08T11:00:00.000Z' }, now), false);
  assert.equal(isLikelyFinished({ kickoff: '2026-08-08T19:00:00+08:00' }, now), false);
  assert.equal(isLikelyFinished({ kickoff: '2026-08-08T07:00:00.000Z' }, now), true);
  // A bare timestamp carries no offset and is Shanghai time, as it always was.
  assert.equal(isLikelyFinished({ kickoff: '2026-08-08 12:00' }, now), true);
  assert.equal(isLikelyFinished({ kickoff: '2026-08-08 21:00' }, now), false);
  // The provider's own wording still settles it whatever the clock says.
  assert.equal(isLikelyFinished({ kickoff: '2026-08-08T11:30:00Z', status: 'Match Finished' }, now), true);
});

test('a fixture the schedule cannot reach is looked up directly', async () => {
  const dayAgo = new Date(NOW - 30 * 60 * 60 * 1000).toISOString();
  const requests = [];
  const writes = [];
  const storage = {
    listContextsAwaitingResult: async () => [
      { ownerId: 'u1', context: { id: 'covered', matchId: 'covered', kickoff: hoursAgo(6) } },
      { ownerId: 'u2', context: { id: 'stuck', matchId: 'stuck', kickoff: dayAgo } }
    ],
    listMatchSchedules: async () => [
      { source: 'api-football', competitionId: '39', matches: [{ matchId: 'covered', score: '1:0' }] }
    ],
    upsertMatchContexts: async (entries) => { writes.push(entries); return entries; }
  };

  const result = await backfillMatchResults(storage, NOW, { apiKey: 'k' }, async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({
      response: [{ fixture: { status: { short: 'FT' } }, goals: { home: 2, away: 2 } }]
    }), { headers: { 'Content-Type': 'application/json' } });
  });

  // The schedule cache covers a few days and the configured leagues. Anything outside
  // that was waiting for a score that was never coming.
  assert.equal(result.filled, 1, 'the free path settles what it can');
  assert.equal(result.lookedUp, 1);
  assert.equal(requests.length, 1, 'only the fixture the cache could not reach');
  assert.match(requests[0], /id=stuck/);
  assert.equal(result.unresolved, 0);
  assert.deepEqual(writes[0].map((entry) => entry.context.actualScore), ['1:0', '2:2']);
});

test('a fixture still being played is not looked up, and a lookup failure is reported', async () => {
  const dayAgo = new Date(NOW - 30 * 60 * 60 * 1000).toISOString();
  const storage = {
    listContextsAwaitingResult: async () => [
      { ownerId: 'u1', context: { id: 'recent', matchId: 'recent', kickoff: hoursAgo(6) } },
      { ownerId: 'u2', context: { id: 'old', matchId: 'old', kickoff: dayAgo } }
    ],
    listMatchSchedules: async () => [],
    upsertMatchContexts: async () => []
  };

  const result = await backfillMatchResults(storage, NOW, {}, async () => { throw new Error('provider down'); });

  // Six hours in, the schedule cache still has chances left; spending a request there
  // would pay for something about to arrive free.
  assert.equal(result.lookedUp, 0);
  assert.equal(result.lookupErrors.length, 1);
  assert.equal(result.lookupErrors[0].fixtureId, 'old');
  assert.equal(result.unresolved, 2, 'nothing settled is reported as still waiting');
});

test('an unfinished fixture returns no score rather than a running one', async () => {
  const { fetchApiFootballScore } = await import('../src/api-football.js');
  const reply = (body) => async () => new Response(JSON.stringify({ response: [body] }), { headers: { 'Content-Type': 'application/json' } });

  assert.equal(await fetchApiFootballScore('1', { apiKey: 'k' }, reply({ fixture: { status: { short: 'FT' } }, goals: { home: 1, away: 0 } })), '1:0');
  assert.equal(await fetchApiFootballScore('1', { apiKey: 'k' }, reply({ fixture: { status: { short: 'AET' } }, goals: { home: 2, away: 1 } })), '2:1');
  // A half-time score stored as final is the failure the whole settle delay exists for.
  assert.equal(await fetchApiFootballScore('1', { apiKey: 'k' }, reply({ fixture: { status: { short: 'HT' } }, goals: { home: 1, away: 0 } })), '');
  assert.equal(await fetchApiFootballScore('1', { apiKey: 'k' }, reply({ fixture: { status: { short: 'NS' } }, goals: { home: null, away: null } })), '');
});
