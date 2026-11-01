import { Module } from '@nestjs/common';
import { CoachProfileController } from './coachProfile.controller';
import { CoachProfileService } from './coachProfile.service';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { UserModule } from 'src/user/user.module';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  // UserModule for AccessRequestService, behind the coach's access requests.
  imports: [SupabaseModule, UserModule, NotificationsModule],
  controllers: [CoachProfileController],
  providers: [CoachProfileService],
  exports: [CoachProfileService],
})
export class CoachProfileModule {}
