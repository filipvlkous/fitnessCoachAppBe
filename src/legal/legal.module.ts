import { Module } from '@nestjs/common';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

@Module({
  imports: [SupabaseModule],
  controllers: [LegalController],
  providers: [LegalService],
})
export class LegalModule {}
