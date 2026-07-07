import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';

@Module({
  imports: [SupabaseModule],
  controllers: [FeedController],
  providers: [FeedService],
  exports: [FeedService],
})
export class FeedModule {}
