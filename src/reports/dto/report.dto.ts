import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export const REPORT_TARGETS = [
  'coachProfile',
  'review',
  'chatMessage',
] as const;
export const REPORT_REASONS = [
  'illegal',
  'harassment',
  'sexual',
  'dangerous',
  'spam',
  'other',
] as const;

export class CreateReportDto {
  @IsIn(REPORT_TARGETS)
  targetType: (typeof REPORT_TARGETS)[number];

  @IsString()
  @Length(1, 64)
  targetId: string;

  @IsIn(REPORT_REASONS)
  reason: (typeof REPORT_REASONS)[number];

  /** DSA Art. 16(2)(a) asks the notice to explain why; the app requires it for 'other'. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  details?: string;
}
