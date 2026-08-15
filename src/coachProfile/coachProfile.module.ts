import { Module } from '@nestjs/common';
import { CoachProfileController } from './coachProfile.controller';
import { CoachProfileService } from './coachProfile.service';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { UserModule } from 'src/user/user.module';

@Module({
  // UserModule for the consent read behind /coaches/client/:id/permissions —
  // the consent ledger stays owned by UserService rather than being queried
  // from a second place.
  imports: [SupabaseModule, UserModule],
  controllers: [CoachProfileController],
  providers: [CoachProfileService],
  exports: [CoachProfileService],
})
export class CoachProfileModule {}
