/**
 * Longest run of consecutive calendar days in the set.
 *
 * Clipping to the month is the caller's job and happens by construction: only
 * days inside the month are ever put in, so a run that started in the last week
 * of August is worth whatever it is worth in September. That is the point of a
 * monthly contest — everyone starts level on the 1st.
 *
 * Pure and dependency-free so it can be tested on its own, the way
 * `retention.scoring` is.
 */
export function longestStreak(days: Iterable<string>): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let previous: number | null = null;

  for (const day of sorted) {
    const index = Date.parse(`${day}T00:00:00Z`) / 86_400_000;
    run = previous !== null && index - previous === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = index;
  }

  return best;
}
