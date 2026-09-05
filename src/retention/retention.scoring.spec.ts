import {
  dismissalSurvives,
  RetentionSignals,
  scoreClient,
} from './retention.scoring';

/**
 * The score decides which clients a coach chases, so the cases that must never
 * regress are the ones about *not* crying wolf: a new client, and a client who
 * is doing exactly what their plan asks of them.
 */
const base: RetentionSignals = {
  tenureDays: 120,
  plannedSessionsPerWeek: 3,
  daysSinceLastWorkout: 1,
  sessionsRecent: 6,
  sessionsPrevious: 6,
  daysSinceLastMeal: 0,
  mealDaysRecent: 12,
  mealDaysPrevious: 12,
  everLoggedMeals: true,
  daysSinceClientMessage: 2,
  everChatted: true,
  cancelledMeetings: 0,
  upcomingMeetings: 0,
  daysSinceLastWeighIn: 3,
  everWeighedIn: true,
};

const signals = (overrides: Partial<RetentionSignals>): RetentionSignals => ({
  ...base,
  ...overrides,
});

describe('scoreClient', () => {
  it('gives no score to a client who has barely started', () => {
    const result = scoreClient(signals({ tenureDays: 5 }));

    expect(result.band).toBe('new');
    expect(result.score).toBeNull();
    expect(result.factors).toEqual([]);
  });

  it('gives no score without an active program to judge against', () => {
    expect(scoreClient(signals({ tenureDays: null })).band).toBe('new');
  });

  it('leaves a client who is following their plan alone', () => {
    const result = scoreClient(base);

    expect(result.band).toBe('ok');
    expect(result.score).toBeLessThan(25);
  });

  it('does not punish a low training frequency that matches the plan', () => {
    // Twice a week, to a twice-a-week program, on schedule.
    const result = scoreClient(
      signals({
        plannedSessionsPerWeek: 2,
        sessionsRecent: 4,
        sessionsPrevious: 4,
        daysSinceLastWorkout: 2,
      }),
    );

    expect(result.band).toBe('ok');
  });

  it('flags a client who stopped showing up', () => {
    const result = scoreClient(
      signals({
        daysSinceLastWorkout: 20,
        sessionsRecent: 0,
        sessionsPrevious: 2,
        mealDaysRecent: 0,
        daysSinceClientMessage: 20,
        daysSinceLastWeighIn: 25,
      }),
    );

    expect(result.band).toBe('at_risk');
    expect(result.factors.map((f) => f.code)).toContain('inactive_streak');
    expect(result.factors.map((f) => f.code)).toContain('missed_sessions');
  });

  it('reads "nothing in the window" as a long absence, not as zero days', () => {
    const absent = scoreClient(
      signals({
        daysSinceLastWorkout: null,
        sessionsRecent: 0,
        sessionsPrevious: 0,
      }),
    );

    expect(absent.band).toBe('at_risk');
  });

  it('counts a booked session against the risk', () => {
    const drifting = signals({
      daysSinceLastWorkout: 9,
      sessionsRecent: 1,
      sessionsPrevious: 5,
    });

    const withoutBooking = scoreClient(drifting);
    const withBooking = scoreClient({ ...drifting, upcomingMeetings: 1 });

    expect(withBooking.score!).toBeLessThan(withoutBooking.score!);
    expect(withBooking.factors.map((f) => f.code)).toContain('booked_session');
  });

  it('keeps the score inside 0-100', () => {
    const worst = scoreClient(
      signals({
        daysSinceLastWorkout: null,
        sessionsRecent: 0,
        sessionsPrevious: 8,
        mealDaysRecent: 0,
        mealDaysPrevious: 14,
        daysSinceClientMessage: null,
        cancelledMeetings: 5,
        daysSinceLastWeighIn: null,
      }),
    );

    expect(worst.score).toBeLessThanOrEqual(100);
    expect(worst.score).toBeGreaterThan(0);

    // The counter-signal cannot push a healthy client below zero either.
    const calm = scoreClient(signals({ upcomingMeetings: 2 }));
    expect(calm.score).toBeGreaterThanOrEqual(0);
  });
});

describe('dismissalSurvives', () => {
  const YESTERDAY = '2026-09-02T06:00:00.000Z';

  it('is not dismissed when it was never dismissed', () => {
    expect(dismissalSurvives(null, null, 'at_risk')).toBe(false);
  });

  it('holds while the client sits at the band it was closed for', () => {
    expect(dismissalSurvives(YESTERDAY, 'watch', 'watch')).toBe(true);
    expect(dismissalSurvives(YESTERDAY, 'at_risk', 'at_risk')).toBe(true);
  });

  it('breaks when a dismissed watch turns into at_risk', () => {
    // The whole point: closing a card must never be able to hide someone who
    // is actually leaving.
    expect(dismissalSurvives(YESTERDAY, 'watch', 'at_risk')).toBe(false);
  });

  it('holds when a dismissed at_risk eases back to watch', () => {
    expect(dismissalSurvives(YESTERDAY, 'at_risk', 'watch')).toBe(true);
  });

  it('is cleared once the client is out of trouble, so the next drift shows', () => {
    expect(dismissalSurvives(YESTERDAY, 'at_risk', 'ok')).toBe(false);
    expect(dismissalSurvives(YESTERDAY, 'watch', 'new')).toBe(false);
  });
});
