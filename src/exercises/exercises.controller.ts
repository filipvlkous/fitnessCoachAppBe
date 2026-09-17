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
  UpsertCoachExerciseVersionDto,
} from './dto/exercises.dto';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import { UserScopedCacheInterceptor } from 'utils/user-cache.interceptor';
import { AccessService } from 'src/auth/access.service';
import * as authReq from 'utils/authenticated-request.interface';
import {
  assertWithinLimit,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  mediaFileFilter,
} from 'utils/upload-limits';

interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

interface UploadedFiles {
  image?: UploadedFile[];
  image2?: UploadedFile[];
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
    await this.cacheManager.del('/exercises');
    return result;
  }

  // Answers with the catalogue's media, overlaid field by field with the
  // version written by this viewer's coach — so the same URL gives two athletes
  // with different coaches different content.
  //
  // Deliberately not cached. Entries were keyed per reader, so every write that
  // changes the answer (a gallery upload, a removed picture, a coach's version)
  // would have to reach each reader's entry — and the shared catalogue has no
  // list of who read it. The writes missed, and clients kept the old gallery
  // for five minutes after a coach changed it.
  @Get(':id/media')
  getMedia(
    @Param('id') id: string,
    @Req() req: authReq.AuthenticatedRequest,
    @Query('type') type: 'image' | 'video' | 'both' = 'both',
  ) {
    return this.exercisesService.getMedia(id, type, req.user.id);
  }

  @Delete(':id/media')
  async deleteMedia(
    @Param('id') id: string,
    @Req() req: authReq.AuthenticatedRequest,
    @Query('type') type: 'image' | 'image2' | 'video' | 'both' = 'both',
  ) {
    await this.accessService.assertCoachRole(req.user.id);
    const result = await this.exercisesService.deleteMedia(id, type);
    await this.cacheManager.del(`/exercises/${id}`);
    return result;
  }

  @Post(':exerciseId/upload-media')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'image', maxCount: 1 },
        { name: 'image2', maxCount: 1 },
        { name: 'video', maxCount: 1 },
      ],
      {
        // One number covers every field, so it has to be the largest one; the
        // images are held to their own cap in the handler below.
        limits: { fileSize: MAX_VIDEO_BYTES },
        fileFilter: mediaFileFilter({
          image: 'image',
          image2: 'image',
          video: 'video',
        }),
      },
    ),
  )
  async uploadMedia(
    @Param('exerciseId') exerciseId: string,
    @UploadedFiles()
    files: UploadedFiles,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertCoachRole(req.user.id);
    if (!files.image && !files.image2 && !files.video) {
      throw new BadRequestException(
        'At least one file (image, image2 or video) must be provided',
      );
    }

    const image = files.image?.[0];
    const image2 = files.image2?.[0];
    const video = files.video?.[0];

    if (image) assertWithinLimit(image.size, MAX_IMAGE_BYTES, 'Image');
    if (image2) assertWithinLimit(image2.size, MAX_IMAGE_BYTES, 'Image');

    const imageFile = image
      ? { file: image.buffer, filename: image.originalname }
      : undefined;

    const image2File = image2
      ? { file: image2.buffer, filename: image2.originalname }
      : undefined;

    const videoFile = video
      ? {
          file: video.buffer,
          filename: video.originalname,
          mimetype: video.mimetype,
        }
      : undefined;

    const result = await this.exercisesService.uploadMedia(
      exerciseId,
      imageFile,
      videoFile,
      image2File,
    );

    await this.cacheManager.del(`/exercises/${exerciseId}`);

    return {
      message: 'Media uploaded and exercise updated successfully',
      data: result,
      info: {
        image:
          imageFile || image2File
            ? 'Image compressed to WebP format (80% quality)'
            : null,
        video: videoFile ? 'Video uploaded (max 100MB recommended)' : null,
      },
    };
  }

  // ── A coach's own version of a catalogue exercise ──────────────────────────
  //
  // The catalogue is shared and any coach may edit it, so a coach who wants to
  // cue a movement their own way had to overwrite everyone else's wording.
  // These four endpoints give them a private layer instead: their text, image
  // and YouTube link, read back only by them and their approved clients.
  // `/media` is not cached, so a saved version shows on the client's next read.

  /** The requesting coach's own version. Null when they have written none. */
  @Get(':id/coach-version')
  async getCoachVersion(
    @Param('id') id: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertCoachRole(req.user.id);
    return this.exercisesService.getCoachVersion(id, req.user.id);
  }

  @Put(':id/coach-version')
  async upsertCoachVersion(
    @Param('id') id: string,
    @Body() dto: UpsertCoachExerciseVersionDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertCoachRole(req.user.id);
    return this.exercisesService.upsertCoachVersion(id, req.user.id, dto);
  }

  @Post(':id/coach-version/image')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'image', maxCount: 1 }], {
      limits: { fileSize: MAX_IMAGE_BYTES },
      fileFilter: mediaFileFilter({ image: 'image' }),
    }),
  )
  async uploadCoachVersionImage(
    @Param('id') id: string,
    @UploadedFiles() files: UploadedFiles,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertCoachRole(req.user.id);

    const image = files.image?.[0];
    if (!image) throw new BadRequestException('An image file must be provided');

    return this.exercisesService.uploadCoachVersionImage(id, req.user.id, {
      file: image.buffer,
      filename: image.originalname,
    });
  }

  /** `part=image` clears just the picture; the default removes the version. */
  @Delete(':id/coach-version')
  async deleteCoachVersion(
    @Param('id') id: string,
    @Req() req: authReq.AuthenticatedRequest,
    @Query('part') part: 'image' | 'all' = 'all',
  ) {
    await this.accessService.assertCoachRole(req.user.id);
    return this.exercisesService.deleteCoachVersion(id, req.user.id, part);
  }
}
