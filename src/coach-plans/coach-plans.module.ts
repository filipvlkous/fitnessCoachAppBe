import { Module } from '@nestjs/common';
import { CoachPlansController } from './coach-plans.controller';
import { CoachPlansService } from './coach-plans.service';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [SupabaseModule, NotificationsModule],
  controllers: [CoachPlansController],
  providers: [CoachPlansService],
  exports: [CoachPlansService],
})
export class CoachPlansModule {}
