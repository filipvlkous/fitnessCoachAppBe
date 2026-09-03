import { Module } from '@nestjs/common';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { CoachAvailabilityService } from './availability.service';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [SupabaseModule, NotificationsModule],
  controllers: [MeetingsController],
  providers: [MeetingsService, CoachAvailabilityService],
})
export class MeetingsModule {}
