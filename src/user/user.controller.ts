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
import { SaveConsentsDto } from './dto/consent.dto';
import { ResolveAccessRequestDto } from './dto/access-request.dto';
import { AccessRequestService } from './access-request.service';
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
    private readonly accessRequestService: AccessRequestService,
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

  @Get('user/:id/consents')
  async getConsents(
    @Param('id') id: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    // Self only, not assertSelfOrCoach: what someone consented to — including
    // their refusal to share data with a coach — is not the coach's to read.
    this.accessService.assertSelf(req.user.id, id);
    return this.userService.getConsents(id);
  }

  @Put('user/:id/consents')
  async saveConsents(
    @Param('id') id: string,
    @Body() body: SaveConsentsDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    // Consent is personal: nobody records it on somebody else's behalf.
    this.accessService.assertSelf(req.user.id, id);
    return this.userService.saveConsents(id, body);
  }

  /**
   * GET /userController/user/:id/access-requests
   *
   * Coaches waiting on an answer about one of this user's data scopes.
   */
  @Get('user/:id/access-requests')
  async getAccessRequests(
    @Param('id') id: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    // Self only. Which coach asked for what — and that it went unanswered —
    // is the user's business alone.
    this.accessService.assertSelf(req.user.id, id);
    return this.accessRequestService.listPendingForUser(id);
  }

  /**
   * POST /userController/access-request/:requestId
   *
   * Answer a request. Ownership is checked against the request row rather than
   * a path parameter, so there is no user id here to get wrong.
   */
  @Post('access-request/:requestId')
  async resolveAccessRequest(
    @Param('requestId') requestId: string,
    @Body() body: ResolveAccessRequestDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    return this.accessRequestService.resolveRequest(
      req.user.id,
      requestId,
      body.granted,
    );
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
