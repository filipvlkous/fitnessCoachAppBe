import { drawWinners, Entrant } from './rewards.draw';

const entrant = (userId: string, tickets: number): Entrant => ({
  userId,
  tickets,
});

/**
 * The draw hands out things that cost money, so the cases that must never
 * regress are the ones about handing out more than there is, twice, or
 * differently on a second run.
 */
describe('drawWinners', () => {
  it('deals the same winners for the same seed', () => {
    const pool = [
      entrant('a', 10),
      entrant('b', 20),
      entrant('c', 15),
      entrant('d', 31),
    ];

    expect(drawWinners(pool, 2, 'draw:2026-10')).toEqual(
      drawWinners(pool, 2, 'draw:2026-10'),
    );
  });

  it('does not depend on the order the rows arrived in', () => {
    const pool = [entrant('a', 10), entrant('b', 20), entrant('c', 15)];
    const shuffled = [pool[2], pool[0], pool[1]];

    expect(drawWinners(shuffled, 2, 'seed')).toEqual(
      drawWinners(pool, 2, 'seed'),
    );
  });

  it('deals different winners for different seeds', () => {
    const pool = Array.from({ length: 50 }, (_, i) =>
      entrant(`user-${i}`, 10 + (i % 20)),
    );

    const runs = new Set(
      ['a', 'b', 'c', 'd', 'e'].map((seed) =>
        drawWinners(pool, 3, seed).join(),
      ),
    );

    expect(runs.size).toBeGreaterThan(1);
  });

  it('never draws one entrant twice', () => {
    const pool = [entrant('a', 100), entrant('b', 1), entrant('c', 1)];

    const winners = drawWinners(pool, 3, 'heavy-favourite');

    expect(new Set(winners).size).toBe(3);
  });

  it('draws no more than there are prizes', () => {
    const pool = Array.from({ length: 40 }, (_, i) => entrant(`u${i}`, 12));

    expect(drawWinners(pool, 5, 'seed')).toHaveLength(5);
  });

  it('stops at the number of entrants when prizes outnumber them', () => {
    const winners = drawWinners([entrant('a', 10), entrant('b', 12)], 5, 's');

    expect(winners.sort()).toEqual(['a', 'b']);
  });

  it('draws nobody when there is nothing to win', () => {
    expect(drawWinners([entrant('a', 10)], 0, 'seed')).toEqual([]);
  });

  it('draws nobody from an empty month', () => {
    expect(drawWinners([], 5, 'seed')).toEqual([]);
  });

  it('ignores an entrant with no tickets', () => {
    expect(drawWinners([entrant('a', 0), entrant('b', 10)], 2, 'seed')).toEqual(
      ['b'],
    );
  });

  it('favours the entrant holding more tickets', () => {
    // Ten tickets against one, one prize, a hundred months. The heavy entrant
    // does not always win, but a generator that ignored the weights would sit
    // near fifty.
    let heavy = 0;

    for (let month = 0; month < 100; month += 1) {
      const winners = drawWinners(
        [entrant('heavy', 10), entrant('light', 1)],
        1,
        `2026-${month}`,
      );
      if (winners[0] === 'heavy') heavy += 1;
    }

    expect(heavy).toBeGreaterThan(75);
    expect(heavy).toBeLessThan(100);
  });
});
