import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [SupabaseModule, NotificationsModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
