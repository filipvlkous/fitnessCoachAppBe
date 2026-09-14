/**
 * Turning a month of logs into an entry in the draw.
 *
 * Pure and dependency-free, like `rewards.draw`: how many tickets a month was
 * worth is the other half of what a disputed draw has to be able to show.
 */

/**
 * Days with a completed workout needed to enter at all.
 *
 * The whole premise is that regular training is the ticket, so the bar sits at
 * roughly every third day. It is the one number here worth arguing about; it is
 * deliberately the only place to change it.
 */
export const MIN_WORKOUT_DAYS = 10;

export interface Entry {
  /** Days with at least one completed workout. */
  workoutDays: number;
  /** Weight in the draw. */
  tickets: number;
  /** Whether the month is in the draw at all. */
  qualified: boolean;
}

/**
 * One athlete's month.
 *
 * A day trained is a ticket; a day trained *and* eaten to is two. Food alone is
 * worth nothing — logging a meal takes ten seconds, and a bar that can be
 * cleared from the sofa is not a bar. It rides along with training instead,
 * where it costs something to reach.
 */
export function countEntry(
  workoutDays: Iterable<string>,
  mealDays: Iterable<string>,
): Entry {
  const trained = new Set(workoutDays);
  const ate = new Set(mealDays);

  let both = 0;
  for (const day of trained) {
    if (ate.has(day)) both += 1;
  }

  return {
    workoutDays: trained.size,
    tickets: trained.size + both,
    qualified: trained.size >= MIN_WORKOUT_DAYS,
  };
}
