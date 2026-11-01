export type EmailLanguage = 'cs' | 'en';
export type AuthEmailType = 'signup' | 'recovery';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const COPY: Record<
  AuthEmailType,
  Record<
    EmailLanguage,
    { subject: string; heading: string; intro: string; button: string }
  >
> = {
  signup: {
    cs: {
      subject: 'Potvrďte svou registraci',
      heading: 'Vítejte!',
      intro: 'Pro dokončení registrace potvrďte svou e-mailovou adresu.',
      button: 'Potvrdit e-mail',
    },
    en: {
      subject: 'Confirm your sign-up',
      heading: 'Welcome!',
      intro: 'Please confirm your email address to finish signing up.',
      button: 'Confirm email',
    },
  },
  recovery: {
    cs: {
      subject: 'Obnovení hesla',
      heading: 'Obnovení hesla',
      intro: 'Obdrželi jsme žádost o obnovení hesla k vašemu účtu.',
      button: 'Nastavit nové heslo',
    },
    en: {
      subject: 'Reset your password',
      heading: 'Reset your password',
      intro: 'We received a request to reset the password for your account.',
      button: 'Set a new password',
    },
  },
};

const FOOTER: Record<EmailLanguage, { code: string; ignore: string }> = {
  cs: {
    code: 'Nebo zadejte v aplikaci kód:',
    ignore: 'Pokud jste o tento e-mail nežádali, můžete ho ignorovat.',
  },
  en: {
    code: 'Or enter this code in the app:',
    ignore: "If you didn't request this email, you can ignore it.",
  },
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** The confirmation / reset email, with both the link and the OTP code. */
export function renderAuthEmail(
  type: AuthEmailType,
  language: EmailLanguage,
  link: string,
  code: string,
): RenderedEmail {
  const copy = COPY[type][language];
  const footer = FOOTER[language];
  const href = escapeHtml(link);

  const html = `<!doctype html>
<html lang="${language}">
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
  <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
    <tr><td>
      <h1 style="margin:0 0 16px;font-size:22px">${copy.heading}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.5">${copy.intro}</p>
      <p style="margin:0 0 24px">
        <a href="${href}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px">${copy.button}</a>
      </p>
      <p style="margin:0 0 8px;font-size:14px">${footer.code}</p>
      <p style="margin:0 0 24px;font-size:24px;letter-spacing:4px;font-weight:bold">${escapeHtml(code)}</p>
      <p style="margin:0;font-size:13px;color:#71717a">${footer.ignore}</p>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    copy.heading,
    '',
    copy.intro,
    '',
    `${copy.button}: ${link}`,
    '',
    `${footer.code} ${code}`,
    '',
    footer.ignore,
  ].join('\n');

  return { subject: copy.subject, html, text };
}
