import { Module } from '@nestjs/common';
import { MonthlySummaryService } from './monthly-summary.service';
import { MonthlySummaryController } from './monthly-summary.controller';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [MonthlySummaryController],
  providers: [MonthlySummaryService],
})
export class MonthlySummaryModule {}
