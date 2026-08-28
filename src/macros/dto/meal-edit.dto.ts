import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ManualFoodItemDto } from 'src/image-analysis/dto/image.dto';

/**
 * A meal rewritten in place.
 *
 * `items` is the whole ingredient list, not a patch: the client edits a copy of
 * the meal it is already showing and sends back what it should now be, which
 * makes "remove one ingredient" and "change two amounts" the same request and
 * leaves no way for the stored totals to disagree with the rows they sum.
 *
 * Ingredients reuse `ManualFoodItemDto` — an edited meal has to be expressible
 * in exactly the shape a logged one is, or the editor would quietly drop the
 * serving breakdown ("2 kusy") off every row it touched.
 */
export class UpdateMealDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  type?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ManualFoodItemDto)
  items: ManualFoodItemDto[];

  /**
   * Sibling rows the client is showing as part of this one meal.
   *
   * The manual form used to POST one meal per ingredient, so a single dinner
   * can sit in the database as several rows that the history folds back
   * together (`mergeSplitMeals`). Editing what looks like one meal has to
   * resolve that: the ingredients land on `mealId` and the siblings are
   * removed, which is also how those legacy rows finally get consolidated.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  mergedIds?: string[];
}
