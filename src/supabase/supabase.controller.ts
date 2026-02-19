import { Controller, Get, Query, Param } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

@Controller('supabase')
export class SupabaseController {
  constructor(private readonly supabaseService: SupabaseService) {}

  @Get(':table')
  async fetchData(@Param('table') table: string) {
    return this.supabaseService.fetchData(table);
  }

  @Get(':table/filter')
  async fetchDataWithFilter(
    @Param('table') table: string,
    @Query('column') column: string,
    @Query('value') value: string,
  ) {
    return this.supabaseService.fetchDataWithFilter(table, column, value);
  }
}
