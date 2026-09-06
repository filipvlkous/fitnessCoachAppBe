import { pickWinners, ScoredEntry } from './leaderboard.awards';

const entry = (
  userId: string,
  workouts: number,
  workoutStreak: number,
  foodStreak: number,
): ScoredEntry => ({ userId, workouts, workoutStreak, foodStreak });

/**
 * A badge is permanent, so the cases that must never regress are the ones about
 * awarding something nobody earned: a board of zeros, a group with nobody to
 * compete against, and a tie broken silently in someone's favour.
 */
describe('pickWinners', () => {
  it('awards the top of each board', () => {
    const wins = pickWinners([
      entry('a', 20, 4, 9),
      entry('b', 12, 11, 3),
      entry('c', 3, 2, 25),
    ]);

    expect(wins).toEqual([
      { userId: 'a', category: 'workouts', value: 20 },
      { userId: 'b', category: 'workoutStreak', value: 11 },
      { userId: 'c', category: 'foodStreak', value: 25 },
    ]);
  });

  it('lets one athlete win more than one board', () => {
    const wins = pickWinners([entry('a', 20, 9, 30), entry('b', 1, 1, 1)]);

    expect(wins.filter((w) => w.userId === 'a')).toHaveLength(3);
    expect(wins.filter((w) => w.userId === 'b')).toHaveLength(0);
  });

  it('awards every athlete tied at the top', () => {
    const wins = pickWinners([
      entry('a', 18, 1, 1),
      entry('b', 18, 2, 1),
      entry('c', 4, 1, 1),
    ]);

    const workoutWinners = wins
      .filter((w) => w.category === 'workouts')
      .map((w) => w.userId);

    expect(workoutWinners).toEqual(['a', 'b']);
  });

  it('awards nothing on a board the whole group scored zero on', () => {
    const wins = pickWinners([entry('a', 5, 2, 0), entry('b', 3, 1, 0)]);

    expect(wins.some((w) => w.category === 'foodStreak')).toBe(false);
    expect(wins).toHaveLength(2);
  });

  it('awards nothing at all in a month nobody logged anything', () => {
    expect(pickWinners([entry('a', 0, 0, 0), entry('b', 0, 0, 0)])).toEqual([]);
  });

  it('is not a contest with one athlete, however much they trained', () => {
    expect(pickWinners([entry('a', 40, 20, 30)])).toEqual([]);
  });

  it('is not a contest with nobody in it', () => {
    expect(pickWinners([])).toEqual([]);
  });
});
