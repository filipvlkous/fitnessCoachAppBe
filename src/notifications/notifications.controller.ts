import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import {
  SavePushTokenDto,
  SendNotificationDto,
  SendBulkNotificationDto,
} from './dto/notification.dto';
import { SupabaseAuthGuard } from 'utils/AuthGuard';

@Controller('notifications')
@UseGuards(SupabaseAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('token/:userId')
  async savePushToken(
    @Param('userId') userId: string,
    @Body() dto: SavePushTokenDto,
  ) {
    return this.notificationsService.savePushToken(userId, dto);
  }

  @Delete('token/:userId')
  async deletePushToken(@Param('userId') userId: string) {
    return this.notificationsService.deletePushToken(userId);
  }

  @Post('send/:userId')
  async sendToUser(
    @Param('userId') userId: string,
    @Body() dto: SendNotificationDto,
  ) {
    return this.notificationsService.sendToUser(userId, dto);
  }

  @Post('send-bulk')
  async sendBulk(@Body() dto: SendBulkNotificationDto) {
    return this.notificationsService.sendToMultipleUsers(dto);
  }
}
