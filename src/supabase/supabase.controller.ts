import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SupabaseService } from './supabase.service';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import * as authReq from 'utils/authenticated-request.interface';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('supabase')
export class SupabaseController {
  constructor(public supabaseService: SupabaseService) {}

  @Get('user')
  @UseGuards(SupabaseAuthGuard)
  getUser(@Req() req: authReq.AuthenticatedRequest) {
    return {
      email: req.user.email,
      id: req.user.id,
    };
  }
}
