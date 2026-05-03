import { Module } from '@nestjs/common';
import { MacrosController } from './macros.controller';
import { MacrosService } from './macros.service';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
	imports: [SupabaseModule],
	controllers: [MacrosController],
	providers: [MacrosService],
	exports: [MacrosService],
})
export class MacrosModule {}
