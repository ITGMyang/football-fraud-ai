// Fills in final scores so accuracy has something to score against.
//
// Nothing did this on a schedule before. The only writer was an endpoint the profile
// page called, which read one account's twenty most recent fixtures - so a match was
// only ever settled if the person who happened to import it came back and opened that
// page. Everything else stayed unscored for good, and the accuracy figures were quietly
// computed over whichever matches had been lucky.
//
// The scores come from the schedule cache the cron already refreshes, including the
// history date it backfills, so this costs no provider request at all.

import { filterApiFootballSchedules } from './api-football-cache.js';
import { fetchApiFootballScore } from './api-football.js';
import { isLikelyFinished, SETTLE_DELAY_MS } from './evaluation.js';

// Written in one request, so this is a cap on rows rather than on subrequests.
const MAX_PER_RUN = 200;

// Each of these is one provider request and one subrequest, inside a Worker that gets
// fifty for everything it does. Few per run is enough: they only exist for fixtures the
// free path could not settle, and the cron comes round every twenty minutes.
const MAX_DIRECT_LOOKUPS = 5;

// Long enough that the schedule cache has had several chances at the date. Asking the
// provider before that spends a request on something about to arrive for nothing.
const DIRECT_LOOKUP_AFTER_MS = 12 * 60 * 60 * 1000;

export function scoresFromSchedules(schedules = []) {
  const scores = new Map();
  for (const schedule of filterApiFootballSchedules(schedules)) {
    for (const match of schedule.matches || []) {
      const id = String(match.matchId || match.id || '');
      const score = String(match.score || '').trim();
      if (id && score) scores.set(id, score);
    }
  }
  return scores;
}

export function contextsNeedingResult(entries = [], scores = new Map(), now = Date.now()) {
  const filled = [];
  for (const entry of entries) {
    const context = entry?.context;
    if (!context) continue;
    if (String(context.actualScore || '').trim()) continue;
    if (!isLikelyFinished(context, now)) continue;
    const score = scores.get(String(context.matchId || context.id || ''));
    if (!score) continue;
    filled.push({ ownerId: entry.ownerId || 'guest', context: { ...context, actualScore: score } });
    if (filled.length >= MAX_PER_RUN) break;
  }
  return filled;
}

// Fixtures the schedule cache still cannot score, oldest first: those are the ones it
// is never going to reach, because its window only goes back a few days.
export function stuckWithoutResult(entries = [], filled = [], now = Date.now()) {
  const settledIds = new Set(filled.map((entry) => String(entry.context.matchId || entry.context.id || '')));
  return entries
    .filter((entry) => entry?.context && !String(entry.context.actualScore || '').trim())
    .filter((entry) => !settledIds.has(String(entry.context.matchId || entry.context.id || '')))
    .filter((entry) => {
      const kickoff = Date.parse(entry.context.kickoff || '');
      return Number.isFinite(kickoff) && now - kickoff > DIRECT_LOOKUP_AFTER_MS;
    })
    .sort((left, right) => Date.parse(left.context.kickoff) - Date.parse(right.context.kickoff));
}

export async function backfillMatchResults(storage, now = Date.now(), options = {}, fetchImpl = fetch) {
  const before = new Date(now - SETTLE_DELAY_MS).toISOString();
  const [entries, schedules] = await Promise.all([
    storage.listContextsAwaitingResult(before),
    storage.listMatchSchedules()
  ]);
  const filled = contextsNeedingResult(entries, scoresFromSchedules(schedules), now);

  // Second pass, only for what the free path left behind.
  const stuck = stuckWithoutResult(entries, filled, now).slice(0, MAX_DIRECT_LOOKUPS);
  const looked = [];
  const lookupErrors = [];
  for (const entry of stuck) {
    const fixtureId = String(entry.context.matchId || entry.context.id || '');
    try {
      const score = await fetchApiFootballScore(fixtureId, options, fetchImpl);
      if (score) looked.push({ ownerId: entry.ownerId || 'guest', context: { ...entry.context, actualScore: score } });
    } catch (error) {
      lookupErrors.push({ fixtureId, error: error.message });
    }
  }

  const written = [...filled, ...looked];
  if (written.length) await storage.upsertMatchContexts(written);
  return {
    checked: entries.length,
    filled: filled.length,
    lookedUp: looked.length,
    lookupErrors,
    // Fixtures past their settle time that neither path could score. A number that
    // keeps climbing is the one worth looking at.
    unresolved: entries.filter((entry) => !String(entry?.context?.actualScore || '').trim()).length - written.length
  };
}
