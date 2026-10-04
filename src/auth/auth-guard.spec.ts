import { ExecutionContext } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { SupabaseAuthGuard } from 'utils/AuthGuard';

const NOW = 1_800_000_000_000;

const jwt = (expSeconds: number) =>
  [
    'header',
    Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url'),
    'signature',
  ].join('.');

const contextFor = (token: string, ip: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { authorization: `Bearer ${token}`, 'x-real-ip': ip },
      }),
    }),
  }) as unknown as ExecutionContext;

const guardWith = (validate: jest.Mock) =>
  new SupabaseAuthGuard({
    validateUserToken: validate,
  } as unknown as SupabaseService);

describe('SupabaseAuthGuard', () => {
  let now: number;
  beforeEach(() => {
    now = NOW;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  it('asks Supabase again after 30 seconds', async () => {
    const validate = jest.fn().mockResolvedValue({ id: 'u' });
    const guard = guardWith(validate);
    const token = jwt(NOW / 1000 + 3600);

    await guard.canActivate(contextFor(token, '10.0.0.1'));
    now += 29_000;
    await guard.canActivate(contextFor(token, '10.0.0.1'));
    expect(validate).toHaveBeenCalledTimes(1);

    now += 2_000;
    await guard.canActivate(contextFor(token, '10.0.0.1'));
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it('never serves a token from cache past its exp', async () => {
    const validate = jest.fn().mockResolvedValue({ id: 'u' });
    const guard = guardWith(validate);
    const token = jwt(NOW / 1000 + 5);

    await guard.canActivate(contextFor(token, '10.0.0.2'));
    now += 6_000;
    await guard.canActivate(contextFor(token, '10.0.0.2'));
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it('stops asking Supabase after 20 bad tokens from one address', async () => {
    const validate = jest.fn().mockRejectedValue(new Error('Invalid token'));
    const guard = guardWith(validate);

    for (let i = 0; i < 20; i++) {
      await expect(
        guard.canActivate(contextFor(`made-up-${i}`, '10.0.0.3')),
      ).rejects.toMatchObject({ status: 401 });
    }
    await expect(
      guard.canActivate(contextFor('made-up-20', '10.0.0.3')),
    ).rejects.toMatchObject({ status: 429 });
    expect(validate).toHaveBeenCalledTimes(20);

    // Another address is unaffected, and the block lifts after a minute.
    await expect(
      guard.canActivate(contextFor('made-up-x', '10.0.0.4')),
    ).rejects.toMatchObject({ status: 401 });
    now += 60_000;
    await expect(
      guard.canActivate(contextFor('made-up-y', '10.0.0.3')),
    ).rejects.toMatchObject({ status: 401 });
  });
});
