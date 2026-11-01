import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { FeedModule } from '../feed/feed.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SupplementsController } from './supplements.controller';
import { SupplementsService } from './supplements.service';

@Module({
  imports: [SupabaseModule, FeedModule, NotificationsModule],
  controllers: [SupplementsController],
  providers: [SupplementsService],
})
export class SupplementsModule {}
