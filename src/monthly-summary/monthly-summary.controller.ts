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
  MonthlySummaryService,
} from './monthly-summary.service';
import { MonthlySummaryQueryDto } from './dto/monthly-summary.dto';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import { AccessService } from 'src/auth/access.service';
import * as authReq from 'utils/authenticated-request.interface';

@ApiTags('monthly-summary')
@ApiBearerAuth()
@Controller('monthly-summary')
// @UseGuards(SupabaseAuthGuard)
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
    // await this.accessService.assertSelfOrCoach(req.user.id, userId);

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
}
