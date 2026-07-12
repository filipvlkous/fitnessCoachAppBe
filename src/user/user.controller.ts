import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserService } from './user.service';
import { BecomeCoachDto, UpdateProfileDto } from './dto/user.dto';
import { localDateStr } from 'utils/getLocalTime';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import { AccessService } from 'src/auth/access.service';
import * as authReq from 'utils/authenticated-request.interface';

@ApiTags('users')
@ApiBearerAuth()
@Controller('userController')
@UseGuards(SupabaseAuthGuard)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly accessService: AccessService,
  ) {}

  @Delete('user/:id')
  async deleteUser(
    @Param('id') id: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    // Account deletion is strictly self-service.
    this.accessService.assertSelf(req.user.id, id);
    return await this.userService.deleteUser(id);
  }

  @Get('user/:id')
  async getUser(
    @Param('id') id: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, id);
    return this.userService.getUserById(id);
  }

  @Put('user/:id')
  async updateUserProfile(
    @Param('id') id: string,
    @Body() body: UpdateProfileDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, id);
    return this.userService.updateUserProfile(id, body);
  }

  @Put('user/:id/setup')
  async becomeCoach(
    @Param('id') id: string,
    @Body() body: BecomeCoachDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    // Only the user themselves can switch their account to a coach role.
    this.accessService.assertSelf(req.user.id, id);
    return this.userService.becomeCoach(id, body);
  }

  @Get('user/:userId/profile')
  async getUserProfile(
    @Param('userId') userId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, userId);
    const data = await this.userService.getUserProfile(userId);
    if (!data) {
      throw new NotFoundException('User profile not found');
    }

    return data;
  }

  @Get('dailyEntries/:id')
  async getDailyEntries(
    @Param('id') id: string,
    @Req() req: authReq.AuthenticatedRequest,
    @Query('date') date?: string,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, id);
    const goal = await this.userService.getDailyEntries(
      id,
      date ? localDateStr(date) : localDateStr(new Date()),
    );
    if (!goal) return null;

    return goal;
  }

  @Post('assign-user-to-coach/:userId')
  async assignUserToCoach(
    @Param('userId') userId: string,
    @Body('code') code: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    this.accessService.assertSelf(req.user.id, userId);
    if (!code) throw new BadRequestException('code is required');
    return this.userService.assignUserToCoach(userId, code);
  }

  @Post('coach-assigned-users/:userId')
  async getAssignedUsersToCoach(
    @Param('userId') userId: string,
    @Body('param') param: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    this.accessService.assertSelf(req.user.id, userId);
    // `param` is used as a column name; only these two are allowed.
    if (param !== 'coach_id' && param !== 'user_id') {
      throw new BadRequestException('param must be coach_id or user_id');
    }
    return this.userService.getAssignedUsersToCoach(userId, param);
  }

  @Post('coach-assigned-users/:userId/update/:relationId')
  async postAssignedUsersToCoachUpdate(
    @Param('relationId') relationId: string,
    @Param('userId') userId: string,
    @Body('status') status: boolean,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    if (status) {
      return this.userService.approveUser(relationId, req.user.id);
    } else {
      return this.userService.rejectUser(relationId, req.user.id);
    }
  }

  @Delete('coach-relation/:programId/user/:userId')
  async removeCoachRelationByUserId(
    @Param('programId') programId: string,
    @Param('userId') userId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    // The athlete themselves or their coach can remove the relation.
    await this.accessService.assertSelfOrCoach(req.user.id, userId);
    return this.userService.removeCoachRelationByUserId(userId, programId);
  }

  @Get('weight-history/:id')
  async getWeightHistory(
    @Param('id') id: string,
    @Req() req: authReq.AuthenticatedRequest,
    @Query('limit') limit?: string,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, id);
    return this.userService.getWeightHistory(id, limit ? Number(limit) : 6);
  }

  @Post('weight/:id')
  async addWeightEntry(
    @Param('id') id: string,
    @Body('weight') weight: number,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    this.accessService.assertSelf(req.user.id, id);
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) {
      throw new BadRequestException('weight must be a positive number');
    }
    return this.userService.addWeightEntry(id, weight);
  }

  @Get('body-photos/:userId')
  async getBodyPhotos(
    @Param('userId') userId: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertSelfOrCoach(req.user.id, userId);
    return this.userService.getBodyPhotos(userId);
  }

  @Post('body-photos/:userId')
  @UseInterceptors(FileInterceptor('file'))
  async addBodyPhoto(
    @Param('userId') userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: authReq.AuthenticatedRequest,
    @Body('slot') slot?: string,
  ) {
    this.accessService.assertSelf(req.user.id, userId);
    if (!file) throw new BadRequestException('No file provided');
    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('Only images are allowed');
    }
    return this.userService.addBodyPhoto(userId, file, slot);
  }
}
