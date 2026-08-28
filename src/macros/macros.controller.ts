import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  Inject,
  UseInterceptors,
} from '@nestjs/common';
import { CACHE_MANAGER, CacheTTL } from '@nestjs/cache-manager';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import * as CacheManagerTypes from 'cache-manager';
import { MacrosService } from './macros.service';
import { SetMacrosDto } from './dto/macros.dto';
import { UpdateMealDto } from './dto/meal-edit.dto';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import {
  UserScopedCacheInterceptor,
  userCacheKey,
} from 'utils/user-cache.interceptor';
import { localDateStr } from 'utils/getLocalTime';
import { AccessService } from 'src/auth/access.service';
import * as authReq from 'utils/authenticated-request.interface';

@ApiTags('macros')
@ApiBearerAuth()
@Controller('macros')
@UseGuards(SupabaseAuthGuard)
export class MacrosController {
  constructor(
    private readonly macrosService: MacrosService,
    private readonly accessService: AccessService,
    @Inject(CACHE_MANAGER) private cacheManager: CacheManagerTypes.Cache,
  ) {}

  /**
   * Drop every cached copy of this user's macros.
   *
   * `UserScopedCacheInterceptor` keys entries by the *requester*, not by the
   * user the data belongs to, so clearing only the target's own scope left a
   * coach's copy of their client's macros stale for the full TTL. That
   * requester-scoping is deliberate — the interceptor runs before the handler,
   * so a hit on a shared key would return data without `assertSelfOrCoach`
   * ever running — which makes "delete more scopes" the fix rather than
   * "widen the key".
   */
  private async invalidateMacrosCache(userId: string, actorId: string) {
    const coachIds = await this.accessService.getApprovedCoachIds(userId);
    const scopes = new Set([userId, actorId, ...coachIds]);
    const paths = [
      `/macros/${userId}`,
      // day-level entries share the same prefix; clear all days (1-7)
      ...[1, 2, 3, 4, 5, 6, 7].map((d) => `/macros/${userId}/${d}`),
    ];

    await Promise.all(
      [...scopes].flatMap((scope) =>
        paths.map((path) => this.cacheManager.del(userCacheKey(scope, path))),
      ),
    );
  }

  /**
   * Logged meals, newest first, with the ingredients of each one. Declared
   * before the `:userId` routes so its literal prefix is matched first.
   */
  @Get('mealHistory/:userId')
  async getMealHistory(
    @Param('userId') userId: string,
    @Req() req: authReq.AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('date') date?: string,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, userId);

    const parsedLimit = Math.min(
      Math.max(parseInt(limit ?? '', 10) || 20, 1),
      50,
    );
    const parsedOffset = Math.max(parseInt(offset ?? '', 10) || 0, 0);

    // Rejected rather than ignored: a typo in the date silently becoming
    // "every meal ever logged" is the wrong way for this to fail.
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must be formatted as YYYY-MM-DD');
    }

    return {
      body: await this.macrosService.getMealHistory(
        userId,
        parsedLimit,
        parsedOffset,
        date ? localDateStr(date) : undefined,
      ),
    };
  }

  /**
   * Changes left in today's allowance. Self only — the allowance is spent by
   * the owner of the log and by nobody else, so there is nothing here for a
   * coach to read.
   */
  @Get('mealEdits/:userId')
  async getMealEditQuota(
    @Param('userId') userId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    this.accessService.assertSelf(req.user.id, userId);
    return { body: await this.macrosService.getMealEditQuota(userId) };
  }

  /**
   * Rewrite a logged meal. Deliberately not `assertSelfOrCoach`: a coach
   * reviewing the log must not be able to change what their client says they
   * ate, and spending the client's daily allowance on their behalf would be
   * worse still. Ownership is checked against the meal itself in the service.
   */
  @Patch('meals/:mealId')
  async updateMeal(
    @Param('mealId') mealId: string,
    @Body() dto: UpdateMealDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    return {
      body: await this.macrosService.updateMeal(req.user.id, mealId, dto),
    };
  }

  /**
   * Remove a logged meal. `mergedIds` is a comma-separated list of the sibling
   * rows the client is showing as part of this one entry — a query parameter
   * rather than a body, since a DELETE body is dropped by enough of the stack
   * (proxies, some fetch implementations) not to be worth relying on.
   */
  @Delete('meals/:mealId')
  async deleteMeal(
    @Param('mealId') mealId: string,
    @Req() req: authReq.AuthenticatedRequest,
    @Query('mergedIds') mergedIds?: string,
  ) {
    const merged = (mergedIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    return {
      body: await this.macrosService.deleteMeal(req.user.id, mealId, merged),
    };
  }

  @Get(':userId')
  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(300000)
  async getUserMacros(
    @Param('userId') userId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, userId);
    return this.macrosService.getUserMacros(userId);
  }

  @Get(':userId/:day')
  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(300000)
  async getUserDayMacro(
    @Param('userId') userId: string,
    @Param('day') day: number,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, userId);
    return this.macrosService.getUserDayMacro(userId, day);
  }

  @Post(':userId')
  async setUserMacros(
    @Param('userId') userId: string,
    @Body() macros: SetMacrosDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, userId);
    const result = await this.macrosService.setUserMacros(
      userId,
      macros,
      req.user.id,
    );
    await this.invalidateMacrosCache(userId, req.user.id);
    return result;
  }

  @Get('dailyMacros/:id/:date')
  async getDailyMacros(
    @Param('id') id: string,
    @Param('date') date: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, id);
    const macros = await this.macrosService.getDailyMacros(
      id,
      localDateStr(date),
    );
    return { body: macros };
  }
}
