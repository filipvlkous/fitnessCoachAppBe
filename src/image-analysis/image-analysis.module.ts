import { Module } from '@nestjs/common';
import { ImageAnalysisService } from './image-analysis.service';
import { ImageAnalysisController } from './image-analysis.controller';
import { PhotoQuotaService } from './photo-quota.service';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [ImageAnalysisController],
  providers: [ImageAnalysisService, PhotoQuotaService],
})
export class ImageAnalysisModule {}
