// src/programs/programs.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  Inject,
  UseInterceptors,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import {
  CACHE_MANAGER,
  CacheInterceptor,
  CacheTTL,
} from '@nestjs/cache-manager';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import * as CacheManagerTypes from 'cache-manager';
import { ProgramsService } from './programs.service';
import * as dto from './dto/program.dto';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import {
  UserScopedCacheInterceptor,
  userCacheKey,
} from 'utils/user-cache.interceptor';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AccessService } from 'src/auth/access.service';
import * as authReq from 'utils/authenticated-request.interface';

@ApiTags('programs')
@ApiBearerAuth()
@Controller('programs')
@UseGuards(SupabaseAuthGuard)
export class ProgramsController {
  constructor(
    private programsService: ProgramsService,
    private notificationsService: NotificationsService,
    private accessService: AccessService,
    @Inject(CACHE_MANAGER) private cacheManager: CacheManagerTypes.Cache,
  ) {}

  private async invalidateUserCache(userId: string | null | undefined) {
    if (!userId) return;
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

  // Program detail is cached per user, so clear it for every participant.
  private async invalidateProgramCache(
    programId: string,
    ...ownerIds: (string | null | undefined)[]
  ) {
    const paths = [`/programs/${programId}`, `/programs/${programId}/progress`];
    const deletions = paths.map((path) => this.cacheManager.del(path));
    for (const ownerId of ownerIds) {
      if (!ownerId) continue;
      for (const path of paths) {
        deletions.push(this.cacheManager.del(userCacheKey(ownerId, path)));
      }
    }
    await Promise.all(deletions);
  }

  private async invalidateCoachCache(coachId: string | null | undefined) {
    if (!coachId) return;
    await this.cacheManager.del(
      userCacheKey(coachId, `/programs/coach/${coachId}/programs`),
    );
  }

  private async invalidateDayCache(requesterId: string, dayId: string) {
    // Always clear the day entry for the requester (may be the athlete themselves)
    await this.cacheManager.del(
      userCacheKey(requesterId, `/programs/days/${dayId}`),
    );
    await this.invalidateUserCache(requesterId);

    // If a coach is making the change, also clear the athlete's caches so they see the update immediately
    const athleteId = await this.programsService.getAthleteIdForDay(dayId);
    if (athleteId && athleteId !== requesterId) {
      await this.cacheManager.del(
        userCacheKey(athleteId, `/programs/days/${dayId}`),
      );
      await this.invalidateUserCache(athleteId);
    }
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
  async createProgram(
    @Body() createDto: dto.CreateUserProgramDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    // The requester must be a participant of the program they are creating.
    if (
      req.user.id !== createDto.coach_id &&
      req.user.id !== createDto.user_id
    ) {
      throw new ForbiddenException(
        'You can only create programs you participate in',
      );
    }
    if (req.user.id === createDto.coach_id) {
      await this.accessService.assertSelfOrCoach(
        req.user.id,
        createDto.user_id,
      );
    }

    const result = await this.programsService.createUserProgram(createDto);
    await this.invalidateUserCache(createDto.user_id);
    await this.invalidateCoachCache(createDto.coach_id);
    return result;
  }

  @Put(':programId')
  async updateProgram(
    @Param('programId') programId: string,
    @Body() updateDto: dto.UpdateProgramDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertProgramAccess(req.user.id, programId);
    const result = await this.programsService.updateProgram(
      programId,
      updateDto,
    );

    await this.invalidateProgramCache(
      programId,
      result?.user_id,
      result?.coach_id,
    );
    await this.invalidateUserCache(result?.user_id);
    await this.invalidateCoachCache(result?.coach_id);
    return result;
  }

  @Delete(':programId')
  async deleteProgram(
    @Param('programId') programId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertProgramAccess(req.user.id, programId);
    const result = await this.programsService.deleteProgram(programId);
    await this.invalidateProgramCache(
      programId,
      result.user_id,
      result.coach_id,
    );
    await this.invalidateUserCache(result.user_id);
    await this.invalidateCoachCache(result.coach_id);
    return result;
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60000)
  @Get('users/:userId/active')
  async getUserActiveProgram(
    @Param('userId') userId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, userId);
    return this.programsService.getUserActiveProgram(userId);
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60000)
  @Get('exercises/:program_id/active/:dayNumber')
  async getUserActiveDay(
    @Param('program_id') program_id: string,
    @Param('dayNumber') dayNumber: number,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertProgramAccess(req.user.id, program_id);
    return this.programsService.getUserActiveDay(program_id, dayNumber);
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60000)
  @Get('/users/:user_id/activeWeek')
  async getUserActiveWeek(
    @Param('user_id') user_id: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, user_id);
    return this.programsService.getUserActiveWeek(user_id);
  }

  // ============================================
  // DAY MANAGEMENT (COACH)
  // ============================================

  @Post('days')
  async createDay(
    @Body() dayDto: dto.CreateProgramDayDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    console.log('Creating program day:', dayDto);
    await this.accessService.assertProgramAccess(
      req.user.id,
      dayDto.program_id,
    );
    const result = await this.programsService.createProgramDay(dayDto);
    await this.invalidateProgramCache(dayDto.program_id, req.user.id);
    return result;
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60000)
  @Get('days/:dayId')
  async getDay(
    @Param('dayId') dayId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertDayAccess(req.user.id, dayId);
    return this.programsService.getProgramDay(dayId);
  }

