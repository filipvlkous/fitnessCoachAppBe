
import { IsDateString, IsUUID } from 'class-validator';

export class WeekStatusDto {
  @IsDateString()
  weekStart: string;
}


export class MonthHistoryDto {
  @IsDateString()
  date: string;

  @IsUUID()
  user_workout_program_id: string;
}