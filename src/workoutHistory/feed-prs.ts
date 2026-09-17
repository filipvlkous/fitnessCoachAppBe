export interface PrWorkout {
  log_id: string;
  user_id: string;
  /** When the workout was started (`workout_logs.created_at`). */
  started_at: string;
}

export interface PrSet {
  workout_log_id: string;
  user_id: string;
  /** Start of the workout this set belongs to. */
  started_at: string;
  exercises_id: string;
  weight: number;
}

/**
 * How many weight PRs each workout set, keyed by log id.
 *
 * An exercise counts once per workout when the heaviest weight lifted on it
 * beats every weight the same athlete logged for it in a workout started
 * earlier. The first time an athlete does an exercise is not a PR — there is
 * nothing to beat — and sets without a weight never count.
 *
 * `sets` is every weighted set of these athletes on these exercises, the
 * workouts' own sets included.
 */
export function countWeightPrs(
  workouts: PrWorkout[],
  sets: PrSet[],
): Map<string, number> {
  const byAthleteExercise = new Map<string, PrSet[]>();
  for (const set of sets) {
    if (!(set.weight > 0)) continue;
    const key = `${set.user_id}|${set.exercises_id}`;
    const list = byAthleteExercise.get(key) ?? [];
    list.push(set);
    byAthleteExercise.set(key, list);
  }

  const counts = new Map<string, number>();
  for (const workout of workouts) {
    const startedAt = Date.parse(workout.started_at);
    const topByExercise = new Map<string, number>();
    for (const set of sets) {
      if (set.workout_log_id !== workout.log_id || !(set.weight > 0)) continue;
      const top = topByExercise.get(set.exercises_id) ?? 0;
      topByExercise.set(set.exercises_id, Math.max(top, set.weight));
    }

    let prs = 0;
    for (const [exerciseId, top] of topByExercise) {
      const earlier = (
        byAthleteExercise.get(`${workout.user_id}|${exerciseId}`) ?? []
      ).filter(
        (set) =>
          set.workout_log_id !== workout.log_id &&
          Date.parse(set.started_at) < startedAt,
      );
      if (earlier.length === 0) continue;
      if (top > Math.max(...earlier.map((set) => set.weight))) prs += 1;
    }
    counts.set(workout.log_id, prs);
  }
  return counts;
}
