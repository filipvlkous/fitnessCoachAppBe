import { IsString, IsOptional, IsObject, IsArray } from 'class-validator';

export class SavePushTokenDto {
  @IsString()
  token!: string;
  
  @IsString()
  platform!: string;
}

export class SendNotificationDto {
  @IsString()
  title!: string;

  @IsString()
  body!: string;

  @IsOptional()
  @IsString()
  sound?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

export class SendBulkNotificationDto {
  @IsArray()
  @IsString({ each: true })
  userIds!: string[];

  @IsString()
  title!: string;

  @IsString()
  body!: string;

  @IsOptional()
  @IsString()
  sound?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
