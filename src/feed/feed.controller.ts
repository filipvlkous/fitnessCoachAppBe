import { Controller, Get, Param } from '@nestjs/common';
import { FeedService } from './feed.service';

@Controller('feed')
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Get('category')
  async getAllByCategory() {
    return this.feedService.getAllByCategory();
  }

  @Get('category/:category')
  async getByCategory(@Param('category') category: string) {
    return this.feedService.getByCategory(category);
  }

  @Get('manufacturer')
  async getAllByManufacturer() {
    return this.feedService.getAllByManufacturer();
  }

  @Get('manufacturer/:manufacturer')
  async getByManufacturer(@Param('manufacturer') manufacturer: string) {
    return this.feedService.getByManufacturer(manufacturer);
  }
}
