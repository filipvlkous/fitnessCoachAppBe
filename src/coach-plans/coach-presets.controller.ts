import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import * as CacheManagerTypes from 'cache-manager';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import { userCacheKey } from 'utils/user-cache.interceptor';
import * as authReq from 'utils/authenticated-request.interface';
import { AccessService } from 'src/auth/access.service';
import { CoachPlansService } from './coach-plans.service';
import {
  AssignPresetDto,
  CreatePresetDto,
  UpdatePresetDto,
} from './dto/coach-preset.dto';

/**
 * Program presets: a reusable training week made of the coach's day plans.
 *
 * Its own controller rather than more routes on `coach-plans`, where a
 * `presets` path would have to be declared ahead of `:planId` to avoid being
 * read as a plan id.
 */
@ApiTags('coach-presets')
@ApiBearerAuth()
@Controller('coach-presets')
@UseGuards(SupabaseAuthGuard)
export class CoachPresetsController {
  constructor(
    private coachPlansService: CoachPlansService,
    private accessService: AccessService,
    @Inject(CACHE_MANAGER) private cacheManager: CacheManagerTypes.Cache,
  ) {}

  // Cache keys are scoped to the requester, so a week written into a student's
  // program has to be cleared for the student and for the coach who wrote it.
  private async invalidateUserProgramCache(
    userId: string,
    requesterId?: string,
  ) {
    const readers = [...new Set([userId, requesterId])].filter(
      (id): id is string => !!id,
    );
    await Promise.all(
      ['all', 'active', 'activeWeek', 'stats', 'history'].flatMap((suffix) =>
        readers.map((readerId) =>
          this.cacheManager.del(
            userCacheKey(readerId, `/programs/users/${userId}/${suffix}`),
          ),
        ),
      ),
    );
  }

  @Get()
  async listPresets(@Req() req: authReq.AuthenticatedRequest) {
    await this.accessService.assertCoachRole(req.user.id);
    return this.coachPlansService.listPresets(req.user.id);
  }

  @Get(':presetId')
  async getPreset(
    @Req() req: authReq.AuthenticatedRequest,
    @Param('presetId') presetId: string,
  ) {
    await this.accessService.assertPresetOwner(req.user.id, presetId);
    return this.coachPlansService.getPreset(presetId);
  }

  @Post()
  async createPreset(
    @Req() req: authReq.AuthenticatedRequest,
    @Body() dto: CreatePresetDto,
  ) {
    await this.accessService.assertCoachRole(req.user.id);
    return this.coachPlansService.createPreset(req.user.id, dto);
  }

  // Snapshot model: editing a preset only changes the template. Weeks already
  // copied into a student's program are untouched.
  @Put(':presetId')
  async updatePreset(
    @Req() req: authReq.AuthenticatedRequest,
    @Param('presetId') presetId: string,
    @Body() dto: UpdatePresetDto,
  ) {
    await this.accessService.assertPresetOwner(req.user.id, presetId);
    return this.coachPlansService.updatePreset(req.user.id, presetId, dto);
  }

  @Delete(':presetId')
  async deletePreset(
    @Req() req: authReq.AuthenticatedRequest,
    @Param('presetId') presetId: string,
  ) {
    await this.accessService.assertPresetOwner(req.user.id, presetId);
    return this.coachPlansService.deletePreset(presetId);
  }

  // Write the whole week into a student's program. Enforces both "your preset"
  // and "your student".
  @Post(':presetId/assign')
  async assignPreset(
    @Req() req: authReq.AuthenticatedRequest,
    @Param('presetId') presetId: string,
    @Body() dto: AssignPresetDto,
  ) {
    await this.accessService.assertPresetOwner(req.user.id, presetId);
    if (!(await this.accessService.isCoachOf(req.user.id, dto.user_id))) {
      throw new ForbiddenException('Not your student');
    }
    const result = await this.coachPlansService.assignPresetToStudent(
      req.user.id,
      presetId,
      dto,
    );
    await this.invalidateUserProgramCache(dto.user_id, req.user.id);
    return result;
  }
}
