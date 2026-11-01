import { LoggedSet, pickLastExerciseSet } from './last-exercise-set';

const set = (
  workout_log_id: string,
  workout_date: string,
  weight: number | null,
  reps: number | null,
): LoggedSet => ({ workout_log_id, workout_date, weight, reps });

describe('pickLastExerciseSet', () => {
  it('returns null when the exercise was never logged', () => {
    expect(pickLastExerciseSet([])).toBeNull();
  });

  it('takes the best set of the newest workout only', () => {
    expect(
      pickLastExerciseSet([
        set('new', '2026-03-02', 60, 8),
        set('new', '2026-03-02', 62.5, 5),
        set('new', '2026-03-02', 62.5, 6),
        set('old', '2026-02-20', 80, 3),
      ]),
    ).toEqual({
      date: '2026-03-02',
      weight: 62.5,
      reps: 6,
      sets: 3,
      bodyweight: false,
    });
  });

  it('reports most reps for a workout without weight', () => {
    expect(
      pickLastExerciseSet([
        set('w', '2026-03-02T00:00:00', null, 10),
        set('w', '2026-03-02T00:00:00', 0, 12),
      ]),
    ).toEqual({
      date: '2026-03-02',
      weight: 0,
      reps: 12,
      sets: 2,
      bodyweight: true,
    });
  });
});
