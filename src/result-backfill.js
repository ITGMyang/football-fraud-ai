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

// A match is settled well before this, but a late kickoff, extra time and a delayed
// provider update all sit inside it, and a score read too early is worse than one read
// late: it would be stored as final.
const SETTLE_DELAY_MS = 3 * 60 * 60 * 1000;

// Written in one request, so this is a cap on rows rather than on subrequests.
const MAX_PER_RUN = 200;

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
  const settled = now - SETTLE_DELAY_MS;
  const filled = [];
  for (const entry of entries) {
    const context = entry?.context;
    if (!context) continue;
    if (String(context.actualScore || '').trim()) continue;
    const kickoff = Date.parse(context.kickoff || '');
    if (!Number.isFinite(kickoff) || kickoff > settled) continue;
    const score = scores.get(String(context.matchId || context.id || ''));
    if (!score) continue;
    filled.push({ ownerId: entry.ownerId || 'guest', context: { ...context, actualScore: score } });
    if (filled.length >= MAX_PER_RUN) break;
  }
  return filled;
}

export async function backfillMatchResults(storage, now = Date.now()) {
  const before = new Date(now - SETTLE_DELAY_MS).toISOString();
  const [entries, schedules] = await Promise.all([
    storage.listContextsAwaitingResult(before),
    storage.listMatchSchedules()
  ]);
  const filled = contextsNeedingResult(entries, scoresFromSchedules(schedules), now);
  if (filled.length) await storage.upsertMatchContexts(filled);
  return {
    checked: entries.length,
    filled: filled.length,
    // Fixtures past their settle time that the schedule cache cannot score. A number
    // that keeps climbing means the schedule no longer reaches back far enough.
    unresolved: entries.filter((entry) => !String(entry?.context?.actualScore || '').trim()).length - filled.length
  };
}
