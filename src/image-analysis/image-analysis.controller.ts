import {
  BadRequestException,
  Body,
  Controller,
  InternalServerErrorException,
  Post,
} from '@nestjs/common';
import { ImageAnalysisService } from './image-analysis.service';
import {
  AnalyzeFoodDto,
  AnalyzeFoodResponseDto,
  ManualFoodEntryDto,
} from './dto/image.dto';
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
      if (!analysisJson) {
        throw new InternalServerErrorException('Failed to analyze the image.');
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

  /** Manually add macros for a single food item without image analysis. */
  @Post('food/manual')
  async addFoodManually(@Body() dto: ManualFoodEntryDto) {
    try {
      const foodItems = JSON.stringify({
        foodArray: [
          {
            name: dto.item.name,
            weight: dto.item.weight,
            protein: dto.item.protein,
            fat: dto.item.fat,
            carbs: dto.item.carbs,
            calories: dto.item.calories,
            nutritionScore: 0,
          },
        ],
      });

      await this.supabaseService.saveFoodItems(
        foodItems,
        dto.name,
        dto.id,
        dto.category,
        localDateStr(dto.date),
        dto.meal_score ?? 0,
      );

      return { message: 'Food entry saved successfully.' };
    } catch (error: any) {
      console.error(error);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to save manual food entry.',
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
