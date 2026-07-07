import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SupplementsService } from './supplements.service';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import { AccessService } from 'src/auth/access.service';
import * as authReq from 'utils/authenticated-request.interface';

@ApiTags('supplements')
@ApiBearerAuth()
@Controller('supplements')
@UseGuards(SupabaseAuthGuard)
export class SupplementsController {
  constructor(
    private readonly supplementsService: SupplementsService,
    private readonly accessService: AccessService,
  ) {}

  @Get(':userId')
  async getUserSupplements(
    @Param('userId') userId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, userId);
    return this.supplementsService.getUserSupplements(userId);
  }

  @Post(':userId')
  async addSupplement(
    @Param('userId') userId: string,
    @Body() body: { id: string },
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, userId);
    return this.supplementsService.addSupplementToUser(userId, body.id);
  }

  @Delete(':userId/:supplementId')
  async removeSupplement(
    @Param('userId') userId: string,
    @Param('supplementId') supplementId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, userId);
    return this.supplementsService.removeSupplementFromUser(
      userId,
      supplementId,
    );
  }
}
