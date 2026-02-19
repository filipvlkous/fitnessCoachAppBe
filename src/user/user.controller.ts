import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/user.dto';
import { localDateStr } from 'utils/getLocalTime';

@Controller('userController')
// @UseGuards(AuthGuard('jwt'))
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('all-assigned-users-to-coach/:userId')
  async getAllAssignedUsersToCoach(@Param('userId') userId: string) {
    return this.userService.getAllUsers(userId);
  }

  @Put('user/:id/fitness-macros')
  async updateUserFitnessMacros(
    @Param('id') id: string,
    @Body() fitnessMacros: UpdateUserDto,
  ) {
    return this.userService.updateUserFitnessMacros(id, fitnessMacros);
  }

  @Get('user/:id')
  async getUser(@Param('id') id: string) {
    return this.userService.getUserById(id);
  }

  @Get('dailyEntries/:id')
  async getDailyEntries(
    @Param('id') id: string,
    @Body('date') date?: string, // Accept an optional date from the request body
  ) {
    const goal = await this.userService.getDailyEntries(
      id,
      date ? localDateStr(date) : new Date().toLocaleDateString(),
    );
    console.log(goal);
    if (!goal) return null;

    return goal;
  }

  @Get('dailyMeals/:id')
  async getDailyMeals(@Param('id') id: string) {
    return this.userService.getDailyMeals(id);
  }
}
