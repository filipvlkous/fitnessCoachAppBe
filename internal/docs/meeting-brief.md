# Shrnutí před schůzkou (AI)

`GET /meetings/:id/brief?lang=cs|en` — trenér si před osobní schůzkou nechá
shrnout, co klient dělal od minulé schůzky. Appka: tlačítko na schválené
schůzce u trenéra → `MeetingBriefSheet`.

- **Kdo:** jen trenér té schůzky, jen `approved`. Jinak 404 (stejně jako
  `MeetingsService` — neprozrazuje, že id existuje). Navíc
  `assertSelfOrCoach`: schůzka přežije vztah, data ne.
- **Okno:** od poslední schválené schůzky téhož páru, max 28 dní; první
  schůzka = 14 dní. Konec = teď, nebo začátek schůzky, pokud už běží
  (`briefWindow` v `meeting-brief.facts.ts`).
- **Data jen podle scopů** z `getCoachDataAccess`: `workouts` (tréninky, RPE,
  posun nejčastějších cviků), `nutrition` (průměr kcal/bílkovin vs. cíl),
  `bodyMetrics` (váha). Nesdílený scope = `null` a do promptu nejde vůbec.
  **Chat se do Gemini neposílá** (rozhodnutí 2026-10-07).
- **Čísla počítá kód, ne model** (`buildBriefFacts`, pokryto jestem). Model
  je jen převádí do vět: `headline`, `wins`, `concerns`, `questions`.
- **Cache:** cache-manager, 6 h, klíč = schůzka + jazyk + hash faktů. Nový
  záznam klienta → jiný hash → nové shrnutí. Selhání modelu se necachuje.
- **Dva dotazy z appky:** model trvá 15–20 s (změřeno 2026-10-07 na
  `gemini-3-flash-preview`, `thinkingLevel` LOW ani MINIMAL nepomohly, časté
  503). Appka nejdřív volá `?summary=false` → čísla + jen cachované shrnutí,
  hned. Text pak druhým dotazem; sheet mezitím ukazuje „Píšu shrnutí…“.
  Jeden spinner na obojí vypadal jako zaseknutí.
- Nic zapsaného → model se nevolá, `summary: null`; appka ukáže čísla
  a hlášku. Selže model → čísla zůstanou, `summary: null`.
- RPE se čte samostatným dotazem, který smí selhat (sloupec z
  `sql/2026-09-16_workout_logs_rpe.sql`), vzor coach feedu.
