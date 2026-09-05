import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RetentionService } from './retention.service';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import * as authReq from 'utils/authenticated-request.interface';

/**
 * Retention is a coach-facing surface only. Every route answers for the signed-in
 * coach's own roster — a client has no endpoint here to read their own score,
 * and would not be helped by one.
 */
@ApiTags('retention')
@ApiBearerAuth()
@Controller('retention')
@UseGuards(SupabaseAuthGuard)
export class RetentionController {
  constructor(private readonly retentionService: RetentionService) {}

  /**
   * GET /retention
   *
   * The coach's clients ordered by risk. Reads what the daily job wrote; it
   * never scores or calls the model, so the dashboard stays instant and free.
   */
  @Get()
  async list(@Req() req: authReq.AuthenticatedRequest) {
    return this.retentionService.listForCoach(req.user.id);
  }

  /**
   * POST /retention/refresh
   *
   * Recompute this coach's roster now, for the pull-to-refresh on the list and
   * for the first run after a client is approved. Scoped to the caller, so no
   * request can trigger work for anyone else's clients.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: authReq.AuthenticatedRequest) {
    return this.retentionService.refreshForCoach(req.user.id);
  }

  /**
   * POST /retention/:userId/dismiss
   *
   * "I know about this one." The card stops showing until the client's band
   * gets worse than what was dismissed, or until they are out of trouble and
   * drift back in — see `dismissalSurvives`. There is no un-dismiss endpoint:
   * the button sits inside the opened card rather than as a stray × on the
   * list, so closing one is a deliberate act, and the next real change brings
   * it back on its own.
   */
  @Post(':userId/dismiss')
  @HttpCode(HttpStatus.OK)
  async dismiss(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    return this.retentionService.dismiss(req.user.id, userId);
  }

  /**
   * GET /retention/:userId
   *
   * One client, with the signal vector behind the score — the detail screen
   * exists so the coach can disagree with the number.
   */
  @Get(':userId')
  async detail(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    const detail = await this.retentionService.getForClient(
      req.user.id,
      userId,
    );
    if (!detail) {
      throw new NotFoundException('This client has not been scored yet.');
    }
    return detail;
  }
}
