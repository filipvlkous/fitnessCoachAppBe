import { Controller, Get, Query, Param, UseGuards, Req } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { SupabaseAuthGuard } from 'utils/AuthGuard';

@Controller('supabase')
export class SupabaseController {
  constructor(public supabaseService: SupabaseService) {}

  @Get('user')
  @UseGuards(SupabaseAuthGuard)
  getUser(@Req() req) {
    return {
      email: req.user.email,
      id: req.user.id,
    };
  }
}
