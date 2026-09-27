import { Module } from '@nestjs/common';
import { RetentionController } from './retention.controller';
import { RetentionService } from './retention.service';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { UserModule } from 'src/user/user.module';

@Module({
  // UserModule for getCoachDataAccess: the score may only use what the client
  // shares with the coach, and the consent ledger is UserService's to read.
  imports: [SupabaseModule, NotificationsModule, UserModule],
  controllers: [RetentionController],
  providers: [RetentionService],
})
export class RetentionModule {}
