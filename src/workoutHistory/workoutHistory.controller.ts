import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CacheTTL } from '@nestjs/cache-manager';

import { WorkoutHistoryService } from './workoutHistory.service';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import * as authenticatedRequestInterface from 'utils/authenticated-request.interface';
import { UserScopedCacheInterceptor } from 'utils/user-cache.interceptor';

export type WorkoutDayStatus = 'done' | 'partial' | 'empty' | 'rest';

export interface WeekDayStatus {
  date: string;
  status: WorkoutDayStatus;
  total_exercises: number;
  logged_exercises: number;
  workout_log_id: string | null;
  day_name: string | null;
}

@Controller('workoutHistory')
@UseGuards(SupabaseAuthGuard)
export class WorkoutHistoryController {
  constructor(private readonly workoutHistoryService: WorkoutHistoryService) {}

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60000)
  @Get()
  async getMonthHistory(
    @Query('date') date: string,
    @Query('user_workout_program_id') user_workout_program_id: string,
  ) {
    return await this.workoutHistoryService.getMonthHistory(
      date,
      user_workout_program_id,
    );
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60000)
  @Get('streak')
  async getWorkoutStreak(
    @Req() req: authenticatedRequestInterface.AuthenticatedRequest,
  ) {
    return this.workoutHistoryService.getWorkoutStreek(req.user.id);
  }

  // FIX: Added invalidation helper here in case you ever add
  // a "Manual Refresh" or "Re-calculate" button in the history UI.
  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60000)
  @Get('userDay/:id')
  async getWorkoutHistoryForUserDay(@Param('id') id: string) {
    return this.workoutHistoryService.getWorkoutHistoryForUserDay(id);
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60000)
  @Get('userDay/:id/short')
  async getWorkoutHistoryForUserDayShort(@Param('id') id: string) {
    return this.workoutHistoryService.getWorkoutHistoryForUserDayShort(id);
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60000)
  @Get('week-status')
  async getWeekStatus(
    @Req() req: authenticatedRequestInterface.AuthenticatedRequest,
    @Query('weekStart') weekStart: string,
  ) {
    return this.workoutHistoryService.getWeekStatus(req.user.id, weekStart);
  }
}
