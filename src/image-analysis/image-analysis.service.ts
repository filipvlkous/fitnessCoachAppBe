import { Injectable } from '@nestjs/common';
// import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleGenAI, Type } from '@google/genai';
import { AnalyzeFoodResponseDto, FoodItemResponse } from './dto/image.dto';
import { count } from 'console';

@Injectable()
export class ImageAnalysisService {
  private genAI: GoogleGenAI;

  constructor() {
    this.genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) || '';
  }

  async analyzeImage(base64: string): Promise<any> {
    try {
      // Strip data URL prefix if present (e.g. "data:image/jpeg;base64,...")
      const rawBase64 = base64.includes(',') ? base64.split(',')[1] : base64;

      const generationConfig = {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            foodTitle: { type: Type.STRING },
            mealScore: { type: Type.NUMBER },
            foodArray: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  weight: { type: Type.NUMBER },
                },
                required: ['name', 'weight'],
              },
            },
          },
          required: ['foodArray', 'foodTitle', 'mealScore'],
        },
      };

      const imageAnalysisPrompt = `
You are an expert AI food analyst. Your task is to analyze an image of food and return a detailed breakdown in JSON format.

**Your response must be a single, valid JSON object adhering strictly to the structure specified below. Do not include any explanations, comments, markdown formatting, or any characters outside the JSON structure itself.**

Based on the provided image, perform the following analyses:

1.  **"foodTitle" (String)**: Identify a concise and descriptive title for the overall meal (e.g., "Cheeseburger with French Fries", "Margherita Pizza", "Chicken Salad").
2.  **"foodArray" (Array of Objects)**:
    * Detect each distinct food item in the image.
    * For composite dishes (e.g., a burger), break them down into their primary individual components (e.g., for a burger: "top bun", "beef patty", "cheese slice", "lettuce", "bottom bun", "tomato slice").
    * For each item, provide:
        * **"name" (String)**: The common, recognizable name of the food item (e.g., "top bun", "tomato slice", "grilled chicken breast"). Use exact, commonly known names.
        * **"weight" (Number)**: Your realistic estimate of the item's weight in **grams**. This must be a numerical value (e.g., 50, 120.5). Ensure weights are realistic based on the image.
3.  **"mealScore" (Number)**: Evaluate the overall healthiness of the meal and provide a score between 0 (least healthy) and 100 (most healthy). Consider the ingredients and general nutritional aspects. This must be a numerical value.

**JSON Output Structure (this is a template, provide actual values):**

\`\`\`json
{
  "foodTitle": "<Descriptive title of the meal>",
  "mealScore": <Numerical healthiness score (0-100)>,
  "foodArray": [
    {
      "name": "<Name of first food item>",
      "weight": <Estimated weight in grams for first item (e.g., 75)>
    },
    {
      "name": "<Name of second food item>",
      "weight": <Estimated weight in grams for second item (e.g., 150.2)>
    }
    // ... more items if present
  ]
}
\`\`\`

**Important Considerations:**
* **Accuracy**: Strive for accurate identification of food items and realistic weight estimations.
* **Specificity**: Be specific with item names (e.g., "whole wheat bun" instead of just "bun" if discernible; "chicken thigh" vs "chicken breast").
* **Completeness**: Identify all visible food components.
* **Strict JSON**: Ensure the output is *only* the JSON object, perfectly formatted according to the schema enforced by the system.

**Example of a valid JSON response (what your output should look like):**

\`\`\`json
{
  "foodTitle": "Classic Beef Burger and Fries",
  "mealScore": 35,
  "foodArray": [
    {
      "name": "top sesame seed bun",
      "weight": 35
    },
    {
      "name": "lettuce leaf",
      "weight": 10
    },
    {
      "name": "tomato slice",
      "weight": 20
    },
    {
      "name": "cheddar cheese slice",
      "weight": 18
    },
    {
      "name": "beef patty",
      "weight": 110
    },
    {
      "name": "bottom sesame seed bun",
      "weight": 35
    },
    {
      "name": "french fries",
      "weight": 150
    }
  ]
}
\`\`\`
`;

      const contents = [
        imageAnalysisPrompt,
        {
          inlineData: {
            data: rawBase64,
            mimeType: 'image/jpeg',
          },
        },
      ];

      const response = await this.genAI.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: contents,
        config: generationConfig,
      });

      if (!response || !response.text) return;

      return response.text;
    } catch (error: any) {
      throw new Error(`Error analyzing image: ${error.message}`);
    }
  }

  async getMacronutrients(
    macronutrientDto: AnalyzeFoodResponseDto,
  ): Promise<any> {
    try {
      const generationConfig = {
        temperature: 0,
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
        contents: `${JSON.stringify(macronutrientDto.items)}
       You are a nutrition calculator.

INPUT • A single JSON object with one property, **foodArray**.
Each element of *foodArray* contains:
  • **name** (string) – common name of the food item  
  • **weight** (number) – weight in grams of ONE individual piece  
  • **nutritionScore** (number, 1 – 100) – relative healthfulness of the item  

TASK • For every element, estimate realistic macronutrient values **per ONE piece** using standard nutrition references and weight and your experience. Together it have to add up to realistic value of the whole food item nutritional value.

OUTPUT • Return **only** a JSON object that exactly matches the schema below—no extra keys, comments, or text:

{
  "foodArray": [
    {
      "name": "string",
      "weight": number,
      "calories": number,
      "carbs": number,
      "fat": number,
      "protein": number,
      "nutritionScore": number
    }
    // …repeat for each item
  ]
}
`,
      });

      if (!response || !response.text) return;

      return response.text;
    } catch (error: any) {
      throw new Error(`Error analyzing image: ${error.message}`);
    }
  }
}
