import { Module } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service';
import { LeaderboardController } from './leaderboard.controller';
import { SupabaseModule } from 'src/supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [LeaderboardController],
  providers: [LeaderboardService],
  // UserService puts each client's badge counts on the coach's client list.
  exports: [LeaderboardService],
})
export class LeaderboardModule {}
