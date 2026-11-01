import { Module } from '@nestjs/common';

import { SupabaseModule } from '../supabase/supabase.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { AccessRequestService } from './access-request.service';
import { LeaderboardModule } from 'src/leaderboard/leaderboard.module';

@Module({
  imports: [SupabaseModule, NotificationsModule, LeaderboardModule],
  controllers: [UserController],
  providers: [UserService, AccessRequestService],
  // AccessRequestService is exported for CoachProfileController, which owns the
  // coach-facing half of the same flow.
  exports: [UserService, AccessRequestService],
})
export class UserModule {}
