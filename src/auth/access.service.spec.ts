import { ForbiddenException } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { AccessService } from './access.service';

const COACH = 'coach-1';
const CLIENT = 'client-1';

type Consent = { kind: string; consent_key: string; granted: boolean };

/**
 * A fake Supabase where every query on a table resolves to one fixed result,
 * whatever filters were chained on it. Records which tables were read.
 */
const serviceWith = (tables: {
  relation?: boolean;
  consents?: Consent[];
  workoutLog?: { coach_id: string | null; user_id: string };
}) => {
  const reads: string[] = [];
  const results: Record<string, unknown> = {
    coach_user_relations: { data: tables.relation ? { id: 'r' } : null },
    user_consents_current: { data: tables.consents ?? [], error: null },
    workout_logs: {
      data: tables.workoutLog
        ? {
            coach_id: tables.workoutLog.coach_id,
            user_workout_programs: { user_id: tables.workoutLog.user_id },
          }
        : null,
      error: null,
    },
  };

  const from = (table: string) => {
    reads.push(table);
    const result = results[table];
    const builder: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) => resolve(result),
    };
    for (const m of ['select', 'eq', 'limit']) builder[m] = () => builder;
    builder.maybeSingle = () => Promise.resolve(result);
    return builder;
  };

  const service = new AccessService({
    getClient: () => ({ from }),
  } as unknown as SupabaseService);
  return { service, reads };
};

const sharing = (scopes: Record<string, boolean>): Consent[] => [
  { kind: 'consent', consent_key: 'coachSharing', granted: true },
  ...Object.entries(scopes).map(([consent_key, granted]) => ({
    kind: 'coachScope',
    consent_key,
    granted,
  })),
];

describe('AccessService scopes', () => {
  it('never limits users by their own scopes', async () => {
    const { service, reads } = serviceWith({});
    await expect(
      service.assertSelfOrCoach(CLIENT, CLIENT, 'nutrition'),
    ).resolves.toBeUndefined();
    expect(reads).toEqual([]);
  });

  it('lets a coach through when the client shares the scope', async () => {
    const { service } = serviceWith({
      relation: true,
      consents: sharing({ nutrition: true }),
    });
    await expect(
      service.assertSelfOrCoach(COACH, CLIENT, 'nutrition'),
    ).resolves.toBeUndefined();
  });

  it('refuses a coach when the scope is not shared', async () => {
    const { service } = serviceWith({
      relation: true,
      consents: sharing({ nutrition: false, workouts: true }),
    });
    await expect(
      service.assertSelfOrCoach(COACH, CLIENT, 'nutrition'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses every scope once coachSharing is withdrawn', async () => {
    const { service } = serviceWith({
      relation: true,
      consents: [
        { kind: 'consent', consent_key: 'coachSharing', granted: false },
        { kind: 'coachScope', consent_key: 'bodyMetrics', granted: true },
      ],
    });
    await expect(
      service.assertSelfOrCoach(COACH, CLIENT, 'bodyMetrics'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('skips the consent read when no scope is asked for', async () => {
    const { service, reads } = serviceWith({ relation: true });
    await service.assertSelfOrCoach(COACH, CLIENT);
    expect(reads).not.toContain('user_consents_current');
  });

  it("holds the log's own coach to the client's scope too", async () => {
    const { service } = serviceWith({
      consents: sharing({ workouts: false }),
      workoutLog: { coach_id: COACH, user_id: CLIENT },
    });
    await expect(
      service.assertWorkoutLogAccess(COACH, 'log-1', 'workouts'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.assertWorkoutLogAccess(COACH, 'log-1'),
    ).resolves.toBeUndefined();
  });
});
