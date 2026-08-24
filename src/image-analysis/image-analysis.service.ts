import { Injectable } from '@nestjs/common';
// import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleGenAI, Type } from '@google/genai';
import { AnalyzeFoodResponseDto } from './dto/image.dto';

/** Per 100 g (or 100 ml) — the form nutrition tables and food databases use. */
export interface Per100 {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface AnalyzedFoodItem {
  name: string;
  /** Single food emoji for the row thumbnail. */
  emoji: string;
  /**
   * The amount, expressed the way a person would say it: `servings` ×
   * `servingLabel` of `servingGrams` each — "2 pieces (100 g)". The UI lets
   * the user nudge either the serving count or the raw grams.
   */
  servings: number;
  servingLabel: string;
  servingGrams: number;
  /** servings × servingGrams, in `unit`. Derived server-side. */
  weight: number;
  unit: 'g' | 'ml';
  per100: Per100;
  // Absolute macros for `weight`, derived from `per100` by the server rather
  // than asked of the model — see scaleItem.
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/**
 * What the router decided the photo was.
 *
 * `meal`  — a plate of food; weights are estimated from the image.
 * `label` — a packaged product's nutrition table; values are read off it, so
 *           they are exact rather than estimated.
 */
export type ImageKind = 'meal' | 'label';

export interface MealAnalysis {
  kind: ImageKind;
  foodTitle: string;
  mealScore: number;
  /** Serving text off a label, e.g. "1 porce (30 g)". Null for meal photos. */
  servingLabel: string | null;
  foodArray: AnalyzedFoodItem[];
}

@Injectable()
export class ImageAnalysisService {
  private genAI: GoogleGenAI;
  private readonly MAX_RETRIES = 5;
  private readonly INITIAL_DELAY_MS = 5000;

