/**
 * Picking the winners of a closed month.
 *
 * Pure and dependency-free so it can be tested on its own, the way
 * `retention.scoring` and `leaderboard.streak` are. This decides what somebody
 * keeps for good, so it is the part worth pinning down in tests.
 */

export const CATEGORIES = ['workouts', 'workoutStreak', 'foodStreak'] as const;

export type LeaderboardCategory = (typeof CATEGORIES)[number];

/** The counts shown beside a name on the board. */
export type WinCounts = Record<LeaderboardCategory, number>;

/** Only the part of a scored month a winner is picked from. */
export interface ScoredEntry {
  userId: string;
  workouts: number;
  workoutStreak: number;
  foodStreak: number;
}

export interface Win {
  userId: string;
  category: LeaderboardCategory;
  value: number;
}

export const emptyWinCounts = (): WinCounts => ({
  workouts: 0,
  workoutStreak: 0,
  foodStreak: 0,
});

/**
 * The winners of each board, for a month that has closed.
 *
 * Ties all win. The board already ranks a tie as a shared first place, and
 * splitting two people level on 18 workouts by name would hand a permanent
 * badge to whoever's parents picked the earlier letter.
 */
export function pickWinners(entries: ScoredEntry[]): Win[] {
  const wins: Win[] = [];

  for (const category of CATEGORIES) {
    // A zero is not on the board at all, the same way the client leaves it off
    // the list. Nobody wins a board nobody scored on, rather than crowning
    // whoever happens to sort first on zero.
    const scored = entries.filter((entry) => entry[category] > 0);

    // A board of one is not a contest — the same reason the client hides the
    // board below two participants.
    if (scored.length < 2) continue;

    const best = Math.max(...scored.map((entry) => entry[category]));

    for (const entry of scored) {
      if (entry[category] === best) {
        wins.push({ userId: entry.userId, category, value: best });
      }
    }
  }

  return wins;
}
