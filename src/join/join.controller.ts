import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';

/** Same shape the app generates: six characters from A–Z and 0–9. */
const CODE_PATTERN = /^[A-Z0-9]{6}$/;

const APP_SCHEME = 'athletica';

/**
 * The page a shared invite link opens.
 *
 * Deliberately public and deliberately dumb. A custom-scheme link
 * (`athletica://…`) is not clickable in most messengers, so what a coach shares
 * is an https link to this endpoint, which bounces the visitor into the app.
 *
 * It never looks the code up. Confirming which codes exist would turn a public
 * URL into an oracle for enumerating coaches, and it buys nothing: the app
 * validates the code when it sends the join request.
 */
@ApiExcludeController()
@Controller('join')
export class JoinController {
  @Get()
  openInApp(@Query('code') rawCode: string, @Res() res: Response) {
    const code = (rawCode ?? '').trim().toUpperCase();
    const valid = CODE_PATTERN.test(code);

    res
      .status(valid ? 200 : 400)
      .type('html')
      .send(valid ? page(code) : invalidPage());
  }
}

const escape = (value: string) =>
  value.replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`);

const storeLinks = () => {
  const ios = process.env.IOS_STORE_URL;
  const android = process.env.ANDROID_STORE_URL;
  if (!ios && !android) return '';

  const link = (href: string, label: string) =>
    `<a class="ghost" href="${escape(href)}">${label}</a>`;

  return `<div class="stores">
      ${ios ? link(ios, 'App Store') : ''}
      ${android ? link(android, 'Google Play') : ''}
    </div>`;
};

const shell = (body: string) => `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Athletica — kód trenéra</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; padding: 24px; background: #f5f5f7; color: #0f172a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .card {
    width: 100%; max-width: 380px; background: #fff; border-radius: 24px;
    padding: 32px 24px; text-align: center;
    box-shadow: 0 18px 40px rgba(15, 23, 42, 0.12);
  }
  h1 { margin: 0 0 8px; font-size: 20px; }
  p { margin: 0 0 20px; font-size: 14px; line-height: 1.5; color: #475569; }
  .code {
    display: inline-block; margin-bottom: 24px; padding: 12px 20px;
    border-radius: 14px; background: #f1f5f9; font-size: 28px;
    font-weight: 700; letter-spacing: 6px;
  }
  a.button, a.ghost {
    display: block; text-decoration: none; font-weight: 700; font-size: 15px;
    padding: 14px; border-radius: 14px;
  }
  a.button { background: #30b561; color: #fff; }
  a.ghost { background: #f1f5f9; color: #0f172a; margin-top: 10px; }
  .stores { display: flex; gap: 10px; margin-top: 10px; }
  .stores a { flex: 1; }
  .hint { margin: 20px 0 0; font-size: 12.5px; color: #64748b; }
  @media (prefers-color-scheme: dark) {
    body { background: #0f172a; color: #f8fafc; }
    .card { background: #1e293b; box-shadow: none; }
    p, .hint { color: #94a3b8; }
    .code, a.ghost { background: #334155; color: #f8fafc; }
  }
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;

const page = (code: string) => {
  const deepLink = `${APP_SCHEME}://join?code=${code}`;
  return shell(`
    <h1>Přidat trenéra</h1>
    <p>Otevřete Athletiku a připojte se k trenérovi s tímto kódem.</p>
    <div class="code">${code}</div>
    <a class="button" href="${deepLink}">Otevřít v aplikaci</a>
    ${storeLinks()}
    <p class="hint">
      Pokud se aplikace neotevře sama, zadejte kód ručně na úvodní obrazovce
      v sekci „Propojte se s trenérem“.
    </p>
    <script>
      // Fires on load for Android and most in-app browsers. iOS Safari often
      // requires the tap above, which is why the button is the primary action
      // and not a fallback.
      window.location.replace(${JSON.stringify(deepLink)});
    </script>
  `);
};

const invalidPage = () =>
  shell(`
    <h1>Neplatný odkaz</h1>
    <p>
      Tento odkaz neobsahuje platný kód trenéra. Požádejte trenéra, aby vám ho
      poslal znovu, nebo kód zadejte ručně v aplikaci.
    </p>
  `);
