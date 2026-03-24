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
  Req,
  Inject,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import {
  CACHE_MANAGER,
  CacheInterceptor,
  CacheTTL,
} from '@nestjs/cache-manager';
import * as CacheManagerTypes from 'cache-manager';
import { ProgramsService } from './programs.service';
import * as dto from './dto/program.dto';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import {
  UserScopedCacheInterceptor,
  userCacheKey,
} from 'utils/user-cache.interceptor';

@Controller('programs')
@UseGuards(SupabaseAuthGuard)
export class ProgramsController {
  constructor(
    private programsService: ProgramsService,
    @Inject(CACHE_MANAGER) private cacheManager: CacheManagerTypes.Cache,
  ) {}

  private async invalidateUserCache(userId: string) {
    await Promise.all([
      this.cacheManager.del(
        userCacheKey(userId, `/programs/users/${userId}/all`),
      ),
      this.cacheManager.del(
        userCacheKey(userId, `/programs/users/${userId}/active`),
      ),
      this.cacheManager.del(
        userCacheKey(userId, `/programs/users/${userId}/activeWeek`),
      ),
      this.cacheManager.del(
        userCacheKey(userId, `/programs/users/${userId}/stats`),
      ),
      this.cacheManager.del(
        userCacheKey(userId, `/programs/users/${userId}/history`),
      ),
      this.cacheManager.del(userCacheKey(userId, '/workoutHistory/streak')),
    ]);
  }

  private async invalidateProgramCache(programId: string) {
    await Promise.all([
      this.cacheManager.del(`/programs/${programId}`),
      this.cacheManager.del(`/programs/${programId}/progress`),
    ]);
  }

  private async invalidateCoachCache(userId: string, coachId: string) {
    await Promise.all([
      this.cacheManager.del(`/programs/coach/${coachId}/programs`),
      this.cacheManager.del(
        userCacheKey(coachId, `/programs/coach/${coachId}/programs`),
      ),
    ]);
  }

  private async invalidateDayCache(userId: string, dayId: string) {
    await this.cacheManager.del(
      userCacheKey(userId, `/programs/days/${dayId}`),
    );
    await this.invalidateUserCache(userId);
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
    await this.invalidateCoachCache(createDto.user_id, createDto.coach_id);
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

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60)
  @Get('users/:userId/all')
  getUserPrograms(@Param('userId') userId: string) {
    return this.programsService.getUserPrograms(userId);
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60)
  @Get('users/:userId/active')
  getUserActiveProgram(@Param('userId') userId: string) {
    return this.programsService.getUserActiveProgram(userId);
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60)
  @Get('exercises/:program_id/active/:dayNumber')
  getUserActiveDay(
    @Param('program_id') program_id: string,
    @Param('dayNumber') dayNumber: number,
  ) {
    return this.programsService.getUserActiveDay(program_id, dayNumber);
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60)
  @Get('/users/:user_id/activeWeek')
  getUserActiveWeek(@Param('user_id') user_id: string) {
    return this.programsService.getUserActiveWeek(user_id);
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60)
  @Get('coach/:coachId/programs')
  getCoachPrograms(@Param('coachId') coachId: string) {
    return this.programsService.getCoachPrograms(coachId);
  }

  // ============================================
  // DAY MANAGEMENT (COACH)
  // ============================================

  @Post('days')
  async createDay(@Body() dayDto: dto.CreateProgramDayDto, @Req() req: any) {
    const result = await this.programsService.createProgramDay(dayDto);
    // Assuming the DTO has a program_id, you might want to invalidate that program's cache
    if (dayDto.program_id) {
      await this.invalidateProgramCache(dayDto.program_id);
    }
    return result;
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60)
  @Get('days/:dayId')
  getDay(@Param('dayId') dayId: string) {
    return this.programsService.getProgramDay(dayId);
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60)
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
  async updateDay(
    @Param('dayId') dayId: string,
    @Body() updateDto: dto.UpdateProgramDayDto,
    @Req() req: any,
  ) {
    const result = await this.programsService.updateProgramDay(
      dayId,
      updateDto,
    );
    // Requires athlete's user ID if coach is making the change
    await this.invalidateDayCache(req.user.id, dayId);
    return result;
  }

  @Delete('days/:dayId')
  async deleteDay(@Param('dayId') dayId: string, @Req() req: any) {
    const result = await this.programsService.deleteProgramDay(dayId);
    await this.invalidateDayCache(req.user.id, dayId);
    return result;
  }

  // ============================================
  // EXERCISE MANAGEMENT (COACH)
  // ============================================

