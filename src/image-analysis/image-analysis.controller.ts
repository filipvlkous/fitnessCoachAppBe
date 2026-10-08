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
import { Throttle } from '@nestjs/throttler';
import { ImageAnalysisService } from './image-analysis.service';
import { PhotoQuotaService } from './photo-quota.service';
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
    private readonly photoQuotaService: PhotoQuotaService,
    private readonly supabaseService: SupabaseService,
  ) {}

  /**
   * Route and analyze a photo in one call.
   *
   * The response says which branch was taken (`kind`) and carries finished
   * macros either way, so the client no longer follows up with
   * `food/macronutrients` — it saves through `food/manual` instead.
   */
  // The one endpoint that pays a third party per request, and the one that
  // accepts a 10 MB body to do it. Ten scans a minute is well past how fast a
  // person can photograph meals, and it caps what a stuck client can spend.
  //
  // On top of that, the user's own daily allowance and the pause after a
  // cancelled scan (`PhotoQuotaService`). The scan is booked before Gemini is
  // called and handed back only if the analysis fails.
  @Throttle({ heavy: { limit: 10, ttl: 60_000 } })
  @Post('food/analyze')
  async analyzeFoodImage(
    @Body() analyzeFoodDto: AnalyzeFoodDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    const claimId = await this.photoQuotaService.claimScan(req.user.id);
    try {
      const analysisJson = await this.imageAnalysisService.analyzeImage(
        analyzeFoodDto.imageBase64,
      );
      console.log(
        '[image-analysis] food/analyze result:',
        JSON.stringify(analysisJson, null, 2),
      );
      if (!analysisJson) {
        throw new InternalServerErrorException('Failed to analyze the image.');
      }

      return {
        data: analysisJson,
        quota: await this.photoQuotaService.getQuota(req.user.id),
        message: 'Food analysis completed successfully.',
      };
    } catch (error: any) {
      console.log('[image-analysis] food/analyze error:', error);
      await this.photoQuotaService.refundScan(claimId);
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        error?.message ?? 'Image analysis failed.',
      );
    }
  }

  /** Today's photo allowance and whether scanning is paused. */
  @Get('photo-quota')
  async getPhotoQuota(@Req() req: authReq.AuthenticatedRequest) {
    return { data: await this.photoQuotaService.getQuota(req.user.id) };
  }

  /**
   * The athlete cancelled a running scan. It still counts (Gemini bills it),
   * and scanning pauses for the user's `photo_cooldown_minutes`.
   */
  @Post('food/analyze/cancel')
  async cancelFoodAnalysis(@Req() req: authReq.AuthenticatedRequest) {
    return { data: await this.photoQuotaService.cancelScan(req.user.id) };
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
