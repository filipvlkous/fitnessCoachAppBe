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
    ]);
  }

  // Program-level endpoints (GET /:programId, GET /:programId/progress) are
  // cached with the plain CacheInterceptor (no user prefix) because their
  // responses are shared across users.  Invalidation therefore uses the
  // plain URL key, consistent with what CacheInterceptor stores.
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

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60000)
  @Get('users/:userId/all')
  getUserPrograms(@Param('userId') userId: string) {
    return this.programsService.getUserPrograms(userId);
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60000)
  @Get('users/:userId/active')
  getUserActiveProgram(@Param('userId') userId: string) {
    return this.programsService.getUserActiveProgram(userId);
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60000)
  @Get('exercises/:program_id/active/:dayNumber')
  getUserActiveDay(
    @Param('program_id') program_id: string,
    @Param('dayNumber') dayNumber: number,
  ) {
    return this.programsService.getUserActiveDay(program_id, dayNumber);
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60000)
  @Get('/users/:user_id/activeWeek')
  getUserActiveWeek(@Param('user_id') user_id: string) {
    return this.programsService.getUserActiveWeek(user_id);
  }

  @UseInterceptors(UserScopedCacheInterceptor)
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

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60000)
  @Get('days/:dayId')
  getDay(@Param('dayId') dayId: string) {
    return this.programsService.getProgramDay(dayId);
  }

  @UseInterceptors(UserScopedCacheInterceptor)
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
    await Promise.all([
      this.cacheManager.del(
        userCacheKey(req.user.id, `/programs/days/${dayId}`),
      ),
      this.invalidateUserCache(req.user.id),
    ]);
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
    await Promise.all([
      this.cacheManager.del(
        userCacheKey(req.user.id, `/programs/days/${dayId}`),
      ),
      this.invalidateUserCache(req.user.id),
    ]);
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
    await Promise.all([
      result?.program_day_id
        ? this.cacheManager.del(
            userCacheKey(
              req.user.id,
              `/programs/days/${result.program_day_id}`,
            ),
          )
        : Promise.resolve(),
      this.invalidateUserCache(req.user.id),
    ]);
    return result;
  }

  @Delete('exercises/:exerciseId')
  async removeExercise(
    @Param('exerciseId') exerciseId: string,
    @Req() req: any,
  ) {
    const result = await this.programsService.removeExerciseFromDay(exerciseId);
    await Promise.all([
      result?.program_day_id
        ? this.cacheManager.del(
            userCacheKey(
              req.user.id,
              `/programs/days/${result.program_day_id}`,
            ),
          )
        : Promise.resolve(),
      this.invalidateUserCache(req.user.id),
    ]);
    return result;
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
  ) {
    const result = await this.programsService.completeWorkout(
      workoutId,
      completeDto.program_day_id ?? '',
      completeDto.duration_minutes,
    );
    await this.cacheManager.del(`/programs/workouts/${workoutId}`);
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
  ) {
    const result = await this.programsService.addWorkoutComment(
      workoutId,
      commentDto.user_id,
      commentDto.author_role,
      commentDto.message,
    );
    // Invalidate the comment cache for *all* users who may have it cached.
    // Because comment lists are per-workout (not per-user), also delete the
    // user-scoped key belonging to the commenter so they see the update
    // immediately.
    await Promise.all([
      this.cacheManager.del(`/programs/workouts/${workoutId}/comments`),
      this.cacheManager.del(
        userCacheKey(
          commentDto.user_id,
          `/programs/workouts/${workoutId}/comments`,
        ),
      ),
    ]);
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
