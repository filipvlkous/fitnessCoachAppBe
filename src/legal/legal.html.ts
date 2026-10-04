import { LegalDocument } from './legal.service';

/** The section shape documented in `sql/2026-10-04_legal_documents.sql`. */
type LegalSection = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  paragraphsAfter?: string[];
  rows?: { label: string; value: string }[];
};

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const paragraphs = (items: string[] = []): string =>
  items.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');

const renderSection = (section: LegalSection): string => {
  const rows = section.rows?.length
    ? `<table><tbody>${section.rows
        .map(
          (r) =>
            `<tr><th>${escapeHtml(r.label)}</th><td>${escapeHtml(r.value)}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '';
  const bullets = section.bullets?.length
    ? `<ul>${section.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`
    : '';

  return `<h2>${escapeHtml(section.heading)}</h2>
${paragraphs(section.paragraphs)}
${bullets}
${rows}
${paragraphs(section.paragraphsAfter)}`;
};

/**
 * A legal document as a standalone public web page — the URL Google Play asks
 * for. Rendered from the same Supabase row the app reads, so the two never
 * drift apart.
 */
export const renderLegalHtml = (doc: LegalDocument): string => {
  const contact = doc.contactEmail
    ? `<p class="meta">Kontakt: <a href="mailto:${escapeHtml(doc.contactEmail)}">${escapeHtml(doc.contactEmail)}</a></p>`
    : '';

  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(doc.title)}</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #1a1a1a;
      background: #f5f5f7;
    }
    .container { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
    .card {
      background: #ffffff;
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
      overflow-wrap: anywhere;
    }
    h1 { font-size: 28px; margin: 0 0 8px; }
    h2 { font-size: 20px; margin: 32px 0 12px; }
    p, li { font-size: 16px; }
    .meta { color: #666; margin: 0 0 4px; font-size: 14px; }
    .intro { margin-top: 24px; }
    a { color: #0a66ff; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 15px; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #eaeaea; vertical-align: top; }
    th { width: 35%; font-weight: 600; }
    @media (prefers-color-scheme: dark) {
      body { color: #eaeaea; background: #111114; }
      .card { background: #1c1c1f; box-shadow: none; }
      .meta { color: #a0a0a0; }
      th, td { border-bottom-color: #333; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>${escapeHtml(doc.title)}</h1>
      <p class="meta">Verze ${escapeHtml(doc.version)} &middot; Účinnost od ${escapeHtml(doc.effectiveDate)}</p>
      ${contact}
      <p class="intro">${escapeHtml(doc.intro)}</p>
      ${(doc.sections as LegalSection[]).map(renderSection).join('\n')}
    </div>
  </div>
</body>
</html>`;
};
