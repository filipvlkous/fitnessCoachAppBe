import { IsNotEmpty, Matches } from 'class-validator';

export class MonthlySummaryQueryDto {
  /** Month to summarise, in YYYY-MM format (e.g. 2026-06). */
  @IsNotEmpty()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'month must be in YYYY-MM format',
  })
  month: string;
}
