import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { WorkoutHistoryService } from './workoutHistory.service';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import * as authenticatedRequestInterface from 'utils/authenticated-request.interface';

export type WorkoutDayStatus = 'done' | 'partial' | 'empty' | 'rest';

export interface WeekDayStatus {
  date: string;
  status: WorkoutDayStatus;
  total_exercises: number;
  logged_exercises: number;
  workout_log_id: string | null;
  day_name: string | null;
}

class WeekStatusDto {
  weekStart: string; // 'yyyy-MM-dd'
}

@Controller('workoutHistory')
@UseGuards(SupabaseAuthGuard)
export class WorkoutHistoryController {
  constructor(private readonly workoutHistoryService: WorkoutHistoryService) {}

  @Post()
  async getMonthHistory(
    @Req() req: authenticatedRequestInterface.AuthenticatedRequest,
    @Body() body: { date: string; user_workout_program_id: string },
  ) {
    return await this.workoutHistoryService.getMonthHistory(
      body.date,
      body.user_workout_program_id,
    );
  }

  @Get('streak')
  async getWorkoutStreak(
    @Req() req: authenticatedRequestInterface.AuthenticatedRequest,
  ) {
    return this.workoutHistoryService.getWorkoutStreek(req.user.id);
  }

  @Get('userDay/:id')
  async getWorkoutHistoryForUserDay(@Param('id') id: string) {
    return this.workoutHistoryService.getWorkoutHistoryForUserDay(id);
  }

  @Post('week-status')
  async getWeekStatus(
    @Req() req: authenticatedRequestInterface.AuthenticatedRequest,
    @Body() body: WeekStatusDto,
  ) {
    return this.workoutHistoryService.getWeekStatus(
      req.user.id,
      body.weekStart,
    );
  }
}
