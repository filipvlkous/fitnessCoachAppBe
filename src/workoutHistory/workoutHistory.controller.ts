import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { WorkoutHistoryService } from './workoutHistory.service';

@Controller('workoutHistory')
// @UseGuards(AuthGuard('jwt'))
export class WorkoutHistoryController {
  constructor(private readonly workoutHistoryService: WorkoutHistoryService) {}

  @Post()
  async getMonthHistory(@Body() body: { date: string }) {
    console.log(body.date);
    return this.workoutHistoryService.getMonthHistory(body.date);
  }

  @Get(':id')
  async getWorkoutStreak(@Param('id') id: string) {
    return this.workoutHistoryService.getWorkoutStreek(id);
  }

  @Get('userDay/:id')
  async getWorkoutHistoryForUserDay(@Param('id') id: string) {
    return this.workoutHistoryService.getWorkoutHistoryForUserDay(id);
  }
}
