import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { SupplementsService } from './supplements.service';
import { SupabaseAuthGuard } from 'utils/AuthGuard';

@Controller('supplements')
@UseGuards(SupabaseAuthGuard)
export class SupplementsController {
  constructor(private readonly supplementsService: SupplementsService) {}

  @Get(':userId')
  async getUserSupplements(@Param('userId') userId: string) {
    return this.supplementsService.getUserSupplements(userId);
  }

  @Post(':userId')
  async addSupplement(
    @Param('userId') userId: string,
    @Body() body:{id:string},
  ) {
    console.log('Adding supplement for user:', userId, 'with supplement ID:', body.id);
    return this.supplementsService.addSupplementToUser(userId, body.id);
  }

  @Delete(':userId/:supplementId')
  async removeSupplement(
    @Param('userId') userId: string,
    @Param('supplementId') supplementId: string,
  ) {
    return this.supplementsService.removeSupplementFromUser(userId, supplementId);
  }
}
