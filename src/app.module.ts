import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import KeyvRedis from '@keyv/redis';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseModule } from './supabase/supabase.module';
import { AccessModule } from './auth/access.module';
import { ImageAnalysisModule } from './image-analysis/image-analysis.module';
import { UserModule } from './user/user.module';
import { ExercisesModule } from './exercises/exercises.module';
import { ProgramsModule } from './program/programs.module';
import { WorkoutHistoryModule } from './workoutHistory/workoutHistory.module';
import { FeedModule } from './feed/feed.module';
import { SupplementsModule } from './supplements/supplements.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MacrosModule } from './macros/macros.module';
import { CoachProfileModule } from './coachProfile/coachProfile.module';
import { MonthlySummaryModule } from './monthly-summary/monthly-summary.module';
import { CoachPlansModule } from './coach-plans/coach-plans.module';
import { ChatModule } from './chat/chat.module';
import { JoinModule } from './join/join.module';

@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: () => {
        if (!process.env.UPSTASH_REDIS_URL) {
          throw new Error(
            'UPSTASH_REDIS_URL is not set. Configure it in the server environment.',
          );
        }
        const redisUrl = new URL(process.env.UPSTASH_REDIS_URL);

        // `@keyv/redis` is the adapter for cache-manager v6+. The older
        // `cache-manager-redis-yet` + `{ store }` shape is a v5 API: this
        // module reads `stores` (plural), so a `store` key was silently
        // ignored and every cache entry lived in a per-process Map instead of
        // Redis — invalidation then only ever cleared the instance that
        // handled the write.
        const store = new KeyvRedis({
          password: redisUrl.password,
          socket: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port) || 6379,
            tls: true,
            // Retry with backoff so transient DNS/network blips don't kill the client.
            reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
          },
        });

        // Log connection errors instead of letting them crash the process.
        store.on('error', (err) => {
          console.error('Redis Connection Error:', err);
        });

        return { stores: [store], ttl: 60 * 1000 };
      },
    }),

    ScheduleModule.forRoot(),
    AccessModule,
    SupabaseModule,
    ImageAnalysisModule,
    UserModule,
    ExercisesModule,
    ProgramsModule,
    WorkoutHistoryModule,
    FeedModule,
    SupplementsModule,
    NotificationsModule,
    MacrosModule,
    CoachProfileModule,
    MonthlySummaryModule,
    CoachPlansModule,
    ChatModule,
    JoinModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
