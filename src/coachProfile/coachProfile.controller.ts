import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  UseGuards,
  Req,
  ForbiddenException,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Query,
  Inject,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Post,
  UploadedFiles,
} from '@nestjs/common';
import { Multer } from 'multer';
import {
  CACHE_MANAGER,
  CacheInterceptor,
  CacheTTL,
} from '@nestjs/cache-manager';
import * as CacheManagerTypes from 'cache-manager';
import { CoachProfileService } from './coachProfile.service';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import { UpdateCoachProfileDto } from './dto/coachProfile.dto';
import { SearchCoachProfilesDto } from './dto/searchCoach.dto';
import {
  UserScopedCacheInterceptor,
  userCacheKey,
} from 'utils/user-cache.interceptor';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';

@Controller('coaches')
export class CoachProfileController {
  constructor(
    private readonly coachProfileService: CoachProfileService,
    @Inject(CACHE_MANAGER) private cacheManager: CacheManagerTypes.Cache,
  ) {}

  private async invalidateProfileCache(coachId: string) {
    await Promise.all([
      this.cacheManager.del(userCacheKey(coachId, `/coaches/${coachId}/profile`)),
      this.cacheManager.del(`/coaches/${coachId}/public-profile`),
    ]);
  }

@Get('search')
@UseGuards(SupabaseAuthGuard)
@UseInterceptors(CacheInterceptor)
@CacheTTL(60000)
async searchCoaches(@Query() dto: SearchCoachProfilesDto) {
  return this.coachProfileService.searchProfiles(dto);
}

  /**
   * GET /coaches/:coachId/profile
   * Private – authenticated coach fetches their own profile.
   */
  @Get(':coachId/profile')
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(300000)
  async getOwnProfile(
    @Param('coachId', ParseUUIDPipe) coachId: string,
    @Req() req: any,
  ) {
    this.assertOwner(req.user.id, coachId);
    return this.coachProfileService.getProfile(coachId);
  }

  /**
   * PUT /coaches/:coachId/profile
   * Private – authenticated coach updates their own profile.
   */
  @Put(':coachId/profile')
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @Param('coachId', ParseUUIDPipe) coachId: string,
    @Body() dto: UpdateCoachProfileDto,
    @Req() req: any,
  ) {
    this.assertOwner(req.user.id, coachId);
    const result = await this.coachProfileService.upsertProfile(coachId, dto);
    await this.invalidateProfileCache(coachId);
    return result;
  }

  /**
   * GET /coaches/:coachId/public-profile
   * Public – any authenticated user (e.g. a client) can view a coach profile.
   */
  @Get(':coachId/public-profile')
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(300000)
  async getPublicProfile(
    @Param('coachId', ParseUUIDPipe) coachId: string,
  ) {
    return this.coachProfileService.getPublicProfile(coachId);
  }


@Post(':coachId/avatar')
@UseInterceptors(FileInterceptor('file', {
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new BadRequestException('Only images are allowed'), false);
    }
    cb(null, true);
  },
}))
async uploadAvatar(
  @Param('coachId') coachId: string,
  @UploadedFile() file: Express.Multer.File,
) {
  if (!file) throw new BadRequestException('No file provided');
  return this.coachProfileService.uploadAvatar(coachId, file);
}

@Post(':coachId/gallery')
@UseInterceptors(FilesInterceptor('files', 10, {
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new BadRequestException('Only images are allowed'), false);
    }
    cb(null, true);
  },
}))

async uploadGalleryImages(
  @Param('coachId') coachId: string,
  @UploadedFiles() files: Express.Multer.File[],
) {
  if (!files?.length) throw new BadRequestException('No files provided');
  return this.coachProfileService.uploadGalleryImages(coachId, files);
}

  // ── helpers ──────────────────────────────────────────────────────────────

  private assertOwner(requesterId: string, resourceOwnerId: string) {
    if (requesterId !== resourceOwnerId) {
      throw new ForbiddenException('You can only manage your own profile');
    }
  }

  @Post('review/:coachId/:clientId')
  async addReview(
    @Param('coachId') coachId: string,
    @Param('clientId') clientId: string,
    @Body() reviewDto: { rating: number; comment?: string },
  ) {
       return this.coachProfileService.addReview(coachId, clientId, reviewDto.rating, reviewDto.comment);
  }

   @Get('review/:coachId')
  async getReviews(
    @Param('coachId') coachId: string,
  ) {
       return this.coachProfileService.getReviews(coachId);
  }
}
