import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ImageAnalysisService } from './image-analysis.service';
import { AnalyzeFoodDto, AnalyzeFoodResponseDto } from './dto/image.dto';
import { SupabaseService } from 'src/supabase/supabase.service';
import { ok } from 'assert';
import { localDateStr } from 'utils/getLocalTime';

@Controller('image-analysis')
export class ImageAnalysisController {
  constructor(
    private readonly imageAnalysisService: ImageAnalysisService,
    private readonly supabaseService: SupabaseService,
  ) {}

  @Post('food/analyze')
  async analyzeFoodImage(@Body() analyzeFoodDto: AnalyzeFoodDto) {
    const { imageBase64 } = analyzeFoodDto;

    try {
      if (!imageBase64) {
        throw new BadRequestException('No image data provided.');
      }

      const analysisJson =
        await this.imageAnalysisService.analyzeImage(imageBase64);
      const analysisResult = JSON.parse(analysisJson);

      return {
        data: analysisResult,
        message: 'Food analysis completed successfully.',
      };
    } catch (error) {
      console.error(error);
    }
  }

  /** Store or recalculate macronutrients for the analysed food. */
  @Post('food/macronutrients')
  async saveMacronutrients(@Body() macronutrientDto: AnalyzeFoodResponseDto) {
    try {
      console.log(macronutrientDto);
      const macronutrientData: string =
        await this.imageAnalysisService.getMacronutrients(macronutrientDto);

      this.supabaseService.saveFoodItems(
        macronutrientData,
        macronutrientDto.name,
        macronutrientDto.id,
        macronutrientDto.category,
        localDateStr(macronutrientDto.date),
        macronutrientDto.meal_score,
      );

      return {
        message: 'Macronutrient data saved successfully.',
        macronutrientData,
        ok,
      };
    } catch (error) {
      return console.log(error);
    }
  }
}
