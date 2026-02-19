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
} from '@nestjs/common';
import { ProgramsService } from './programs.service';
import * as dto from './dto/program.dto';

@Controller('programs')
export class ProgramsController {
  constructor(private programsService: ProgramsService) {}

  @Get('allExercises')
  getAllExercises() {
    return this.programsService.getAllExercises();
  }

  // ============================================
  // PROGRAM MANAGEMENT (COACH)
  // ============================================

  @Post()
  createProgram(@Body() createDto: dto.CreateUserProgramDto) {
    return this.programsService.createUserProgram(createDto);
  }

  @Put(':programId')
  updateProgram(
    @Param('programId') programId: string,
    @Body() updateDto: dto.UpdateProgramDto,
  ) {
    return this.programsService.updateProgram(programId, updateDto);
  }

  @Delete(':programId')
  deleteProgram(@Param('programId') programId: string) {
    return this.programsService.deleteProgram(programId);
  }

  @Get('users/:userId/all')
  getUserPrograms(@Param('userId') userId: string) {
    return this.programsService.getUserPrograms(userId);
  }

  @Get('users/:userId/active')
  getUserActiveProgram(@Param('userId') userId: string) {
    return this.programsService.getUserActiveProgram(userId);
  }

  @Get('exercises/:program_id/active/:dayNumber')
  getUserActiveDay(
    @Param('program_id') program_id: string,
    @Param('dayNumber') dayNumber: number,
  ) {
    return this.programsService.getUserActiveDay(program_id, dayNumber);
  }

  @Get('/users/:user_id/activeWeek')
  getUserActiveWeek(@Param('user_id') user_id: string) {
    console.log('getUserActiveWeek', user_id);
    return this.programsService.getUserActiveWeek(user_id);
  }

  @Get('coach/:coachId/programs')
  getCoachPrograms(@Param('coachId') coachId: string) {
    return this.programsService.getCoachPrograms(coachId);
  }

  // ============================================
  // DAY MANAGEMENT (COACH)
  // ============================================

  @Post('days')
  createDay(@Body() dayDto: dto.CreateProgramDayDto) {
    console.log(dayDto);
    return this.programsService.createProgramDay(dayDto);
  }

  @Get('days/:dayId')
  getDay(@Param('dayId') dayId: string) {
    return this.programsService.getProgramDay(dayId);
  }

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

  @Post('exercises')
  addExercise(@Body() exerciseDto: dto.AddExerciseDto[]) {
    return this.programsService.addExerciseToDay(exerciseDto);
  }

  @Post('days/:dayId/exercises/bulk')
  bulkAddExercises(
    @Param('dayId') dayId: string,
    @Body() bulkDto: dto.BulkAddExercisesDto,
  ) {
    return this.programsService.bulkAddExercisesToDay(dayId, bulkDto.exercises);
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
  completeWorkout(
    @Param('workout_id') workoutId: string,
    @Body() completeDto: dto.CompleteWorkoutDto,
  ) {
    return this.programsService.completeWorkout(
      workoutId,
      completeDto.duration_minutes,
    );
  }

  @Get('workouts/:workoutId')
  getWorkoutLog(@Param('workoutId') workoutId: string) {
    return this.programsService.getWorkoutLog(workoutId);
  }

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
  addComment(
    @Param('workoutId') workoutId: string,
    @Body() commentDto: dto.AddCommentDto,
  ) {
    return this.programsService.addWorkoutComment(
      workoutId,
      commentDto.user_id,
      commentDto.author_role,
      commentDto.message,
    );
  }

  @Get('workouts/:workoutId/comments')
  getComments(@Param('workoutId') workoutId: string) {
    return this.programsService.getWorkoutComments(workoutId);
  }

  // ============================================
  // ANALYTICS / PROGRESS
  // ============================================

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

  @Get('users/:userId/stats')
  getUserStats(@Param('userId') userId: string) {
    return this.programsService.getUserWorkoutStats(userId);
  }

  @Get(':programId/progress')
  getProgramProgress(@Param('programId') programId: string) {
    return this.programsService.getProgramProgress(programId);
  }

  @Get(':programId')
  getProgram(@Param('programId') programId: string) {
    return this.programsService.getUserProgram(programId);
  }
}
