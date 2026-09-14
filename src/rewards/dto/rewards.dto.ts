import { IsNotEmpty, Matches } from 'class-validator';

export class BoxMonthParamDto {
  /** The settled month whose box is being opened, in YYYY-MM format. */
  @IsNotEmpty()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'month must be in YYYY-MM format',
  })
  month: string;
}
