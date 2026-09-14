import { countEntry, MIN_WORKOUT_DAYS } from './rewards.tickets';

const days = (...numbers: number[]) =>
  numbers.map((day) => `2026-10-${String(day).padStart(2, '0')}`);

describe('countEntry', () => {
  it('gives a ticket per day trained', () => {
    expect(countEntry(days(1, 2, 3), []).tickets).toBe(3);
  });

  it('gives two for a day both trained and eaten to', () => {
    expect(countEntry(days(1, 2, 3), days(2, 3)).tickets).toBe(5);
  });

  it('gives nothing for a day only eaten to', () => {
    expect(countEntry(days(1), days(1, 2, 3, 4, 5)).tickets).toBe(2);
  });

  it('counts a day once however many sessions it held', () => {
    const twiceOnTuesday = [...days(1, 2, 3), ...days(2)];

    expect(countEntry(twiceOnTuesday, []).workoutDays).toBe(3);
  });

  it('qualifies at the bar', () => {
    const atBar = days(
      ...Array.from({ length: MIN_WORKOUT_DAYS }, (_, i) => i + 1),
    );

    expect(countEntry(atBar, []).qualified).toBe(true);
    expect(countEntry(atBar.slice(1), []).qualified).toBe(false);
  });

  it('does not let food carry a month over the bar', () => {
    const short = days(
      ...Array.from({ length: MIN_WORKOUT_DAYS - 1 }, (_, i) => i + 1),
    );

    expect(
      countEntry(short, days(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)).qualified,
    ).toBe(false);
  });

  it('reads an empty month as no entry', () => {
    expect(countEntry([], [])).toEqual({
      workoutDays: 0,
      tickets: 0,
      qualified: false,
    });
  });
});
