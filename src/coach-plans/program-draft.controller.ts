import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from 'utils/AuthGuard';
import * as authReq from 'utils/authenticated-request.interface';
import { AccessService } from 'src/auth/access.service';
import { ProgramDraftService } from './program-draft.service';
import { ApplyDraftDto, DraftProgramDto } from './dto/program-draft.dto';

/**
 * Drafting a training week from a sentence.
 *
 * Its own controller for the same reason presets have one: a `draft` path under
 * `coach-plans` would have to be declared ahead of `:planId` not to be read as
 * a plan id.
 */
@ApiTags('program-draft')
@ApiBearerAuth()
@Controller('program-draft')
@UseGuards(SupabaseAuthGuard)
export class ProgramDraftController {
  constructor(
    private readonly programDraftService: ProgramDraftService,
    private readonly accessService: AccessService,
  ) {}

  /**
   * POST /program-draft
   *
   * Returns a draft and stores nothing. Coach role required — this is a paid
   * call, and there is nothing here for an athlete account to ask for.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async draft(
    @Body() body: DraftProgramDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertCoachRole(req.user.id);
    return this.programDraftService.draft(body);
  }

  /**
   * POST /program-draft/apply
   *
   * Saves the draft as it now stands — the coach's edits included, since the
   * server kept no copy of what it generated. Comes back as the finished
   * preset, ready to open in the ordinary program editor.
   */
  @Post('apply')
  @HttpCode(HttpStatus.CREATED)
  async apply(
    @Body() body: ApplyDraftDto,
    @Req() req: authReq.AuthenticatedRequest,
  ) {
    await this.accessService.assertCoachRole(req.user.id);
    return this.programDraftService.apply(req.user.id, body);
  }
}
