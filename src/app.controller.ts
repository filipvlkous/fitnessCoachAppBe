import { Controller, Get, Header } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('delete-account')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getDeleteAccountPage(): string {
    return this.appService.getDeleteAccountPage();
  }
}
