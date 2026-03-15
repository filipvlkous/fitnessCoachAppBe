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
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ExercisesService } from './exercises.service';
import { CreateExerciseDto, UpdateExerciseDto } from './dto/exercises.dto';

interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

interface UploadedFiles {
  image?: UploadedFile[];
  video?: UploadedFile[];
}

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

  @Get(':id/media')
  getMedia(@Param('id') id: string) {
    return this.exercisesService.getMedia(id);
  }

  @Delete(':id/media')
  deleteMedia(
    @Param('id') id: string,
    @Query('type') type: 'image' | 'video' | 'both' = 'both',
  ) {
    return this.exercisesService.deleteMedia(id, type);
  }

  @Post(':exerciseId/upload-media')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'image', maxCount: 1 },
      { name: 'video', maxCount: 1 },
    ]),
  )
  async uploadMedia(
    @Param('exerciseId') exerciseId: string,
    @UploadedFiles()
    files: UploadedFiles,
  ) {
    if (!files.image && !files.video) {
      throw new BadRequestException(
        'At least one file (image or video) must be provided',
      );
    }

    const imageFile = files.image?.[0]
      ? { file: files.image[0].buffer, filename: files.image[0].originalname }
      : undefined;

    const videoFile = files.video?.[0]
      ? { file: files.video[0].buffer, filename: files.video[0].originalname }
      : undefined;

    const result = await this.exercisesService.uploadMedia(
      exerciseId,
      imageFile,
      videoFile,
    );

    return {
      message: 'Media uploaded and exercise updated successfully',
      data: result,
      info: {
        image: imageFile
          ? 'Image compressed to WebP format (80% quality)'
          : null,
        video: videoFile ? 'Video uploaded (max 100MB recommended)' : null,
      },
    };
  }
}
