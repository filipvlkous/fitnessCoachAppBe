import { countWeightPrs, PrSet, PrWorkout } from './feed-prs';

const workout = (log_id: string, started_at: string): PrWorkout => ({
  log_id,
  user_id: 'u1',
  started_at,
});

const set = (
  workout_log_id: string,
  started_at: string,
  exercises_id: string,
  weight: number,
  user_id = 'u1',
): PrSet => ({ workout_log_id, user_id, started_at, exercises_id, weight });

const MON = '2026-09-14T09:00:00+00:00';
const TUE = '2026-09-15T09:00:00+00:00';
const WED = '2026-09-16T09:00:00+00:00';

describe('countWeightPrs', () => {
  it('counts an exercise whose top weight beats every earlier one', () => {
    const counts = countWeightPrs(
      [workout('tue', TUE)],
      [
        set('mon', MON, 'bench', 80),
        set('mon', MON, 'bench', 90),
        set('tue', TUE, 'bench', 85),
        set('tue', TUE, 'bench', 95),
      ],
    );
    expect(counts.get('tue')).toBe(1);
  });

  it('does not count matching the earlier best', () => {
    const counts = countWeightPrs(
      [workout('tue', TUE)],
      [set('mon', MON, 'bench', 90), set('tue', TUE, 'bench', 90)],
    );
    expect(counts.get('tue')).toBe(0);
  });

  it('does not count the first time an exercise is done', () => {
    const counts = countWeightPrs(
      [workout('tue', TUE)],
      [set('tue', TUE, 'bench', 100)],
    );
    expect(counts.get('tue')).toBe(0);
  });

  it('ignores later workouts and other athletes', () => {
    const counts = countWeightPrs(
      [workout('tue', TUE)],
      [
        set('mon', MON, 'bench', 80),
        set('tue', TUE, 'bench', 90),
        set('wed', WED, 'bench', 120),
        set('other', MON, 'bench', 150, 'u2'),
      ],
    );
    expect(counts.get('tue')).toBe(1);
  });

  it('counts each exercise once and skips weightless sets', () => {
    const counts = countWeightPrs(
      [workout('tue', TUE)],
      [
        set('mon', MON, 'bench', 80),
        set('mon', MON, 'squat', 100),
        set('mon', MON, 'pullup', 0),
        set('tue', TUE, 'bench', 85),
        set('tue', TUE, 'bench', 87.5),
        set('tue', TUE, 'squat', 110),
        set('tue', TUE, 'pullup', 0),
      ],
    );
    expect(counts.get('tue')).toBe(2);
  });
});
