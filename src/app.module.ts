import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { redisStore } from 'cache-manager-redis-yet';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseModule } from './supabase/supabase.module';
import { ImageAnalysisModule } from './image-analysis/image-analysis.module';
import { UserModule } from './user/user.module';
import { ExercisesModule } from './exercises/exercises.module';
import { ProgramsModule } from './program/programs.module';
import { WorkoutHistoryModule } from './workoutHistory/workoutHistory.module';
import { FeedModule } from './feed/feed.module';
import { SupplementsModule } from './supplements/supplements.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: async () => {
        const redisUrl = new URL(process.env.UPSTASH_REDIS_URL!);
        return {
          store: await redisStore({
            password: redisUrl.password,
            socket: {
              host: redisUrl.hostname,
              port: Number(redisUrl.port) || 6379,
              tls: true,
            },
            ttl: 60 * 1000, // default 60s in ms
          }),
        };
      },
    }),

    ScheduleModule.forRoot(),
    SupabaseModule,
    ImageAnalysisModule,
    UserModule,
    ExercisesModule,
    ProgramsModule,
    WorkoutHistoryModule,
    FeedModule,
    SupplementsModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
