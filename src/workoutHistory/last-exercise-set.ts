export interface LoggedSet {
  workout_log_id: string;
  /** `workout_logs.workout_date` of the workout this set belongs to. */
  workout_date: string;
  weight: number | null;
  reps: number | null;
}

export interface LastExerciseSet {
  date: string; // "YYYY-MM-DD"
  weight: number;
  reps: number;
  sets: number;
  bodyweight: boolean;
}

/**
 * The best set of the most recent workout in `sets`, or null when there are
 * none. `sets` must be newest first; the workout of the first one counts.
 *
 * "Best" matches the month progress: heaviest weight, tie-broken by reps. A
 * workout without any weight is bodyweight and reports its most reps instead.
 */
export function pickLastExerciseSet(sets: LoggedSet[]): LastExerciseSet | null {
  const latest = sets[0];
  if (!latest) return null;

  const workout = sets.filter(
    (s) => s.workout_log_id === latest.workout_log_id,
  );

  let bestWeight = 0;
  let bestReps = 0;
  let topReps = 0;
  for (const set of workout) {
    const weight = set.weight ?? 0;
    const reps = set.reps ?? 0;
    topReps = Math.max(topReps, reps);
    if (weight > bestWeight || (weight === bestWeight && reps > bestReps)) {
      bestWeight = weight;
      bestReps = reps;
    }
  }

  const bodyweight = bestWeight === 0;
  return {
    date: latest.workout_date.split('T')[0],
    weight: bestWeight,
    reps: bodyweight ? topReps : bestReps,
    sets: workout.length,
    bodyweight,
  };
}
