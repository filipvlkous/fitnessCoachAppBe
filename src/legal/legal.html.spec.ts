import { renderLegalHtml } from './legal.html';

describe('renderLegalHtml', () => {
  const html = renderLegalHtml({
    title: 'Zásady ochrany osobních údajů',
    version: '1.0.0',
    effectiveDate: '1. 11. 2026',
    intro: 'Úvod <script>alert(1)</script>',
    sections: [
      {
        heading: '1. Kdo je správce',
        paragraphs: ['Odstavec'],
        bullets: ['Bod'],
        rows: [{ label: 'IČO', value: '123' }],
        paragraphsAfter: ['Závěr'],
      },
    ],
    contactEmail: 'gdpr@example.cz',
  });

  it('renders every part of a section', () => {
    expect(html).toContain('<h2>1. Kdo je správce</h2>');
    expect(html).toContain('<p>Odstavec</p>');
    expect(html).toContain('<li>Bod</li>');
    expect(html).toContain('<th>IČO</th><td>123</td>');
    expect(html).toContain('<p>Závěr</p>');
    expect(html).toContain('mailto:gdpr@example.cz');
  });

  it('escapes text from the database', () => {
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
