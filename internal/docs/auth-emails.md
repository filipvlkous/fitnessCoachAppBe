# Auth e-maily (Resend)

Potvrzení registrace a obnovení hesla posílá backend přes Resend, ne Supabase.
App dál volá `supabase.auth.signUp` / `resetPasswordForEmail` přímo; Supabase
pak místo odeslání e-mailu zavolá **Send Email Hook** → `POST /email/auth-hook`
(`src/email/`).

## Nastavení

1. **Resend:** ověřit doménu odesílatele, vytvořit API klíč.
2. **Env na serveru:**
   - `RESEND_API_KEY` — `re_...`
   - `EMAIL_FROM` — např. `Fitness App <noreply@vase-domena.cz>` (doména musí být ověřená v Resend)
   - `SEND_EMAIL_HOOK_SECRET` — secret z kroku 3, celý tvar `v1,whsec_...`
   - `SUPABASE_URL` — už existuje, z něj se skládá ověřovací odkaz
3. **Supabase dashboard → Authentication → Hooks → Send Email Hook:** typ HTTPS,
   URL `https://<backend>/email/auth-hook`, vygenerovat secret.

Po zapnutí hooku Supabase **neposílá žádné auth e-maily sám**.

## Chování

- Podporované typy: `signup`, `recovery`. Jiný typ (`magiclink`, `invite`,
  `email_change`, `reauthentication`) vrátí chybu, takže akce v appce selže
  viditelně, ne potichu. Při zavedení takové funkce přidat šablonu do
  `email.templates.ts`.
- Jazyk: `user_metadata.language` (`'en'` → anglicky, jinak česky). App ho má
  posílat při registraci: `signUp({ email, password, options: { data: { language } } })`.
- E-mail obsahuje odkaz (`/auth/v1/verify?token=…&type=…&redirect_to=…`,
  `redirect_to` z volání v appce, jinak Site URL) i 6místný kód pro `verifyOtp`.
- Podpis: Standard Webhooks (HMAC-SHA256 nad raw body, tolerance 5 min).
  Kvůli tomu `rawBody: true` v `main.ts`.
- `webhook-id` jde do Resend jako `Idempotency-Key` — retry ze Supabase
  nepošle e-mail dvakrát.
- Chyby vrací ve tvaru `{ error: { http_code, message } }`, který Supabase
  předá appce.
