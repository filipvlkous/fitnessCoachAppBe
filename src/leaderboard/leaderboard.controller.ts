import {
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LeaderboardService } from './leaderboard.service';
import { LeaderboardQueryDto } from './dto/leaderboard.dto';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import * as authReq from 'utils/authenticated-request.interface';

@ApiTags('leaderboard')
@ApiBearerAuth()
@Controller('leaderboard')
@UseGuards(SupabaseAuthGuard)
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  /**
   * GET /leaderboard/monthly?month=YYYY-MM
   *
   * The standings for the caller's own coach group. It takes no coach id: the
   * group comes from the token, so this route cannot be pointed at a roster the
   * caller is not part of. The guard is therefore load-bearing, not decoration.
   */
  @Get('monthly')
  async getMonthly(
    @Query() query: LeaderboardQueryDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    try {
      const data = await this.leaderboardService.getMonthlyLeaderboard(
        req.user.id,
        query.month,
      );

      return { data, message: 'Monthly leaderboard fetched successfully.' };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        error instanceof Error
          ? error.message
          : 'Failed to build the monthly leaderboard.',
      );
    }
  }

  /**
   * GET /leaderboard/badges
   *
   * Every board the caller has won, for their profile. Own badges only: the
   * scoreboard already carries everyone else's counts, and it carries them for
   * the group the token resolves to.
   */
  @Get('badges')
  async getBadges(@Req() req: authReq.AuthenticatedRequest) {
    try {
      const data = await this.leaderboardService.getBadges(req.user.id);
      return { data, message: 'Badges fetched successfully.' };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        error instanceof Error ? error.message : 'Failed to fetch badges.',
      );
    }
  }
}
