import { InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { LegalService } from './legal.service';

const serviceReturning = (result: { data: unknown; error: unknown }) => {
  const select = jest.fn().mockResolvedValue(result);
  const supabase = { from: jest.fn(() => ({ select })) };
  return new LegalService({ supabase } as unknown as SupabaseService);
};

const row = (kind: string, extra: Record<string, unknown> = {}) => ({
  kind,
  version: '1.0.0',
  effective_date: '1. 11. 2026',
  title: `${kind} title`,
  intro: `${kind} intro`,
  sections: [{ heading: '1. Provozovatel' }],
  contact_email: null,
  ...extra,
});

describe('LegalService.getDocuments', () => {
  it('maps rows to the shape the app renders', async () => {
    const service = serviceReturning({
      data: [
        row('terms'),
        row('privacy', { version: '1.1.0', contact_email: 'gdpr@example.cz' }),
      ],
      error: null,
    });

    await expect(service.getDocuments()).resolves.toEqual({
      terms: {
        title: 'terms title',
        version: '1.0.0',
        effectiveDate: '1. 11. 2026',
        intro: 'terms intro',
        sections: [{ heading: '1. Provozovatel' }],
        contactEmail: null,
      },
      privacy: {
        title: 'privacy title',
        version: '1.1.0',
        effectiveDate: '1. 11. 2026',
        intro: 'privacy intro',
        sections: [{ heading: '1. Provozovatel' }],
        contactEmail: 'gdpr@example.cz',
      },
    });
  });

  it('returns null for a document with no row, so the app keeps its copy', async () => {
    const service = serviceReturning({ data: [row('terms')], error: null });
    const documents = await service.getDocuments();
    expect(documents.privacy).toBeNull();
    expect(documents.terms?.title).toBe('terms title');
  });

  it('fails loudly when the table cannot be read', async () => {
    const service = serviceReturning({
      data: null,
      error: { message: 'relation "legal_documents" does not exist' },
    });
    await expect(service.getDocuments()).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
