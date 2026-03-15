// src/programs/programs.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Inject,
  UseInterceptors,
} from '@nestjs/common';
import {
  CACHE_MANAGER,
  CacheInterceptor,
  CacheTTL,
} from '@nestjs/cache-manager';
import * as CacheManagerTypes from 'cache-manager';
import { ProgramsService } from './programs.service';
import * as dto from './dto/program.dto';

@Controller('programs')
export class ProgramsController {
  constructor(
    private programsService: ProgramsService,
    @Inject(CACHE_MANAGER) private cacheManager: CacheManagerTypes.Cache,
  ) {}

  private async invalidateUserCache(userId: string) {
    await Promise.all([
      this.cacheManager.del(`/programs/users/${userId}/all`),
      this.cacheManager.del(`/programs/users/${userId}/active`),
      this.cacheManager.del(`/programs/users/${userId}/activeWeek`),
      this.cacheManager.del(`/programs/users/${userId}/stats`),
    ]);
  }

  private async invalidateProgramCache(programId: string) {
    await Promise.all([
      this.cacheManager.del(`/programs/${programId}`),
      this.cacheManager.del(`/programs/${programId}/progress`),
    ]);
  }

  @UseInterceptors(CacheInterceptor)
  @CacheTTL(300000)
  @Get('allExercises')
  getAllExercises() {
    return this.programsService.getAllExercises();
  }

  // ============================================
  // PROGRAM MANAGEMENT (COACH)
  // ============================================

  @Post()
  async createProgram(@Body() createDto: dto.CreateUserProgramDto) {
    const result = await this.programsService.createUserProgram(createDto);
    await this.invalidateUserCache(createDto.user_id);
    await this.cacheManager.del(
      `/programs/coach/${createDto.coach_id}/programs`,
    );
    return result;
  }

  @Put(':programId')
  async updateProgram(
    @Param('programId') programId: string,
    @Body() updateDto: dto.UpdateProgramDto,
  ) {
    const result = await this.programsService.updateProgram(
      programId,
      updateDto,
    );
    await this.invalidateProgramCache(programId);
    return result;
  }

