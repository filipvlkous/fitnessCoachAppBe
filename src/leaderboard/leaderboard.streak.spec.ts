import { longestStreak } from './leaderboard.streak';

/**
 * The streak is the only arithmetic in the leaderboard, and it decides two of
 * the three boards. The cases below are the ones that would quietly hand
 * someone else the win: a gap that gets bridged, a day counted twice, or
 * calendar maths that slips over a month end or a clock change.
 */
describe('longestStreak', () => {
  it('is zero for a month with nothing logged', () => {
    expect(longestStreak([])).toBe(0);
  });

  it('counts a single day as one', () => {
    expect(longestStreak(['2026-09-14'])).toBe(1);
  });

  it('counts consecutive days', () => {
    expect(longestStreak(['2026-09-01', '2026-09-02', '2026-09-03'])).toBe(3);
  });

  it('does not bridge a gap, and keeps the longest run', () => {
    expect(
      longestStreak([
        '2026-09-01',
        '2026-09-02',
        // one day missed
        '2026-09-04',
        '2026-09-05',
        '2026-09-06',
      ]),
    ).toBe(3);
  });

  it('treats several entries on one day as one day', () => {
    expect(longestStreak(['2026-09-08', '2026-09-08', '2026-09-09'])).toBe(2);
  });

  it('does not depend on the order rows come back in', () => {
    expect(longestStreak(['2026-09-05', '2026-09-03', '2026-09-04'])).toBe(3);
  });

  it('carries a run across the end of a month', () => {
    // Only reachable if a caller ever passes two months at once, but the day
    // arithmetic has to be calendar-correct either way.
    expect(longestStreak(['2026-08-31', '2026-09-01'])).toBe(2);
  });

  it('is unaffected by a daylight-saving change', () => {
    // Europe/Prague springs forward on 2026-03-29; the days are parsed as UTC
    // precisely so a 23-hour local day is still one day apart.
    expect(longestStreak(['2026-03-28', '2026-03-29', '2026-03-30'])).toBe(3);
  });
});
