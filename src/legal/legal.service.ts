import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';

export type LegalKind = 'terms' | 'privacy';

/** Same shape as the app's `LegalDocument` (constants/legal). */
export type LegalDocument = {
  title: string;
  version: string;
  effectiveDate: string;
  intro: string;
  sections: unknown[];
  /** Where data-subject requests go; only the privacy policy has one. */
  contactEmail: string | null;
};

type LegalRow = {
  kind: LegalKind;
  version: string;
  effective_date: string;
  title: string;
  intro: string;
  sections: unknown[];
  contact_email: string | null;
};

@Injectable()
export class LegalService {
  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Both documents, edited in Supabase (`sql/2026-10-04_legal_documents.sql`).
   * A kind with no row comes back `null` and the app keeps its bundled copy.
   */
  async getDocuments(): Promise<Record<LegalKind, LegalDocument | null>> {
    const { data, error } = await this.supabaseService.supabase
      .from('legal_documents')
      .select(
        'kind, version, effective_date, title, intro, sections, contact_email',
      );

    if (error) throw new InternalServerErrorException(error.message);

    const byKind = new Map(
      ((data ?? []) as LegalRow[]).map((row) => [row.kind, row]),
    );
    const toDocument = (kind: LegalKind): LegalDocument | null => {
      const row = byKind.get(kind);
      if (!row) return null;
      return {
        title: row.title,
        version: row.version,
        effectiveDate: row.effective_date,
        intro: row.intro,
        sections: row.sections,
        contactEmail: row.contact_email,
      };
    };

    return { terms: toDocument('terms'), privacy: toDocument('privacy') };
  }
}
