import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import {
  GetChatMessagesQueryDto,
  SendChatMessageDto,
  SendWorkoutNoteDto,
} from './dto/chat.dto';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import * as authReq from 'utils/authenticated-request.interface';

@ApiTags('chat')
@ApiBearerAuth()
@Controller('chat')
@UseGuards(SupabaseAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /** Unread counts per chat peer, for list badges. */
  @Get('unread')
  async unread(@Req() req: authReq.AuthenticatedRequest) {
    return this.chatService.unreadCounts(req.user.id);
  }

  /** Share a saved set note with the user's coach as a workout note. */
  @Post('workout-note')
  async sendWorkoutNote(
    @Body() dto: SendWorkoutNoteDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    return this.chatService.sendWorkoutNoteToCoach(req.user.id, dto);
  }

  /** Newest-first message page for the chat with :peerId. */
  @Get('with/:peerId')
  async getMessages(
    @Param('peerId') peerId: string,
    @Query() query: GetChatMessagesQueryDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    const pair = await this.chatService.resolvePair(req.user.id, peerId);
    return this.chatService.getMessages(
      pair,
      query.before,
      query.limit ? Number(query.limit) : undefined,
    );
  }

  @Post('with/:peerId')
  async sendMessage(
    @Param('peerId') peerId: string,
    @Body() dto: SendChatMessageDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    const pair = await this.chatService.resolvePair(req.user.id, peerId);
    return this.chatService.sendMessage(pair, req.user.id, dto.body);
  }

  @Put('with/:peerId/read')
  async markRead(
    @Param('peerId') peerId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    const pair = await this.chatService.resolvePair(req.user.id, peerId);
    return this.chatService.markRead(pair, req.user.id);
  }
}