  @Put('days/:dayId')
  async updateDay(
    @Param('dayId') dayId: string,
    @Body() updateDto: dto.UpdateProgramDayDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertDayAccess(req.user.id, dayId);
    const result = await this.programsService.updateProgramDay(
      dayId,
      updateDto,
    );
    await this.invalidateDayCache(req.user.id, dayId);
    return result;
  }

  @Delete('days/:dayId')
  async deleteDay(
    @Param('dayId') dayId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertDayAccess(req.user.id, dayId);
    // Invalidate before deleting; the athlete can't be resolved afterwards.
    await this.invalidateDayCache(req.user.id, dayId);
    return this.programsService.deleteProgramDay(dayId);
  }

  // ============================================
  // EXERCISE MANAGEMENT (COACH)
  // ============================================

  @Post('days/:dayId/exercises')
  async addExercise(
    @Param('dayId') dayId: string,
    @Body() body: dto.AddExercisesDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertDayAccess(req.user.id, dayId);
    const result = await this.programsService.addExerciseToDay(
      body.exercises,
      dayId,
    );
    await this.invalidateDayCache(req.user.id, dayId);

    // Notify the athlete resolved from the day, not a client-supplied ID.
    const athleteId = await this.programsService.getAthleteIdForDay(dayId);
    if (athleteId && athleteId !== req.user.id) {
      this.notificationsService.notifyUser(athleteId, {
        title: 'Program Updated',
        body: `Exercises have been updated for your program day. Please check the app for details.`,
      });
    }
    return result;
  }

  @Post('days/:dayId/exercises/update')
  async updateExercises(
    @Param('dayId') dayId: string,
    @Body() updateDto: dto.UpdateExercisesDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertDayAccess(req.user.id, dayId);
    const result = await this.programsService.updateAssignedExercises(
      dayId,
      updateDto.exercises,
    );
    await this.invalidateDayCache(req.user.id, dayId);
    return result;
  }

  @Put('exercises/:exerciseId')
  async updateExercise(
    @Param('exerciseId') exerciseId: string,
    @Body() updateDto: dto.UpdateExerciseDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertAssignedExerciseAccess(
      req.user.id,
      exerciseId,
    );
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
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertAssignedExerciseAccess(
      req.user.id,
      exerciseId,
    );
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
  async logWorkout(
    @Body() logDto: dto.LogWorkoutDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertProgramAccess(
      req.user.id,
      logDto.workout_id,
    );
    const result = await this.programsService.logWorkout(logDto);
    await this.invalidateUserCache(req.user.id); // Triggers stats/history refresh
    return result;
  }

  @Post('workouts/logWorkoutSets')
  async logExerciseSets(
    @Body() exerciseDto: dto.LogExerciseDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertWorkoutLogAccess(
      req.user.id,
      exerciseDto.workout_log_id,
    );
    const result = await this.programsService.logExerciseSets(exerciseDto);
    await this.cacheManager.del(
      userCacheKey(
        req.user.id,
        `/programs/workouts/${exerciseDto.workout_log_id}`,
      ),
    );
    return result;
  }

  @Post('workouts/logCardio')
  async logCardio(
    @Body() cardioDto: dto.LogCardioDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertWorkoutLogAccess(
      req.user.id,
      cardioDto.workout_log_id,
    );
    const result = await this.programsService.logCardio(cardioDto);
    await Promise.all([
      this.cacheManager.del(
        userCacheKey(
          req.user.id,
          `/programs/workouts/${cardioDto.workout_log_id}`,
        ),
      ),
      this.invalidateUserCache(req.user.id),
    ]);
    return result;
  }

  @Put('workouts/:workout_id/complete')
  async completeWorkout(
    @Param('workout_id') workoutId: string,
    @Body() completeDto: dto.CompleteWorkoutDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertWorkoutLogAccess(req.user.id, workoutId);
    const result = await this.programsService.completeWorkout(
      workoutId,
      req.user.id,
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

  // ============================================
  // COMMENTS
  // ============================================

  @Post('workouts/:workoutId/comments')
  async addComment(
    @Param('workoutId') workoutId: string,
    @Body() commentDto: dto.AddCommentDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertWorkoutLogAccess(req.user.id, workoutId);
    const result = await this.programsService.addWorkoutComment(
      workoutId,
      req.user.id,
      commentDto.author_role,
      commentDto.message,
    );

    // Invalidate for the requester and, if a coach is commenting, for the athlete.
    await this.cacheManager.del(
      userCacheKey(req.user.id, `/programs/workouts/${workoutId}/comments`),
    );
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
  async getComments(
    @Param('workoutId') workoutId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertWorkoutLogAccess(req.user.id, workoutId);
    return this.programsService.getWorkoutComments(workoutId);
  }

  // User-scoped cache: a shared cache here would leak one user's program to
  // another and bypass the access check on cache hits.
  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(60000)
  @Get(':programId')
  async getProgram(
    @Param('programId') programId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertProgramAccess(req.user.id, programId);
    return this.programsService.getUserProgram(programId);
  }

  @Post(':user_program_day_id/update-name')
  async updateDayName(
    @Param('user_program_day_id') user_program_day_id: string,
    @Body() body: dto.UpdateDayNameDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertDayAccess(req.user.id, user_program_day_id);
    const result = await this.programsService.updateProgramDayName(
      user_program_day_id,
      body.day_name,
    );
    await this.invalidateDayCache(req.user.id, user_program_day_id);
    return result;
  }
}
