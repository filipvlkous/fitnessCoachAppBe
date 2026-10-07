/**
 * The numbers behind a pre-meeting brief, computed without the model.
 *
 * The model only puts these into words, so everything a coach could check —
 * how many sessions, which lifts moved, how far the weight went — is decided
 * here, where it can be tested.
 */

const DAY_MS = 86_400_000;

/** A brief never looks further back than this, however long ago they met. */
export const MAX_WINDOW_DAYS = 28;
/** The window for a first meeting, when there is no previous one to start from. */
export const FIRST_MEETING_WINDOW_DAYS = 14;
/** At most this many lifts go to the model; more is a list, not a summary. */
const MAX_LIFTS = 5;

export interface BriefSet {
  exerciseId: string;
  name: string;
  weight: number | null;
  reps: number | null;
}

export interface BriefWorkoutRow {
  date: string; // YYYY-MM-DD
  completed: boolean;
  dayName: string | null;
  rpe: number | null;
  sets: BriefSet[];
}

export interface BriefMealRow {
  date: string; // YYYY-MM-DD
  calories: number;
  protein: number;
}

export interface BriefTargetRow {
  calories: number | null;
  protein: number | null;
}

export interface BriefWeightRow {
  date: string;
  weight: number;
}

interface TopSet {
  weight: number | null;
  reps: number | null;
}

export interface LiftProgress {
  name: string;
  sessions: number;
  first: TopSet;
  last: TopSet;
}

/**
 * What the coach is shown and the model is given. A section is `null` when
 * the client does not share that scope with the coach — not the same as a
 * section with zeros in it, which means they share it and logged nothing.
 */
export interface BriefFacts {
  since: string;
  until: string;
  days: number;
  workouts: {
    started: number;
    completed: number;
    plannedPerWeek: number | null;
    averageRpe: number | null;
    sessions: {
      date: string;
      dayName: string | null;
      completed: boolean;
      rpe: number | null;
    }[];
    lifts: LiftProgress[];
  } | null;
  nutrition: {
    daysLogged: number;
    averageCalories: number | null;
    averageProtein: number | null;
    targetCalories: number | null;
    targetProtein: number | null;
  } | null;
  weight: {
    entries: number;
    first: number | null;
    last: number | null;
  } | null;
}

/**
 * The stretch a brief covers: from the previous meeting with this client up to
 * now, or up to the meeting if it has already started.
 *
 * Capped at four weeks so a client seen once in spring does not get a brief
 * about their whole year, and two weeks for a first meeting.
 */
export function briefWindow(
  meetingStartsAt: Date,
  previousMeetingAt: Date | null,
  now: Date,
): { since: Date; until: Date } {
  const until = new Date(Math.min(now.getTime(), meetingStartsAt.getTime()));
  const earliest = until.getTime() - MAX_WINDOW_DAYS * DAY_MS;
  const since = previousMeetingAt
    ? new Date(Math.max(previousMeetingAt.getTime(), earliest))
    : new Date(until.getTime() - FIRST_MEETING_WINDOW_DAYS * DAY_MS);
  return { since, until };
}

export function buildBriefFacts(input: {
  since: Date;
  until: Date;
  workouts: BriefWorkoutRow[] | null;
  plannedPerWeek: number | null;
  meals: BriefMealRow[] | null;
  targets: BriefTargetRow[] | null;
  weights: BriefWeightRow[] | null;
}): BriefFacts {
  const { since, until } = input;
  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
    days: Math.max(1, Math.round((until.getTime() - since.getTime()) / DAY_MS)),
    workouts: input.workouts
      ? workoutFacts(input.workouts, input.plannedPerWeek)
      : null,
    nutrition: input.meals
      ? nutritionFacts(input.meals, input.targets ?? [])
      : null,
    weight: input.weights ? weightFacts(input.weights) : null,
  };
}

