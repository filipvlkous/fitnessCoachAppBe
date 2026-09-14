import {
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import * as authReq from 'utils/authenticated-request.interface';
import { BoxMonthParamDto } from './dto/rewards.dto';
import { RewardsService } from './rewards.service';

@ApiTags('rewards')
@ApiBearerAuth()
@Controller('rewards')
@UseGuards(SupabaseAuthGuard)
export class RewardsController {
  constructor(private readonly rewardsService: RewardsService) {}

  /**
   * GET /rewards/monthly
   *
   * The caller's own standing in this month's draw, and their settled boxes.
   * Everything here is about the caller: the entrant list is nobody's business
   * and the codes are worth money.
   */
  @Get('monthly')
  async getMonthly(@Req() req: authReq.AuthenticatedRequest) {
    try {
      const data = await this.rewardsService.getMonthlyDraw(req.user.id);
      return { data, message: 'Monthly draw fetched successfully.' };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        error instanceof Error ? error.message : 'Failed to fetch the draw.',
      );
    }
  }

  /**
   * POST /rewards/box/:month/open
   *
   * Reveals one of the caller's own boxes. The contents were decided when the
   * month closed; this only records that they have been seen. Which box comes
   * from the token plus the month, so nobody can open somebody else's.
   */
  @Post('box/:month/open')
  async openBox(
    @Param() params: BoxMonthParamDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    try {
      const data = await this.rewardsService.openBox(req.user.id, params.month);
      return { data, message: 'Box opened successfully.' };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        error instanceof Error ? error.message : 'Failed to open the box.',
      );
    }
  }
}
