import {
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class SendChatMessageDto {
  @IsString()
  @Length(1, 4000)
  body: string;
}

export class SendWorkoutNoteDto {
  @IsString()
  @Length(1, 4000)
  note: string;

  @IsString()
  @Length(1, 200)
  exerciseName: string;

  @IsOptional()
  @IsString()
  dayName?: string;

  @IsOptional()
  @IsNumber()
  setNumber?: number;

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsNumber()
  reps?: number;
}

export class GetChatMessagesQueryDto {
  /** ISO timestamp cursor: return messages strictly older than this. */
  @IsOptional()
  @IsISO8601()
  before?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
