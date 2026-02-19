// src/exercises/exercises.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  Query,
} from '@nestjs/common';
import { ExercisesService } from './exercises.service';
import { CreateExerciseDto, UpdateExerciseDto } from './dto/exercises.dto';

@Controller('exercises')
export class ExercisesController {
  constructor(private exercisesService: ExercisesService) {}

  @Post('create')
  create(@Body() dto: CreateExerciseDto) {
    return this.exercisesService.create(dto);
  }

  @Get()
  findAll(@Query('muscle_group') muscleGroup?: string) {
    return this.exercisesService.findAll(muscleGroup);
  }

  @Get('search')
  search(@Query('q') searchTerm: string) {
    return this.exercisesService.search(searchTerm);
  }

  @Get('muscle-groups')
  getMuscleGroups() {
    return this.exercisesService.getMuscleGroups();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.exercisesService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateExerciseDto) {
    return this.exercisesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.exercisesService.remove(id);
  }
}
