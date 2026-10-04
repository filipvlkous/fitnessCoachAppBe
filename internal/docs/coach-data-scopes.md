# Co smí trenér číst: scopy na serveru

Klient sdílí s trenérem tři scopy (`workouts`, `nutrition`, `bodyMetrics`) pod
souhlasem `coachSharing`. Platí jen to, co vrátí
`AccessService.getCoachDataAccess` — scope bez `coachSharing` je zavřený,
chybějící záznam je zavřený.

Dřív to zamykala jen appka; endpointy kontrolovaly jen „je to jeho trenér“.
Teď `assertSelfOrCoach` / `assertProgramAccess` / `assertWorkoutLogAccess`
berou volitelný `scope`. Uživatel sám sebe nikdy neomezuje, scope se
kontroluje jen když čte trenér.

| scope | endpointy |
| --- | --- |
| `nutrition` | `macros/mealHistory/:userId`, `macros/:userId` (GET i POST), `macros/:userId/:day`, `macros/dailyMacros/:id/:date`, `userController/dailyEntries/:id` |
| `bodyMetrics` | `userController/weight-history/:id`, `userController/body-photos/:userId`; `user/:userId/profile` a `user/:id` vrací bez `height`, `age`, `sex`, `goal`, `activity_level`, `date_of_birth` (null, zbytek řádku zůstává) |
| `workouts` | `workoutHistory` (měsíc), `workoutHistory/userDay/:id(/short)`, `workoutHistory/users/:userId/exercise-progress` |
| `workouts` + `nutrition` | `monthly-summary/:userId` (AI review čte obojí) |
| `workouts` | `monthly-summary/coach/:userId`; bez `nutrition` má `stats.nutrition` a `previousStats.nutrition` = `null` (appka kartu skryje) |

Nezamčené záměrně: program a jeho dny (autor je trenér), komentáře
k tréninku, suplementy (doporučuje trenér), chat.

**Nový endpoint s daty klienta = přidej scope.** Bez něj ho trenér přečte
bez ohledu na souhlas.

## Známá zpoždění

- `UserScopedCacheInterceptor` (GET macros, workoutHistory) drží kopii per
  čtenář až 5 min. Hit přeskočí handler, takže po odebrání scopu může trenér
  ještě do vypršení vidět, co si už načetl. Nikdy nedostane nic, co nesměl
  v okamžiku načtení.
- Monthly summary má cache sdílenou všemi čtenáři (12 h), proto se nutrition
  ořezává až po čtení z cache, per request.

## Monthly summary byla veřejná

Do 2026-10-04 měl `MonthlySummaryController` zakomentovaný `@UseGuards` i
kontrolu přístupu — kdokoli se znalostí UUID četl statistiky a spouštěl placené
volání Gemini. Kdo by ty řádky „dočasně“ zakomentoval znovu, otevře to celé.

## Ostatní z téhož auditu

- **Odebrání vztahu** (`removeCoachRelationByUserId`): trenér maže jen svůj
  vztah a svůj chat (klient může mít víc trenérů). `programId` z URL se ověří
  proti `user_id` před jakýmkoli mazáním.
- **Auth guard:** cache tokenu 30 s a nikdy přes `exp`. Neúspěšná ověření se
  počítají per IP (`X-Real-IP`), nad 20/min vrací 429 bez volání Supabase —
  throttler počítá podle tokenu, takže vymyšlený token na každý request by
  jinak dostal vždy nový budget. Počítadlo je sdílené všemi instancemi guardu
  (Nest dělá jednu na modul) a jen v paměti — při víc instancích backendu
  patří do Redis, stejně jako throttler.
- **RLS:** `sql/2026-10-04_rls_lockdown.sql` — RLS na všech tabulkách,
  anon bez práv v `public`, views bez `authenticated`. Na konci audit dotaz.
