import { CacheModule } from '@nestjs/cache-manager';
import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AccessService } from 'src/auth/access.service';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import { ExercisesController } from './exercises.controller';
import { ExercisesService } from './exercises.service';

/**
 * A coach who adds or removes a gallery picture changes what the next read of
 * `/media` must return. The response used to sit in a per-user cache that no
 * write could reach — writes deleted a key without the `user:` prefix — so a
 * client kept swiping the old gallery for five minutes after the upload.
 */
describe('GET /exercises/:id/media', () => {
  let app: INestApplication<App>;
  const getMedia = jest.fn();

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CacheModule.register({ isGlobal: true })],
      controllers: [ExercisesController],
      providers: [
        { provide: ExercisesService, useValue: { getMedia } },
        { provide: AccessService, useValue: {} },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context
            .switchToHttp()
            .getRequest<{ user?: { id: string } }>();
          req.user = { id: 'client-1' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    getMedia.mockReset();
    await app.close();
  });

  it('shows a gallery change on the very next read', async () => {
    getMedia
      .mockResolvedValueOnce({ img_url: 'first.webp', img_url_2: null })
      .mockResolvedValueOnce({
        img_url: 'first.webp',
        img_url_2: 'second.webp',
      });

    const path = '/exercises/exercise-1/media?type=both';
    await request(app.getHttpServer()).get(path).expect(200);
    const afterUpload = await request(app.getHttpServer())
      .get(path)
      .expect(200);

    const body = afterUpload.body as { img_url_2: string | null };
    expect(body.img_url_2).toBe('second.webp');
  });
});
