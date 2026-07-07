import { Injectable } from '@nestjs/common';
// import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleGenAI, Type } from '@google/genai';
import { AnalyzeFoodResponseDto } from './dto/image.dto';

export interface MealAnalysis {
  foodTitle: string;
  mealScore: number;
  foodArray: {
    name: string;
    weight: number;
  }[];
}

@Injectable()
export class ImageAnalysisService {
  private genAI: GoogleGenAI;

  constructor() {
    this.genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  async analyzeImage(base64: string): Promise<MealAnalysis | null> {
    try {
      const rawBase64 = base64.includes(',') ? base64.split(',')[1] : base64;

      const generationConfig = {
        temperature: 0,
        responseMimeType: 'application/json',
        // 2. Move your instructions INTO the schema using the 'description' field
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            foodTitle: {
              type: Type.STRING,
              description:
                "A concise and descriptive title for the overall meal (e.g., 'Cheeseburger with French Fries').",
            },
            mealScore: {
              type: Type.NUMBER,
              description:
                'Evaluate overall healthiness based on ingredients. Provide a score from 0 (least healthy) to 100 (most healthy).',
            },
            foodArray: {
              type: Type.ARRAY,
              description:
                'Detect each distinct food item. For composite dishes (like burgers), break them down into their primary components (e.g., bun, patty, lettuce).',
              items: {
                type: Type.OBJECT,
                properties: {
                  name: {
                    type: Type.STRING,
                    description:
                      "The common, recognizable name of the specific food item or component (e.g., 'cheddar cheese slice').",
                  },
                  weight: {
                    type: Type.NUMBER,
                    description:
                      "Your realistic estimate of the item's weight in grams.",
                  },
                },
                required: ['name', 'weight'],
              },
            },
          },
          required: ['foodArray', 'foodTitle', 'mealScore'],
        },
        // 3. Move the persona definition to the system instruction where it belongs
        systemInstruction:
          'You are an expert AI food analyst and nutritionist.',
      };

      // 4. Strip the prompt down to just the core task. No JSON formatting rules needed!
      const imageAnalysisPrompt =
        'Analyze this image of food. Deconstruct it into its individual components, estimate the weight of each in grams, and provide an overall healthiness score.';

      const contents = [
        {
          role: 'user',
          parts: [
            { text: imageAnalysisPrompt },
            {
              inlineData: {
                data: rawBase64,
                mimeType: 'image/jpeg',
              },
            },
          ],
        },
      ];

      const response = await this.genAI.models.generateContent({
        model: 'gemini-3-flash-preview', // Ensure this matches your intended model
        contents: contents,
        config: generationConfig,
      });

      if (!response || !response.text) return null;

      // 5. Parse the guaranteed JSON string into your TypeScript interface
      return JSON.parse(response.text) as MealAnalysis;
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

      const response = await this.genAI.models.generateContent({
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
      });

      if (!response || !response.text) return;

      return response.text;
    } catch (error: any) {
      throw new Error(`Error analyzing image: ${error.message}`);
    }
  }
}
