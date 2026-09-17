import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { throttlerOptions } from './throttler.config';

// The real limits are in the hundreds, which would mean hundreds of sequential
// requests per assertion. What is worth testing is the *shape* of the config —
// how callers are told apart and what shares a budget with what — so the
// tracker and key generator come from the real thing and only the ceilings are
// shrunk.
const API_LIMIT = 6;
const EXPENSIVE_LIMIT = 2;

const testOptions = {
  ...throttlerOptions,
  throttlers: throttlerOptions.throttlers.map((throttler) => ({
    ...throttler,
    limit: API_LIMIT,
  })),
};

@Controller('probe')
class ProbeController {
  @Get('one')
  one() {
    return { ok: 1 };
  }

  @Get('two')
  two() {
    return { ok: 2 };
  }

  // Mirrors what `image-analysis/food/analyze` declares.
  @Throttle({ heavy: { limit: EXPENSIVE_LIMIT, ttl: 60_000 } })
  @Get('expensive')
  expensive() {
    return { ok: 3 };
  }
}

describe('rate limiting (through the real guard and tracker)', () => {
  let app: INestApplication;
  let session = 0;

  /** A distinct caller per test, so tests do not spend each other's budget. */
  const asSession = () => ({ Authorization: `Bearer test-token-${++session}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(testOptions)],
      controllers: [ProbeController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string, headers: Record<string, string>) =>
    request(app.getHttpServer()).get(path).set(headers);

  const spend = async (path: string, headers: Record<string, string>) => {
    for (let i = 0; i < API_LIMIT; i++) {
      expect((await get(path, headers)).status).toBe(200);
    }
  };

  it('lets a caller through while it is under the budget', async () => {
    await spend('/probe/one', asSession());
  });

  // The point of the custom key generator. With the package's default key the
  // budget is per route handler, so a client that knows twenty endpoints would
  // get twenty times the limit and the number would mean nothing.
  it('counts one budget across different endpoints', async () => {
    const headers = asSession();

    for (let i = 0; i < API_LIMIT / 2; i++) {
      expect((await get('/probe/one', headers)).status).toBe(200);
    }
    for (let i = 0; i < API_LIMIT / 2; i++) {
      expect((await get('/probe/two', headers)).status).toBe(200);
    }

    expect((await get('/probe/one', headers)).status).toBe(429);
    expect((await get('/probe/two', headers)).status).toBe(429);
  });

  // The package suffixes the header with the throttler's name unless that name
  // is `default`, which is why the API-wide budget carries that name: the limit
  // a working client actually meets answers with the standard header.
  it('tells the client how long to wait', async () => {
    const headers = asSession();
    await spend('/probe/one', headers);

    const res = await get('/probe/one', headers);
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('tells the client how long to wait on an expensive route too', async () => {
    const headers = asSession();
    for (let i = 0; i < EXPENSIVE_LIMIT; i++)
      await get('/probe/expensive', headers);

    const res = await get('/probe/expensive', headers);
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after-heavy'])).toBeGreaterThan(0);
  });

  it('gives each session its own budget', async () => {
    const spent = asSession();
    await spend('/probe/one', spent);
    expect((await get('/probe/one', spent)).status).toBe(429);

    // A second session is untouched by the first one's flood.
    expect((await get('/probe/one', asSession())).status).toBe(200);
  });

  it('limits an expensive route more tightly than the API budget', async () => {
    const headers = asSession();

    for (let i = 0; i < EXPENSIVE_LIMIT; i++) {
      expect((await get('/probe/expensive', headers)).status).toBe(200);
    }
    expect((await get('/probe/expensive', headers)).status).toBe(429);

    // Only that route is closed; the caller is nowhere near the API budget.
    expect((await get('/probe/one', headers)).status).toBe(200);
  });

  // Behind nginx every request arrives from 127.0.0.1, so without reading
  // X-Real-IP the whole internet would share one budget on the public routes.
  it('separates tokenless callers by X-Real-IP', async () => {
    const flooder = { 'X-Real-IP': '203.0.113.9' };
    await spend('/probe/one', flooder);
    expect((await get('/probe/one', flooder)).status).toBe(429);

    expect(
      (await get('/probe/one', { 'X-Real-IP': '203.0.113.10' })).status,
    ).toBe(200);
  });
});
