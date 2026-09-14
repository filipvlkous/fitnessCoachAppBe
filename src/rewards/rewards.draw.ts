/**
 * Dealing the winners of a closed month.
 *
 * Pure and dependency-free so it can be tested on its own, the way
 * `leaderboard.awards` is. This one hands out things that cost money, so it
 * also has to be *repeatable*: given the same entrants and the same seed it
 * must deal the same winners, months later, on another machine. That is what
 * makes a complaint answerable with something better than "trust the job".
 */

export interface Entrant {
  userId: string;
  /** Weight in the draw. More regular months are more tickets. */
  tickets: number;
}

/**
 * A seeded generator, so the draw is reproducible. `Math.random` cannot be
 * replayed and is therefore not usable here at all.
 */
function mulberry32(state: number): () => number {
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a: a seed string to the generator's 32 bits. */
function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

/**
 * Who wins, in the order they were drawn, at most `prizes` of them.
 *
 * Weighted without replacement: an entrant's chance is their share of all the
 * tickets in the pool, and nobody wins twice in one month.
 *
 * The entrants are sorted by id first. Without that the result would depend on
 * the order the database happened to return rows in, and a draw that cannot be
 * dealt again is not one that can be checked.
 */
export function drawWinners(
  entrants: Entrant[],
  prizes: number,
  seed: string,
): string[] {
  const pool = entrants
    .filter((entrant) => entrant.tickets > 0)
    .sort((a, b) => a.userId.localeCompare(b.userId));

  if (prizes <= 0 || pool.length === 0) return [];

  const random = mulberry32(hashSeed(seed));
  const winners: string[] = [];

  let remaining = pool;
  let total = remaining.reduce((sum, entrant) => sum + entrant.tickets, 0);

  while (winners.length < prizes && remaining.length > 0) {
    let point = random() * total;
    let index = remaining.length - 1;

    for (let i = 0; i < remaining.length; i += 1) {
      point -= remaining[i].tickets;
      if (point < 0) {
        index = i;
        break;
      }
    }

    const winner = remaining[index];
    winners.push(winner.userId);
    total -= winner.tickets;
    remaining = remaining.filter((_, i) => i !== index);
  }

  return winners;
}
