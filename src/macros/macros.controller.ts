import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { MacrosService } from './macros.service';
import { SetMacrosDto } from './dto/macros.dto';

@Controller('macros')
export class MacrosController {
	constructor(private readonly macrosService: MacrosService) {}

	@Get(':userId')
	async getUserMacros(@Param('userId') userId: string) {
		return this.macrosService.getUserMacros(userId);
	}

	@Get(':userId/:day')
	async getUserDayMacro(@Param('userId') userId: string, @Param('day') day: number) {
		return this.macrosService.getUserDayMacro(userId, day);
	}


	@Post(':userId')
	async setUserMacros(@Param('userId') userId: string, @Body() macros: SetMacrosDto) {
        console.log('Received macros for user', userId, macros);
		return this.macrosService.setUserMacros(userId, macros);
	}
}
