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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { WorkoutHistoryService } from './workoutHistory.service';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import * as authReq from 'utils/authenticated-request.interface';
import { UserScopedCacheInterceptor } from 'utils/user-cache.interceptor';
import { AccessService } from 'src/auth/access.service';

export type WorkoutDayStatus = 'done' | 'partial' | 'empty' | 'rest';

export interface WeekDayStatus {
  date: string;
  status: WorkoutDayStatus;
  total_exercises: number;
  logged_exercises: number;
  workout_log_id: string | null;
  day_name: string | null;
}

@ApiTags('workout-history')
@ApiBearerAuth()
@Controller('workoutHistory')
@UseGuards(SupabaseAuthGuard)
export class WorkoutHistoryController {
  constructor(
    private readonly workoutHistoryService: WorkoutHistoryService,
    private readonly accessService: AccessService,
  ) {}

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60000)
  @Get()
  async getMonthHistory(
    @Query('date') date: string,
    @Query('user_workout_program_id') user_workout_program_id: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertProgramAccess(
      req.user.id,
      user_workout_program_id,
    );
    return await this.workoutHistoryService.getMonthHistory(
      date,
      user_workout_program_id,
    );
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60000)
  @Get('userDay/:id/short')
  async getWorkoutHistoryForUserDayShort(
    @Param('id') id: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertWorkoutLogAccess(req.user.id, id);
    return this.workoutHistoryService.getWorkoutHistoryForUserDayShort(id);
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60000)
  @Get('userDay/:id')
  async getWorkoutHistoryForUserDay(
    @Param('id') id: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertWorkoutLogAccess(req.user.id, id);
    return this.workoutHistoryService.getWorkoutHistoryForUserDay(id);
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60000)
  @Get('week-status')
  async getWeekStatus(
    @Req() req: authReq.AuthenticatedRequest,
    @Query('weekStart') weekStart: string,
  ) {
    return this.workoutHistoryService.getWeekStatus(req.user.id, weekStart);
  }

  // User-scoped cache: with a shared cache one coach's feed could be served
  // to another user on a cache hit, bypassing the access check.
  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(10000)
  @Get('coach-feed/:coachId')
  async getCoachFeedLogs(
    @Param('coachId') coachId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    this.accessService.assertSelf(req.user.id, coachId);
    return this.workoutHistoryService.getRecentCoachLogs(coachId);
  }
}
