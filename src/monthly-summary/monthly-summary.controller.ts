import {
  Controller,
  Get,
  HttpException,
  Inject,
  InternalServerErrorException,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import * as CacheManagerTypes from 'cache-manager';
import {
  MonthlySummary,
  MonthlySummaryCoach,
  MonthlySummaryService,
} from './monthly-summary.service';
import { MonthlySummaryQueryDto } from './dto/monthly-summary.dto';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import { AccessService } from 'src/auth/access.service';
import * as authReq from 'utils/authenticated-request.interface';

@ApiTags('monthly-summary')
@ApiBearerAuth()
@Controller('monthly-summary')
@UseGuards(SupabaseAuthGuard)
export class MonthlySummaryController {
  constructor(
    private readonly monthlySummaryService: MonthlySummaryService,
    private readonly accessService: AccessService,
    @Inject(CACHE_MANAGER) private cacheManager: CacheManagerTypes.Cache,
  ) {}

  /**
   * Full month report for a user: stats for the requested and previous month,
   * weekly activity, muscle group split, session goal, and AI-generated
   * reviews (pros/cons) for both months.
   */
  @Get(':userId')
  async getMonthlySummary(
    @Param('userId') userId: string,
    @Query() query: MonthlySummaryQueryDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    // The AI review reads workouts and meals alike, so a coach needs both.
    await this.accessService.assertSelfOrCoach(req.user.id, userId, 'workouts');
    if (req.user.id !== userId) {
      await this.accessService.assertCoachScope(userId, 'nutrition');
    }

    const cacheKey = `monthly-summary:${userId}:${query.month}`;
    const cached = await this.cacheManager.get<MonthlySummary>(cacheKey);
    if (cached) {
      return { data: cached, message: 'Monthly summary fetched successfully.' };
    }

    try {
      const data = await this.monthlySummaryService.getMonthlySummary(
        userId,
        query.month,
      );

      // AI calls are slow and paid; keep the generated summary for 12 hours.
      await this.cacheManager.set(cacheKey, data, 12 * 60 * 60 * 1000);

      return { data, message: 'Monthly summary generated successfully.' };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        error instanceof Error
          ? error.message
          : 'Failed to generate monthly summary.',
      );
    }
  }

    @Get('coach/:userId')
    async getMonthlySummaryCoach(
    @Param('userId') userId: string,
    @Query() query: MonthlySummaryQueryDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, userId, 'workouts');
    // The cached copy is shared by every reader, so nutrition is dropped per
    // request rather than before caching.
    const hideNutrition =
      req.user.id !== userId &&
      !(await this.accessService.getCoachDataAccess(userId)).nutrition;
    const forReader = (data: MonthlySummaryCoach) =>
      hideNutrition ? withoutNutrition(data) : data;

    // Own key prefix: the user endpoint caches a different shape (with the
    // AI review) under `monthly-summary:`; sharing it would poison both.
    const cacheKey = `monthly-summary:coach:${userId}:${query.month}`;
    const cached = await this.cacheManager.get<MonthlySummaryCoach>(cacheKey);
    if (cached) {
      return {
        data: forReader(cached),
        message: 'Monthly summary fetched successfully.',
      };
    }

    try {
      const data = await this.monthlySummaryService.getMonthlySummaryCoach(
        userId,
        query.month,
      );

      // AI calls are slow and paid; keep the generated summary for 12 hours.
      await this.cacheManager.set(cacheKey, data, 12 * 60 * 60 * 1000);

      return {
        data: forReader(data),
        message: 'Monthly summary generated successfully.',
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        error instanceof Error
          ? error.message
          : 'Failed to generate monthly summary.',
      );
    }
  }
}

/** The coach summary for a client who does not share nutrition. */
const withoutNutrition = (data: MonthlySummaryCoach) => ({
  ...data,
  stats: { ...data.stats, nutrition: null },
  previousStats: { ...data.previousStats, nutrition: null },
});
