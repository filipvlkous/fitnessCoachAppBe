/**
 * The deterministic half of retention: the signal vector and the arithmetic
 * that turns it into a risk score.
 *
 * Kept apart from the service on purpose. Nothing here touches the database,
 * the network or a model, so the rule that decides which clients a coach is
 * told to chase can be read, argued with and tested on its own.
 */

export type RetentionBand = 'new' | 'ok' | 'watch' | 'at_risk';

/**
 * Everything the score is computed from, per coach-client pair.
 *
 * Counts are over the last 28 days; the "previous" halves are days 14-28 so a
 * client can be compared against themselves rather than against other clients.
 * A `daysSince…` of null means nothing was found inside the window — read it
 * as "at least 28", never as zero.
 */
export interface RetentionSignals {
  tenureDays: number | null;
  plannedSessionsPerWeek: number | null;
  daysSinceLastWorkout: number | null;
  sessionsRecent: number;
  sessionsPrevious: number;
  daysSinceLastMeal: number | null;
  mealDaysRecent: number;
  mealDaysPrevious: number;
  everLoggedMeals: boolean;
  daysSinceClientMessage: number | null;
  everChatted: boolean;
  cancelledMeetings: number;
  upcomingMeetings: number;
  daysSinceLastWeighIn: number | null;
  everWeighedIn: boolean;
}

/** One scored reason, with the numbers that produced it. */
export interface RetentionFactor {
  code: string;
  points: number;
  detail: Record<string, number | null>;
}

/** How far back every signal looks. */
export const WINDOW_DAYS = 28;
/** The recent half of the window; days 14-28 are what it is compared against. */
export const HALF_WINDOW_DAYS = 14;

/**
 * Below this many days on the program a client gets no score at all.
 *
 * Three weeks is the first point where "trained twice in the last fortnight"
 * says something about the person rather than about onboarding. Flagging
 * someone the week after they signed up trains coaches to ignore the list.
 */
const MIN_TENURE_DAYS = 21;

const WATCH_SCORE = 25;
const AT_RISK_SCORE = 55;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Additive risk points, 0-100, from signals only.
 *
 * Every term is measured against the client's own plan and their own previous
 * fortnight. Someone training twice a week to a twice-a-week program is not
 * at risk for training less than someone else.
 */
export function scoreClient(signals: RetentionSignals): {
  score: number | null;
  band: RetentionBand;
  factors: RetentionFactor[];
} {
  // No active program, or too new to read: no number. A client four days in
  // has no pattern to break yet, and a made-up score here is the kind that
  // teaches coaches to stop looking.
  if (signals.tenureDays === null || signals.tenureDays < MIN_TENURE_DAYS) {
    return { score: null, band: 'new', factors: [] };
  }

  const factors: RetentionFactor[] = [];
  const add = (
    code: string,
    points: number,
    detail: Record<string, number | null>,
  ) => {
    if (Math.abs(points) >= 1) {
      factors.push({ code, points: Math.round(points), detail });
    }
  };

  const perWeek = signals.plannedSessionsPerWeek ?? 0;
  // Without a program to compare against, assume every other day.
  const expectedGap = perWeek > 0 ? 7 / perWeek : 3.5;

  // 1. Silence since the last session, in units of their own training rhythm.
  // Nothing inside the window reads as the full window, not as zero.
  const gap = signals.daysSinceLastWorkout ?? WINDOW_DAYS;
  add(
    'inactive_streak',
    clamp01((gap - expectedGap) / (expectedGap * 3)) * 35,
    {
      daysSinceLastWorkout: gap,
      expectedGapDays: Math.round(expectedGap * 10) / 10,
    },
  );

  // 2. Adherence over the recent fortnight.
  if (perWeek > 0) {
    const expected = perWeek * 2;
    add(
      'missed_sessions',
      clamp01((expected - signals.sessionsRecent) / expected) * 25,
      { done: signals.sessionsRecent, expected: Math.round(expected) },
    );
  }

  // 3. Falling off their own pace, even while still training.
  if (signals.sessionsPrevious >= 2) {
    add(
      'training_dropped',
      clamp01(
        (signals.sessionsPrevious - signals.sessionsRecent) /
          signals.sessionsPrevious,
      ) * 15,
      { recent: signals.sessionsRecent, previous: signals.sessionsPrevious },
    );
  }

  // 4. Food logging is the habit that goes first; it drops weeks before the
  // training does. Only counted for clients who ever had the habit.
  if (signals.mealDaysPrevious >= 4) {
    add(
      'logging_dropped',
      clamp01(
        (signals.mealDaysPrevious - signals.mealDaysRecent) /
          signals.mealDaysPrevious,
      ) * 10,
      { recent: signals.mealDaysRecent, previous: signals.mealDaysPrevious },
    );
  }

  // 5. A client who used to write and stopped.
  if (signals.everChatted) {
    const silence = signals.daysSinceClientMessage ?? WINDOW_DAYS;
    add('chat_silence', clamp01((silence - 7) / 21) * 10, {
      daysSinceClientMessage: silence,
    });
  }

  // 6. Cancelling sessions is the loudest signal there is, but two is the
  // point past which more of them say nothing new.
  add('cancelled_sessions', Math.min(signals.cancelledMeetings, 2) * 5, {
    cancelled: signals.cancelledMeetings,
  });

  // 7. Weigh-ins, for clients who track them.
  if (signals.everWeighedIn) {
    const since = signals.daysSinceLastWeighIn ?? WINDOW_DAYS;
    add('no_weigh_in', clamp01((since - 21) / 21) * 5, {
      daysSinceLastWeighIn: since,
    });
  }

  // A session already in the diary is the strongest counter-signal: whatever
  // the last fortnight looked like, this one has not walked away.
  if (signals.upcomingMeetings > 0) {
    add('booked_session', -10, { upcoming: signals.upcomingMeetings });
  }

  const raw = factors.reduce((sum, factor) => sum + factor.points, 0);
  const score = Math.min(100, Math.max(0, Math.round(raw)));

  const band: RetentionBand =
    score >= AT_RISK_SCORE ? 'at_risk' : score >= WATCH_SCORE ? 'watch' : 'ok';

  return { score, band, factors };
}

/**
 * Whether a coach's "I know about this one" still holds after a recompute.
 *
 * It survives while the picture is the same or better and the client is still
 * in trouble. It is dropped the moment the band worsens past what was waved
 * away — a dismissed `watch` that turns into `at_risk` is new information, not
 * the thing the coach already answered — and dropped again once the client is
 * out of trouble, so the next drift starts with a clean slate.
 */
export function dismissalSurvives(
  dismissedAt: string | null,
  dismissedBand: string | null,
  band: RetentionBand,
): boolean {
  if (!dismissedAt) return false;
  if (band === 'ok' || band === 'new') return false;
  return !(dismissedBand === 'watch' && band === 'at_risk');
}
