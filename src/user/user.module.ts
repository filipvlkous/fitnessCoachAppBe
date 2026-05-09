import { Module } from '@nestjs/common';

import { SupabaseModule } from '../supabase/supabase.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [SupabaseModule, NotificationsModule],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