/** True when there is nothing in any shared section worth summarising. */
export function isEmptyBrief(facts: BriefFacts): boolean {
  return (
    (facts.workouts?.started ?? 0) === 0 &&
    (facts.nutrition?.daysLogged ?? 0) === 0 &&
    (facts.weight?.entries ?? 0) === 0
  );
}

function workoutFacts(
  rows: BriefWorkoutRow[],
  plannedPerWeek: number | null,
): NonNullable<BriefFacts['workouts']> {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const rated = sorted
    .map((row) => row.rpe)
    .filter((rpe): rpe is number => rpe != null);

  return {
    started: sorted.length,
    completed: sorted.filter((row) => row.completed).length,
    plannedPerWeek,
    averageRpe: rated.length > 0 ? round1(average(rated)) : null,
    sessions: sorted.map(({ date, dayName, completed, rpe }) => ({
      date,
      dayName,
      completed,
      rpe,
    })),
    lifts: liftProgress(sorted),
  };
}

/**
 * The best set of each exercise, first session against last.
 *
 * Only exercises done in at least two sessions: a single session has nothing
 * to compare with. The most often trained come first — those are the lifts the
 * plan is built around, and the ones a coach will ask about.
 */
function liftProgress(sorted: BriefWorkoutRow[]): LiftProgress[] {
  const byExercise = new Map<string, { name: string; tops: TopSet[] }>();

  for (const row of sorted) {
    const bestInSession = new Map<string, BriefSet>();
    for (const set of row.sets) {
      const best = bestInSession.get(set.exerciseId);
      if (!best || isBetter(set, best)) bestInSession.set(set.exerciseId, set);
    }
    for (const [id, set] of bestInSession) {
      const entry = byExercise.get(id) ?? { name: set.name, tops: [] };
      entry.tops.push({ weight: set.weight, reps: set.reps });
      byExercise.set(id, entry);
    }
  }

  return [...byExercise.values()]
    .filter((entry) => entry.tops.length >= 2)
    .sort((a, b) => b.tops.length - a.tops.length)
    .slice(0, MAX_LIFTS)
    .map(({ name, tops }) => ({
      name,
      sessions: tops.length,
      first: tops[0],
      last: tops[tops.length - 1],
    }));
}

// Heavier wins; at the same weight (or none, for bodyweight work) more reps.
function isBetter(a: TopSet, b: TopSet): boolean {
  const weightA = a.weight ?? 0;
  const weightB = b.weight ?? 0;
  if (weightA !== weightB) return weightA > weightB;
  return (a.reps ?? 0) > (b.reps ?? 0);
}

function nutritionFacts(
  meals: BriefMealRow[],
  targets: BriefTargetRow[],
): NonNullable<BriefFacts['nutrition']> {
  const perDay = new Map<string, { calories: number; protein: number }>();
  for (const meal of meals) {
    const day = perDay.get(meal.date) ?? { calories: 0, protein: 0 };
    day.calories += meal.calories;
    day.protein += meal.protein;
    perDay.set(meal.date, day);
  }
  const days = [...perDay.values()];

  // Targets are set per weekday; their mean is the daily goal to compare a
  // mean day against.
  const targetCalories = targets
    .map((t) => t.calories)
    .filter((v): v is number => v != null);
  const targetProtein = targets
    .map((t) => t.protein)
    .filter((v): v is number => v != null);

  return {
    daysLogged: days.length,
    averageCalories:
      days.length > 0 ? Math.round(average(days.map((d) => d.calories))) : null,
    averageProtein:
      days.length > 0 ? Math.round(average(days.map((d) => d.protein))) : null,
    targetCalories:
      targetCalories.length > 0 ? Math.round(average(targetCalories)) : null,
    targetProtein:
      targetProtein.length > 0 ? Math.round(average(targetProtein)) : null,
  };
}

function weightFacts(
  rows: BriefWeightRow[],
): NonNullable<BriefFacts['weight']> {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  return {
    entries: sorted.length,
    first: sorted[0]?.weight ?? null,
    last: sorted[sorted.length - 1]?.weight ?? null,
  };
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
