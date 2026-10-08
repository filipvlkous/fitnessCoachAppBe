import { HttpException } from '@nestjs/common';
import { PhotoQuotaService } from './photo-quota.service';

type UserRow = {
  daily_photo_limit: number;
  photo_cooldown_minutes: number;
  photo_cooldown_until: string | null;
};

/**
 * Just enough of the PostgREST builder for the queries the service makes:
 * one user row and the scan ledger, filtered by equality.
 */
function fakeSupabase(user: UserRow) {
  const scans: { id: string; user_id: string; day: string }[] = [];
  let nextId = 1;

  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let op: 'select' | 'insert' | 'delete' | 'update' = 'select';
    let payload: any;
    let head = false;

    const rows = () =>
      scans.filter((s) =>
        Object.entries(filters).every(([k, v]) => (s as any)[k] === v),
      );

    const run = () => {
      if (table === 'user') {
        if (op === 'update') Object.assign(user, payload);
        return { data: { ...user }, error: null };
      }
      if (op === 'insert') {
        const row = { id: String(nextId++), ...payload };
        scans.push(row);
        return { data: { id: row.id }, error: null };
      }
      if (op === 'delete') {
        const id = filters.id;
        scans.splice(
          scans.findIndex((s) => s.id === id),
          1,
        );
        return { error: null };
      }
      return head
        ? { count: rows().length, error: null }
        : { data: rows(), error: null };
    };

    const builder: any = {
      select: (_cols: string, opts?: { head?: boolean }) => {
        head = !!opts?.head;
        return builder;
      },
      insert: (p: unknown) => ((op = 'insert'), (payload = p), builder),
      update: (p: unknown) => ((op = 'update'), (payload = p), builder),
      delete: () => ((op = 'delete'), builder),
      eq: (k: string, v: unknown) => ((filters[k] = v), builder),
      order: () => builder,
      single: async () => run(),
      maybeSingle: async () => run(),
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return builder;
  };

  return { supabase: { from }, scans };
}

const make = (user: Partial<UserRow> = {}) => {
  const row: UserRow = {
    daily_photo_limit: 3,
    photo_cooldown_minutes: 5,
    photo_cooldown_until: null,
    ...user,
  };
  const fake = fakeSupabase(row);
  return {
    service: new PhotoQuotaService(fake as any),
    scans: fake.scans,
    row,
  };
};

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return ((e as HttpException).getResponse() as { code: string }).code;
  }
};

describe('PhotoQuotaService', () => {
  it('allows the user their own limit and refuses the next scan', async () => {
    const { service } = make({ daily_photo_limit: 2 });

    await service.claimScan('u1');
    await service.claimScan('u1');

    expect(await codeOf(service.claimScan('u1'))).toBe('PHOTO_LIMIT_REACHED');
    expect((await service.getQuota('u1')).used).toBe(2);
  });

  it('keeps a cancelled scan counted and pauses scanning', async () => {
    const { service } = make();

    await service.claimScan('u1');
    const quota = await service.cancelScan('u1');

    expect(quota.used).toBe(1);
    expect(quota.cooldownUntil).not.toBeNull();
    expect(await codeOf(service.claimScan('u1'))).toBe('PHOTO_COOLDOWN');
  });

  it('accepts scans again once the pause is over', async () => {
    const { service } = make({
      photo_cooldown_until: new Date(Date.now() - 1000).toISOString(),
    });

    expect(await codeOf(service.claimScan('u1'))).toBeNull();
    expect((await service.getQuota('u1')).cooldownUntil).toBeNull();
  });

  it('gives a failed scan back', async () => {
    const { service } = make();

    const id = await service.claimScan('u1');
    await service.refundScan(id);

    expect((await service.getQuota('u1')).remaining).toBe(3);
  });
});
