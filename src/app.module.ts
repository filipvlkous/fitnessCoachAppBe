import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseModule } from './supabase/supabase.module';
import { ImageAnalysisModule } from './image-analysis/image-analysis.module';
import { UserModule } from './user/user.module';
import { ExercisesModule } from './exercises/exercises.module';
import { ProgramsModule } from './program/programs.module';
import { WorkoutHistoryModule } from './workoutHistory/workoutHistory.module';

@Module({
  imports: [
    SupabaseModule,
    ImageAnalysisModule,
    UserModule,
    ExercisesModule,
    ProgramsModule,
    WorkoutHistoryModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
