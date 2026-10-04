import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from 'src/notifications/notifications.service';
import { SupabaseService } from 'src/supabase/supabase.service';
import { UserService } from './user.service';

const COACH = 'coach-1';
const CLIENT = 'client-1';

type Call = { table: string; op: string; filters: Record<string, string> };

/**
 * Records every query as table + operation + `eq` filters. `program` decides
 * whether the ownership lookup on user_workout_programs finds a row.
 */
const serviceWith = (program: boolean) => {
  const calls: Call[] = [];

  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: {} };
    calls.push(call);
    const result =
      table === 'user_workout_programs'
        ? { data: program ? { id: 'p' } : null, error: null }
        : { data: [{ id: 'row' }], error: null };

    const builder: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) => resolve(result),
    };
    builder.select = () => builder;
    builder.delete = () => {
      call.op = 'delete';
      return builder;
    };
    builder.eq = (column: string, value: string) => {
      call.filters[column] = value;
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve(result);
    return builder;
  };

  const service = new UserService(
    { supabase: { from } } as unknown as SupabaseService,
    {} as NotificationsService,
  );
  return { service, calls };
};

const deletesOn = (calls: Call[], table: string) =>
  calls.filter((c) => c.table === table && c.op === 'delete');

describe('UserService.removeCoachRelationByUserId', () => {
  it("removes only the requesting coach's relation and chat", async () => {
    const { service, calls } = serviceWith(true);
    await service.removeCoachRelationByUserId(CLIENT, COACH);

    for (const table of ['chat_messages', 'coach_user_relations']) {
      expect(deletesOn(calls, table)).toEqual([
        expect.objectContaining({
          filters: { user_id: CLIENT, coach_id: COACH },
        }),
      ]);
    }
  });

  it('removes every relation when the user leaves on their own', async () => {
    const { service, calls } = serviceWith(true);
    await service.removeCoachRelationByUserId(CLIENT, CLIENT);

    expect(deletesOn(calls, 'coach_user_relations')[0].filters).toEqual({
      user_id: CLIENT,
    });
  });

  it("deletes nothing when the program is not the user's", async () => {
    const { service, calls } = serviceWith(false);
    await expect(
      service.removeCoachRelationByUserId(CLIENT, COACH, 'someone-elses'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(calls.filter((c) => c.op === 'delete')).toEqual([]);
    expect(calls[0].filters).toEqual({ id: 'someone-elses', user_id: CLIENT });
  });

  it('deletes the program days of an owned program', async () => {
    const { service, calls } = serviceWith(true);
    await service.removeCoachRelationByUserId(CLIENT, COACH, 'p');

    expect(deletesOn(calls, 'user_program_days')[0].filters).toEqual({
      program_id: 'p',
    });
  });
});
