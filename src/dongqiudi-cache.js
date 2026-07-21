import { fetchDongqiudiMatches, todayInShanghai } from './dongqiudi-fetcher.js';
import { createSupabaseStorage } from './supabase-storage.js';

export const DEFAULT_DONGQIUDI_COMPETITIONS = [
  '125', '10', '5', '100', '101', '111', '105', '6',
  '7', '8', '9', '30', '31', '34', '98', '99'
];

export function configuredDongqiudiCompetitions(env = {}) {
  const configured = String(env.DONGQIUDI_COMPETITIONS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(configured.length ? configured : DEFAULT_DONGQIUDI_COMPETITIONS)];
}

export async function refreshDongqiudiScheduleCache(env, fetchImpl = fetch) {
  const workerFetch = (input, init) => fetchImpl(input, init);
  const storage = createSupabaseStorage(env, workerFetch);
  const refreshed = [];
  const errors = [];
  for (const competitionId of configuredDongqiudiCompetitions(env)) {
    try {
      const schedule = await fetchDongqiudiMatches({ competitionId, date: todayInShanghai() }, workerFetch);
      await storage.upsertMatchSchedules([schedule]);
      refreshed.push({ competitionId, matches: schedule.matches.length, fetchedAt: schedule.fetchedAt });
    } catch (error) {
      errors.push({ competitionId, error: error.message });
    }
  }
  return { refreshed, errors, attempted: refreshed.length + errors.length };
}
