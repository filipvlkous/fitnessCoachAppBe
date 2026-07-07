import { Injectable } from '@nestjs/common';

const APP_NAME = 'Fitness App';
const DEVELOPER_NAME = 'Fitness App';
const SUPPORT_EMAIL = 'support@fitness-app.example';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  getDeleteAccountPage(): string {
    return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Žádost o smazání účtu – ${APP_NAME}</title>
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
    .container {
      max-width: 760px;
      margin: 0 auto;
      padding: 32px 20px 64px;
    }
    .card {
      background: #ffffff;
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
    }
    h1 { font-size: 28px; margin: 0 0 8px; }
    h2 { font-size: 20px; margin: 32px 0 12px; }
    p, li { font-size: 16px; }
    .subtitle { color: #666; margin: 0 0 24px; }
    ol.steps { padding-left: 20px; }
    ol.steps li { margin-bottom: 10px; }
    a { color: #0a66ff; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      font-size: 15px;
    }
    th, td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid #eaeaea;
      vertical-align: top;
    }
    th { background: #fafafa; font-weight: 600; }
    .note {
      margin-top: 24px;
      padding: 16px;
      background: #f0f6ff;
      border-radius: 12px;
      font-size: 15px;
    }
    footer { margin-top: 32px; color: #888; font-size: 13px; }
    @media (prefers-color-scheme: dark) {
      body { color: #eaeaea; background: #111114; }
      .card { background: #1c1c1f; box-shadow: none; }
      .subtitle { color: #a0a0a0; }
      th { background: #26262b; }
      th, td { border-bottom-color: #333; }
      .note { background: #16233a; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>Žádost o smazání účtu</h1>
      <p class="subtitle">Aplikace <strong>${APP_NAME}</strong> &middot; Vývojář <strong>Filip Vlk</strong></p>

      <p>
        Na této stránce se dozvíte, jak požádat o smazání svého uživatelského účtu
        v aplikaci <strong>${APP_NAME}</strong> a jaké údaje budou smazány nebo naopak
        po určitou dobu uchovány.
      </p>

      <h2>Jak požádat o smazání účtu</h2>
      <ol class="steps">
        <li>
          Zašlete e-mail na adresu
          <a href="mailto:filipvlkous@gmail.com?subject=Žádost o smazání účtu">filipvlkous@gmail.com</a>
          z e-mailové adresy, kterou používáte pro přihlášení do aplikace.
        </li>
        <li>Do předmětu uveďte <strong>„Žádost o smazání účtu“</strong>.</li>
        <li>
          Pro ověření totožnosti uveďte e-mail nebo uživatelské jméno spojené s vaším účtem.
        </li>
        <li>
          Vaši žádost zpracujeme a účet i související osobní údaje smažeme
          <strong>nejpozději do 30 dnů</strong> od ověření žádosti. O dokončení
          vás budeme informovat e-mailem.
        </li>
      </ol>

      <h2>Které údaje budou smazány</h2>
      <p>Po smazání účtu trvale odstraníme následující data:</p>
      <table>
        <thead>
          <tr><th>Typ dat</th><th>Doba uchování</th></tr>
        </thead>
        <tbody>
          <tr><td>Údaje profilu (jméno, e-mail, uživatelské jméno)</td><td>Smazáno neprodleně po zpracování žádosti</td></tr>
          <tr><td>Tréninkový plán a historie tréninků</td><td>Smazáno neprodleně po zpracování žádosti</td></tr>
          <tr><td>Nutriční údaje, makra a záznamy o doplňcích</td><td>Smazáno neprodleně po zpracování žádosti</td></tr>
          <tr><td>Nahrané fotografie a obrázky</td><td>Smazáno neprodleně po zpracování žádosti</td></tr>
          <tr><td>Příspěvky a aktivita v komunitním feedu</td><td>Smazáno neprodleně po zpracování žádosti</td></tr>
        </tbody>
      </table>

      <h2>Které údaje mohou být dočasně uchovány</h2>
      <p>
        Některé údaje jsme povinni po omezenou dobu uchovávat z právních, účetních
        nebo bezpečnostních důvodů:
      </p>
      <table>
        <thead>
          <tr><th>Typ dat</th><th>Doba uchování</th></tr>
        </thead>
        <tbody>
          <tr><td>Účetní a fakturační doklady (pokud existují)</td><td>Uchováno po dobu vyžadovanou zákonem (zpravidla až 10 let)</td></tr>
          <tr><td>Záznamy nezbytné k prevenci podvodů a zneužití</td><td>Uchováno po nezbytně nutnou dobu, nejdéle 90 dnů</td></tr>
          <tr><td>Zálohy systému</td><td>Automaticky přepsány zpravidla do 30 dnů</td></tr>
        </tbody>
      </table>

      <div class="note">
        Máte-li jakékoliv dotazy k procesu smazání účtu nebo ke zpracování vašich
        osobních údajů, kontaktujte nás na adrese
        <a href="mailto:filipvlkous@gmail.com?subject=Žádost o smazání účtu">filipvlkous@gmail.com</a>.
      </div>

      <footer>
        &copy; ${new Date().getFullYear()} Filip Vlk. Všechna práva vyhrazena.
      </footer>
    </div>
  </div>
</body>
</html>`;
  }
}