  @Delete(':programId')
  async deleteProgram(@Param('programId') programId: string) {
    const result = await this.programsService.deleteProgram(programId);
    await this.invalidateProgramCache(programId);
    return result;
  }

  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60000)
  @Get('users/:userId/all')
  getUserPrograms(@Param('userId') userId: string) {
    return this.programsService.getUserPrograms(userId);
  }

  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60000)
  @Get('users/:userId/active')
  getUserActiveProgram(@Param('userId') userId: string) {
    return this.programsService.getUserActiveProgram(userId);
  }

  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60000)
  @Get('exercises/:program_id/active/:dayNumber')
  getUserActiveDay(
    @Param('program_id') program_id: string,
    @Param('dayNumber') dayNumber: number,
  ) {
    return this.programsService.getUserActiveDay(program_id, dayNumber);
  }

  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60000)
  @Get('/users/:user_id/activeWeek')
  getUserActiveWeek(@Param('user_id') user_id: string) {
    return this.programsService.getUserActiveWeek(user_id);
  }

  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60000)
  @Get('coach/:coachId/programs')
  getCoachPrograms(@Param('coachId') coachId: string) {
    return this.programsService.getCoachPrograms(coachId);
  }

  // ============================================
  // DAY MANAGEMENT (COACH)
  // ============================================

  @Post('days')
  createDay(@Body() dayDto: dto.CreateProgramDayDto) {
    return this.programsService.createProgramDay(dayDto);
  }

  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60000)
  @Get('days/:dayId')
  getDay(@Param('dayId') dayId: string) {
    return this.programsService.getProgramDay(dayId);
  }

  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60000)
  @Get(':programId/week/:weekNumber/day/:dayNumber')
  getDayByNumber(
    @Param('programId') programId: string,
    @Param('weekNumber') weekNumber: number,
    @Param('dayNumber') dayNumber: number,
  ) {
    return this.programsService.getProgramDayByNumber(
      programId,
      +weekNumber,
      +dayNumber,
    );
  }

  @Put('days/:dayId')
  updateDay(
    @Param('dayId') dayId: string,
    @Body() updateDto: dto.UpdateProgramDayDto,
  ) {
    return this.programsService.updateProgramDay(dayId, updateDto);
  }

  @Delete('days/:dayId')
  deleteDay(@Param('dayId') dayId: string) {
    return this.programsService.deleteProgramDay(dayId);
  }

  // ============================================
  // EXERCISE MANAGEMENT (COACH)
  // ============================================

  @Post('days/exercises')
  addExercise(
    @Param('dayId') dayId: string,
    @Body() body: { exercises: dto.AddExerciseDto[]; day_name?: string },
  ) {
    return this.programsService.addExerciseToDay(body.exercises);
  }

  @Post('days/:dayId/exercises/update')
  updateExercises(
    @Param('dayId') dayId: string,
    @Body() updateDto: dto.UpdateExercisesDto,
  ) {
    return this.programsService.updateAssignedExercises(
      dayId,
      updateDto.exercises,
    );
  }

  @Put('exercises/:exerciseId')
  updateExercise(
    @Param('exerciseId') exerciseId: string,
    @Body() updateDto: dto.UpdateExerciseDto,
  ) {
    return this.programsService.updateAssignedExercise(exerciseId, updateDto);
  }

  @Delete('exercises/:exerciseId')
  removeExercise(@Param('exerciseId') exerciseId: string) {
    return this.programsService.removeExerciseFromDay(exerciseId);
  }

  // ============================================
  // WORKOUT LOGGING (USER)
  // ============================================

  @Post('workouts')
  logWorkout(@Body() logDto: dto.LogWorkoutDto) {
    return this.programsService.logWorkout(logDto);
  }

  @Post('workouts/logWorkoutSets')
  logExerciseSets(@Body() exerciseDto: dto.LogExerciseDto) {
    return this.programsService.logExerciseSets(exerciseDto);
  }

  @Put('workouts/:workout_id/complete')
  async completeWorkout(
    @Param('workout_id') workoutId: string,
    @Body() completeDto: dto.CompleteWorkoutDto,
    @Body() program_day_id: string,
  ) {
    const result = await this.programsService.completeWorkout(
      workoutId,
      program_day_id,
      completeDto.duration_minutes,
    );
    await this.cacheManager.del(`/programs/workouts/${workoutId}`);
    return result;
  }

  @UseInterceptors(CacheInterceptor)
  @CacheTTL(30000)
  @Get('workouts/:workoutId')
  getWorkoutLog(@Param('workoutId') workoutId: string) {
    return this.programsService.getWorkoutLog(workoutId);
  }

  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60000)
  @Get('users/:userId/history')
  getWorkoutHistory(
    @Param('userId') userId: string,
    @Query('limit') limit?: number,
  ) {
    return this.programsService.getWorkoutHistory(userId, limit ? +limit : 30);
  }

  // ============================================
  // COMMENTS
  // ============================================

  @Post('workouts/:workoutId/comments')
  async addComment(
    @Param('workoutId') workoutId: string,
    @Body() commentDto: dto.AddCommentDto,
  ) {
    const result = await this.programsService.addWorkoutComment(
      workoutId,
      commentDto.user_id,
      commentDto.author_role,
      commentDto.message,
    );
    await this.cacheManager.del(`/programs/workouts/${workoutId}/comments`);
    return result;
  }

  @UseInterceptors(CacheInterceptor)
  @CacheTTL(30000)
  @Get('workouts/:workoutId/comments')
  getComments(@Param('workoutId') workoutId: string) {
    return this.programsService.getWorkoutComments(workoutId);
  }

  // ============================================
  // ANALYTICS / PROGRESS
  // ============================================

  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60000)
  @Get('users/:userId/exercises/:exerciseId/progress')
  getExerciseProgress(
    @Param('userId') userId: string,
    @Param('exerciseId') exerciseId: string,
    @Query('limit') limit?: number,
  ) {
    return this.programsService.getExerciseProgress(
      userId,
      exerciseId,
      limit ? +limit : 20,
    );
  }

  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60000)
  @Get('users/:userId/stats')
  getUserStats(@Param('userId') userId: string) {
    return this.programsService.getUserWorkoutStats(userId);
  }

  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60000)
  @Get(':programId/progress')
  getProgramProgress(@Param('programId') programId: string) {
    return this.programsService.getProgramProgress(programId);
  }

  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60000)
  @Get(':programId')
  getProgram(@Param('programId') programId: string) {
    return this.programsService.getUserProgram(programId);
  }

  @Post(':user_program_day_id/update-name')
  completeProgram(
    @Param('user_program_day_id') user_program_day_id: string,
    @Body() body: { day_name: string },
  ) {
    return this.programsService.updateProgramDayName(
      user_program_day_id,
      body.day_name,
    );
  }
}
