import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { CreateReportDto } from './dto/report.dto';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Files a DSA Art. 16 notice. The operator works the `content_reports` queue
   * in the Supabase dashboard (`sql/2026-09-26_legal_compliance.sql`); the
   * warning in the log is there so a new one is noticed without polling it.
   */
  async create(reporterId: string, dto: CreateReportDto) {
    const { error } = await this.supabaseService.supabase
      .from('content_reports')
      .insert({
        reporter_id: reporterId,
        target_type: dto.targetType,
        target_id: dto.targetId,
        reason: dto.reason,
        details: dto.details?.trim() || null,
      });

    if (error) {
      throw new InternalServerErrorException(
        `Error filing report: ${error.message}`,
      );
    }

    this.logger.warn(
      `Content report: ${dto.targetType} ${dto.targetId} (${dto.reason})`,
    );
    return true;
  }
}
