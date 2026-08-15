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
import {
  CACHE_MANAGER,
  CacheInterceptor,
  CacheTTL,
} from '@nestjs/cache-manager';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import * as CacheManagerTypes from 'cache-manager';
import { CoachProfileService } from './coachProfile.service';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import { UpdateCoachProfileDto } from './dto/coachProfile.dto';
import { SearchCoachProfilesDto } from './dto/searchCoach.dto';
import { AddReviewDto } from './dto/review.dto';
import {
  UserScopedCacheInterceptor,
  userCacheKey,
} from 'utils/user-cache.interceptor';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { AccessService } from 'src/auth/access.service';
import { UserService } from 'src/user/user.service';
import { AccessRequestService } from 'src/user/access-request.service';
import { CreateAccessRequestDto } from 'src/user/dto/access-request.dto';
import * as authReq from 'utils/authenticated-request.interface';

@ApiTags('coaches')
@ApiBearerAuth()
@Controller('coaches')
@UseGuards(SupabaseAuthGuard)
export class CoachProfileController {
  constructor(
    private readonly coachProfileService: CoachProfileService,
    private readonly accessService: AccessService,
    private readonly userService: UserService,
    private readonly accessRequestService: AccessRequestService,
    @Inject(CACHE_MANAGER) private cacheManager: CacheManagerTypes.Cache,
  ) {}

  private async invalidateProfileCache(coachId: string) {
    await Promise.all([
      this.cacheManager.del(
        userCacheKey(coachId, `/coaches/${coachId}/profile`),
      ),
      this.cacheManager.del(`/coaches/${coachId}/public-profile`),
    ]);
  }

  /**
   * GET /coaches/client/:clientId/permissions
   *
   * What the requesting coach may read about one of their clients, derived from
   * the client's own consent — never from anything the coach app sends.
   *
   * Not cached: a withdrawal has to take effect on the next read, and a stale
   * "true" here is the one answer this endpoint must never give.
   *
   * This is what the coach UI renders against; it is not the enforcement point.
   * Endpoints returning client data have to run the same check themselves, or
   * the data stays one direct HTTP request away from any coach token.
   */
  @Get('client/:clientId/permissions')
  async getClientPermissions(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    // 403 for a coach who is not connected to this client, rather than a blank
    // set of scopes: "you are not their coach" and "they share nothing with
    // you" are different answers and the app should not conflate them.
    await this.accessService.assertSelfOrCoach(req.user.id, clientId);
    return this.userService.getCoachDataAccess(clientId);
  }

  /**
   * POST /coaches/client/:clientId/access-request
   *
   * Ask a client to unlock one scope. Grants nothing: it sends them a prompt,
   * and the decision is theirs to record through the consent endpoints.
   *
   * Rate limiting lives in the schema (one open request per coach/client/scope)
   * and in the service (a cooldown after a decline). Both matter: an ask that
   * can be repeated at will is a way to pressure someone into consenting, and
   * consent given under pressure is not freely given.
   */
  @Post('client/:clientId/access-request')
  @HttpCode(HttpStatus.OK)
  async requestClientAccess(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: CreateAccessRequestDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    // assertSelfOrCoach would let a user "request access" to their own data,
    // which is meaningless, so the relation is checked directly instead.
    if (!(await this.accessService.isCoachOf(req.user.id, clientId))) {
      throw new ForbiddenException('Not your client');
    }
    return this.accessRequestService.createRequest(
      req.user.id,
      clientId,
      body.scope,
    );
  }

  @Get('search')
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
  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(300000)
  async getOwnProfile(
    @Param('coachId', ParseUUIDPipe) coachId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    this.assertOwner(req.user.id, coachId);
    return this.coachProfileService.getProfile(coachId);
  }

  /**
   * PUT /coaches/:coachId/profile
   * Private – authenticated coach updates their own profile.
   */
  @Put(':coachId/profile')
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @Param('coachId', ParseUUIDPipe) coachId: string,
    @Body() dto: UpdateCoachProfileDto,
    @Req() req: authReq.AuthenticatedRequest,
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
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(300000)
  async getPublicProfile(@Param('coachId', ParseUUIDPipe) coachId: string) {
    return this.coachProfileService.getPublicProfile(coachId);
  }

  @Post(':coachId/avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
      fileFilter: (_, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(new BadRequestException('Only images are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadAvatar(
    @Param('coachId') coachId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    this.assertOwner(req.user.id, coachId);
    if (!file) throw new BadRequestException('No file provided');
    const result = await this.coachProfileService.uploadAvatar(coachId, file);
    await this.invalidateProfileCache(coachId);
    return result;
  }

  @Post(':coachId/gallery')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(new BadRequestException('Only images are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadGalleryImages(
    @Param('coachId') coachId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    this.assertOwner(req.user.id, coachId);
    if (!files?.length) throw new BadRequestException('No files provided');
    const result = await this.coachProfileService.uploadGalleryImages(
      coachId,
      files,
    );
    await this.invalidateProfileCache(coachId);
    return result;
  }

  // The reviewer is always the authenticated user; the client cannot review
  // on someone else's behalf.
  @Post('review/:coachId')
  async addReview(
    @Param('coachId', ParseUUIDPipe) coachId: string,
    @Body() reviewDto: AddReviewDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    if (coachId === req.user.id) {
      throw new ForbiddenException('You cannot review yourself');
    }
    return await this.coachProfileService.addReview(
      coachId,
      req.user.id,
      reviewDto.rating,
      reviewDto.comment,
    );
  }

  @Get('review/:coachId')
  async getReviews(@Param('coachId', ParseUUIDPipe) coachId: string) {
    return await this.coachProfileService.getReviews(coachId);
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private assertOwner(requesterId: string, resourceOwnerId: string) {
    if (requesterId !== resourceOwnerId) {
      throw new ForbiddenException('You can only manage your own profile');
    }
  }
}
