import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
  Inject,
  UseInterceptors,
} from '@nestjs/common';
import { CACHE_MANAGER, CacheTTL } from '@nestjs/cache-manager';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import * as CacheManagerTypes from 'cache-manager';
import { MacrosService } from './macros.service';
import { SetMacrosDto } from './dto/macros.dto';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import {
  UserScopedCacheInterceptor,
  userCacheKey,
} from 'utils/user-cache.interceptor';
import { localDateStr } from 'utils/getLocalTime';
import { AccessService } from 'src/auth/access.service';
import * as authReq from 'utils/authenticated-request.interface';

@ApiTags('macros')
@ApiBearerAuth()
@Controller('macros')
@UseGuards(SupabaseAuthGuard)
export class MacrosController {
  constructor(
    private readonly macrosService: MacrosService,
    private readonly accessService: AccessService,
    @Inject(CACHE_MANAGER) private cacheManager: CacheManagerTypes.Cache,
  ) {}

  private async invalidateMacrosCache(userId: string) {
    await Promise.all([
      this.cacheManager.del(userCacheKey(userId, `/macros/${userId}`)),
      // day-level entries share the same prefix; clear all days (1-7)
      ...[1, 2, 3, 4, 5, 6, 7].map((d) =>
        this.cacheManager.del(userCacheKey(userId, `/macros/${userId}/${d}`)),
      ),
    ]);
  }

  @Get(':userId')
  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(300000)
  async getUserMacros(
    @Param('userId') userId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, userId);
    return this.macrosService.getUserMacros(userId);
  }

  @Get(':userId/:day')
  @UseInterceptors(UserScopedCacheInterceptor)
  @CacheTTL(300000)
  async getUserDayMacro(
    @Param('userId') userId: string,
    @Param('day') day: number,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, userId);
    return this.macrosService.getUserDayMacro(userId, day);
  }

  @Post(':userId')
  async setUserMacros(
    @Param('userId') userId: string,
    @Body() macros: SetMacrosDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, userId);
    const result = await this.macrosService.setUserMacros(userId, macros);
    await this.invalidateMacrosCache(userId);
    return result;
  }

  @Get('dailyMacros/:id/:date')
  async getDailyMacros(
    @Param('id') id: string,
    @Param('date') date: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, id);
    const macros = await this.macrosService.getDailyMacros(
      id,
      localDateStr(date),
    );
    return { body: macros };
  }
}
