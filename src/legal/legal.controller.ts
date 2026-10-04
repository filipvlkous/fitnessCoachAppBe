import { Controller, Get, Header, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { renderLegalHtml } from './legal.html';
import { LegalDocument, LegalKind, LegalService } from './legal.service';

/**
 * The terms of service and privacy policy.
 *
 * Deliberately public, like `/app-version`: both must be readable before an
 * account exists — on the sign-up screen and on the consent screen that a new
 * account goes through before anything else.
 */
@ApiTags('legal')
@Controller('legal')
export class LegalController {
  constructor(private readonly legalService: LegalService) {}

  @Get()
  @ApiOperation({ summary: 'Current terms of service and privacy policy' })
  async getDocuments(): Promise<{
    data: Record<LegalKind, LegalDocument | null>;
    message: string;
  }> {
    const data = await this.legalService.getDocuments();
    return { data, message: 'Legal documents fetched successfully.' };
  }

  /** The privacy policy as a web page — the URL listed in Google Play. */
  @Get('privacy')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({ summary: 'Privacy policy as an HTML page' })
  async getPrivacyPage(): Promise<string> {
    const { privacy } = await this.legalService.getDocuments();
    if (!privacy) throw new NotFoundException('Privacy policy not found.');
    return renderLegalHtml(privacy);
  }
}
