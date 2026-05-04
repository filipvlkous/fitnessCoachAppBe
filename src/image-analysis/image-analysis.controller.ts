import {
  BadRequestException,
  Body,
  Controller,
  InternalServerErrorException,
  Post,
} from '@nestjs/common';
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
    console.log('Received image analysis request:', analyzeFoodDto);
    const { imageBase64 } = analyzeFoodDto;

    try {
      if (!imageBase64) {
        throw new BadRequestException('No image data provided.');
      }

      const analysisJson =
        await this.imageAnalysisService.analyzeImage(imageBase64);
        if (!analysisJson) {
          throw new InternalServerErrorException(
            'Failed to analyze the image.',
          );
        }
     
      return {
        data: analysisJson,
        message: 'Food analysis completed successfully.',
      };
    } catch (error: any) {
      console.error(error);
      throw new InternalServerErrorException(
        error?.message ?? 'Image analysis failed.',
      );
    }
  }

  /** Store or recalculate macronutrients for the analysed food. */
  @Post('food/macronutrients')
  async saveMacronutrients(@Body() macronutrientDto: AnalyzeFoodResponseDto) {
    try {
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
