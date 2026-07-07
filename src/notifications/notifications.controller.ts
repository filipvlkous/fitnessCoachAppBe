import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import {
  SavePushTokenDto,
  DeletePushTokenDto,
  SendNotificationDto,
  SendBulkNotificationDto,
} from './dto/notification.dto';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import { AccessService } from 'src/auth/access.service';
import * as authReq from 'utils/authenticated-request.interface';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(SupabaseAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly accessService: AccessService,
  ) {}

  @Post('token/:userId')
  async savePushToken(
    @Param('userId') userId: string,
    @Body() dto: SavePushTokenDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    this.accessService.assertSelf(req.user.id, userId);
    return this.notificationsService.savePushToken(userId, dto);
  }

  @Delete('token/:userId')
  async deletePushToken(
    @Param('userId') userId: string,
    @Body() dto: DeletePushTokenDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    this.accessService.assertSelf(req.user.id, userId);
    return this.notificationsService.deletePushToken(userId, dto.token);
  }

  @Post('send/:userId')
  async sendToUser(
    @Param('userId') userId: string,
    @Body() dto: SendNotificationDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    // Only the target user's coach (or the user themselves) may push to them.
    await this.accessService.assertSelfOrCoach(req.user.id, userId);
    return this.notificationsService.sendToUser(userId, dto);
  }

  @Post('send-bulk')
  async sendBulk(
    @Body() dto: SendBulkNotificationDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    for (const userId of dto.userIds) {
      await this.accessService.assertSelfOrCoach(req.user.id, userId);
    }
    return this.notificationsService.sendToMultipleUsers(dto);
  }
}
