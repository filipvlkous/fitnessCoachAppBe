import {
  briefWindow,
  buildBriefFacts,
  BriefWorkoutRow,
  isEmptyBrief,
} from './meeting-brief.facts';

const DAY = 86_400_000;
const now = new Date('2026-10-07T12:00:00Z');

describe('briefWindow', () => {
  it('starts at the previous meeting', () => {
    const previous = new Date(now.getTime() - 10 * DAY);
    const { since, until } = briefWindow(
      new Date(now.getTime() + DAY),
      previous,
      now,
    );
    expect(since).toEqual(previous);
    expect(until).toEqual(now);
  });

  it('never reaches back more than four weeks', () => {
    const { since } = briefWindow(
      new Date(now.getTime() + DAY),
      new Date(now.getTime() - 90 * DAY),
      now,
    );
    expect(since).toEqual(new Date(now.getTime() - 28 * DAY));
  });

  it('covers two weeks before a first meeting', () => {
    const { since } = briefWindow(new Date(now.getTime() + DAY), null, now);
    expect(since).toEqual(new Date(now.getTime() - 14 * DAY));
  });

  it('ends at the meeting once it has started', () => {
    const startedAt = new Date(now.getTime() - 60_000);
    expect(briefWindow(startedAt, null, now).until).toEqual(startedAt);
  });
});

const window = {
  since: new Date('2026-09-23T12:00:00Z'),
  until: new Date('2026-10-07T12:00:00Z'),
};
const empty = {
  ...window,
  workouts: [],
  plannedPerWeek: 3,
  meals: [],
  targets: [],
  weights: [],
};

const session = (
  date: string,
  sets: [string, number | null, number][],
  rpe: number | null = null,
): BriefWorkoutRow => ({
  date,
  completed: true,
  dayName: 'Push',
  rpe,
  sets: sets.map(([name, weight, reps]) => ({
    exerciseId: name,
    name,
    weight,
    reps,
  })),
});

describe('buildBriefFacts', () => {
  it('compares the best set of the first and last session per lift', () => {
    const facts = buildBriefFacts({
      ...empty,
      workouts: [
        // Out of order on purpose: the first session is the earliest date.
        session('2026-10-01', [
          ['Bench', 82.5, 5],
          ['Bench', 80, 8],
        ]),
        session('2026-09-25', [
          ['Bench', 80, 5],
          ['Bench', 80, 6],
        ]),
        session('2026-09-28', [['Squat', 100, 5]]),
      ],
    });

    expect(facts.workouts?.lifts).toEqual([
      {
        name: 'Bench',
        sessions: 2,
        first: { weight: 80, reps: 6 },
        last: { weight: 82.5, reps: 5 },
      },
    ]);
  });

  it('averages only the rated sessions', () => {
    const facts = buildBriefFacts({
      ...empty,
      workouts: [
        session('2026-09-25', [], 7),
        session('2026-09-27', [], null),
        session('2026-09-29', [], 8),
      ],
    });
    expect(facts.workouts?.averageRpe).toBe(7.5);
    expect(facts.workouts?.started).toBe(3);
  });

  it('compares a mean logged day against the mean daily target', () => {
    const facts = buildBriefFacts({
      ...empty,
      meals: [
        { date: '2026-09-25', calories: 800, protein: 40 },
        { date: '2026-09-25', calories: 1200, protein: 60 },
        { date: '2026-09-26', calories: 1800, protein: 120 },
      ],
      targets: [
        { calories: 2000, protein: 150 },
        { calories: 2200, protein: 150 },
      ],
    });
    expect(facts.nutrition).toEqual({
      daysLogged: 2,
      averageCalories: 1900,
      averageProtein: 110,
      targetCalories: 2100,
      targetProtein: 150,
    });
  });

  it('keeps an unshared scope apart from an empty one', () => {
    const facts = buildBriefFacts({ ...empty, meals: null, weights: null });
    expect(facts.nutrition).toBeNull();
    expect(facts.weight).toBeNull();
    expect(facts.workouts?.started).toBe(0);
    expect(isEmptyBrief(facts)).toBe(true);
  });

  it('is not empty once anything shared was logged', () => {
    const facts = buildBriefFacts({
      ...empty,
      weights: [{ date: '2026-09-30', weight: 78.8 }],
    });
    expect(isEmptyBrief(facts)).toBe(false);
  });
});