  @Post('days/:dayId/exercises')
  async addExercise(
    @Param('dayId') dayId: string,
    @Body() body: { exercises: dto.AddExerciseDto[] },
    @Req() req: any,
  ) {
    const result = await this.programsService.addExerciseToDay(
      body.exercises,
      dayId,
    );
    await this.invalidateDayCache(req.user.id, dayId); // Better invalidation scope
    return result;
  }

  @Post('days/:dayId/exercises/update')
  async updateExercises(
    @Param('dayId') dayId: string,
    @Body() updateDto: dto.UpdateExercisesDto,
    @Req() req: any,
  ) {
    const result = await this.programsService.updateAssignedExercises(
      dayId,
      updateDto.exercises,
    );
    await this.invalidateDayCache(req.user.id, dayId); // Better invalidation scope
    return result;
  }

  @Put('exercises/:exerciseId')
  async updateExercise(
    @Param('exerciseId') exerciseId: string,
    @Body() updateDto: dto.UpdateExerciseDto,
    @Req() req: any,
  ) {
    const result = await this.programsService.updateAssignedExercise(
      exerciseId,
      updateDto,
    );

    if (result?.program_day_id) {
      await this.invalidateDayCache(req.user.id, result.program_day_id);
    }
    return result;
  }

  @Delete('exercises/:exerciseId')
  async removeExercise(
    @Param('exerciseId') exerciseId: string,
    @Req() req: any,
  ) {
    const result = await this.programsService.removeExerciseFromDay(exerciseId);
    if (result?.program_day_id) {
      await this.invalidateDayCache(req.user.id, result.program_day_id);
    }
    return result;
  }

  // ============================================
  // WORKOUT LOGGING (USER)
  // ============================================

  @Post('workouts')
  async logWorkout(@Body() logDto: dto.LogWorkoutDto, @Req() req: any) {
    const result = await this.programsService.logWorkout(logDto);
    await this.invalidateUserCache(req.user.id); // Triggers stats/history refresh
    return result;
  }

  @Post('workouts/logWorkoutSets')
  logExerciseSets(@Body() exerciseDto: dto.LogExerciseDto) {
    return this.programsService.logExerciseSets(exerciseDto);
  }

  @Put('workouts/:workout_id/complete')
  async completeWorkout(
    @Param('workout_id') workoutId: string,
    @Body() completeDto: dto.CompleteWorkoutDto,
    @Req() req: any,
  ) {
    const result = await this.programsService.completeWorkout(
      workoutId,
      completeDto.program_day_id ?? '',
      completeDto.duration_minutes,
    );

    await Promise.all([
      this.cacheManager.del(
        userCacheKey(req.user.id, `/programs/workouts/${workoutId}`),
      ),
      this.invalidateUserCache(req.user.id), // Needed for stats, history, and active status updates
    ]);
    return result;
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(30000)
  @Get('workouts/:workoutId')
  getWorkoutLog(@Param('workoutId') workoutId: string) {
    return this.programsService.getWorkoutLog(workoutId);
  }

  @UseInterceptors(UserScopedCacheInterceptor)
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
    @Req() req: any,
  ) {
    const result = await this.programsService.addWorkoutComment(
      workoutId,
      commentDto.user_id, // Highly recommend using this userId for invalidation if the coach is commenting
      commentDto.author_role,
      commentDto.message,
    );

    // Invalidates for the person making the request.
    // If a coach comments, the athlete won't see it until TTL expires unless you also invalidate the athlete's cache key!
    await this.cacheManager.del(
      userCacheKey(req.user.id, `/programs/workouts/${workoutId}/comments`),
    );

    // Safest bet if commentDto.user_id is the athlete:
    if (commentDto.user_id && commentDto.user_id !== req.user.id) {
      await this.cacheManager.del(
        userCacheKey(
          commentDto.user_id,
          `/programs/workouts/${workoutId}/comments`,
        ),
      );
    }

    return result;
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(30000)
  @Get('workouts/:workoutId/comments')
  getComments(@Param('workoutId') workoutId: string) {
    return this.programsService.getWorkoutComments(workoutId);
  }

  // ============================================
  // ANALYTICS / PROGRESS
  // ============================================

  @UseInterceptors(UserScopedCacheInterceptor)
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

  @UseInterceptors(UserScopedCacheInterceptor)
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
  async completeProgram(
    @Param('user_program_day_id') user_program_day_id: string,
    @Body() body: { day_name: string },
    @Req() req: any,
  ) {
    const result = await this.programsService.updateProgramDayName(
      user_program_day_id,
      body.day_name,
    );
    // Added day cache invalidation
    await this.invalidateDayCache(req.user.id, user_program_day_id);
    return result;
  }
}