  constructor() {
    this.genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  private async retryWithExponentialBackoff<T>(
    fn: () => Promise<T>,
    retries = 0,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      if (retries >= this.MAX_RETRIES) {
        throw error;
      }

      const delayMs = this.INITIAL_DELAY_MS * Math.pow(2, retries);
      console.warn(
        `API call failed, retrying in ${delayMs}ms (attempt ${retries + 1}/${this.MAX_RETRIES})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      return this.retryWithExponentialBackoff(fn, retries + 1);
    }
  }

  // Macros come back per 100 g and are scaled here rather than asked of the
  // model directly: a model asked for both an amount and its absolute macros
  // will happily return a pair that do not agree. Deriving them means the
  // numbers are always consistent with the weight, and the client can rescale
  // an edited weight itself without another round trip.
  private static scaleItem(raw: {
    name: string;
    emoji?: string;
    servings?: number;
    servingLabel?: string;
    servingGrams?: number;
    unit?: string;
    per100: Per100;
  }): AnalyzedFoodItem {
    const per100: Per100 = {
      calories: Math.max(0, raw.per100?.calories ?? 0),
      protein: Math.max(0, raw.per100?.protein ?? 0),
      carbs: Math.max(0, raw.per100?.carbs ?? 0),
      fat: Math.max(0, raw.per100?.fat ?? 0),
    };

    const servings = Math.max(0, raw.servings ?? 1);
    // A zero here would collapse every amount to nothing, so fall back to a
    // 100 g serving — the same basis `per100` is quoted in.
    const servingGrams = Math.max(1, raw.servingGrams ?? 100);
    const weight = Math.round(servings * servingGrams);
    const factor = weight / 100;
    const round1 = (n: number) => Math.round(n * 10) / 10;

    return {
      name: raw.name,
      emoji: raw.emoji?.trim() || '🍽️',
      servings,
      servingLabel: raw.servingLabel?.trim() || 'porce',
      servingGrams,
      weight,
      unit: raw.unit === 'ml' ? 'ml' : 'g',
      per100,
      calories: Math.round(per100.calories * factor),
      protein: round1(per100.protein * factor),
      carbs: round1(per100.carbs * factor),
      fat: round1(per100.fat * factor),
    };
  }

  /**
   * One call that both routes and extracts.
   *
   * The schema leads with `kind`, so the model commits to "is this a plate of
   * food or a nutrition table?" before it fills anything else in, and the
   * per-field instructions below tell it what each branch means. Keeping it in
   * a single request rather than a separate classifier call matters here: the
   * user is watching a scanning animation while it runs, and a second
   * round trip to Gemini would roughly double that wait.
   */
  async analyzeImage(base64: string): Promise<MealAnalysis | null> {
    try {
      const rawBase64 = base64.includes(',') ? base64.split(',')[1] : base64;

      const per100Schema = {
        type: Type.OBJECT,
        description:
          'Nutrition per 100 g (or per 100 ml for drinks). For a label, copy the "per 100 g" column verbatim. For a meal photo, use standard food-database values for this ingredient.',
        properties: {
          calories: { type: Type.NUMBER, description: 'kcal per 100 g/ml.' },
          protein: { type: Type.NUMBER, description: 'grams per 100 g/ml.' },
          carbs: { type: Type.NUMBER, description: 'grams per 100 g/ml.' },
          fat: { type: Type.NUMBER, description: 'grams per 100 g/ml.' },
        },
        required: ['calories', 'protein', 'carbs', 'fat'],
      };

      const generationConfig = {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            // Declared first so the model decides the route before extracting.
            kind: {
              type: Type.STRING,
              enum: ['meal', 'label'],
              description:
                "Route the image. 'label' when it is mainly printed nutrition information — a packaging nutrition table, an ingredients panel, or a menu listing values. 'meal' when it shows actual food or drink to be eaten. If a package is shown but no readable nutrition table, that is still 'meal'.",
            },
            foodTitle: {
              type: Type.STRING,
              description:
                "For 'label', the product name as printed (e.g. 'Skyr jahoda'). For 'meal', a concise Czech title for the dish (e.g. 'Cheeseburger s hranolky').",
            },
            mealScore: {
              type: Type.NUMBER,
              description:
                'Overall healthiness from 0 (least healthy) to 100 (most healthy).',
            },
            servingLabel: {
              type: Type.STRING,
              nullable: true,
              description:
                "For 'label' only: the serving description as printed, e.g. '1 porce (30 g)'. Null when the label states no serving, and always null for 'meal'.",
            },
            foodArray: {
              type: Type.ARRAY,
              description:
                "For 'meal': one entry per distinct component, breaking composite dishes down (bun, patty, cheese, lettuce). For 'label': a single entry for the product itself — never invent components.",
              items: {
                type: Type.OBJECT,
                properties: {
                  name: {
                    type: Type.STRING,
                    description:
                      "Common name of the item in Czech, e.g. 'plátek čedaru'.",
                  },
                  emoji: {
                    type: Type.STRING,
                    description:
                      'A single emoji that best depicts this item, e.g. 🍳 for a fried egg. Exactly one emoji, no text.',
                  },
                  servingLabel: {
                    type: Type.STRING,
                    description:
                      "Czech name of one natural unit of this item, singular: 'kus' for countable things (eggs, slices, rolls), 'porce' for anything served by the plateful, 'sklenice' for drinks, 'lžíce' for condiments.",
                  },
                  servingGrams: {
                    type: Type.NUMBER,
                    description:
                      "How many grams (or ml) ONE such unit weighs — e.g. 50 for one egg. For 'label', the serving size printed on the package; if none is printed, 100.",
                  },
                  servings: {
                    type: Type.NUMBER,
                    description:
                      "How many of those units are present. For 'meal', count them in the photo (2 eggs → 2). For 'label', always 1. Whole numbers where the item is countable; a fraction like 0.5 is fine for a part portion.",
                  },
                  unit: {
                    type: Type.STRING,
                    enum: ['g', 'ml'],
                    description:
                      "'ml' for drinks and liquids, 'g' for everything else.",
                  },
                  per100: per100Schema,
                },
                required: [
                  'name',
                  'emoji',
                  'servingLabel',
                  'servingGrams',
                  'servings',
                  'unit',
                  'per100',
                ],
              },
            },
          },
          required: ['kind', 'foodTitle', 'mealScore', 'foodArray'],
        },
        systemInstruction:
          'You are an expert AI food analyst and nutritionist. You read nutrition labels exactly as printed and never round or reinterpret their numbers; when estimating from a photo instead, you use standard food-database values.',
      };

      const contents = [
        {
          role: 'user',
          parts: [
            {
              text: 'Decide whether this image is a nutrition label or food to be eaten, then extract it according to the schema.',
            },
            {
              inlineData: {
                data: rawBase64,
                mimeType: 'image/jpeg',
              },
            },
          ],
        },
      ];

      const response = await this.retryWithExponentialBackoff(() =>
        this.genAI.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: contents,
          config: generationConfig,
        }),
      );

      if (!response || !response.text) return null;

      const parsed = JSON.parse(response.text) as {
        kind?: string;
        foodTitle?: string;
        mealScore?: number;
        servingLabel?: string | null;
        foodArray?: {
          name: string;
          emoji?: string;
          servings?: number;
          servingLabel?: string;
          servingGrams?: number;
          unit?: string;
          per100: Per100;
        }[];
      };

      const kind: ImageKind = parsed.kind === 'label' ? 'label' : 'meal';

      return {
        kind,
        foodTitle: parsed.foodTitle ?? '',
        mealScore: parsed.mealScore ?? 0,
        // Only a label carries a serving line, whatever the model filled in.
        servingLabel: kind === 'label' ? (parsed.servingLabel ?? null) : null,
        foodArray: (parsed.foodArray ?? []).map((item) =>
          ImageAnalysisService.scaleItem(item),
        ),
      };
    } catch (error: any) {
      console.error('Image analysis failed:', error);
      throw new Error(`Error analyzing image: ${error.message}`);
    }
  }

  async getMacronutrients(
    macronutrientDto: AnalyzeFoodResponseDto,
  ): Promise<string | undefined> {
    try {
      const generationConfig = {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            foodArray: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  weight: { type: Type.NUMBER },
                  protein: { type: Type.NUMBER },
                  fat: { type: Type.NUMBER },
                  carbs: { type: Type.NUMBER },
                  calories: { type: Type.NUMBER },
                  nutritionScore: { type: Type.NUMBER },
                },
                required: [
                  'name',
                  'weight',
                  'calories',
                  'carbs',
                  'fat',
                  'protein',
                  'nutritionScore',
                ],
              },
            },
          },
          required: ['foodArray'],
        },
      };

      const response = await this.retryWithExponentialBackoff(() =>
        this.genAI.models.generateContent({
          model: 'gemini-3-flash-preview',
          config: generationConfig,
          contents: `
            INPUT: ${JSON.stringify(macronutrientDto.items)}

            TASK: You are an expert nutrition database. For every food item in the input array, estimate its standard macronutrients (protein, fat, carbs) and calories.

            RULES:
            - Values must be based on the provided 'weight' in grams.
            - Values must align with the provided 'nutritionScore'.
            - Provide realistic estimates per ONE piece.
          `,
        }),
      );

      if (!response || !response.text) return;

      return response.text;
    } catch (error: any) {
      throw new Error(`Error analyzing image: ${error.message}`);
    }
  }
}
