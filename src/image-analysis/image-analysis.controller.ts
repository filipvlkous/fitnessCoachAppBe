import {
  Body,
  Controller,
  HttpException,
  InternalServerErrorException,
  Post,
  Req,
  UseGuards,
  Get,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ImageAnalysisService } from './image-analysis.service';
import {
  AnalyzeFoodDto,
  AnalyzeFoodResponseDto,
  ManualFoodEntryDto,
} from './dto/image.dto';
import { SupabaseService } from 'src/supabase/supabase.service';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import { localDateStr } from 'utils/getLocalTime';
import * as authReq from 'utils/authenticated-request.interface';

@ApiTags('image-analysis')
@ApiBearerAuth()
@Controller('image-analysis')
@UseGuards(SupabaseAuthGuard)
export class ImageAnalysisController {
  constructor(
    private readonly imageAnalysisService: ImageAnalysisService,
    private readonly supabaseService: SupabaseService,
  ) {}

  @Post('food/analyze')
  async analyzeFoodImage(@Body() analyzeFoodDto: AnalyzeFoodDto) {
    try {
      const analysisJson = await this.imageAnalysisService.analyzeImage(
        analyzeFoodDto.imageBase64,
      );
      if (!analysisJson) {
        throw new InternalServerErrorException('Failed to analyze the image.');
      }

      return {
        data: analysisJson,
        message: 'Food analysis completed successfully.',
      };
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        error?.message ?? 'Image analysis failed.',
      );
    }
  }

  /** Manually add macros for a single food item without image analysis. */
  @Post('food/manual')
  async addFoodManually(
    @Body() dto: ManualFoodEntryDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
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

    // The meal always belongs to the authenticated user.
    await this.supabaseService.saveFoodItems(
      foodItems,
      dto.name,
      req.user.id,
      dto.category,
      localDateStr(dto.date),
      dto.meal_score ?? 0,
    );

    return { message: 'Food entry saved successfully.' };
  }

  /** Store or recalculate macronutrients for the analysed food. */
  @Post('food/macronutrients')
  async saveMacronutrients(
    @Body() macronutrientDto: AnalyzeFoodResponseDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    const macronutrientData =
      await this.imageAnalysisService.getMacronutrients(macronutrientDto);

    if (!macronutrientData) {
      throw new InternalServerErrorException(
        'Failed to compute macronutrients.',
      );
    }

    await this.supabaseService.saveFoodItems(
      macronutrientData,
      macronutrientDto.name,
      req.user.id,
      macronutrientDto.category,
      localDateStr(macronutrientDto.date),
      macronutrientDto.meal_score ?? 0,
    );

    return {
      message: 'Macronutrient data saved successfully.',
      macronutrientData,
    };
  }

  @Get('monthly-summary')
  async getMonthlySummary(@Req() req: authReq.AuthenticatedRequest) {
    try {
      const data = await this.supabaseService.fetchData('food_entries');
      return { data, message: 'Monthly summary fetched successfully.' };
    } catch (error: any) {
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to fetch monthly summary.',
      );
    }
  }
}
