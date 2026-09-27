import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import * as authReq from 'utils/authenticated-request.interface';
import { CreateReportDto } from './dto/report.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(SupabaseAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /** POST /reports — flag a coach profile, review or chat message. */
  @Post()
  @Throttle({ heavy: { limit: 10, ttl: 60_000 } })
  async create(
    @Body() body: CreateReportDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    return this.reportsService.create(req.user.id, body);
  }
}
