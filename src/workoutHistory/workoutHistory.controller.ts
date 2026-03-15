import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';

import { WorkoutHistoryService } from './workoutHistory.service';

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
  userId: string;
  weekStart: string; // 'yyyy-MM-dd'
}

@Controller('workoutHistory')
// @UseGuards(AuthGuard('jwt'))
export class WorkoutHistoryController {
  constructor(private readonly workoutHistoryService: WorkoutHistoryService) {}

  @Post()
  async getMonthHistory(
    @Body() body: { date: string; user_workout_program_id: string },
  ) {
    return await this.workoutHistoryService.getMonthHistory(
      body.date,
      body.user_workout_program_id,
    );
  }

  @Get(':id')
  async getWorkoutStreak(@Param('id') id: string) {
    return this.workoutHistoryService.getWorkoutStreek(id);
  }

  @Get('userDay/:id')
  async getWorkoutHistoryForUserDay(@Param('id') id: string) {
    return this.workoutHistoryService.getWorkoutHistoryForUserDay(id);
  }

  @Post('week-status')
  async getWeekStatus(@Body() body: WeekStatusDto) {
    return this.workoutHistoryService.getWeekStatus(
      body.userId,
      body.weekStart,
    );
  }
}
