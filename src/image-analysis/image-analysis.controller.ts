import {
  BadRequestException,
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

  /**
   * Route and analyze a photo in one call.
   *
   * The response says which branch was taken (`kind`) and carries finished
   * macros either way, so the client no longer follows up with
   * `food/macronutrients` — it saves through `food/manual` instead.
   */
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

  /** Manually add a meal and its ingredients without image analysis. */
  @Post('food/manual')
  async addFoodManually(
    @Body() dto: ManualFoodEntryDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    // `items` carries the whole dish in one request; `item` is the legacy
    // one-request-per-ingredient shape, which split a dish into several meals.
    const entries = dto.items?.length ? dto.items : dto.item ? [dto.item] : [];

    if (entries.length === 0) {
      throw new BadRequestException('A meal needs at least one ingredient.');
    }

    const foodItems = JSON.stringify({
      foodArray: entries.map((entry) => ({
        name: entry.name,
        weight: entry.weight,
        unit: entry.unit ?? 'g',
        protein: entry.protein,
        fat: entry.fat,
        carbs: entry.carbs,
        calories: entry.calories,
        nutritionScore: 0,
        // Present when the entry came from a photo scan; the manual form omits
        // them and the history then falls back to showing the plain weight.
        emoji: entry.emoji,
        servings: entry.servings,
        servingLabel: entry.servingLabel,
        servingGrams: entry.servingGrams,
      })),
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
  /**
   * @deprecated Second half of the old two-call flow: estimate macros for
   * already-detected items, then save. `food/analyze` now returns macros
   * directly, so current clients do not call this. Kept for app versions
   * already installed that still do.
   */
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
