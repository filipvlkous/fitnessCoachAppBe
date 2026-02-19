import { Module } from '@nestjs/common';
import { ImageAnalysisService } from './image-analysis.service';
import { ImageAnalysisController } from './image-analysis.controller';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [ImageAnalysisController],
  providers: [ImageAnalysisService],
})
export class ImageAnalysisModule {}
