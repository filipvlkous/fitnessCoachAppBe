import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CHAT_PHOTO_BUCKET,
  purgeExpiredPhotos,
  removeChatPhotosOf,
} from './chat-photo';

type Row = {
  id: string;
  kind: string;
  coach_id: string;
  user_id: string;
  created_at: string;
  metadata: { photo_path?: string } | null;
};

const NOW = new Date('2026-09-13T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const photo = (id: string, age: number, owner = 'client-1'): Row => ({
  id,
  kind: 'photo',
  coach_id: 'coach-1',
  user_id: owner,
  created_at: ago(age),
  metadata: { photo_path: `coach-1/${owner}/${id}.webp` },
});

/**
 * In-memory stand-in for the handful of query-builder calls the purge makes.
 * Filters are applied to `rows`; a delete removes what matched.
 */
function fakeSupabase(initial: Row[], { storageFails = false } = {}) {
  let rows = [...initial];
  const removed: { bucket: string; paths: string[] }[] = [];

  const query = () => {
    const filters: ((row: Row) => boolean)[] = [];
    let isDelete = false;
    let limit = Infinity;

    const builder = {
      select: () => builder,
      delete: () => {
        isDelete = true;
        return builder;
      },
      eq: (column: keyof Row, value: unknown) => {
        filters.push((row) => row[column] === value);
        return builder;
      },
      lt: (column: keyof Row, value: string) => {
        filters.push((row) => (row[column] as string) < value);
        return builder;
      },
      in: (column: keyof Row, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      or: (expression: string) => {
        const clauses = expression.split(',').map((clause) => {
          const [column, , value] = clause.split('.');
          return (row: Row) => row[column as keyof Row] === value;
        });
        filters.push((row) => clauses.some((matches) => matches(row)));
        return builder;
      },
      limit: (n: number) => {
        limit = n;
        return builder;
      },
      then: (resolve: (result: { data: Row[]; error: null }) => void) => {
        const matched = rows
          .filter((row) => filters.every((f) => f(row)))
          .slice(0, limit);
        if (isDelete) rows = rows.filter((row) => !matched.includes(row));
        resolve({ data: matched, error: null });
      },
    };
    return builder;
  };

  const client = {
    from: () => query(),
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          if (storageFails) {
            return Promise.resolve({ data: null, error: { message: 'down' } });
          }
          removed.push({ bucket, paths });
          return Promise.resolve({ data: [], error: null });
        },
      }),
    },
  } as unknown as SupabaseClient;

  return {
    client,
    rows: () => rows,
    removedPaths: () => removed.flatMap((call) => call.paths),
    buckets: () => removed.map((call) => call.bucket),
  };
}

describe('purgeExpiredPhotos', () => {
  it('deletes the file and the row of a photo older than 7 days', async () => {
    const db = fakeSupabase([photo('old', 7 * DAY + HOUR)]);

    await expect(purgeExpiredPhotos(db.client, NOW)).resolves.toBe(1);

    expect(db.rows()).toEqual([]);
    expect(db.removedPaths()).toEqual(['coach-1/client-1/old.webp']);
    expect(db.buckets()).toEqual([CHAT_PHOTO_BUCKET]);
  });

  it('keeps a photo that is not 7 days old yet', async () => {
    const db = fakeSupabase([photo('young', 7 * DAY - HOUR)]);

    await expect(purgeExpiredPhotos(db.client, NOW)).resolves.toBe(0);

    expect(db.rows().map((row) => row.id)).toEqual(['young']);
    expect(db.removedPaths()).toEqual([]);
  });

  it('never touches text messages, however old', async () => {
    const text: Row = {
      ...photo('text', 30 * DAY),
      kind: 'text',
      metadata: null,
    };
    const db = fakeSupabase([text]);

    await purgeExpiredPhotos(db.client, NOW);

    expect(db.rows()).toEqual([text]);
  });

  it('leaves the rows in place when storage fails, so the next run retries', async () => {
    const db = fakeSupabase([photo('old', 8 * DAY)], { storageFails: true });

    await expect(purgeExpiredPhotos(db.client, NOW)).rejects.toThrow('down');

    expect(db.rows().map((row) => row.id)).toEqual(['old']);
  });

  it('works through more expired photos than fit in one pass', async () => {
    const expired = Array.from({ length: 250 }, (_, i) =>
      photo(`old-${i}`, 8 * DAY),
    );
    const db = fakeSupabase([...expired, photo('young', DAY)]);

    await expect(purgeExpiredPhotos(db.client, NOW)).resolves.toBe(250);

    expect(db.rows().map((row) => row.id)).toEqual(['young']);
    expect(db.removedPaths()).toHaveLength(250);
  });
});

describe('removeChatPhotosOf', () => {
  it("removes the files of the user's photos, whatever their age", async () => {
    const db = fakeSupabase([
      photo('mine', HOUR, 'client-1'),
      photo('other-client', HOUR, 'client-2'),
    ]);

    await removeChatPhotosOf(db.client, 'client-1');

    expect(db.removedPaths()).toEqual(['coach-1/client-1/mine.webp']);
    // Rows are the account deletion RPC's job.
    expect(db.rows()).toHaveLength(2);
  });
});
