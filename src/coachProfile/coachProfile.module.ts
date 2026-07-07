import { Module } from '@nestjs/common';
import { CoachProfileController } from './coachProfile.controller';
import { CoachProfileService } from './coachProfile.service';
import { SupabaseModule } from 'src/supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [CoachProfileController],
  providers: [CoachProfileService],
  exports: [CoachProfileService],
})
export class CoachProfileModule {}
