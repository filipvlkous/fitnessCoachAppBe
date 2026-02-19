// src/exercises/exercises.module.ts
import { Module } from '@nestjs/common';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { WorkoutHistoryService } from './workoutHistory.service';
import { WorkoutHistoryController } from './workoutHistory.controller';

@Module({
  imports: [SupabaseModule],
  controllers: [WorkoutHistoryController],
  providers: [WorkoutHistoryService],
  exports: [WorkoutHistoryService],
})
export class WorkoutHistoryModule {}
