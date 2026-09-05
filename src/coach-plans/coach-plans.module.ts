import { Module } from '@nestjs/common';
import { CoachPlansController } from './coach-plans.controller';
import { CoachPresetsController } from './coach-presets.controller';
import { CoachPlansService } from './coach-plans.service';
import { ProgramDraftController } from './program-draft.controller';
import { ProgramDraftService } from './program-draft.service';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [SupabaseModule, NotificationsModule],
  controllers: [
    CoachPlansController,
    CoachPresetsController,
    ProgramDraftController,
  ],
  providers: [CoachPlansService, ProgramDraftService],
  exports: [CoachPlansService],
})
export class CoachPlansModule {}
