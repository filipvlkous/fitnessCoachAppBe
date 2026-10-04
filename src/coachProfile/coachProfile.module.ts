import { Module } from '@nestjs/common';
import { CoachProfileController } from './coachProfile.controller';
import { CoachProfileService } from './coachProfile.service';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { UserModule } from 'src/user/user.module';

@Module({
  // UserModule for AccessRequestService, behind the coach's access requests.
  imports: [SupabaseModule, UserModule],
  controllers: [CoachProfileController],
  providers: [CoachProfileService],
  exports: [CoachProfileService],
})
export class CoachProfileModule {}
