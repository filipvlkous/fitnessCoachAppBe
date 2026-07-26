import {
  Body,
  Controller,
  Delete,
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
import { ForbiddenException } from '@nestjs/common';
import * as CacheManagerTypes from 'cache-manager';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import { userCacheKey } from 'utils/user-cache.interceptor';
import * as authReq from 'utils/authenticated-request.interface';
import { AccessService } from 'src/auth/access.service';
import { CoachPlansService } from './coach-plans.service';
import { AssignPlanDto, CreatePlanDto, UpdatePlanDto } from './dto/coach-plan.dto';

@ApiTags('coach-plans')
@ApiBearerAuth()
@Controller('coach-plans')
@UseGuards(SupabaseAuthGuard)
export class CoachPlansController {
  constructor(
    private coachPlansService: CoachPlansService,
    private accessService: AccessService,
    @Inject(CACHE_MANAGER) private cacheManager: CacheManagerTypes.Cache,
  ) {}

  // Clear the read-model caches for a student whose program a plan touched.
  // Cache keys are scoped to the REQUESTER (user:<requesterId>:<url>), so the
  // coach's cached view of the student must be cleared too — otherwise the
  // coach keeps seeing stale data until the TTL expires.
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

  // List the requesting coach's own plans.
  @Get()
  async listPlans(@Req() req: authReq.AuthenticatedRequest) {
    await this.accessService.assertCoachRole(req.user.id);
    return this.coachPlansService.listPlans(req.user.id);
  }

  // Get one plan (must be owned by the requester).
  @Get(':planId')
  async getPlan(
    @Req() req: authReq.AuthenticatedRequest,
    @Param('planId') planId: string,
  ) {
    await this.accessService.assertPlanOwner(req.user.id, planId);
    return this.coachPlansService.getPlan(planId);
  }

  // Create a new one-day plan template.
  @Post()
  async createPlan(
    @Req() req: authReq.AuthenticatedRequest,
    @Body() dto: CreatePlanDto,
  ) {
    await this.accessService.assertCoachRole(req.user.id);
    return this.coachPlansService.createPlan(req.user.id, dto);
  }

  // Update a plan. Snapshot model: only the template changes — days already
  // assigned to students are untouched, so no student caches to invalidate.
  @Put(':planId')
  async updatePlan(
    @Req() req: authReq.AuthenticatedRequest,
    @Param('planId') planId: string,
    @Body() dto: UpdatePlanDto,
  ) {
    await this.accessService.assertPlanOwner(req.user.id, planId);
    return this.coachPlansService.updatePlan(planId, dto);
  }

  // Delete a plan (assigned student days are kept, just unlinked).
  @Delete(':planId')
  async deletePlan(
    @Req() req: authReq.AuthenticatedRequest,
    @Param('planId') planId: string,
  ) {
    await this.accessService.assertPlanOwner(req.user.id, planId);
    return this.coachPlansService.deletePlan(planId);
  }

  // Attach a plan to one of the coach's students. Enforces both "your plan"
  // and "your student".
  @Post(':planId/assign')
  async assignPlan(
    @Req() req: authReq.AuthenticatedRequest,
    @Param('planId') planId: string,
    @Body() dto: AssignPlanDto,
  ) {
    await this.accessService.assertPlanOwner(req.user.id, planId);
    if (!(await this.accessService.isCoachOf(req.user.id, dto.user_id))) {
      throw new ForbiddenException('Not your student');
    }
    const result = await this.coachPlansService.assignPlanToStudent(
      req.user.id,
      planId,
      dto,
    );
    await this.invalidateUserProgramCache(dto.user_id, req.user.id);
    return result;
  }
}
