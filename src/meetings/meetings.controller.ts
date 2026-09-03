import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MeetingsService } from './meetings.service';
import { CoachAvailabilityService } from './availability.service';
import { CreateMeetingDto, RespondMeetingDto } from './dto/meeting.dto';
import {
  AvailabilityRangeDto,
  SetAvailabilityDto,
} from './dto/availability.dto';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import * as authReq from 'utils/authenticated-request.interface';

@ApiTags('meetings')
@ApiBearerAuth()
@Controller('meetings')
@UseGuards(SupabaseAuthGuard)
export class MeetingsController {
  constructor(
    private readonly meetingsService: MeetingsService,
    private readonly availabilityService: CoachAvailabilityService,
  ) {}

  /**
   * GET /meetings/availability
   *
   * The signed-in coach's own week, for the screen they edit it on.
   */
  @Get('availability')
  async myAvailability(@Req() req: authReq.AuthenticatedRequest) {
    return this.availabilityService.listOwn(req.user.id);
  }

  /**
   * PUT /meetings/availability
   *
   * Replaces the coach's whole week. An empty list clears it, which puts their
   * clients back on a free-form picker.
   */
  @Put('availability')
  @HttpCode(HttpStatus.OK)
  async setMyAvailability(
    @Body() body: SetAvailabilityDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    return this.availabilityService.replaceOwn(req.user.id, body);
  }

  /**
   * GET /meetings/availability/:coachId?from=&to=
   *
   * The windows and the already-taken stretches a client needs to draw a slot
   * grid. Ranges only — never who the other slots belong to.
   */
  @Get('availability/:coachId')
  async coachAvailability(
    @Param('coachId', ParseUUIDPipe) coachId: string,
    @Query() range: AvailabilityRangeDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    return this.availabilityService.forBooking(req.user.id, coachId, range);
  }

  /**
   * GET /meetings
   *
   * Everything the caller needs on screen, whichever side they are on: open
   * requests, upcoming approved sessions, and answers from the last few days.
   * Not cached — an approval has to show on the next pull.
   */
  @Get()
  async list(@Req() req: authReq.AuthenticatedRequest) {
    return this.meetingsService.listForUser(req.user.id);
  }

  /**
   * POST /meetings
   *
   * A client asks their coach for a slot. The coach is resolved from the
   * approved relation, so this cannot be used to reach anyone else.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async request(
    @Body() body: CreateMeetingDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    return this.meetingsService.createRequest(req.user.id, body);
  }

  /**
   * POST /meetings/:id/respond
   *
   * Answer the meeting waiting on you. Who that is comes from the meeting's
   * status, not from anything the app sends.
   */
  @Post(':id/respond')
  @HttpCode(HttpStatus.OK)
  async respond(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RespondMeetingDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    return this.meetingsService.respond(req.user.id, id, body);
  }

  /** POST /meetings/:id/cancel — either party calls it off. */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    return this.meetingsService.cancel(req.user.id, id);
  }
}
