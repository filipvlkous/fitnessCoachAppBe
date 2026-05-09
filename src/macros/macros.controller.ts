import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Inject,
  UseInterceptors,
} from '@nestjs/common';
import { CACHE_MANAGER, CacheTTL } from '@nestjs/cache-manager';
import * as CacheManagerTypes from 'cache-manager';
import { MacrosService } from './macros.service';
import { SetMacrosDto } from './dto/macros.dto';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import {
  UserScopedCacheInterceptor,
  userCacheKey,
} from 'utils/user-cache.interceptor';
import { localDateStr } from 'utils/getLocalTime';

@Controller('macros')
@UseGuards(SupabaseAuthGuard)
export class MacrosController {
  constructor(
    private readonly macrosService: MacrosService,
    @Inject(CACHE_MANAGER) private cacheManager: CacheManagerTypes.Cache,
  ) {}

  private async invalidateMacrosCache(userId: string) {
    await Promise.all([
      this.cacheManager.del(userCacheKey(userId, `/macros/${userId}`)),
      // day-level entries share the same prefix; clear all 7 days
      ...[0, 1, 2, 3, 4, 5, 6].map((d) =>
        this.cacheManager.del(userCacheKey(userId, `/macros/${userId}/${d}`)),
      ),
    ]);
  }

  @Get(':userId')
  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(300000)
  async getUserMacros(@Param('userId') userId: string) {
    return this.macrosService.getUserMacros(userId);
  }

  @Get(':userId/:day')
  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(300000)
  async getUserDayMacro(
    @Param('userId') userId: string,
    @Param('day') day: number,
  ) {
    return this.macrosService.getUserDayMacro(userId, day);
  }

  @Post(':userId')
  async setUserMacros(
    @Param('userId') userId: string,
    @Body() macros: SetMacrosDto,
  ) {
    const result = await this.macrosService.setUserMacros(userId, macros);
    await this.invalidateMacrosCache(userId);
    return result;
  }

  @Get('dailyMacros/:id/:date')
  async getDailyMacros(
    @Param('id') id: string,
    @Param('date') date: string, // Accept an optional date from the request body
  ) {
    const macros = await this.macrosService.getDailyMacros(
      id,
      date ? localDateStr(date) : new Date().toLocaleDateString(),
    );
    return { body: macros };
  }
}
