import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
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
    if (!goal) return null;

    return goal;
  }

  @Get('dailyMeals/:id')
  async getDailyMeals(@Param('id') id: string) {
    return this.userService.getDailyMeals(id);
  }

  @Post('assign-user-to-coach/:userId')
  async assignUserToCoach(
    @Param('userId') userId: string,
    @Body('code') code: string,
  ) {
    return this.userService.assignUserToCoach(userId, code);
  }

  @Post('coach-assigned-users/:userId')
  async getAssignedUsersToCoach(
    @Param('userId') userId: string,
    @Body('param') param: string,
  ) {
    return this.userService.getAssignedUsersToCoach(userId, param);
  }

  @Post('coach-assigned-users/:userId/update/:relationId')
  async postAssignedUsersToCoachUpdate(
    @Param('relationId') relationId: string,
    @Param('userId') userId: string,
    @Body('status') status: boolean,
  ) {
    if (status) {
      return this.userService.approveUser(relationId, userId);
    } else {
      return this.userService.rejectUser(relationId);
    }
  }

  @Get('weight-history/:id')
  async getWeightHistory(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.userService.getWeightHistory(id, limit ? Number(limit) : 6);
  }

  @Post('weight/:id')
  async addWeightEntry(
    @Param('id') id: string,
    @Body('weight') weight: number,
  ) {
    return this.userService.addWeightEntry(id, weight);
  }
}
