import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { redisStore } from 'cache-manager-redis-yet';
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

@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: async () => {
        const redisUrl = new URL(process.env.UPSTASH_REDIS_URL!);
        const store = await redisStore({
          password: redisUrl.password,
          socket: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port) || 6379,
            tls: true,
            // Retry with backoff so transient DNS/network blips don't kill the client.
            reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
          },
          ttl: 60 * 1000, // default 60s in ms
        });

        // Log connection errors instead of letting them crash the process.
        store.client.on('error', (err) => {
          console.error('Redis Connection Error:', err);
        });

        return { store };
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
