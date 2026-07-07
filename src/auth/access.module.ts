import { Global, Module } from '@nestjs/common';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { AccessService } from './access.service';

@Global()
@Module({
  imports: [SupabaseModule],
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
