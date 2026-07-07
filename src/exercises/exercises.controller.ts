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
  Req,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { CACHE_MANAGER, CacheTTL } from '@nestjs/cache-manager';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import * as CacheManagerTypes from 'cache-manager';
import { ExercisesService } from './exercises.service';
import {
  CreateExerciseDto,
  UpdateExerciseCatalogDto,
} from './dto/exercises.dto';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import { UserScopedCacheInterceptor } from 'utils/user-cache.interceptor';
import { AccessService } from 'src/auth/access.service';
import * as authReq from 'utils/authenticated-request.interface';

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

@ApiTags('exercises')
@ApiBearerAuth()
@Controller('exercises')
@UseGuards(SupabaseAuthGuard)
export class ExercisesController {
  constructor(
    private exercisesService: ExercisesService,
    private accessService: AccessService,
    @Inject(CACHE_MANAGER) private cacheManager: CacheManagerTypes.Cache,
  ) {}

  // The exercise catalogue is shared, so only coaches may modify it.
  @Post('create')
  async create(
    @Body() dto: CreateExerciseDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertCoachRole(req.user.id);
    const result = await this.exercisesService.create(dto);
    await this.cacheManager.del('/exercises');
    return result;
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(300000)
  @Get()
  findAll(@Query('muscle_group') muscleGroup?: string) {
    return this.exercisesService.findAll(muscleGroup);
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(300000)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.exercisesService.findOne(id);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateExerciseCatalogDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertCoachRole(req.user.id);
    await this.exercisesService.update(id, dto);

    // Delete both possible key patterns to be safe
    await this.cacheManager.del(`/exercises/${id}`);
    await this.cacheManager.del('/exercises');
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertCoachRole(req.user.id);
    const result = await this.exercisesService.remove(id);
    await this.cacheManager.del(`/exercises/${id}`);
    await this.cacheManager.del(`/exercises/${id}/media`);
    await this.cacheManager.del('/exercises');
    return result;
  }

  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(300000)
  @Get(':id/media')
  getMedia(
    @Param('id') id: string,
    @Query('type') type: 'image' | 'video' | 'both' = 'both',
  ) {
    return this.exercisesService.getMedia(id, type);
  }

  @Delete(':id/media')
  async deleteMedia(
    @Param('id') id: string,
    @Req() req: authReq.AuthenticatedRequest,
    @Query('type') type: 'image' | 'video' | 'both' = 'both',
  ) {
    await this.accessService.assertCoachRole(req.user.id);
    const result = await this.exercisesService.deleteMedia(id, type);
    await this.cacheManager.del(`/exercises/${id}/media`);
    await this.cacheManager.del(`/exercises/${id}`);
    return result;
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
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertCoachRole(req.user.id);
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

    await Promise.all([
      this.cacheManager.del(`/exercises/${exerciseId}`),
      this.cacheManager.del(`/exercises/${exerciseId}/media`),
    ]);

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
